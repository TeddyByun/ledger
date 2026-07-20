import { Injectable } from '@nestjs/common';
import { TransactionType } from '@ledger/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  EXCLUDE_CATEGORY_NAME,
  excludeCategoryCodes,
} from '../common/exclude-category.js';

const YM_RE = /^\d{4}-\d{2}$/;

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  private assertYm(ym: string) {
    if (!YM_RE.test(ym)) throw new Error(`invalid ym '${ym}' (expected YYYY-MM)`);
  }

  getSummary(ym: string) {
    return this.prisma.monthlySummary.findUnique({ where: { ym } });
  }

  /**
   * 최근 N개월(기본 12) 월별 수입·지출 추이. (달력 연도가 아닌 롤링 기간)
   * 거래(transaction)에서 직접 집계. 이번 달 포함, 과거 방향으로 N개월.
   * 대분류별 구성(누적 막대용)도 함께 반환 — 상위 N개만 색을 주고 나머지는 '기타'.
   */
  async monthlyTrend(months = 12) {
    const TOP_INCOME = 3;
    const TOP_EXPENSE = 5;
    const TOP_PAYMENT = 8;
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
    const endExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const excluded = await excludeCategoryCodes(this.prisma);
    const [txns, cats] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          transactionDate: { gte: start, lt: endExclusive },
          ...(excluded.length > 0 && { categoryCode: { notIn: excluded } }),
        },
        select: {
          type: true,
          amount: true,
          transactionDate: true,
          categoryCode: true,
          paymentMethod: { select: { id: true, name: true } },
        },
      }),
      this.prisma.category.findMany({ select: { code: true, name: true, parentCode: true } }),
    ]);

    // 리프 분류 → 대분류(code,name)
    const byCode = new Map(cats.map((c) => [c.code, c]));
    const topOf = new Map<string, { code: string; name: string }>();
    for (const c of cats) {
      const top = (c.parentCode ? byCode.get(c.parentCode) : null) ?? c;
      topOf.set(c.code, { code: top.code, name: top.name });
    }

    const buckets: { ym: string; income: number; expense: number }[] = [];
    const idx = new Map<string, number>();
    for (let i = 0; i < months; i++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      idx.set(ym, i);
      buckets.push({ ym, income: 0, expense: 0 });
    }

    // 유형별 대분류 × 월 누적
    const zeros = () => new Array(months).fill(0) as number[];
    const cell = new Map<string, { name: string; type: 'income' | 'expense'; values: number[] }>();
    const keyOf = (type: string, code: string) => `${type}:${code}`;
    // 결제수단 × 월 지출 누적 (하단 차트용)
    const payCell = new Map<number, { name: string; values: number[] }>();

    for (const t of txns) {
      const d = t.transactionDate;
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const i = idx.get(ym);
      if (i === undefined) continue;
      const b = buckets[i];
      if (!b) continue;
      const amt = Number(t.amount ?? 0);
      if (t.type === 'income') b.income += amt;
      else b.expense += amt;

      const top = topOf.get(t.categoryCode) ?? { code: t.categoryCode, name: t.categoryCode };
      const k = keyOf(t.type, top.code);
      let e = cell.get(k);
      if (!e) {
        e = { name: top.name, type: t.type as 'income' | 'expense', values: zeros() };
        cell.set(k, e);
      }
      e.values[i] = (e.values[i] ?? 0) + amt;

      // 결제수단별 지출
      if (t.type === 'expense' && t.paymentMethod) {
        let p = payCell.get(t.paymentMethod.id);
        if (!p) {
          p = { name: t.paymentMethod.name, values: zeros() };
          payCell.set(t.paymentMethod.id, p);
        }
        p.values[i] = (p.values[i] ?? 0) + amt;
      }
    }

    // 유형별 상위 N개 + 나머지는 '기타'로 합산
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const series: { key: string; name: string; type: 'income' | 'expense'; values: number[] }[] = [];
    for (const type of ['income', 'expense'] as const) {
      const list = [...cell.entries()]
        .filter(([, v]) => v.type === type)
        .map(([k, v]) => ({ key: k, name: v.name, type, values: v.values, total: sum(v.values) }))
        .sort((a, b) => b.total - a.total);
      const cap = type === 'income' ? TOP_INCOME : TOP_EXPENSE;
      const keep = list.slice(0, cap);
      const rest = list.slice(cap);
      for (const s of keep) series.push({ key: s.key, name: s.name, type, values: s.values });
      if (rest.length > 0) {
        const other = zeros();
        for (const r of rest) {
          for (let i = 0; i < months; i++) other[i] = (other[i] ?? 0) + (r.values[i] ?? 0);
        }
        series.push({ key: `${type}:__other__`, name: '기타', type, values: other });
      }
    }

    // 결제수단별 월 지출 — 상위 TOP_PAYMENT개 + 나머지는 '기타'
    const payList = [...payCell.entries()]
      .map(([id, v]) => ({ key: `pm:${id}`, name: v.name, values: v.values, total: sum(v.values) }))
      .sort((a, b) => b.total - a.total);
    const paymentSeries: { key: string; name: string; values: number[] }[] = payList
      .slice(0, TOP_PAYMENT)
      .map((s) => ({ key: s.key, name: s.name, values: s.values }));
    const payRest = payList.slice(TOP_PAYMENT);
    if (payRest.length > 0) {
      const other = zeros();
      for (const r of payRest) {
        for (let i = 0; i < months; i++) other[i] = (other[i] ?? 0) + (r.values[i] ?? 0);
      }
      paymentSeries.push({ key: 'pm:__other__', name: '기타', values: other });
    }

    return { months: buckets, series, paymentSeries };
  }

  /**
   * 결제수단별 월별 지출 추이 (롤링 N개월). 결제수단 하나당 차트 하나(소형 다중)용.
   * '집계제외' 분류는 제외. 지출만 집계.
   */
  async paymentTrend(months = 12) {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
    const endExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const excluded = await excludeCategoryCodes(this.prisma);
    const txns = await this.prisma.transaction.findMany({
      where: {
        type: 'expense',
        transactionDate: { gte: start, lt: endExclusive },
        ...(excluded.length > 0 && { categoryCode: { notIn: excluded } }),
      },
      select: {
        amount: true,
        transactionDate: true,
        paymentMethod: { select: { id: true, name: true, methodType: true } },
      },
    });

    const ymList: string[] = [];
    const idx = new Map<string, number>();
    for (let i = 0; i < months; i++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      idx.set(ym, i);
      ymList.push(ym);
    }

    const map = new Map<
      number,
      { name: string; methodType: string; values: number[] }
    >();
    for (const t of txns) {
      const pm = t.paymentMethod;
      if (!pm) continue;
      const d = t.transactionDate;
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const i = idx.get(ym);
      if (i === undefined) continue;
      let e = map.get(pm.id);
      if (!e) {
        e = {
          name: pm.name,
          methodType: pm.methodType,
          values: new Array(months).fill(0) as number[],
        };
        map.set(pm.id, e);
      }
      e.values[i] = (e.values[i] ?? 0) + Number(t.amount ?? 0);
    }

    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const items = [...map.entries()]
      .map(([id, v]) => ({
        id,
        name: v.name,
        methodType: v.methodType,
        values: v.values,
        total: sum(v.values),
      }))
      .sort((a, b) => b.total - a.total);

    return { months: ymList, items };
  }

  /**
   * 대시보드용 — 올해 월별(1~12) 집계.
   *  - 계좌별 수입/지출
   *  - 카드별 지출
   *  - 대분류별 지출
   * 거래(transaction)에서 직접 집계(항상 최신). 가구 스코프는 미들웨어가 주입.
   */
  async dashboard(year: number) {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    const [txns, cats] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { transactionDate: { gte: start, lt: end } },
        select: {
          type: true,
          amount: true,
          transactionDate: true,
          categoryCode: true,
          paymentMethod: {
            select: { id: true, name: true, methodType: true },
          },
        },
      }),
      this.prisma.category.findMany({
        select: { code: true, name: true, parentCode: true },
      }),
    ]);

    // 리프 분류코드 → 대분류(code,name)
    const byCode = new Map(cats.map((c) => [c.code, c]));
    const topOf = new Map<string, { code: string; name: string }>();
    for (const c of cats) {
      const top = (c.parentCode ? byCode.get(c.parentCode) : null) ?? c;
      topOf.set(c.code, { code: top.code, name: top.name });
    }

    // '분류제외' 분류(대분류+소분류)는 집계에서 제외
    const excludeRoots = cats.filter((c) => c.name === EXCLUDE_CATEGORY_NAME).map((c) => c.code);
    const excludeSet = new Set<string>(excludeRoots);
    for (const c of cats) {
      if (c.parentCode && excludeRoots.includes(c.parentCode)) excludeSet.add(c.code);
    }

    const z = () => new Array(12).fill(0) as number[];
    const bank = new Map<number, { name: string; income: number[]; expense: number[] }>();
    const card = new Map<number, { name: string; expense: number[] }>();
    const cat = new Map<string, { name: string; expense: number[] }>();

    for (const t of txns) {
      if (excludeSet.has(t.categoryCode)) continue;
      const m = t.transactionDate.getUTCMonth(); // 0~11
      const amt = Number(t.amount ?? 0);
      const pm = t.paymentMethod;
      if (pm?.methodType === 'bank') {
        let e = bank.get(pm.id);
        if (!e) {
          e = { name: pm.name, income: z(), expense: z() };
          bank.set(pm.id, e);
        }
        if (t.type === 'income') e.income[m] = (e.income[m] ?? 0) + amt;
        else e.expense[m] = (e.expense[m] ?? 0) + amt;
      } else if (pm?.methodType === 'card' && t.type === 'expense') {
        let e = card.get(pm.id);
        if (!e) {
          e = { name: pm.name, expense: z() };
          card.set(pm.id, e);
        }
        e.expense[m] = (e.expense[m] ?? 0) + amt;
      }
      if (t.type === 'expense') {
        const top = topOf.get(t.categoryCode) ?? {
          code: t.categoryCode,
          name: t.categoryCode,
        };
        let e = cat.get(top.code);
        if (!e) {
          e = { name: top.name, expense: z() };
          cat.set(top.code, e);
        }
        e.expense[m] = (e.expense[m] ?? 0) + amt;
      }
    }

    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    return {
      year,
      bank: [...bank]
        .map(([id, v]) => ({
          id,
          name: v.name,
          income: v.income,
          expense: v.expense,
          total: sum(v.income) + sum(v.expense),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      card: [...card]
        .map(([id, v]) => ({ id, name: v.name, expense: v.expense, total: sum(v.expense) }))
        .sort((a, b) => b.total - a.total),
      category: [...cat]
        .map(([code, v]) => ({ code, name: v.name, expense: v.expense, total: sum(v.expense) }))
        .sort((a, b) => b.total - a.total),
    };
  }

  getRecent(limit = 6) {
    return this.prisma.monthlySummary.findMany({
      orderBy: { ym: 'desc' },
      take: limit,
    });
  }

  getByCategory(ym: string, type?: TransactionType) {
    return this.prisma.monthlyCategoryStat.findMany({
      where: { ym, ...(type ? { type } : {}) },
      include: { category: true },
      orderBy: { amountTotal: 'desc' },
    });
  }

  getBySource(ym: string) {
    return this.prisma.monthlySourceStat.findMany({
      where: { ym },
      include: { counterparty: true },
      orderBy: { amountTotal: 'desc' },
    });
  }

  getByPayment(ym: string, methodType?: 'bank' | 'card') {
    return this.prisma.monthlyPaymentStat.findMany({
      where: { ym, ...(methodType ? { methodType } : {}) },
      include: { paymentMethod: true },
      orderBy: { expenseTotal: 'desc' },
    });
  }

  /**
   * 월 요약 재집계 (DATABASE.md §8.5) — 해당 월 삭제 후 재삽입.
   * settled + amount 존재 거래만 합산. 이체/카드대금은 transaction 미연결이라 자동 제외.
   */
  async rebuild(ym: string) {
    this.assertYm(ym);
    const from = new Date(`${ym}-01T00:00:00Z`);
    const to = new Date(from);
    to.setUTCMonth(to.getUTCMonth() + 1);

    const rows = await this.prisma.transaction.findMany({
      where: {
        status: 'settled',
        amount: { not: null },
        transactionDate: { gte: from, lt: to },
      },
      include: { paymentMethod: true },
    });

    const num = (d: unknown) => Number(d ?? 0);
    let incomeTotal = 0;
    let expenseTotal = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    const catMap = new Map<string, { type: string; amount: number; count: number }>();
    const srcMap = new Map<number, { amount: number; count: number }>();
    const payMap = new Map<
      number,
      { methodType: string; income: number; expense: number; count: number }
    >();

    for (const t of rows) {
      const amt = num(t.amount);
      if (t.type === 'income') {
        incomeTotal += amt;
        incomeCount++;
      } else {
        expenseTotal += amt;
        expenseCount++;
      }
      // 분류별
      const c = catMap.get(t.categoryCode) ?? { type: t.type, amount: 0, count: 0 };
      c.amount += amt;
      c.count++;
      catMap.set(t.categoryCode, c);
      // 수입처별 (수입만)
      if (t.type === 'income' && t.counterpartyId) {
        const s = srcMap.get(t.counterpartyId) ?? { amount: 0, count: 0 };
        s.amount += amt;
        s.count++;
        srcMap.set(t.counterpartyId, s);
      }
      // 결제수단별
      const p = payMap.get(t.paymentMethodId) ?? {
        methodType: t.paymentMethod.methodType,
        income: 0,
        expense: 0,
        count: 0,
      };
      if (t.type === 'income') p.income += amt;
      else p.expense += amt;
      p.count++;
      payMap.set(t.paymentMethodId, p);
    }

    // 분류별 비중(ratio) — type별 합계 대비
    const typeTotals: Record<string, number> = { income: incomeTotal, expense: expenseTotal };

    await this.prisma.$transaction([
      // 전체 요약
      this.prisma.monthlySummary.upsert({
        where: { ym },
        update: {
          incomeTotal,
          expenseTotal,
          netAmount: incomeTotal - expenseTotal,
          incomeCount,
          expenseCount,
        },
        create: {
          ym,
          incomeTotal,
          expenseTotal,
          netAmount: incomeTotal - expenseTotal,
          incomeCount,
          expenseCount,
        },
      }),
      // 차원별 — 삭제 후 재삽입
      this.prisma.monthlyCategoryStat.deleteMany({ where: { ym } }),
      this.prisma.monthlyCategoryStat.createMany({
        data: [...catMap.entries()].map(([categoryCode, v]) => ({
          ym,
          categoryCode,
          type: v.type as TransactionType,
          amountTotal: v.amount,
          txCount: v.count,
          ratio: typeTotals[v.type]
            ? Math.round((v.amount / typeTotals[v.type]!) * 10000) / 100
            : null,
        })),
      }),
      this.prisma.monthlySourceStat.deleteMany({ where: { ym } }),
      this.prisma.monthlySourceStat.createMany({
        data: [...srcMap.entries()].map(([counterpartyId, v]) => ({
          ym,
          counterpartyId,
          amountTotal: v.amount,
          txCount: v.count,
        })),
      }),
      this.prisma.monthlyPaymentStat.deleteMany({ where: { ym } }),
      this.prisma.monthlyPaymentStat.createMany({
        data: [...payMap.entries()].map(([paymentMethodId, v]) => ({
          ym,
          paymentMethodId,
          methodType: v.methodType as 'bank' | 'card',
          incomeTotal: v.income,
          expenseTotal: v.expense,
          txCount: v.count,
        })),
      }),
    ]);

    return this.getSummary(ym);
  }
}
