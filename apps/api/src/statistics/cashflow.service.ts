import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { recurringKey } from '../common/fuzzy-key.js';
import { nowKst } from '../common/kst.js';
import { excludeCategoryCodes } from '../common/exclude-category.js';
import { cashflowMatchScore, reconcileCashflowPlans, type CashflowActual } from './cashflow-plan.js';
import { internalBankTransfers, isCardSettlement, referencedBank } from './bank-flow.js';

const ymOf = (d: Date) => d.toISOString().slice(0, 7);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0));
const mean = (values: number[]) => values.length ? Math.round(sum(values) / values.length) : 0;

type Flow = 'income' | 'expense';
interface Line extends CashflowActual {
  kind: 'salary' | 'income-recurring' | 'card' | 'recurring' | 'variable' | 'actual';
  basis: string; confidence: 'high' | 'med' | 'low'; actual: boolean;
  matchKey?: string; planned?: boolean; categoryCode?: string;
  expectedOccurrences?: number;
}

/** 현금흐름과 소비 지출은 같은 기준 통장·같은 정기 계획·같은 실적 연결 규칙을 공유한다. */
@Injectable()
export class CashflowService {
  constructor(private readonly prisma: PrismaService) {}

  async cashflow(ym?: string, _accountId?: number, ignoreActual = false) {
    const now = nowKst();
    const tym = ym && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym) ? ym : ymOf(now);
    const year = Number(tym.slice(0, 4)), month = Number(tym.slice(5, 7));
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    const histStart = new Date(Date.UTC(year, month - 7, 1));
    const prevYm = ymOf(new Date(Date.UTC(year, month - 2, 1)));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const closedMonth = !ignoreActual && tym < ymOf(now);
    const [allBanks, cards, rows, cardRows, registered, statements, excluded] = await Promise.all([
      this.prisma.paymentMethod.findMany({ where: { methodType: 'bank' }, select: { id: true, name: true, accountNo: true, excludeFromStats: true }, orderBy: { id: 'asc' } }),
      this.prisma.paymentMethod.findMany({ where: { methodType: 'card' }, select: { id: true, name: true, issuer: true } }),
      this.prisma.bankTransaction.findMany({
        where: { txnAt: { gte: histStart, lt: end } },
        select: { id: true, paymentMethodId: true, txnAt: true, description: true, txnTypeRaw: true, deposit: true, withdrawal: true, excludeReason: true, transaction: { select: { categoryCode: true } } },
        orderBy: [{ txnAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.cardTransaction.findMany({
        where: { txnDate: { gte: histStart, lt: end } },
        select: { id: true, paymentMethodId: true, txnDate: true, merchantName: true, principal: true, fee: true, isCanceled: true, installmentPlanId: true, billingRound: true, installmentPlan: { select: { merchantName: true, totalMonths: true } }, transaction: { select: { categoryCode: true } } },
        orderBy: [{ txnDate: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.recurringExpense.findMany({ where: { isActive: 'Y' }, include: { paymentMethod: { select: { id: true, name: true, methodType: true } } } }),
      this.prisma.cardStatement.findMany({ where: { statementYm: tym }, select: { paymentMethodId: true, totalAmount: true, billingDate: true } }),
      excludeCategoryCodes(this.prisma),
    ]);
    // 결제수단의 집계 제외 설정으로 생활 통장 범위를 관리한다. 적금·청약과의 입출금은 외부 거래다.
    const banks = allBanks.filter((b) => !b.excludeFromStats);
    if (!banks.length) throw new NotFoundException('집계할 기준 은행 계좌가 없습니다.');
    const scopeIds = new Set(banks.map((b) => b.id));
    const accountName = (id: number) => [...allBanks, ...cards].find((b) => b.id === id)?.name ?? '';
    const internalIds = internalBankTransfers(rows, banks, new Set(excluded));
    const scopedRows = rows.filter((r) => scopeIds.has(r.paymentMethodId));
    const externalRows = scopedRows.filter((r) => !internalIds.has(r.id));
    const monthRows = ignoreActual ? [] : scopedRows.filter((r) => ymOf(r.txnAt) === tym);
    const bankUntil = monthRows.reduce((n, r) => Math.max(n, r.txnAt.getUTCDate()), 0);
    const until = (lines: Line[]) => lines.reduce((n, l) => Math.max(n, l.day ?? 0), 0);
    const asLine = (r: (typeof rows)[number], flow: Flow): Line => ({
      id: r.id, flow, source: 'bank', paymentMethodId: r.paymentMethodId, accountName: accountName(r.paymentMethodId),
      label: r.description?.trim() || r.txnTypeRaw || '거래', amount: Number(flow === 'income' ? r.deposit : r.withdrawal),
      date: iso(r.txnAt), day: r.txnAt.getUTCDate(), kind: flow === 'expense' && isCardSettlement(r) ? 'card' : 'actual',
      basis: '은행 외부 거래', confidence: 'high', actual: true, categoryCode: r.transaction?.categoryCode ?? undefined,
    });
    const bankLines = externalRows.flatMap((r) => ([
      ...(Number(r.deposit) > 0 ? [asLine(r, 'income')] : []),
      ...(Number(r.withdrawal) > 0 ? [asLine(r, 'expense')] : []),
    ]));
    // 분류가 아직 안 된 카드도 원천 거래에서 집계한다. 양수 취소건은 제외하고 음수 환불은 차감한다.
    const cardLines: Line[] = cardRows.filter((r) => r.isCanceled !== 'Y' || Number(r.principal) < 0).map((r) => ({
      id: r.id, flow: 'expense', source: 'card', paymentMethodId: r.paymentMethodId, accountName: accountName(r.paymentMethodId),
      label: r.merchantName, amount: Number(r.principal) + Number(r.fee), date: iso(r.txnDate), day: r.txnDate.getUTCDate(),
      kind: 'actual', basis: '카드 거래 원금·수수료', confidence: 'high', actual: true, categoryCode: r.transaction?.categoryCode ?? undefined,
    }));
    const history = bankLines.filter((l) => l.date! < tym);
    const cardHistory = cardLines.filter((l) => l.date! < tym);
    const cashActual = ignoreActual ? [] : bankLines.filter((l) => l.date!.startsWith(tym));
    const cardActual = ignoreActual ? [] : cardLines.filter((l) => l.date!.startsWith(tym));
    const actualUntil = Math.max(bankUntil, until(cardActual));
    const clampDay = (day: number) => Math.min(daysInMonth, Math.max(1, day));
    const cashPlans: Line[] = [], spendingPlans: Line[] = [];
    const omittedPlans: { label: string; amount: number; reason: string }[] = [];
    const issuerOf = (card: (typeof cards)[number]) => card.issuer ?? card.name.split(' ')[0]!;
    const issuerNames = [...new Set(cards.map(issuerOf))];
    const isBillLabel = (label: string) => issuerNames.some((issuer) => recurringKey(label) === recurringKey(issuer)) || /카드대금/.test(label);
    const applies = (r: (typeof registered)[number]) => (!r.startYm || tym >= r.startYm) && (!r.endYm || tym <= r.endYm) && (r.cadence !== 'annual' || r.months.includes(month));

    for (const r of registered) {
      if (!applies(r) || Number(r.amount) <= 0) continue;
      if (r.paymentMethod?.methodType === 'bank' && !scopeIds.has(r.paymentMethod.id)) continue;
      if (referencedBank(r.label, banks, r.paymentMethod?.id)) {
        omittedPlans.push({ label: r.label, amount: Number(r.amount), reason: '기준 통장 사이의 내부 이체' });
        continue;
      }
      const source = r.paymentMethod?.methodType === 'card' ? 'card' : 'bank';
      const template: Line = {
        flow: r.flow, source, paymentMethodId: r.paymentMethod?.id, accountName: r.paymentMethod?.name,
        label: r.label, matchKey: r.matchKey ?? recurringKey(r.label), amount: Math.round(Number(r.amount)), day: r.dayOfMonth,
        kind: r.flow === 'income' ? /급여|월급/.test(r.label) ? 'salary' : 'income-recurring' : source === 'bank' && isBillLabel(r.label) ? 'card' : 'recurring',
        planned: true, actual: false, categoryCode: r.categoryCode,
        basis: `정기 ${r.flow === 'income' ? '수입' : '지출'} 등록 · ${r.cadence === 'annual' ? '연례' : r.cadence === 'schedule' ? '스케줄' : '매월'}`,
        confidence: r.amountType === 'variable' ? 'med' : 'high',
      };
      const hits = [...history, ...cardHistory].filter((l) => cashflowMatchScore(template, l) > 0);
      template.day = clampDay(r.dayOfMonth ?? (Math.round(median(hits.map((l) => l.day!))) || 1));
      const counts = new Map<string, number>();
      hits.forEach((l) => counts.set(l.date!.slice(0, 7), (counts.get(l.date!.slice(0, 7)) ?? 0) + 1));
      template.expectedOccurrences = Math.max(1, Math.round(median([...counts.values()])));
      if (source === 'bank') cashPlans.push(template);
      if (r.flow === 'expense' && template.kind !== 'card') spendingPlans.push(template);
    }

    // 정기 등록 카드대금의 금액을 우선한다. 미등록 카드사는 청구액→전월 카드 거래→과거 출금으로 보완.
    for (const issuer of issuerNames) {
      const ids = cards.filter((c) => issuerOf(c) === issuer).map((c) => c.id);
      const matchedHistory = history.filter((l) => l.kind === 'card' && l.label.includes(issuer));
      const issuerProbe: Line = { flow: 'expense', source: 'bank', label: issuer, amount: 0, day: null, kind: 'card', actual: false, basis: '', confidence: 'med' };
      if (cashPlans.some((p) => p.kind === 'card' && cashflowMatchScore(p, issuerProbe) > 0)) continue;
      const statementTotal = sum(statements.filter((s) => ids.includes(s.paymentMethodId)).map((s) => Number(s.totalAmount ?? 0)));
      const prevUsage = sum(cardHistory.filter((c) => c.date!.startsWith(prevYm) && ids.includes(c.paymentMethodId!)).map((c) => c.amount));
      const monthly = new Map<string, number>();
      matchedHistory.forEach((l) => monthly.set(l.date!.slice(0, 7), (monthly.get(l.date!.slice(0, 7)) ?? 0) + l.amount));
      const past = Math.round(median([...monthly.entries()].sort().slice(-3).map(([, a]) => a)));
      const amount = statementTotal || prevUsage || past;
      if (amount <= 0) continue;
      cashPlans.push({ ...issuerProbe, label: `카드대금 · ${issuer}`, matchKey: recurringKey(issuer), amount,
        day: clampDay(Math.round(median(matchedHistory.map((l) => l.day!))) || statements.find((s) => ids.includes(s.paymentMethodId))?.billingDate?.getUTCDate() || 14),
        basis: statementTotal ? `${tym} 명세서 청구액` : prevUsage ? `${prevYm} 카드 거래액` : '최근 3개월 출금 중앙값',
      });
    }

    // 등록 이외의 규칙적인 거래만 보완. 등록 종료/비적용 항목도 자동 탐지로 되살리지 않는다.
    const known = registered.map((r) => ({ flow: r.flow, label: r.label, matchKey: r.matchKey ?? undefined, amount: Number(r.amount), day: r.dayOfMonth }));
    const infer = (lines: Line[], plans: Line[], flow: Flow) => {
      const groups = new Map<string, Line[]>();
      for (const l of lines) {
        if (l.flow !== flow || l.kind === 'card' || l.amount <= 0 || known.some((p) => cashflowMatchScore(p, l) > 0)) continue;
        const key = `${l.source}|${l.paymentMethodId}|${recurringKey(l.label)}`;
        groups.set(key, [...(groups.get(key) ?? []), l]);
      }
      for (const group of groups.values()) {
        const monthly = new Map<string, number>();
        group.forEach((l) => monthly.set(l.date!.slice(0, 7), (monthly.get(l.date!.slice(0, 7)) ?? 0) + l.amount));
        const recentFrom = ymOf(new Date(Date.UTC(year, month - 3, 1)));
        const amounts = [...monthly.values()];
        if (monthly.size < (flow === 'income' ? 3 : 2) || group.length / monthly.size > 1.5 ||
          ![...monthly.keys()].some((m) => m >= recentFrom) || Math.max(...amounts) > Math.min(...amounts) * 5) continue;
        const last = group[group.length - 1]!;
        const inferred: Line = { ...last, id: undefined, date: undefined, actual: false, amount: Math.round(median(amounts)),
          day: clampDay(Math.round(median(group.map((l) => l.day!)))), kind: flow === 'income' ? 'income-recurring' : 'recurring',
          basis: `과거 ${monthly.size}개월 반복 · 중앙값`, confidence: 'med', planned: false };
        if (!plans.some((p) => cashflowMatchScore(p, inferred) > 0)) plans.push(inferred);
      }
    };
    infer(history, cashPlans, 'income');
    infer(history, cashPlans, 'expense');
    for (const p of cashPlans.filter((p) => p.flow === 'expense' && p.kind !== 'card')) {
      if (!spendingPlans.includes(p)) spendingPlans.push(p);
    }
    // 음식점처럼 자주 찾은 가맹점은 정기 약정으로 추정하지 않는다. 진행 중 할부만 별도 보완한다.
    const installments = new Map<number, (typeof cardRows)[number]>();
    cardRows.forEach((r) => { if (r.installmentPlanId && r.isCanceled !== 'Y') installments.set(r.installmentPlanId, r); });
    for (const r of installments.values()) {
      const round = Number((r.billingRound ?? '').match(/\d+/)?.[0] ?? 0);
      const monthsSince = (year - r.txnDate.getUTCFullYear()) * 12 + month - 1 - r.txnDate.getUTCMonth();
      if (!r.installmentPlan || !round || Number(r.principal) + Number(r.fee) <= 0 || round + monthsSince > r.installmentPlan.totalMonths) continue;
      const installment: Line = { flow: 'expense', source: 'card', paymentMethodId: r.paymentMethodId,
        accountName: accountName(r.paymentMethodId), label: r.merchantName, amount: Number(r.principal) + Number(r.fee),
        day: clampDay(r.txnDate.getUTCDate()), kind: 'recurring', actual: false,
        basis: `할부 ${round + monthsSince}/${r.installmentPlan.totalMonths}회차`, confidence: 'high' };
      if (!spendingPlans.some((p) => cashflowMatchScore(p, installment) > 0)) spendingPlans.push(installment);
    }

    const reconcile = (plans: Line[], actuals: Line[], cutoff: number) => reconcileCashflowPlans(plans, actuals, { actualUntil: cutoff, daysInMonth, closedMonth });
    const cashReconciled = reconcile(cashPlans, cashActual, bankUntil);
    const consumptionActual = [...cashActual.filter((l) => l.flow === 'expense' && l.kind !== 'card'), ...cardActual];
    const spendingReconciled = reconcile(spendingPlans, consumptionActual, actualUntil);
    // 미등록 생활비는 실제 금액을 전액 반영하고, 남은 날짜의 과거 지출만 추가 예측한다.
    const consumptionHistory = [...history.filter((l) => l.flow === 'expense' && l.kind !== 'card'), ...cardHistory];
    const variableHistory = consumptionHistory.filter((l) => ![...spendingPlans, ...known].some((p) => cashflowMatchScore(p, l) > 0));
    const historyMonths = [...new Set(consumptionHistory.map((l) => l.date!.slice(0, 7)))].sort().slice(-3);
    const variableBaseline = mean(historyMonths.map((m) => sum(variableHistory.filter((l) => l.date!.startsWith(m)).map((l) => l.amount))));
    const variableRemaining = closedMonth ? 0 : mean(historyMonths.map((m) => sum(variableHistory.filter((l) => l.date!.startsWith(m) && l.day! > actualUntil).map((l) => l.amount))));

    const side = (flow: Flow, plans: typeof cashReconciled, actuals: Line[], variable = { baseline: 0, remaining: 0 }) => {
      const selected = plans.filter((p) => p.flow === flow);
      const actualItems = actuals.filter((a) => a.flow === flow).sort((a, b) => b.date!.localeCompare(a.date!) || b.amount - a.amount);
      const actual = sum(actualItems.map((a) => a.amount));
      const baseline = sum(selected.map((p) => p.amount)) + variable.baseline;
      const predicted = sum(selected.map((p) => p.remaining)) + variable.remaining;
      const unplannedActual = actual - sum(selected.map((p) => p.occurred));
      return { baseline, actual, predicted, total: actual + predicted, change: actual + predicted - baseline,
        unplannedActual, predictedItems: selected.sort((a, b) => (a.day ?? 32) - (b.day ?? 32)), actualItems,
        referenceItems: [], registeredBaseline: sum(selected.filter((p) => p.planned).map((p) => p.amount)),
        inferredBaseline: sum(selected.filter((p) => !p.planned).map((p) => p.amount)) + variable.baseline,
      };
    };
    const bankHistoryMonths = [...new Set(history.map((l) => l.date!.slice(0, 7)))].sort().slice(-3);
    const bankVariableHistory = history.filter((l) => l.flow === 'expense' && l.kind !== 'card' &&
      ![...cashPlans, ...known].some((p) => cashflowMatchScore(p, l) > 0));
    const bankVariableAllDays = Array.from({ length: daysInMonth }, (_, i) =>
      mean(bankHistoryMonths.map((m) => sum(bankVariableHistory.filter((l) => l.date!.startsWith(m) && clampDay(l.day!) === i + 1).map((l) => l.amount)))));
    const bankVariableBaseline = sum(bankVariableAllDays);
    const bankVariableDays = bankVariableAllDays.map((amount, i) => closedMonth || i + 1 <= bankUntil ? 0 : amount);
    const bankVariableRemaining = sum(bankVariableDays);
    const income = side('income', cashReconciled, cashActual);
    const expense = { ...side('expense', cashReconciled, cashActual, { baseline: bankVariableBaseline, remaining: bankVariableRemaining }),
      variableBaseline: bankVariableBaseline, variableRemaining: bankVariableRemaining };
    const spending = { ...side('expense', spendingReconciled, consumptionActual, { baseline: variableBaseline, remaining: variableRemaining }),
      bankActual: sum(consumptionActual.filter((l) => l.source === 'bank').map((l) => l.amount)),
      cardActual: sum(cardActual.map((l) => l.amount)),
      cardSettlementActual: sum(cashActual.filter((l) => l.kind === 'card').map((l) => l.amount)),
      variableBaseline, variableRemaining,
      regularRemaining: sum(spendingReconciled.map((p) => p.remaining)),
      actualUntil,
    };

    const accounts = await Promise.all(banks.map(async (b) => {
      const last = await this.prisma.bankTransaction.findFirst({ where: { paymentMethodId: b.id, txnAt: { lt: start }, balance: { not: null } }, orderBy: [{ txnAt: 'desc' }, { id: 'desc' }], select: { balance: true, txnAt: true } });
      return { id: b.id, name: b.name, balance: Math.round(Number(last?.balance ?? 0)), asOf: last ? iso(last.txnAt) : null };
    }));
    const openingBalance = sum(accounts.map((a) => a.balance));
    const daily = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, date: `${tym}-${String(i + 1).padStart(2, '0')}`, income: 0, expense: 0, net: 0, balance: 0, hasActual: false, isForecast: i + 1 > bankUntil, items: [] as Line[] }));
    const push = (l: Line, day: number, amount: number) => {
      const d = daily[day - 1]; if (!d || amount === 0) return;
      d[l.flow] += amount; d.items.push({ ...l, amount }); d.hasActual ||= l.actual;
    };
    cashActual.forEach((l) => push(l, l.day!, l.amount));
    cashReconciled.forEach((l) => { if (l.forecastDay) push(l, l.forecastDay, l.remaining); });
    bankVariableDays.forEach((amount, i) => push({ flow: 'expense', source: 'bank', label: '변동 출금 예상', amount, day: i + 1,
      kind: 'variable', actual: false, basis: '과거 같은 시기 외부 출금 평균', confidence: 'low' }, i + 1, amount));
    let balance = openingBalance;
    daily.forEach((d) => { d.net = d.income - d.expense; balance += d.net; d.balance = balance; });
    const internalActual = monthRows.filter((r) => internalIds.has(r.id));
    return {
      ym: tym, prevYm, daysInMonth, today: tym === ymOf(now) ? now.getUTCDate() : null, isCurrentMonth: tym === ymOf(now), actualUntil: bankUntil,
      scope: { accountId: null, accountName: `기준 통장 ${banks.length}개 합산`, options: banks.map((b) => ({ id: b.id, name: b.name })), accounts: banks.map((b) => ({ id: b.id, name: b.name })), externalAccounts: allBanks.filter((b) => !scopeIds.has(b.id)).map((b) => b.name) },
      opening: { balance: openingBalance, asOf: accounts.every((a) => a.asOf === accounts[0]!.asOf) ? accounts[0]!.asOf : null, accounts, excludedAccounts: allBanks.filter((b) => !scopeIds.has(b.id)).map((b) => b.name) },
      current: { balance: openingBalance + income.actual - expense.actual, asOf: bankUntil ? `${tym}-${String(bankUntil).padStart(2, '0')}` : null },
      closing: { balance }, income, expense, spending,
      baselineNet: income.baseline - expense.baseline, actualNet: income.actual - expense.actual,
      remainingNet: income.predicted - expense.predicted, net: income.total - expense.total,
      consumptionNet: income.total - spending.total,
      transfer: { in: sum(internalActual.map((r) => Number(r.deposit))), out: sum(internalActual.map((r) => Number(r.withdrawal))), net: sum(internalActual.map((r) => Number(r.deposit) - Number(r.withdrawal))) },
      omittedPlans, unscheduled: { income: 0, expense: variableBaseline },
      lowest: daily.reduce((low, d) => d.balance < low.balance ? d : low, daily[0]!), daily,
      consumptionPrevActual: sum(consumptionHistory.filter((l) => l.date!.startsWith(prevYm)).map((l) => l.amount)),
    };
  }
}
