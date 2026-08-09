import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { recurringKey } from '../common/fuzzy-key.js';

const ymOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const cmpYm = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const median = (a: number[]): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
/** 상위 이상치(중앙값 2배 초과) 제거 평균 — 일회성 스파이크 과대예측 방지(FORECAST R9). */
const trimmedMean = (a: number[]): number => {
  if (!a.length) return 0;
  const med = median(a);
  const kept = a.filter((v) => med === 0 || v <= med * 2);
  const use = kept.length ? kept : a;
  return use.reduce((x, y) => x + y, 0) / use.length;
};

/** 최빈값(동률이면 작은 값) — 카드대금 출금일 추정. */
const mode = (a: number[]): number | null => {
  if (!a.length) return null;
  const c = new Map<number, number>();
  for (const v of a) c.set(v, (c.get(v) ?? 0) + 1);
  return [...c.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]![0];
};

type Conf = 'high' | 'med' | 'low';
type Flow = 'income' | 'expense';

/** 예상/실적 라인 1건 — 목록 표시용(일자별 표는 daily 로 따로 나간다). */
interface FlowLine {
  flow: Flow;
  kind: 'salary' | 'income-recurring' | 'income-etc' | 'card' | 'recurring' | 'variable' | 'actual';
  label: string;
  amount: number;
  /** 배치 일자(1~말일). null = 남은 기간에 일할 분산 */
  day: number | null;
  basis: string;
  confidence: Conf;
  actual: boolean;
  categoryCode?: string;
}

/** 일자별 항목 */
interface DayItem {
  flow: Flow;
  label: string;
  amount: number;
  kind: FlowLine['kind'];
  actual: boolean;
}

/**
 * 월 현금흐름(예상 수입·지출 + 일자별 잔액) — **은행 거래 기준**.
 *
 * 설계 의도(EXPENSE_FORECAST_DESIGN §8):
 *  - 카드 사용액은 그 자체로 현금이 나가는 시점이 아니다. **전월 카드 이용액이 이번 달 카드대금**으로
 *    은행에서 빠져나가는 시점에 현금 유출로 잡는다.
 *  - 잔액은 실제 은행 잔액(직전 달 마지막 거래의 balance)에서 출발해 일자별로 누적한다.
 *  - 실적이 있는 구간은 실제 은행 거래를 그대로 쓰고, 그 이후 일자만 규칙으로 예측한다.
 */
@Injectable()
export class CashflowService {
  constructor(private readonly prisma: PrismaService) {}

  async cashflow(ym?: string, accountId?: number, ignoreActual = false) {
    const now = new Date();
    const tym = ym && /^\d{4}-\d{2}$/.test(ym) ? ym : ymOf(now);
    const ty = Number(tym.slice(0, 4));
    const tm = Number(tym.slice(5, 7));
    const mStart = new Date(Date.UTC(ty, tm - 1, 1));
    const mEnd = new Date(Date.UTC(ty, tm, 1));
    const daysInMonth = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
    const isCurrentMonth = tym === ymOf(now);
    const today = isCurrentMonth ? now.getUTCDate() : null;

    const prevYm = ymOf(new Date(Date.UTC(ty, tm - 2, 1)));
    const prevStart = new Date(Date.UTC(ty, tm - 2, 1));
    const histStart = new Date(Date.UTC(ty, tm - 1 - 6, 1)); // 최근 6개월


    // ── 1. 은행 계좌 · 기초 잔액(직전 달 마지막 잔액) ────────────────
    // 범위 = **집계 제외가 아닌 은행 계좌**(생활 계좌). 투자·저축 계좌는 빼고,
    // 그 계좌로 보내는 이체는 '나가는 돈'으로 잡는다(DATABASE §7.1 자산 이동성 지출 정책과 일관).
    const banks = await this.prisma.paymentMethod.findMany({
      where: { methodType: 'bank', excludeFromStats: false },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
    if (banks.length === 0) throw new NotFoundException('예측할 은행 계좌가 없습니다.');

    // 기준 계좌 1개 — 지정이 없으면 거래가 가장 많은 계좌(주 거래 계좌)
    const counts = await this.prisma.bankTransaction.groupBy({
      by: ['paymentMethodId'],
      _count: { _all: true },
    });
    const countOf = (id: number) =>
      counts.find((c) => c.paymentMethodId === id)?._count._all ?? 0;
    const picked =
      (accountId != null && banks.find((b) => b.id === accountId)) ||
      [...banks].sort((a, b) => countOf(b.id) - countOf(a.id))[0]!;
    const scopeId = picked.id;

    const lastBefore = await this.prisma.bankTransaction.findFirst({
      where: { paymentMethodId: scopeId, txnAt: { lt: mStart }, balance: { not: null } },
      orderBy: [{ txnAt: 'desc' }, { id: 'desc' }],
      select: { balance: true, txnAt: true },
    });
    const openingBalance = Math.round(Number(lastBefore?.balance ?? 0));
    const openingAsOf = lastBefore ? iso(lastBefore.txnAt) : null;
    const accounts = [
      { id: scopeId, name: picked.name, balance: openingBalance, asOf: openingAsOf },
    ];
    const outOfScope = await this.prisma.paymentMethod.findMany({
      where: { methodType: 'bank', NOT: { id: scopeId } },
      select: { name: true },
    });

    // ── 2. 이번 달 실적(은행 원천 그대로 — 잔액이 실제와 맞아야 하므로 제외 없이 전부) ──
    const monthRows = await this.prisma.bankTransaction.findMany({
      where: { paymentMethodId: scopeId, txnAt: { gte: mStart, lt: mEnd } },
      select: { txnAt: true, description: true, txnTypeRaw: true, withdrawal: true, deposit: true },
      orderBy: [{ txnAt: 'asc' }, { id: 'asc' }],
    });
    // ignoreActual=true 면 실적을 반영하지 않고 월 전체를 예측한다(예측 검증용).
    const actualUntil = ignoreActual
      ? 0
      : monthRows.reduce((m, r) => Math.max(m, r.txnAt.getUTCDate()), 0);

    const actualLines: FlowLine[] = [];
    for (const r of monthRows) {
      const day = r.txnAt.getUTCDate();
      const wd = Number(r.withdrawal);
      const dep = Number(r.deposit);
      const label = (r.description ?? '').trim() || r.txnTypeRaw || '거래';
      if (dep > 0) {
        actualLines.push({ flow: 'income', kind: 'actual', label, amount: dep, day, basis: '실제 입금', confidence: 'high', actual: true });
      }
      if (wd > 0) {
        actualLines.push({ flow: 'expense', kind: 'actual', label, amount: wd, day, basis: '실제 출금', confidence: 'high', actual: true });
      }
    }

    // ── 3. 예측 기준 이력(최근 6개월 은행 거래) ─────────────────────
    const hist = await this.prisma.bankTransaction.findMany({
      where: { paymentMethodId: scopeId, txnAt: { gte: histStart, lt: mStart } },
      select: {
        txnAt: true,
        description: true,
        txnTypeRaw: true,
        withdrawal: true,
        deposit: true,
        excludeReason: true,
        transaction: { select: { categoryCode: true } },
      },
    });
    /**
     * 예측 기준에서 뺄 행.
     * **계좌 1개 기준**이므로 자기이체·'분류 제외' 거래도 이 계좌의 잔액을 실제로 바꾼다
     * (급여가 다른 계좌로 들어와 이 계좌로 옮겨오는 경우가 대표적) → 제외하지 않는다.
     * 카드대금만 §5에서 따로 예측하므로 여기서 뺀다.
     */
    const skipForForecast = (_r: (typeof hist)[number]) => false;
    /** 카드대금 출금 — 별도 규칙으로 예측하므로 정기·변동 기준에서 뺀다. */
    const isCardSettle = (r: (typeof hist)[number]) =>
      (r.txnTypeRaw ?? '').includes('카드') || (r.description ?? '').includes('카드');

    // 이력 창에서 실제 거래가 있던 달 목록 — 월 기대값 계산 기준
    const windowYms = [...new Set(hist.map((r) => ymOf(r.txnAt)))].sort();
    const windowMonths = Math.max(1, windowYms.length);
    /**
     * 날짜가 일정하지 않은 항목의 **월 기대값**.
     * 창의 모든 달을 0 포함해 세고, 이상치(중앙값 2배 초과 — 등록금·이사비 같은 일회성)를
     * 잘라낸 평균을 쓴다. 단순 평균은 큰 일회성 지출 하나에 크게 끌려간다.
     */
    const expectedMonthly = (perMonth: Map<string, number>) =>
      Math.round(trimmedMean(windowYms.map((y) => perMonth.get(y) ?? 0)));
    /**
     * 날짜를 특정해 예측할 만큼 규칙적인가.
     * 목적이 "며칠에 현금이 얼마나 나가는가"이므로 비대칭으로 잡는다:
     *  - 수입: 확실한 것만(창의 절반 이상 & 최소 3개월) — 들어올 돈을 낙관하면 부족을 놓친다.
     *  - 지출: 넉넉히(최소 2개월) — 나갈 돈은 빠뜨리지 않는 편이 안전하다.
     */
    const isRegularIn = (months: number) =>
      months >= Math.max(3, Math.ceil(windowMonths / 2));
    const isRegularOut = (months: number) => months >= 2;
    /**
     * 최근에도 이어지고 있는가 — **직전 2개월 안에 한 번은 있어야** 예측한다.
     * 끝난 항목(해지한 구독)이나 **이름이 바뀐 항목의 옛 이름**(예: '대출금'→'집대출')이
     * 계속 예측에 남아 이중 계상되는 것을 막는다.
     */
    const recentFrom = ymOf(new Date(Date.UTC(ty, tm - 3, 1)));
    const isOngoing = (perMonth: Map<string, number>) =>
      [...perMonth.keys()].some((y) => y >= recentFrom);
    /**
     * 정기가 아니라 **수시성(spot)** 이체인가 — 날짜·금액을 예측하지 않고 참고 수치로만 돌린다.
     * 진짜 정기(급여·월세·보험·대출)는 매월 1건, 비슷한 금액이다. 반면 투자 입출금·개인 이체는
     *  - 한 달에 여러 번 나가거나(월평균 건수 > 1.5), 또는
     *  - 월별 금액이 극단으로 튄다(최대 ≥ 최소 × 5).
     * (예: '키움투자' 월 2~4건, '변채민' 월 입금 3천~227만) → 정기로 오탐되던 것을 걸러낸다.
     */
    const isSporadic = (perMonth: Map<string, number>, txCount: number) => {
      const months = perMonth.size;
      if (months === 0) return false;
      if (txCount / months > 1.5) return true;
      const vals = [...perMonth.values()].filter((v) => v > 0);
      if (vals.length >= 2) {
        const mn = Math.min(...vals);
        const mx = Math.max(...vals);
        if (mn > 0 && mx > mn * 5) return true;
      }
      return false;
    };

    const predicted: FlowLine[] = [];

    // ── 4. 예상 수입 — 반복 입금 탐지(최근 6개월) ────────────────────
    interface Grp {
      label: string;
      perMonth: Map<string, number>;
      days: number[];
      code?: string;
    }
    const incomeGrp = new Map<string, Grp>();
    const etcIncomeByMonth = new Map<string, number>();
    for (const r of hist) {
      const dep = Number(r.deposit);
      if (dep <= 0 || skipForForecast(r)) continue;
      const key = recurringKey(r.description) || (r.description ?? '').trim();
      if (!key) continue;
      let g = incomeGrp.get(key);
      if (!g) {
        g = { label: (r.description ?? '').trim() || key, perMonth: new Map(), days: [] };
        incomeGrp.set(key, g);
      }
      const y = ymOf(r.txnAt);
      g.perMonth.set(y, (g.perMonth.get(y) ?? 0) + dep);
      g.days.push(r.txnAt.getUTCDate());
      if (r.transaction?.categoryCode) g.code = r.transaction.categoryCode;
    }
    for (const g of incomeGrp.values()) {
      const months = g.perMonth.size;
      if (!isRegularIn(months) || !isOngoing(g.perMonth) || isSporadic(g.perMonth, g.days.length)) {
        // 가끔 들어오는 입금·수시성 이체 → 날짜를 특정하지 않고 '기타 수입'으로 묶어 일할 반영
        for (const [y, v] of g.perMonth) etcIncomeByMonth.set(y, (etcIncomeByMonth.get(y) ?? 0) + v);
        continue;
      }
      const amount = Math.round(median([...g.perMonth.values()]));
      if (amount <= 0) continue;
      const day = Math.min(daysInMonth, Math.max(1, Math.round(median(g.days))));
      const isSalary = g.code === '13' || /급여|월급/.test(g.label);
      predicted.push({
        flow: 'income',
        kind: isSalary ? 'salary' : 'income-recurring',
        label: g.label,
        amount,
        day,
        basis: `최근 ${windowMonths}개월 중 ${months}개월 반복 · 중앙값`,
        confidence: months >= windowMonths - 1 ? 'high' : 'med',
        actual: false,
        ...(g.code ? { categoryCode: g.code } : {}),
      });
    }
    // 날짜를 특정할 수 없는 흐름은 **예측에 넣지 않는다**(일자별 현금 계획을 흐리므로).
    // 참고 수치로만 반환한다.
    const unscheduledIncome = expectedMonthly(etcIncomeByMonth);

    // ── 5. 카드대금 — 카드사 단위로 이 계좌에서 빠져나가는 청구액 ─────
    // 우선순위: ① 대상월 명세서 청구액 → ② 전월 카드 이용액 → ③ 이 계좌의 과거 실제 출금
    // (①②가 과거 실제 출금의 60% 미만이면 명세서 미업로드로 보고 ③으로 보완)
    const cards = await this.prisma.paymentMethod.findMany({
      where: { methodType: 'card' },
      select: { id: true, name: true, issuer: true },
    });
    if (cards.length > 0) {
      const issuerOf = (c: { name: string; issuer: string | null }) =>
        (c.issuer ?? c.name.split(' ')[0] ?? c.name).trim();
      const issuers = [...new Set(cards.map(issuerOf))];

      const usage = await this.prisma.cardTransaction.findMany({
        where: { txnDate: { gte: prevStart, lt: mStart } },
        select: { paymentMethodId: true, principal: true, fee: true },
      });
      const stmts = await this.prisma.cardStatement.findMany({
        where: { statementYm: tym },
        select: { paymentMethodId: true, totalAmount: true, billingDate: true },
      });
      const anyStmts = await this.prisma.cardStatement.findMany({
        where: { billingDate: { not: null } },
        select: { paymentMethodId: true, billingDate: true, statementYm: true },
        orderBy: { statementYm: 'desc' },
      });

      // 이 계좌에서 카드사 이름으로 나간 과거 출금(월별 합계·일자)
      const settleHist = await this.prisma.bankTransaction.findMany({
        where: {
          paymentMethodId: scopeId,
          txnAt: { gte: new Date(Date.UTC(ty, tm - 1 - 6, 1)), lt: mStart },
          withdrawal: { gt: 0 },
        },
        select: { txnAt: true, description: true, txnTypeRaw: true, withdrawal: true },
      });

      for (const issuer of issuers) {
        const ids = cards.filter((c) => issuerOf(c) === issuer).map((c) => c.id);
        const rows = settleHist.filter(
          (r) =>
            (r.description ?? '').includes(issuer) ||
            (r.txnTypeRaw ?? '').includes(issuer.replace('카드', '')),
        );
        // 과거 실제 출금 — 월별 합계의 중앙값(최근 3개월 우선)
        const perMonth = new Map<string, number>();
        const days: number[] = [];
        for (const r of rows) {
          const y = ymOf(r.txnAt);
          perMonth.set(y, (perMonth.get(y) ?? 0) + Number(r.withdrawal));
          days.push(r.txnAt.getUTCDate());
        }
        const recent = [...perMonth.entries()].sort().slice(-3).map(([, v]) => v);
        const histMed = Math.round(median(recent));

        const stmtTotal = Math.round(
          stmts
            .filter((x) => ids.includes(x.paymentMethodId) && x.totalAmount != null)
            .reduce((a, x) => a + Number(x.totalAmount), 0),
        );
        const usagePrev = Math.round(
          usage
            .filter((u) => ids.includes(u.paymentMethodId))
            .reduce((a, u) => a + Number(u.principal) + Number(u.fee), 0),
        );

        // 예상 카드대금 = 전월 실제 지출을 그대로 반영한다.
        //  ① 대상월 명세서 청구액(전월 사용분) → ② 전월 카드 이용액 → ③ 실적 없을 때만 과거 출금 중앙값.
        //  과거 대비 적게 썼어도(예: 이번 전월만 소액) 실제 명세서·이용액을 우선한다.
        let amount = 0;
        let basis = '';
        let conf: Conf = 'med';
        if (stmtTotal > 0) {
          amount = stmtTotal;
          basis = `${tym} 명세서 청구액`;
          conf = 'high';
        } else if (usagePrev > 0) {
          amount = usagePrev;
          basis = `${prevYm} 카드 이용액`;
          conf = 'high';
        } else if (histMed > 0) {
          amount = histMed;
          basis = '최근 3개월 실제 출금 중앙값';
          conf = 'med';
        }
        if (amount <= 0) continue;

        // 출금일 — 이 계좌의 실제 출금 최빈일 > 명세서 결제일 > 15일
        const stmtDay = anyStmts.find(
          (x) => ids.includes(x.paymentMethodId) && x.billingDate,
        )?.billingDate;
        const day = Math.min(
          daysInMonth,
          Math.max(1, mode(days) ?? stmtDay?.getUTCDate() ?? 15),
        );
        predicted.push({
          flow: 'expense',
          kind: 'card',
          label: `카드대금 · ${issuer}`,
          amount,
          day,
          basis,
          confidence: conf,
          actual: false,
        });
      }
    }

    // ── 6. 등록 정기지출(관리>정기지출) ─────────────────────────────
    // 결제수단 지정에 따라 이 계좌에서 나갈 것만 고른다:
    //   · 이 계좌로 지정 → 무조건 포함(사용자가 직접 지정한 값)
    //   · 다른 은행 계좌 → 제외
    //   · 카드 → 카드대금에 포함되므로 제외. 단 이 계좌에서 같은 이름으로 나간 최근 이력이
    //            있으면(카드결제 → 계좌이체로 바뀐 경우) 실제 현금 흐름을 우선해 포함
    //   · 미지정 → 이 계좌 이력에 매칭될 때만 포함
    const recurrings = await this.prisma.recurringExpense.findMany({
      where: { isActive: 'Y' },
      include: { paymentMethod: { select: { id: true, methodType: true } } },
    });
    /** 적요 키와 정기지출 토큰의 느슨한 일치(부분일치 또는 공통 접두 6자 이상). */
    const matchToken = (key: string, token: string): boolean => {
      if (key.length < 2 || token.length < 2) return false;
      if (key.includes(token) || token.includes(key)) return true;
      let i = 0;
      while (i < key.length && i < token.length && key[i] === token[i]) i++;
      return i >= 6;
    };
    /** 이 계좌의 과거 출금(카드대금 제외) — 정기지출 매칭·일자 추정용 */
    const bankOutKeys = hist
      .filter((r) => Number(r.withdrawal) > 0 && !isCardSettle(r))
      .map((r) => ({
        key: recurringKey(r.description),
        day: r.txnAt.getUTCDate(),
        ym: ymOf(r.txnAt),
      }));
    const recurringTokens: string[] = [];
    for (const r of recurrings) {
      // 시작·만기 년월은 주기와 무관하게 적용(할부처럼 끝이 있는 매월 항목)
      const inWindow =
        (!r.startYm || cmpYm(tym, r.startYm) >= 0) && (!r.endYm || cmpYm(tym, r.endYm) <= 0);
      const applies = inWindow && (r.cadence === 'annual' ? r.months.includes(tm) : true);
      if (!applies) continue;

      const token = (r.matchKey?.trim() || recurringKey(r.label)).trim();
      if (token.length < 2) continue;
      const hits = bankOutKeys.filter((b) => matchToken(b.key, token));

      const pmType = r.paymentMethod?.methodType;
      const pmId = r.paymentMethod?.id;
      let include: boolean;
      let note = '';
      if (pmType === 'bank') {
        include = pmId === scopeId;
      } else if (pmType === 'card') {
        // 최근 3개월 안에 이 계좌에서 실제로 나갔다면 카드가 아니라 계좌이체로 본다
        include = hits.some((h) => h.ym >= recentFrom);
        note = include ? ' · 카드 등록이지만 이 계좌에서 출금됨' : '';
      } else {
        include = hits.length > 0;
      }
      if (!include) continue;

      recurringTokens.push(token);
      const amount = Math.round(Number(r.amount));
      if (amount <= 0) continue;
      const day = Math.min(
        daysInMonth,
        Math.max(
          1,
          r.dayOfMonth ?? (hits.length ? Math.round(median(hits.map((h) => h.day))) : 1),
        ),
      );
      predicted.push({
        flow: 'expense',
        kind: 'recurring',
        label: r.label,
        amount,
        day,
        basis:
          (r.cadence === 'schedule'
            ? `확정 스케줄${r.endYm ? ` · 만기 ${r.endYm}` : ''}`
            : r.cadence === 'annual'
              ? `연례(${r.months.join(',')}월)`
              : '월 정기') +
          (r.amountType === 'variable' ? ' · 변동(평균치)' : ' · 고정') +
          note,
        confidence: r.amountType === 'variable' ? 'med' : 'high',
        actual: false,
        categoryCode: r.categoryCode,
      });
    }

    // ── 7. 반복 출금 자동 탐지 — 관리>정기지출에 없어도 이력에서 찾아 일자에 배치 ──
    // (보험료·통신비·이자처럼 매월 같은 이름으로 빠지는 출금. 등록된 정기지출과 카드대금은 제외)
    const outGrp = new Map<string, Grp>();
    const varByMonth = new Map<string, number>();
    for (const r of hist) {
      const wd = Number(r.withdrawal);
      if (wd <= 0 || skipForForecast(r) || isCardSettle(r)) continue;
      const key = recurringKey(r.description);
      if (key && recurringTokens.some((t) => matchToken(key, t))) continue; // 등록 정기지출로 이미 반영
      const gk = key || (r.description ?? '').trim();
      if (!gk) {
        const y0 = ymOf(r.txnAt);
        varByMonth.set(y0, (varByMonth.get(y0) ?? 0) + wd);
        continue;
      }
      let g = outGrp.get(gk);
      if (!g) {
        g = { label: (r.description ?? '').trim() || gk, perMonth: new Map(), days: [] };
        outGrp.set(gk, g);
      }
      const y = ymOf(r.txnAt);
      g.perMonth.set(y, (g.perMonth.get(y) ?? 0) + wd);
      g.days.push(r.txnAt.getUTCDate());
      if (r.transaction?.categoryCode) g.code = r.transaction.categoryCode;
    }
    for (const g of outGrp.values()) {
      const months = g.perMonth.size;
      if (!isRegularOut(months) || !isOngoing(g.perMonth) || isSporadic(g.perMonth, g.days.length)) {
        // 가끔 나가는 출금·수시성 이체(투자·개인 송금 등) → 날짜를 특정하지 않고 변동으로
        for (const [y, v] of g.perMonth) varByMonth.set(y, (varByMonth.get(y) ?? 0) + v);
        continue;
      }
      const amount = Math.round(median([...g.perMonth.values()]));
      if (amount <= 0) continue;
      const day = Math.min(daysInMonth, Math.max(1, Math.round(median(g.days))));
      predicted.push({
        flow: 'expense',
        kind: 'recurring',
        label: g.label,
        amount,
        day,
        basis: `최근 ${windowMonths}개월 중 ${months}개월 반복 · 중앙값`,
        confidence: months >= windowMonths - 1 ? 'high' : 'med',
        actual: false,
        ...(g.code ? { categoryCode: g.code } : {}),
      });
    }

    // ── 8. 날짜가 일정하지 않은 출금 — 참고 수치(예측 라인에는 넣지 않음) ──
    const unscheduledExpense = expectedMonthly(varByMonth);

    // ── 9. 일자별 전개 ──────────────────────────────────────────────
    const daily = Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      date: `${tym}-${String(i + 1).padStart(2, '0')}`,
      income: 0,
      expense: 0,
      net: 0,
      balance: 0,
      hasActual: false,
      isForecast: i + 1 > actualUntil,
      items: [] as DayItem[],
    }));

    const push = (day: number, l: FlowLine, amount: number) => {
      const d = daily[day - 1];
      if (!d || amount <= 0) return;
      d.items.push({ flow: l.flow, label: l.label, amount, kind: l.kind, actual: l.actual });
      if (l.flow === 'income') d.income += amount;
      else d.expense += amount;
      if (l.actual) d.hasActual = true;
    };

    for (const l of actualLines) push(l.day!, l, l.amount);
    for (const l of predicted) {
      if (l.day != null && l.day > actualUntil) push(l.day, l, l.amount);
    }

    let running = openingBalance;
    for (const d of daily) {
      d.net = d.income - d.expense;
      running += d.net;
      d.balance = Math.round(running);
      d.income = Math.round(d.income);
      d.expense = Math.round(d.expense);
      d.net = Math.round(d.net);
    }

    const incomeTotal = daily.reduce((s, d) => s + d.income, 0);
    const expenseTotal = daily.reduce((s, d) => s + d.expense, 0);
    const sumOf = (flow: Flow, actual: boolean) =>
      daily.reduce(
        (s, d) => s + d.items.filter((i) => i.flow === flow && i.actual === actual).reduce((x, i) => x + i.amount, 0),
        0,
      );

    /** 목록용 라인 — 실적은 같은 이름끼리 합치고, 예측은 그대로. */
    const mergeActual = (flow: Flow): FlowLine[] => {
      const m = new Map<string, FlowLine>();
      for (const l of actualLines.filter((x) => x.flow === flow)) {
        const cur = m.get(l.label);
        if (cur) {
          cur.amount += l.amount;
          cur.basis = `실제 ${flow === 'income' ? '입금' : '출금'} · 여러 건`;
          cur.day = null;
        } else m.set(l.label, { ...l });
      }
      return [...m.values()].sort((a, b) => b.amount - a.amount);
    };
    const lines = (flow: Flow) => ({
      predictedItems: predicted
        .filter((l) => l.flow === flow && (l.day == null || l.day > actualUntil))
        .sort((a, b) => b.amount - a.amount),
      actualItems: mergeActual(flow),
    });

    return {
      ym: tym,
      daysInMonth,
      today,
      isCurrentMonth,
      actualUntil,
      scope: {
        accountId: scopeId,
        accountName: picked.name,
        options: banks.map((b) => ({ id: b.id, name: b.name })),
      },
      opening: {
        balance: openingBalance,
        asOf: openingAsOf,
        accounts,
        excludedAccounts: outOfScope.map((a) => a.name),
      },
      closing: { balance: Math.round(openingBalance + incomeTotal - expenseTotal) },
      income: {
        total: Math.round(incomeTotal),
        actual: Math.round(sumOf('income', true)),
        predicted: Math.round(sumOf('income', false)),
        ...lines('income'),
      },
      expense: {
        total: Math.round(expenseTotal),
        actual: Math.round(sumOf('expense', true)),
        predicted: Math.round(sumOf('expense', false)),
        ...lines('expense'),
      },
      net: Math.round(incomeTotal - expenseTotal),
      /** 날짜를 특정할 수 없어 일자별 예측에서 뺀 흐름(참고용 월 기대값) */
      unscheduled: { income: unscheduledIncome, expense: unscheduledExpense },
      /** 월 중 잔액이 가장 낮아지는 날 — 자금 부족 시점 */
      lowest: daily.reduce((m, d) => (d.balance < m.balance ? d : m), daily[0]!),
      daily,
      prevYm,
    };
  }
}
