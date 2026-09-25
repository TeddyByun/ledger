import { normKey, recurringKey } from '../common/fuzzy-key.js';

export interface CashflowPlan {
  flow: 'income' | 'expense'; label: string; amount: number; day: number | null;
  matchKey?: string; planned?: boolean; kind?: string;
  paymentMethodId?: number | null; source?: 'bank' | 'card';
  expectedOccurrences?: number;
}
export interface CashflowActual {
  flow: CashflowPlan['flow']; label: string; amount: number; day: number | null;
  id?: number; date?: string; paymentMethodId?: number | null; accountName?: string;
  source?: 'bank' | 'card';
}

/** 같은 이름의 카드/은행 거래를 섞지 않고 번호는 전체 일치로 판정한다. */
export function cashflowMatchScore(plan: CashflowPlan, actual: CashflowActual): number {
  if (plan.flow !== actual.flow || (plan.source && actual.source && plan.source !== actual.source)) return 0;
  const sameAccount = plan.paymentMethodId != null && plan.paymentMethodId === actual.paymentMethodId ? 20 : 0;
  // 대출번호 뒤에 설명이 붙어도 식별한다. 서로 다른 번호의 접두어 일치는 허용하지 않는다.
  const numberLabel = normKey(plan.label);
  if (/^\d+(?:-\d+)*$/.test(numberLabel)) {
    const identifier = numberLabel.replace(/-/g, '');
    const ids = actual.label.match(/\d+(?:-\d+)*/g)?.map((n) => n.replace(/-/g, '')) ?? [];
    return ids.includes(identifier) ? 200 + sameAccount : 0;
  }
  const token = recurringKey(plan.matchKey || plan.label);
  const key = recurringKey(actual.label);
  if (!token || !key) return 0;
  if (token === key || normKey(plan.label) === normKey(actual.label)) return 100 + token.length + sameAccount;
  if (token.length < 2 || key.length < 2 || /^\d+$/.test(token) || /^\d+$/.test(key)) return 0;
  if (key.includes(token) || token.includes(key)) return 50 + Math.min(token.length, key.length) + sameAccount;
  let prefix = 0;
  while (prefix < Math.min(key.length, token.length) && key[prefix] === token[prefix]) prefix++;
  if (prefix >= 6) return 30 + prefix + sameAccount;
  if (prefix >= 4 && plan.amount === actual.amount && plan.day != null && actual.day != null &&
    Math.abs(plan.day - actual.day) <= 3) return 10 + prefix + sameAccount;
  return 0;
}

export function reconcileCashflowPlans<T extends CashflowPlan>(
  plans: T[], actuals: CashflowActual[],
  options: { actualUntil: number; daysInMonth: number; closedMonth: boolean },
) {
  plans = plans.filter((plan) => plan.planned ||
    !plans.some((registered) => registered.planned && cashflowMatchScore(registered, plan) > 0));
  const matched: CashflowActual[][] = plans.map(() => []);
  for (const actual of actuals) {
    let best = -1; let score = 0;
    plans.forEach((plan, i) => {
      const candidate = cashflowMatchScore(plan, actual);
      if (candidate > score) { score = candidate; best = i; }
    });
    if (best >= 0) matched[best]!.push(actual);
  }
  return plans.map((plan, i) => {
    const occurrences = matched[i]!;
    const occurred = occurrences.reduce((sum, item) => sum + item.amount, 0);
    const partial = occurrences.length > 0 && occurrences.length < (plan.expectedOccurrences ?? 1);
    const remaining = options.closedMonth ? 0 : !occurrences.length ? plan.amount :
      partial ? Math.max(0, plan.amount - occurred) : 0;
    const overdue = remaining > 0 && plan.day != null && plan.day <= options.actualUntil;
    return {
      ...plan, occurred, occurrences, remaining, revised: occurred + remaining,
      change: occurred + remaining - plan.amount,
      status: remaining > 0 ? partial ? 'partial' : overdue ? 'overdue' : 'pending' :
        occurrences.length ? 'occurred' : 'not-observed',
      forecastDay: remaining > 0 ? Math.min(options.daysInMonth, Math.max(plan.day ?? 1, options.actualUntil + 1)) : null,
    };
  });
}
