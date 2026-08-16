import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { recurringKey } from '../common/fuzzy-key.js';
import { excludeCategoryCodes } from '../common/exclude-category.js';

const ymOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthNum = (ym: string) => Number(ym.slice(5, 7));
const cmpYm = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
/** R9: 상위 이상치(중앙값 2배 초과)를 잘라낸 평균 — 일회성 스파이크 과대예측 방지. */
const trimmedMean = (a: number[]) => {
  if (!a.length) return 0;
  const med = median(a);
  const kept = a.filter((v) => med === 0 || v <= med * 2);
  const use = kept.length ? kept : a;
  return use.reduce((x, y) => x + y, 0) / use.length;
};

type Bucket = 'fixed' | 'util' | 'event' | 'var';
type Conf = 'high' | 'med' | 'low';

@Injectable()
export class ForecastService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 이번 달(또는 지정 ym) 예상 지출 — 규칙 엔진(설계 §3).
   * 지출을 서로 배타적인 버킷으로 분류: fixed(정기·할부) / util(공과금 04) /
   * event(경조사 10) / var(변동). 각 버킷을 규칙으로 예측하고 이미 발생분은 실제값 사용.
   */
  async forecast(ym?: string) {
    const now = new Date();
    const tym = ym && /^\d{4}-\d{2}$/.test(ym) ? ym : ymOf(now);
    const ty = Number(tym.slice(0, 4));
    const tm = Number(tym.slice(5, 7));
    const isCurrentMonth = tym === ymOf(now);
    const daysInMonth = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
    const dayToday = isCurrentMonth ? now.getUTCDate() : daysInMonth;

    const winStart = new Date(Date.UTC(ty, tm - 1 - 24, 1)); // 24개월 전
    const tStart = new Date(Date.UTC(ty, tm - 1, 1));
    const tEnd = new Date(Date.UTC(ty, tm, 1));

    const [txns, cats, recurrings, plans, planTxns] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { type: 'expense', transactionDate: { gte: winStart, lt: tEnd } },
        select: {
          description: true,
          amount: true,
          transactionDate: true,
          categoryCode: true,
          paymentMethodId: true,
        },
      }),
      this.prisma.category.findMany({ select: { code: true, name: true, parentCode: true } }),
      this.prisma.recurringExpense.findMany({ where: { isActive: 'Y', flow: 'expense' } }),
      this.prisma.installmentPlan.findMany({
        select: { id: true, merchantName: true, totalMonths: true },
      }),
      this.prisma.cardTransaction.findMany({
        where: { installmentPlanId: { not: null } },
        select: {
          installmentPlanId: true,
          billingRound: true,
          principal: true,
          fee: true,
          txnDate: true,
          merchantName: true,
        },
      }),
    ]);

    const excluded = new Set(await excludeCategoryCodes(this.prisma));
    const byCode = new Map(cats.map((c) => [c.code, c]));
    const topOf = (code: string) => {
      const c = byCode.get(code);
      if (!c) return code;
      return c.parentCode ?? c.code;
    };

    // ── 진행 중 할부 → fixed 라인아이템 + claimedKeys ─────────────
    const planById = new Map(plans.map((p) => [p.id, p]));
    interface PlanAgg {
      merchant: string;
      total: number;
      maxRound: number;
      roundAmt: number;
      occurredThisMonth: boolean;
    }
    const planAgg = new Map<number, PlanAgg>();
    for (const c of planTxns) {
      const p = planById.get(c.installmentPlanId!);
      if (!p) continue;
      const round = parseInt((c.billingRound ?? '').replace(/\D/g, ''), 10) || 0;
      const amt = Number(c.principal) + Number(c.fee);
      let a = planAgg.get(c.installmentPlanId!);
      if (!a) {
        a = { merchant: p.merchantName, total: p.totalMonths, maxRound: 0, roundAmt: 0, occurredThisMonth: false };
        planAgg.set(c.installmentPlanId!, a);
      }
      if (round >= a.maxRound) {
        a.maxRound = round;
        if (amt > 0) a.roundAmt = amt;
      }
      const cym = ymOf(c.txnDate);
      if (cym === tym && amt > 0) a.occurredThisMonth = true;
    }

    const claimedKeys = new Set<string>();
    for (const r of recurrings) if (r.matchKey) claimedKeys.add(r.matchKey);
    for (const a of planAgg.values()) claimedKeys.add(recurringKey(a.merchant));

    // ── 거래를 배타적 버킷으로 분류 ───────────────────────────────
    const classify = (desc: string | null, code: string): Bucket => {
      if (claimedKeys.has(recurringKey(desc))) return 'fixed';
      const top = topOf(code);
      if (top === '04') return 'util';
      if (top === '10') return 'event';
      return 'var';
    };

    // 월별·버킷별 합계
    interface MB {
      fixed: number;
      util: number;
      event: number;
      var: number;
    }
    const perMonth = new Map<string, MB>();
    const mb = (y: string) => {
      let m = perMonth.get(y);
      if (!m) {
        m = { fixed: 0, util: 0, event: 0, var: 0 };
        perMonth.set(y, m);
      }
      return m;
    };
    for (const t of txns) {
      if (excluded.has(t.categoryCode)) continue;
      const amt = Number(t.amount ?? 0);
      if (amt <= 0) continue;
      const y = ymOf(t.transactionDate);
      mb(y)[classify(t.description, t.categoryCode)] += amt;
    }

    const cur = perMonth.get(tym) ?? { fixed: 0, util: 0, event: 0, var: 0 };
    // 완료된 최근 3개월(이번 달 제외)
    const recent3 = [1, 2, 3].map((k) => ymOf(new Date(Date.UTC(ty, tm - 1 - k, 1))));
    const prevYearSame = `${ty - 1}-${String(tm).padStart(2, '0')}`;

    const contributions: {
      kind: string;
      label: string;
      categoryCode?: string;
      predicted: number; // 이번 달 예상(발생분 포함)
      occurred: number; // 이미 발생
      remaining: number; // 남은 예측
      status: string;
      basis: string;
      confidence: Conf;
    }[] = [];

    // ── (1) fixed: 정기지출(R4/R6/R7) 라인아이템 ───────────────────
    // 이번 달 각 항목 발생액 매칭
    const thisMonthByKey = new Map<string, number>();
    for (const t of txns) {
      const y = ymOf(t.transactionDate);
      if (y !== tym) continue;
      const amt = Number(t.amount ?? 0);
      if (amt <= 0) continue;
      const fk = recurringKey(t.description);
      if (claimedKeys.has(fk)) thisMonthByKey.set(fk, (thisMonthByKey.get(fk) ?? 0) + amt);
    }
    for (const r of recurrings) {
      // 시작·만기 년월은 주기와 무관하게 적용(할부처럼 끝이 있는 매월 항목)
      const inWindow =
        (!r.startYm || cmpYm(tym, r.startYm) >= 0) && (!r.endYm || cmpYm(tym, r.endYm) <= 0);
      const applies = inWindow && (r.cadence === 'annual' ? r.months.includes(tm) : true);
      if (!applies) continue;
      const occurred = r.matchKey ? (thisMonthByKey.get(r.matchKey) ?? 0) : 0;
      const expected = Number(r.amount);
      const remaining = occurred > 0 ? 0 : expected;
      contributions.push({
        kind: r.cadence === 'schedule' ? 'R7' : r.cadence === 'annual' ? 'R6' : 'R4',
        label: r.label,
        categoryCode: r.categoryCode,
        predicted: Math.max(expected, occurred),
        occurred,
        remaining,
        status: occurred > 0 ? 'occurred' : r.dayOfMonth && r.dayOfMonth < dayToday ? 'overdue' : 'due',
        basis:
          (r.cadence === 'schedule'
            ? `확정 스케줄${r.endYm ? ` · 만기 ${r.endYm}` : ' · 만기 미설정'}`
            : r.cadence === 'annual'
              ? `연례(${r.months.join(',')}월)`
              : '월 정기') + (r.amountType === 'variable' ? ' · 변동(평균치)' : ' · 고정'),
        // 변동 금액은 등록값이 평균치라 그만큼 신뢰도를 낮춘다
        confidence:
          r.amountType === 'variable'
            ? 'med'
            : r.cadence === 'schedule' && !r.endYm
              ? 'med'
              : 'high',
      });
    }
    // 할부(R3)
    for (const a of planAgg.values()) {
      if (a.maxRound >= a.total) continue; // 만기
      const occurred = a.occurredThisMonth ? a.roundAmt : 0;
      const remaining = a.occurredThisMonth ? 0 : a.roundAmt;
      contributions.push({
        kind: 'R3',
        label: `할부 · ${a.merchant}`,
        predicted: a.roundAmt,
        occurred,
        remaining,
        status: a.occurredThisMonth ? 'occurred' : 'due',
        basis: `${a.maxRound + (a.occurredThisMonth ? 0 : 1)}/${a.total}회차`,
        confidence: 'high',
      });
    }
    const fixedRemaining = contributions.reduce((s, c) => s + c.remaining, 0);

    // ── (2) util: 공과금(04) — 전년 동월 or 최근3평균 (R2) ─────────
    const utilPred = (() => {
      const py = perMonth.get(prevYearSame)?.util;
      if (py && py > 0) return { v: py, basis: `전년 ${prevYearSame} 실적`, conf: 'high' as Conf };
      const r3 = recent3.map((y) => perMonth.get(y)?.util ?? 0).filter((v) => v > 0);
      return { v: trimmedMean(r3), basis: '최근 3개월 평균', conf: 'med' as Conf };
    })();
    const utilRemaining = Math.max(0, Math.round(utilPred.v) - cur.util);
    contributions.push({
      kind: 'R2',
      label: '공과금·주거',
      categoryCode: '04',
      predicted: Math.max(Math.round(utilPred.v), cur.util),
      occurred: cur.util,
      remaining: utilRemaining,
      status: cur.util > 0 ? 'partial' : 'due',
      basis: utilPred.basis,
      confidence: utilPred.conf,
    });

    // ── (3) event: 경조사(10) — 같은 달(月) 과거 평균 (R1) ─────────
    const eventSame = [...perMonth.entries()]
      .filter(([y]) => y !== tym && monthNum(y) === tm)
      .map(([, m]) => m.event);
    const eventPredV = eventSame.length ? trimmedMean(eventSame.filter((v) => v > 0)) : 0;
    const eventRemaining = Math.max(0, Math.round(eventPredV) - cur.event);
    if (eventPredV > 0 || cur.event > 0) {
      contributions.push({
        kind: 'R1',
        label: '경조사',
        categoryCode: '10',
        predicted: Math.max(Math.round(eventPredV), cur.event),
        occurred: cur.event,
        remaining: eventRemaining,
        status: cur.event > 0 ? 'partial' : 'due',
        basis: `${tm}월 과거 평균`,
        confidence: 'low',
      });
    }

    // ── (4) var: 변동 — 최근 3개월 평균(이상치 제거) (R5 근사) ─────
    const varHist = recent3.map((y) => perMonth.get(y)?.var ?? 0).filter((v) => v > 0);
    const varPred = trimmedMean(varHist);
    const varRemaining = Math.max(0, Math.round(varPred) - cur.var);
    contributions.push({
      kind: 'VAR',
      label: '변동(생활 등)',
      predicted: Math.max(Math.round(varPred), cur.var),
      occurred: cur.var,
      remaining: varRemaining,
      status: cur.var > 0 ? 'partial' : 'due',
      basis: `최근 3개월 평균${varHist.length < 3 ? `(표본 ${varHist.length})` : ''}`,
      confidence: varHist.length >= 3 ? 'med' : 'low',
    });

    // ── 합계 · A/B/C ──────────────────────────────────────────────
    const A = cur.fixed + cur.util + cur.event + cur.var; // 이미 지출
    const uncertainRemaining = utilRemaining + eventRemaining + varRemaining;
    const B = fixedRemaining + utilRemaining + eventRemaining; // 남은 정기·스케줄·공과·경조
    const C = varRemaining; // 예상 변동
    const total = A + fixedRemaining + uncertainRemaining;
    // R10 범위: 확정(fixed) 외 불확실분에 밴드
    const low = Math.round(A + fixedRemaining + uncertainRemaining * 0.8);
    const high = Math.round(A + fixedRemaining + uncertainRemaining * 1.25);

    // 지난달 실지출(대비)
    const prevYm = ymOf(new Date(Date.UTC(ty, tm - 2, 1)));
    const prevM = perMonth.get(prevYm);
    const prevActual = prevM ? prevM.fixed + prevM.util + prevM.event + prevM.var : 0;

    contributions.sort((a, b) => b.predicted - a.predicted);

    // 그룹: fixed(고정 확정) / certain(비고정·반드시 발생) / estimated(대략 예측)
    const groupOf = (kind: string): 'fixed' | 'certain' | 'estimated' =>
      ['R3', 'R4', 'R6', 'R7'].includes(kind)
        ? 'fixed'
        : kind === 'R2'
          ? 'certain'
          : 'estimated';
    const contribOut = contributions.map((c) => ({ ...c, group: groupOf(c.kind) }));

    return {
      ym: tym,
      total: Math.round(total),
      range: { low, high },
      breakdown: {
        actual: Math.round(A),
        fixedRemaining: Math.round(fixedRemaining),
        seasonalRemaining: Math.round(utilRemaining + eventRemaining),
        variableRemaining: Math.round(C),
      },
      // 화면 3분할(A/B/C)
      abc: { A: Math.round(A), B: Math.round(B), C: Math.round(C) },
      progress: { day: dayToday, days: daysInMonth },
      prev: { ym: prevYm, actual: Math.round(prevActual) },
      contributions: contribOut,
    };
  }
}
