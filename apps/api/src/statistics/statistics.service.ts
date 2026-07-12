import { Injectable } from '@nestjs/common';
import { TransactionType } from '@ledger/shared';
import { PrismaService } from '../prisma/prisma.service.js';

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
