import ExcelJS from 'exceljs';
import { cardAmounts } from '@ledger/shared';
import { StatementTxnService } from '../../../src/statement-txn/statement-txn.service.js';

const discount = { usageAmount: '98640', principal: '83640', fee: '0', installmentPeriod: null, isCanceled: 'N' as const };
const overseas = { usageAmount: '276582', principal: '276582', fee: '492', installmentPeriod: null, isCanceled: 'N' as const };
const installment = { usageAmount: '10500', principal: '10000', fee: '500', installmentPeriod: '3', isCanceled: 'N' as const };
const refund = { usageAmount: '-5000', principal: '-5000', fee: '0', installmentPeriod: null, isCanceled: 'Y' as const };

describe('카드 할인·수수료 분리', () => {
  it('이미 할인된 원금을 다시 차감하지 않는다', () => {
    expect(cardAmounts(discount)).toEqual({ usageAmount: 98640, discountAmount: 15000, feeAmount: 0, payAmount: 83640 });
  });
  it('신한 해외이용 수수료 492원을 할인으로 표시하지 않는다', () => {
    expect(cardAmounts(overseas)).toEqual({ usageAmount: 276582, discountAmount: 0, feeAmount: 492, payAmount: 277074 });
  });
  it('한 거래에 할인과 수수료가 모두 있으면 각각 표시한다', () => {
    expect(cardAmounts({ ...discount, fee: 200 })).toEqual({ usageAmount: 98640, discountAmount: 15000, feeAmount: 200, payAmount: 83840 });
  });
  it('할부의 이번 회차 원금과 이자를 나누고 이자를 할인으로 오인하지 않는다', () => {
    expect(cardAmounts(installment)).toEqual({ usageAmount: 10000, discountAmount: 0, feeAmount: 500, payAmount: 10500 });
  });
  it('취소·환불 금액을 청구할인으로 표시하지 않는다', () => {
    expect(cardAmounts({ ...discount, principal: 0, isCanceled: 'Y' }).discountAmount).toBe(0);
    expect(cardAmounts(refund)).toEqual({ usageAmount: -5000, discountAmount: 0, feeAmount: 0, payAmount: -5000 });
  });

  const data = [discount, overseas, installment, refund].map((amounts, index) => ({
    ...amounts, id: index + 1, txnDate: new Date('2026-09-13'), merchantName: `테스트거래${index}`,
    cardLabel: '본인', paymentMethod: { name: '테스트카드' }, billingRound: '2', transaction: null,
  }));
  function service() {
    const db = { cardTransaction: { findMany: async () => data } };
    return new StatementTxnService(db as never, {} as never, {} as never, {} as never);
  }
  it('합계에서도 할인과 수수료를 상계하지 않는다', async () => {
    expect(await service().findCardSummary({ offset: 0, limit: 50 })).toEqual({ count: 4, usageAmount: 380222, discountAmount: 15000, feeAmount: 992, payAmount: 366214 });
  });
  it('엑셀은 할인 음수·수수료 양수의 별도 열과 실제 결제금액을 내보낸다', async () => {
    const buffer = await service().exportCard({ offset: 0, limit: 50 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(['G1', 'H1', 'I1', 'J1'].map((address) => ws.getCell(address).value)).toEqual(['이용금액', '할인금액', '수수료(이자)', '결제금액']);
    const amounts = [2, 3, 4, 5].map((row) => ['G', 'H', 'I', 'J'].map((col) => ws.getCell(`${col}${row}`).value));
    expect(amounts).toEqual([[98640, -15000, 0, 83640], [276582, 0, 492, 277074], [10000, 0, 500, 10500], [-5000, 0, 0, -5000]]);
  });
});
