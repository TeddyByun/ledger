import { Issuer } from '@ledger/shared';
import { HyundaiCardParser } from '../../../src/ingestion/parsers/hyundai-card.parser.js';
import { readTabular } from '../../../src/ingestion/parsers/tabular.js';

/** 현대카드 HTML 형식 .xls의 셀 경계·빈 열·텍스트 서식을 재현한 가상 명세서. */
function htmlStatement(merchantEndTag: string, headerEndTag: string): Buffer {
  return Buffer.from(`
    <!DOCTYPE html>
    <html lang="ko">
      <head><meta charset="utf-8"></head>
      <body><table>
        <tr><th colspan="10">2026년 09월 이용대금명세서</th></tr>
        <tr><th colspan="10">결제 상세내역</th></tr>
        <tr>
          <th>이용일</th><th>이용카드</th><th>이용가맹점${headerEndTag}
          <th>이용금액</th><th>할부/회차</th><th>적립/할인율(%)</th>
          <th>예상적립/할인</th><th>결제원금</th><th>결제후잔액</th><th>수수료(이자)</th>
        </tr>
        <tr>
          <td>2026년 08월 01일</td><td>본인 테스트카드</td><td>테스트마트${merchantEndTag}
          <td align="right">120,000</td><td></td><td>0.5%</td>
          <td>500</td><td>100,000</td><td>0</td><td>0</td>
        </tr>
        <tr>
          <td>2026년 08월 08일</td><td>본인 테스트카드</td><td>테스트마트${merchantEndTag}
          <td align="right">-20,000</td><td></td><td>0%</td>
          <td>0</td><td>0</td><td>0</td><td>0</td>
        </tr>
        <tr>
          <td>2026년 08월 10일</td><td>본인 테스트카드</td><td>테스트카페${merchantEndTag}
          <td align="right">10,000</td><td></td><td>0.7%</td>
          <td>-70</td><td>9,930</td><td>0</td><td>0</td>
        </tr>
        <tr>
          <td>2026년 07월 15일</td><td>본인 테스트카드</td><td>테스트가전${merchantEndTag}
          <td align="right">300,000</td><td style='mso-number-format:"\\@";'>3/2</td><td>0%</td>
          <td>0</td><td>100,000</td><td>100,000</td><td>1,000</td>
        </tr>
        <tr><td>-</td><td></td><td>소계</td><td>0</td><td></td><td></td><td>0</td><td>210,930</td><td>0</td><td>0</td></tr>
        <tr><td>-</td><td></td><td>총 합계 4 건</td><td>0</td><td></td><td></td><td>0</td><td>210,930</td><td>0</td><td>0</td></tr>
      </table></body>
    </html>
  `);
}

describe('HyundaiCardParser — HTML 형식 .xls 업로드', () => {
  it.each([
    ['</td   >', '</th>'],
    ['</TD \t\r\n>', '</th>'],
    ['</td>', '</th\t>'],
    ['</td>', '</th>'],
  ])(
    '셀 닫는 태그 %j / %j에서도 이용금액·원금·혜택·할부 열을 유지한다',
    async (merchantEndTag, headerEndTag) => {
      const rows = await readTabular(htmlStatement(merchantEndTag, headerEndTag), 'hyundai.xls');
      // HTML의 숫자/회차/비율을 자동 변환하지 않고 원문 그대로 전달한다.
      expect(rows[6]?.slice(3, 6)).toEqual(['300,000', '3/2', '0%']);
      const result = new HyundaiCardParser().parse(rows, { issuer: Issuer.HYUNDAI_CARD });
      if (result.kind !== 'card') throw new Error('expected card result');

      expect(result.statement).toMatchObject({
        statementYm: '2026-09', totalAmount: 210_930, totalCount: 4,
      });
      expect(result.statement.rows).toHaveLength(4);
      expect(result.statement.rows[0]).toMatchObject({
        txnDate: new Date('2026-08-01T00:00:00.000Z'),
        cardLabel: '본인 테스트카드', merchantName: '테스트마트',
        usageAmount: 120_000, principal: 100_000, fee: 0,
        point: 500, benefitAmount: 0, benefitType: '적립',
        installmentPeriod: null, billingRound: null, isCanceled: false,
      });
      expect(result.statement.rows[1]).toMatchObject({
        merchantName: '테스트마트', usageAmount: -20_000,
        principal: 0, fee: 0, isCanceled: true,
      });
      expect(result.statement.rows[2]).toMatchObject({
        usageAmount: 10_000, principal: 9_930,
        benefitAmount: -70, benefitType: '할인', point: 0,
      });
      expect(result.statement.rows[3]).toMatchObject({
        txnDate: new Date('2026-07-15T00:00:00.000Z'),
        usageAmount: 300_000, principal: 100_000, fee: 1_000,
        installmentPeriod: '3', billingRound: '2', saleType: '할부',
      });
      expect(result.statement.rows.reduce((sum, row) => sum + row.principal + row.fee, 0))
        .toBe(result.statement.totalAmount);
    },
  );
});
