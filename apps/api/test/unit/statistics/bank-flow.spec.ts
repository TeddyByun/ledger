import { internalBankTransfers, isCardSettlement, referencedBank } from '../../../src/statistics/bank-flow.js';

const banks = [{ id: 1, name: '통장1', accountNo: '123-456' }, { id: 2, name: '통장2', accountNo: '234-567' }];
const row = (id: number, account: number, label: string, deposit: number, withdrawal: number, code = '') => ({ id, paymentMethodId: account, txnAt: new Date('2026-09-04'), description: label, deposit, withdrawal, transaction: { categoryCode: code } });

describe('기준 통장 사이 내부 이체 판별', () => {
  it('같은 날 같은 금액이어도 다른 외부 거래를 임의로 지우지 않는다', () => {
    expect(internalBankTransfers([row(1, 1, '급여', 100, 0), row(2, 2, '보험료', 0, 100)], banks, new Set())).toEqual(new Set());
  });
  it('기준 밖 적금 통장과 짝인 거래는 분류 제외 표시가 있어도 외부로 남긴다', () => {
    expect(internalBankTransfers([row(1, 1, '적금', 100, 0, '19'), row(2, 3, '적금', 0, 100, '18')], banks, new Set(['18', '19']))).toEqual(new Set());
  });
  it('이체 짝은 서로 다른 기준 통장끼리 한 번만 연결한다', () => {
    expect(internalBankTransfers([row(1, 1, '이체', 100, 0), row(2, 2, '이체', 0, 100), row(3, 2, '이체', 0, 100)], banks, new Set())).toEqual(new Set([1, 2]));
  });
  it('명시된 계좌번호는 전체 번호가 일치하고 범위 안인 경우만 내부로 본다', () => {
    expect(referencedBank('234567', banks, 1)?.id).toBe(2);
    expect(referencedBank('234568', banks, 1)).toBeUndefined();
    expect(referencedBank('123456', banks, 1)).toBeUndefined();
  });
  it('카드대금은 내부 이체와 같은 금액이어도 외부 출금으로 유지한다', () => {
    const bill = row(1, 1, '삼성카드', 0, 100, '18');
    expect(isCardSettlement(bill)).toBe(true);
    expect(internalBankTransfers([bill, row(2, 2, '입금', 100, 0, '19')], banks, new Set(['18', '19']))).toEqual(new Set());
  });
});
