import { CashflowService } from '../../../src/statistics/cashflow.service.js';

const ym = '2099-09';
const date = (day: number) => new Date(`${ym}-${String(day).padStart(2, '0')}T00:00:00Z`);
const bank = (id: number, account: number, day: number, description: string, deposit: number, withdrawal: number, code = '') => ({
  id, paymentMethodId: account, txnAt: date(day), description, deposit, withdrawal, txnTypeRaw: '이체', excludeReason: null, transaction: { categoryCode: code },
});
const banks = [1, 2, 3, 4].map((id) => ({ id, name: `통장${id}`, accountNo: `${id}${id}${id}`, excludeFromStats: id === 4 }));
const rows = [
  bank(1, 2, 4, 'VNTG급여', 7000, 0, '13'),
  bank(2, 2, 4, 'VNTG', 0, 7000, '18'), bank(3, 1, 4, 'VNTG', 7000, 0, '19'),
  bank(4, 1, 5, '444', 8000, 0, '19'), bank(5, 4, 5, '111', 0, 8000, '18'),
  bank(6, 1, 10, '444', 0, 200, '02'), bank(7, 4, 10, '111', 200, 0, '19'),
  bank(8, 1, 20, '집대출', 0, 1000, '18'), bank(9, 3, 20, '집대출', 1000, 0, '19'),
  bank(10, 3, 20, '주택대출', 0, 900, '01'), bank(11, 1, 11, '보험료', 0, 300, '03'),
  bank(12, 1, 14, '삼성카드', 0, 600, '18'),
];
const recurring = (id: number, label: string, amount: number, day: number, account: number, flow = 'expense', methodType = 'bank') => ({
  id, label, amount, dayOfMonth: day, paymentMethodId: account, matchKey: label, flow,
  paymentMethod: { id: account, name: `${methodType}${account}`, methodType }, cadence: 'monthly', months: [], startYm: null, endYm: null, amountType: 'fixed',
});
const plans = [
  recurring(1, 'VNTG 급여', 7500, 5, 2, 'income'), recurring(2, '주택대출', 950, 22, 3),
  recurring(3, '보험료', 350, 11, 1), recurring(4, '444', 200, 10, 1), recurring(5, '공과금', 100, 28, 3),
  recurring(6, '삼성카드', 600, 14, 1), recurring(7, '구독서비스', 110, 25, 5, 'expense', 'card'),
];
const card = (id: number, merchantName: string, principal: number, isCanceled = 'N') => ({
  id, paymentMethodId: 5, txnDate: date(24), merchantName, principal, fee: 0, isCanceled, transaction: null,
});
function service(extraRows: ReturnType<typeof bank>[] = []) {
  const db = {
    paymentMethod: { findMany: async ({ where }: { where: { methodType: string } }) => where.methodType === 'bank' ? banks : [{ id: 5, name: '삼성카드', issuer: '삼성카드' }] },
    bankTransaction: {
      findMany: async () => [...rows, ...extraRows],
      findFirst: async ({ where }: { where: { paymentMethodId: number } }) => ({ balance: where.paymentMethodId * 1000, txnAt: new Date('2099-08-31') }),
    },
    cardTransaction: { findMany: async () => [card(1, '구독서비스', 100), card(2, '상점', 300), card(3, '취소구매', 100, 'Y'), card(4, '환불', -50, 'Y')] },
    cardStatement: { findMany: async () => [] },
    recurringExpense: { findMany: async () => plans },
    category: { findMany: async () => [{ code: '18' }, { code: '19' }] },
  };
  return new CashflowService(db as never);
}

describe('기준 통장 합산 현금흐름과 은행·카드 소비 예상', () => {
  it('급여는 최초 입금만, 적금과의 입출금은 외부 거래로 집계한다', async () => {
    const r = await service().cashflow(ym);
    expect(r.income).toMatchObject({ baseline: 7500, actual: 15000, predicted: 0, total: 15000, unplannedActual: 8000 });
    expect(r.transfer).toEqual({ in: 8000, out: 8000, net: 0 });
    expect(r.scope.accounts).toHaveLength(3);
    expect(r.income.predictedItems.find((p) => p.label === 'VNTG 급여')).toMatchObject({ occurred: 7000, remaining: 0, revised: 7000 });
  });
  it('현금 출금은 카드대금을 포함하고 소비 지출은 카드 사용을 한 번만 포함한다', async () => {
    const r = await service().cashflow(ym);
    expect(r.expense).toMatchObject({ baseline: 2200, actual: 2000, predicted: 100, total: 2100 });
    expect(r.spending).toMatchObject({ baseline: 1710, bankActual: 1400, cardActual: 350, cardSettlementActual: 600, actual: 1750, predicted: 100, total: 1850 });
    expect(r.spending.actualItems.some((l) => l.label === '삼성카드')).toBe(false);
    expect(r.spending.predictedItems.find((p) => p.label === '구독서비스')).toMatchObject({ occurred: 100, remaining: 0, revised: 100, occurrences: [{ date: `${ym}-24`, amount: 100, source: 'card' }] });
  });
  it('일별 흐름과 합계·세 통장 합산 잔액이 일치한다', async () => {
    const r = await service().cashflow(ym);
    expect(r.opening.balance).toBe(6000);
    expect(r.current.balance).toBe(19000);
    expect(r.closing.balance).toBe(18900);
    expect(r.opening.balance + r.net).toBe(r.closing.balance);
    expect(r.current.balance + r.remainingNet).toBe(r.closing.balance);
    expect(r.daily.reduce((n, d) => n + d.income, 0)).toBe(r.income.total);
    expect(r.daily.reduce((n, d) => n + d.expense, 0)).toBe(r.expense.total);
    expect(r.spending.actualItems.reduce((n, l) => n + l.amount, 0)).toBe(r.spending.actual);
    expect(r.consumptionNet).toBe(r.income.total - r.spending.total);
  });
  it('실적 무시 모드는 정기 계획만 남기며 금월 실적이 기준 예상에 섞이지 않는다', async () => {
    const r = await service().cashflow(ym, undefined, true);
    expect(r.income).toMatchObject({ actual: 0, predicted: 7500, total: 7500 });
    expect(r.expense).toMatchObject({ actual: 0, predicted: 2200, total: 2200 });
    expect(r.spending).toMatchObject({ actual: 0, predicted: 1710, total: 1710 });
  });
  it('변동 지출은 실적 기준일 이후의 과거 지출만 남은 예상에 반영한다', async () => {
    const history = [6, 7, 8].flatMap((month) => [10, 27].map((day) => ({
      ...bank(100 + month * 2 + (day === 27 ? 1 : 0), 1, day, '비정기 생활비', 0, day === 10 ? 90 : 60),
      txnAt: new Date(Date.UTC(2099, month - 1, day)),
    })));
    const r = await service(history).cashflow(ym);
    expect(r.expense).toMatchObject({ variableBaseline: 150, variableRemaining: 60, predicted: 160, total: 2160 });
    expect(r.spending).toMatchObject({ variableBaseline: 150, variableRemaining: 60, predicted: 160, total: 1910 });
    expect(r.daily.find((d) => d.day === 27)?.expense).toBe(60);
    expect(r.daily.reduce((n, d) => n + d.expense, 0)).toBe(r.expense.total);
  });

});
