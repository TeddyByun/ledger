import * as XLSX from 'xlsx';
import { Issuer } from '@ledger/shared';
import { readTabular } from '../../../src/ingestion/parsers/tabular.js';
import { ShinhanCardParser } from '../../../src/ingestion/parsers/shinhan-card.parser.js';

const parser = new ShinhanCardParser();
const ctx = { issuer: Issuer.SHINHAN_CARD, statementYm: '2026-09' };
const header = ['이용일', '이용카드', '이용가맹점', '이용금액', '할부기간', '회차', '원금', '수수료', '적용구분'];
const detail = (date: string, merchant = '테스트식당') => [date, '본인253', merchant, '12000', '', '', '12000', '0', '정상'];
function parse(rows: string[][]) {
  const result = parser.parse([['2026년 9월 이용대금명세서'], header, ...rows], ctx);
  if (result.kind !== 'card') throw new Error('card expected');
  return result.statement;
}

describe('신한 이용일 보존', () => {
  it('이전 XLS 리더의 미국식 날짜도 청구월 1일로 바꾸지 않는다', () => {
    const r = parse([detail('8/13/26'), detail('8/1/26')]);
    expect(r.rows.map((row) => row.txnDate.toISOString().slice(0, 10))).toEqual(['2026-08-13', '2026-08-01']);
    expect(r.billingDate).toBeNull();
  });
  it.each(['잘못된 날짜', '2026.13.45', '', '2026.08.13 99:99'])('일반 거래의 잘못된 이용일 %s 는 저장 전에 거부한다', (date) => {
    expect(() => parse([detail('2026.08.01'), detail(date)])).toThrow('거래일을 임의로 대체하지 않았습니다');
  });
  it('날짜가 원래 없는 연회비만 명세서의 유효한 사용일로 귀속한다', () => {
    const r = parse([detail('2026.08.13'), detail('', '기본연회비')]);
    expect(r.rows[1]?.txnDate.toISOString()).toBe('2026-08-13T00:00:00.000Z');
  });
  it('유효한 사용일이 하나도 없으면 연회비도 청구월 1일에 넣지 않는다', () => {
    expect(() => parse([detail('', '기본연회비')])).toThrow('이용일');
  });
  it('HTML XLS와 XLSX의 같은 거래는 같은 이용일과 키로 정규화된다', async () => {
    const rows = [['2026년 9월 이용대금명세서'], header, detail('2026.08.13'), detail('2026.08.01')];
    const html = `<html><table>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td   >`).join('')}</tr>`).join('')}</table></html>`;
    const book = XLSX.utils.book_new();XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), '명세서');
    const xlsx = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const a = parser.parse(await readTabular(Buffer.from(html), 'source.xls'), ctx);
    const b = parser.parse(await readTabular(xlsx, 'source.xlsx'), ctx);
    expect(a).toEqual(b);
  });
});
