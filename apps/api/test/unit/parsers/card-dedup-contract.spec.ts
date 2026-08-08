/**
 * 카드 파서 dedupHash 계약 테스트 (TEST_STRATEGY_DESIGN.md §4.3).
 *
 * 계약: **할부는 회차마다 별개 청구건**이다. 할부 행은 매달 명세서에서
 * 이용일·가맹점·이용금액·원금·카드번호가 전부 동일하므로, 회차가 dedupHash 에
 * 들어가지 않으면 파이프라인의 중복 검사(import-pipeline.service.ts:422)에 걸려
 * **2회차 이후가 조용히 유실된다.**
 *
 * 새 발급사 파서를 추가할 때 이 스위트만 통과하면 파이프라인 호환이 보장된다.
 */
import { Issuer } from '@ledger/shared';
import { ShinhanCardParser } from '../../../src/ingestion/parsers/shinhan-card.parser.js';
import type { ParseContext } from '../../../src/ingestion/parsers/types.js';

const ctx: ParseContext = { issuer: Issuer.SHINHAN_CARD, statementYm: '2026-05' };

/**
 * 신한 상세내역 최소 rows. 컬럼 고정:
 * 이용일 | 이용카드 | 이용가맹점 | 이용금액 | 할부기간 | 회차 | 원금 | 수수료 | 적용구분
 */
function shinhanRows(billingRound: string, fee: string): string[][] {
  return [
    ['2026년 5월 이용대금명세서'],
    ['이용일', '이용카드', '이용가맹점', '이용금액', '할부기간', '회차', '원금', '수수료', '적용구분'],
    ['2026.03.10', '본인253', '전자랜드 김포점', '300,000', '3', billingRound, '100,000', fee, '정상'],
  ];
}

function parseOne(billingRound: string, fee = '1,000') {
  const result = new ShinhanCardParser().parse(shinhanRows(billingRound, fee), ctx);
  if (result.kind !== 'card') throw new Error('expected card result');
  const row = result.statement.rows[0];
  if (!row) throw new Error('행이 파싱되지 않았다');
  return row;
}

describe('ShinhanCardParser', () => {
  it('할부 행의 기본 필드를 정규화한다', () => {
    const row = parseOne('1');

    expect(row).toMatchObject({
      cardLabel: '본인253',
      cardNo: '253',
      merchantName: '전자랜드 김포점',
      usageAmount: 300_000,
      principal: 100_000, // 이번 달 납부원금 (총액 아님)
      fee: 1_000,
      installmentPeriod: '3',
      billingRound: '1',
      isCanceled: false,
    });
    expect(row.txnDate.toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });

  it('본인/가족 카드가 아닌 행은 거래로 인정하지 않는다', () => {
    const rows = shinhanRows('1', '1,000');
    rows[2]![1] = '할인내역'; // 이용카드 칸이 카드 라벨이 아님
    const result = new ShinhanCardParser().parse(rows, ctx);

    expect(result.kind === 'card' && result.statement.rows).toHaveLength(0);
  });

  // ── 알려진 결함: 감사보고서 P1 #7 (shinhan-card.parser.ts:85) ──
  // hana/hyundai/samsung 은 billingRound 를 해시에 포함하는데 신한만 누락됐다.
  // 수정(회차·할부기간 추가) 후 `.failing` 을 떼면 그대로 회귀 테스트가 된다.
  it.failing('회차가 다르면 dedupHash 도 달라야 한다 (미수정)', () => {
    const round1 = parseOne('1', '1,000');
    const round2 = parseOne('2', '700'); // 회차별 이자도 다르다

    expect(round2.dedupHash).not.toBe(round1.dedupHash);
  });

  it('현재는 회차가 달라도 해시가 동일하다 — 유실 재현', () => {
    // 위 결함이 실제로 존재함을 명시적으로 고정해 둔다.
    // #7 을 수정하면 이 테스트를 삭제하고 위 `.failing` 을 정식 테스트로 승격한다.
    expect(parseOne('2', '700').dedupHash).toBe(parseOne('1', '1,000').dedupHash);
  });
});
