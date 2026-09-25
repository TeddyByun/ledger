import { Issuer } from '@ledger/shared';
import { ParserRegistry } from '../../../src/ingestion/parsers/parser.registry.js';
import { readTabular } from '../../../src/ingestion/parsers/tabular.js';
import { locateHeader } from '../../../src/ingestion/parsers/generic.js';
import { interimCardStatements, interimWorkbook } from '../../fixtures/interim-card-statements.js';

const registry = new ParserRegistry();
function parse(issuer: Issuer, rows: string[][]) {
  const result = registry.get(issuer).parse(rows, { issuer });
  if (result.kind !== 'card') throw new Error('expected card result');
  return result.statement;
}

describe('카드 중간이용내역', () => {
  it.each(interimCardStatements)('$issuer 엑셀을 기존 발급사 선택으로 읽는다', async (fixture) => {
    const rows = await readTabular(interimWorkbook(fixture.rows), '중간이용내역.xlsx');
    const statement = parse(fixture.issuer, rows);
    expect(statement.statementYm).toBe('2026-10');
    expect(statement.totalCount).toBe(fixture.amounts.length);
    expect(statement.totalAmount).toBe(fixture.total);
    expect(statement.rows.map((r) => r.principal + r.fee)).toEqual(fixture.amounts);
    expect(statement.rows.every((r) => r.cardNo || r.cardLabel)).toBe(true);
    expect(parse(fixture.issuer, rows)).toEqual(statement);
  });

  it('삼성의 취소는 원거래와 상계하고 같은 날 같은 금액의 별도 승인은 구분한다', () => {
    const fixture = interimCardStatements[0]!;
    const statement = parse(fixture.issuer, fixture.rows);
    expect(statement.billingDate?.toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(statement.rows[0]).toMatchObject({ cardNo: '2252', installmentPeriod: null });
    expect(statement.rows[2]).toMatchObject({ usageAmount: -300000, principal: -300000, isCanceled: true });
    expect(new Set(statement.rows.map((r) => r.dedupHash)).size).toBe(4);
  });

  it('하나의 미매입 승인, 매입 할인, 전체 취소를 구분한다', () => {
    const fixture = interimCardStatements[1]!;
    const { rows } = parse(fixture.issuer, fixture.rows);
    expect(rows[0]).toMatchObject({ cardNo: '4480', usageAmount: 12000, principal: 12000, installmentPeriod: null });
    expect(rows[1]).toMatchObject({ cardNo: '9540', principal: 9930, benefitAmount: 70, benefitType: '할인' });
    expect(rows[2]).toMatchObject({ principal: 0, isCanceled: true });
  });

  it('신한의 0개월·0회차는 일시불이고 할부의 결제금액·이자를 별도로 읽는다', () => {
    const fixture = interimCardStatements[2]!;
    const { rows } = parse(fixture.issuer, fixture.rows);
    expect(rows[0]).toMatchObject({ installmentPeriod: null, billingRound: null, principal: 15000 });
    expect(rows[1]).toMatchObject({ installmentPeriod: '3', billingRound: '2', usageAmount: 300000, principal: 100000, fee: 500 });
    expect(rows[2]).toMatchObject({ usageAmount: 98640, principal: 83640, fee: 0 });
    expect(rows[3]).toMatchObject({ usageAmount: 276582, principal: 276582, fee: 492 });
  });

  it('현대의 적립율과 적립금액을 구분하고 할부잔액을 청구 합계로 읽지 않는다', () => {
    const fixture = interimCardStatements[3]!;
    const statement = parse(fixture.issuer, fixture.rows);
    expect(statement.totalAmount).toBe(16000);
    expect(statement.rows[0]).toMatchObject({ cardLabel: '본인 테스트카드', point: 30 });
    expect(statement.rows[1]).toMatchObject({ cardLabel: '본인 테스트카드', usageAmount: 100000, principal: 10000 });
  });

  it('금액을 읽을 수 없는 승인내역을 0원으로 저장하지 않는다', () => {
    const fixture = interimCardStatements[0]!;
    const rows = fixture.rows.map((row) => [...row]);
    rows[3]![5] = '금액 오류';
    expect(() => parse(fixture.issuer, rows)).toThrow('승인금액');
  });

  it('정확한 헤더 이름을 우선하되 단위가 붙은 헤더도 지원한다', () => {
    const result = locateHeader([
      ['예상적립/할인율(%)', '예상적립/할인', '승인금액(원)'],
    ], { benefit: ['예상적립/할인'], amount: ['승인금액'] });
    expect(result.columns).toEqual({ benefit: 1, amount: 2 });
  });
});
