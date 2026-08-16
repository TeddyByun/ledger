import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, RecurringFlow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { requireTenant } from '../common/tenant/tenant-context.js';
import { recurringKey } from '../common/fuzzy-key.js';
import {
  CreateRecurringExpenseDto,
  UpdateRecurringExpenseDto,
} from './dto/recurring-expense.dto.js';

/** 'YYYY-MM' 헬퍼 */
const ymOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const cmpYm = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

@Injectable()
export class RecurringExpenseService {
  constructor(private readonly prisma: PrismaService) {}

  /** 확정 정기지출/수입 목록 + 이번 달 발생 상태(발생/예정/지연/종료). */
  async findAll(flow: RecurringFlow = 'expense') {
    const now = new Date();
    const ym = ymOf(now);
    const today = now.getUTCDate();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const [rows, monthTxns] = await Promise.all([
      this.prisma.recurringExpense.findMany({
        where: { flow },
        include: { category: { select: { name: true } }, paymentMethod: { select: { name: true } } },
        orderBy: [{ isActive: 'asc' }, { cadence: 'asc' }, { amount: 'desc' }],
      }),
      this.prisma.transaction.findMany({
        where: { type: flow, transactionDate: { gte: monthStart, lt: monthEnd } },
        select: { description: true, amount: true, paymentMethodId: true },
      }),
    ]);

    return rows.map((r) => {
      const currentMonth = now.getUTCMonth() + 1;
      // 시작/만기 년월은 **주기와 무관하게** 적용된다(할부·구독처럼 끝이 있는 매월 항목).
      const beforeStart = r.startYm ? cmpYm(ym, r.startYm) < 0 : false;
      const afterEnd = r.endYm ? cmpYm(ym, r.endYm) > 0 : false;
      const appliesThisMonth =
        !beforeStart &&
        !afterEnd &&
        (r.cadence === 'annual' ? r.months.includes(currentMonth) : true);

      // 이번 달 발생 매칭(fuzzyKey + 결제수단)
      let occurred = 0;
      if (r.matchKey) {
        for (const t of monthTxns) {
          if (recurringKey(t.description) !== r.matchKey) continue;
          if (r.paymentMethodId && t.paymentMethodId !== r.paymentMethodId) continue;
          occurred += Number(t.amount ?? 0);
        }
      }
      const isOccurred = occurred > 0;

      let status: 'occurred' | 'due' | 'overdue' | 'ended' | 'off';
      if (afterEnd) status = 'ended';
      else if (!appliesThisMonth) status = 'off';
      else if (isOccurred) status = 'occurred';
      else if (r.dayOfMonth && r.dayOfMonth < today) status = 'overdue';
      else status = 'due';

      const remainingMonths = r.endYm
        ? Math.max(
            0,
            (Number(r.endYm.slice(0, 4)) - now.getUTCFullYear()) * 12 +
              (Number(r.endYm.slice(5, 7)) - (now.getUTCMonth() + 1)),
          )
        : null;

      return {
        id: r.id,
        label: r.label,
        categoryCode: r.categoryCode,
        categoryName: r.category?.name ?? r.categoryCode,
        paymentMethodId: r.paymentMethodId,
        paymentMethodName: r.paymentMethod?.name ?? null,
        amount: Number(r.amount),
        amountType: r.amountType,
        cadence: r.cadence,
        months: r.months,
        startYm: r.startYm,
        endYm: r.endYm,
        dayOfMonth: r.dayOfMonth,
        source: r.source,
        isActive: r.isActive,
        memo: r.memo,
        status,
        occurredAmount: isOccurred ? occurred : 0,
        remainingMonths,
        needsMaturity: r.cadence === 'schedule' && !r.endYm, // 만기 미설정 경고
      };
    });
  }

  create(dto: CreateRecurringExpenseDto, flow: RecurringFlow = 'expense') {
    return this.prisma.recurringExpense.create({
      data: { ...this.toData(dto), flow, householdId: requireTenant().householdId },
    });
  }

  async update(id: number, dto: UpdateRecurringExpenseDto) {
    await this.findOne(id);
    const data = this.toData(dto);
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return this.prisma.recurringExpense.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.recurringExpense.delete({ where: { id } });
    return { deleted: true };
  }

  private async findOne(id: number) {
    const r = await this.prisma.recurringExpense.findUnique({ where: { id } });
    if (!r) throw new NotFoundException(`recurring expense ${id} not found`);
    return r;
  }

  private toData(
    dto: CreateRecurringExpenseDto | UpdateRecurringExpenseDto,
  ): Prisma.RecurringExpenseUncheckedCreateInput {
    const d: Record<string, unknown> = {};
    if (dto.label !== undefined) d.label = dto.label.trim();
    if (dto.categoryCode !== undefined) d.categoryCode = dto.categoryCode;
    if (dto.paymentMethodId !== undefined) d.paymentMethodId = dto.paymentMethodId;
    if (dto.amount !== undefined) d.amount = dto.amount;
    if (dto.amountType !== undefined) d.amountType = dto.amountType;
    if (dto.cadence !== undefined) d.cadence = dto.cadence;
    if (dto.months !== undefined) d.months = dto.months;
    if (dto.startYm !== undefined) d.startYm = dto.startYm;
    if (dto.endYm !== undefined) d.endYm = dto.endYm;
    if (dto.dayOfMonth !== undefined) d.dayOfMonth = dto.dayOfMonth;
    if (dto.matchKey !== undefined) d.matchKey = dto.matchKey;
    if (dto.source !== undefined) d.source = dto.source;
    if (dto.memo !== undefined) d.memo = dto.memo;
    return d as Prisma.RecurringExpenseUncheckedCreateInput;
  }
}
