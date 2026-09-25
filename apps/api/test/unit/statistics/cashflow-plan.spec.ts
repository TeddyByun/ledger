import { reconcileCashflowPlans } from '../../../src/statistics/cashflow-plan.js';

const options = { actualUntil: 23, daysInMonth: 30, closedMonth: false };
const plan = (label: string, amount: number, day = 25) => ({
  flow: 'income' as const, label, amount, day, planned: true,
});
const actual = (label: string, amount: number, day = 4) => ({
  flow: 'income' as const, label, amount, day,
});

describe('현금흐름 계획과 실적 대조', () => {
  it('예정일보다 먼저 적게 받은 급여는 실제 금액으로 바꾸고 또 예측하지 않는다', () => {
    const [row] = reconcileCashflowPlans([plan('VNTG 급여', 7045502)], [actual('VNTG', 6985052)], options);
    expect(row).toMatchObject({ occurred: 6985052, remaining: 0, revised: 6985052, change: -60450, status: 'occurred', forecastDay: null });
  });

  it('아직 발생하지 않은 계획만 남은 예상에 유지한다', () => {
    const [row] = reconcileCashflowPlans([plan('기타 입금', 30000, 28)], [], options);
    expect(row).toMatchObject({ occurred: 0, remaining: 30000, revised: 30000, forecastDay: 28, status: 'pending' });
  });

  it('예정일이 지나도 열린 달의 미확인 항목은 임의로 없애지 않는다', () => {
    const [row] = reconcileCashflowPlans([plan('급여', 30000, 10)], [], options);
    expect(row).toMatchObject({ remaining: 30000, forecastDay: 24, status: 'overdue' });
  });

  it('마감된 달의 미발생 계획은 추가 예측하지 않는다', () => {
    const [row] = reconcileCashflowPlans([plan('급여', 30000)], [], { ...options, closedMonth: true });
    expect(row).toMatchObject({ occurred: 0, remaining: 0, revised: 0, change: -30000, status: 'not-observed' });
  });

  it('앞자리가 같은 계좌번호는 서로 다른 실제 거래로 매칭한다', () => {
    const result = reconcileCashflowPlans(
      [plan('56991019318621', 200000), plan('56991019696425', 100000)],
      [actual('56991019318621', 200000), actual('56991019696425', 100000)], options,
    );
    expect(result.map((r) => r.occurred)).toEqual([200000, 100000]);
  });

  it('설명이 붙은 번호도 일부 접두어만 같은 다른 계좌와 혼동하지 않는다', () => {
    const [row] = reconcileCashflowPlans([plan('1234567890000', 100)], [actual('1234567890001 이체', 200)], options);
    expect(row?.occurred).toBe(0);
  });

  it('같은 이름의 입금과 출금을 섞지 않는다', () => {
    const expense = { ...plan('삼성카드', 600000), flow: 'expense' as const };
    const [row] = reconcileCashflowPlans([expense], [actual('삼성카드', 7500)], options);
    expect(row).toMatchObject({ occurred: 0, remaining: 600000 });
  });

  it('한 실제 거래는 가장 정확히 맞는 계획 한 건에만 반영한다', () => {
    const result = reconcileCashflowPlans([plan('회사', 100), plan('회사급여', 200)], [actual('회사급여', 210)], options);
    expect(result.map((r) => r.occurred)).toEqual([0, 210]);
  });

  it('등록 계획과 이름만 달라진 자동 탐지 계획은 중복 계산하지 않는다', () => {
    const registered = plan('누리뜰104호채성', 250000, 23);
    const inferred = { ...plan('누리뜰104호23일', 250000, 23), planned: false, kind: 'recurring' };
    const result = reconcileCashflowPlans([registered, inferred], [actual('누리뜰104호23일', 250000, 23)], options);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ occurred: 250000, remaining: 0, revised: 250000 });
  });
  it('대출번호 뒤에 붙은 설명으로 서로 다른 대출을 혼동하지 않는다', () => {
    const result = reconcileCashflowPlans([plan('54598002907142-00001', 409460), plan('56998001300442-00001', 129146)],
      [actual('54598002907142-00001 (( 20260921 까지의 이자를 납입하셨습니다))', 410444)], options);
    expect(result.map((p) => p.occurred)).toEqual([410444, 0]);
  });
  it('분할 발생하는 정기 항목은 남은 금액을 유지하다가 모두 발생하면 실적으로 대체한다', () => {
    const p = { ...plan('보험료', 100), expectedOccurrences: 2 };
    expect(reconcileCashflowPlans([p], [actual('보험료', 40)], options)[0]).toMatchObject({ occurred: 40, remaining: 60, status: 'partial' });
    expect(reconcileCashflowPlans([p], [actual('보험료', 40), actual('보험료', 50)], options)[0]).toMatchObject({ occurred: 90, remaining: 0, revised: 90 });
  });
  it('은행의 카드대금과 카드 가맹점 사용은 서로 매핑하지 않는다', () => {
    const p = { ...plan('삼성카드', 100), source: 'bank' as const };
    expect(reconcileCashflowPlans([p], [{ ...actual('삼성카드', 100), source: 'card' }], options)[0]?.occurred).toBe(0);
  });
});
