import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { requireTenant } from '../common/tenant/tenant-context.js';
import {
  CreateTransactionDto,
  TransactionQueryDto,
  UpdateTransactionDto,
} from './dto/transaction.dto.js';

interface Cursor {
  d: Date;
  id: number;
}

@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 거래 목록 — 커서(keyset) 페이지네이션 (API_CONVENTIONS §3.1).
   * 정렬키 (transactionDate desc, id desc) 로 안정 페이징.
   */
  async findMany(query: TransactionQueryDto) {
    const where = await this.buildWhere(query);
    const limit = query.limit ?? 50;
    const cursor = this.decodeCursor(query.cursor);

    const finalWhere: Prisma.TransactionWhereInput = cursor
      ? {
          AND: [
            where,
            {
              OR: [
                { transactionDate: { lt: cursor.d } },
                { transactionDate: cursor.d, id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : where;

    const rows = await this.prisma.transaction.findMany({
      where: finalWhere,
      include: { category: true, counterparty: true, paymentMethod: true },
      orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasNext = rows.length > limit;
    const items = hasNext ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasNext && last ? this.encodeCursor(last.transactionDate, last.id) : null;

    return { items, page: { nextCursor, hasNext } };
  }

  /** 필터 조건에 대한 수입/지출 합계·건수 (은행+카드 통합). */
  async summary(query: TransactionQueryDto) {
    const where = await this.buildWhere(query);
    const grouped = await this.prisma.transaction.groupBy({
      by: ['type'],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    });
    let incomeTotal = 0;
    let expenseTotal = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    for (const g of grouped) {
      const amt = Number(g._sum.amount ?? 0);
      if (g.type === 'income') {
        incomeTotal = amt;
        incomeCount = g._count._all;
      } else {
        expenseTotal = amt;
        expenseCount = g._count._all;
      }
    }
    return {
      incomeTotal,
      expenseTotal,
      net: incomeTotal - expenseTotal,
      incomeCount,
      expenseCount,
      count: incomeCount + expenseCount,
    };
  }

  private encodeCursor(date: Date, id: number): string {
    const d = date.toISOString().slice(0, 10);
    return Buffer.from(JSON.stringify({ d, id })).toString('base64url');
  }

  private decodeCursor(c?: string): Cursor | undefined {
    if (!c) return undefined;
    try {
      const parsed = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
      return { d: new Date(`${parsed.d}T00:00:00.000Z`), id: Number(parsed.id) };
    } catch {
      return undefined;
    }
  }

  async findOne(id: number) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id },
      include: { category: true, counterparty: true, paymentMethod: true },
    });
    if (!tx) throw new NotFoundException(`transaction ${id} not found`);
    return tx;
  }

  create(dto: CreateTransactionDto) {
    return this.prisma.transaction.create({
      data: { ...this.toData(dto), householdId: requireTenant().householdId },
    });
  }

  async update(id: number, dto: UpdateTransactionDto) {
    await this.findOne(id);
    return this.prisma.transaction.update({
      where: { id },
      data: this.toData(dto),
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.transaction.delete({ where: { id } });
    return { deleted: true };
  }

  // ── helpers ──────────────────────────────────────────
  private toData(
    dto: CreateTransactionDto | UpdateTransactionDto,
  ): Prisma.TransactionUncheckedCreateInput {
    return {
      ...(dto.type !== undefined && { type: dto.type }),
      ...(dto.categoryCode !== undefined && { categoryCode: dto.categoryCode }),
      ...(dto.paymentMethodId !== undefined && {
        paymentMethodId: dto.paymentMethodId,
      }),
      ...(dto.counterpartyId !== undefined && {
        counterpartyId: dto.counterpartyId,
      }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.amount !== undefined && { amount: dto.amount }),
      ...(dto.transactionDate !== undefined && {
        transactionDate: new Date(dto.transactionDate),
      }),
      ...(dto.settledDate !== undefined && {
        settledDate: new Date(dto.settledDate),
      }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.memo !== undefined && { memo: dto.memo }),
    } as Prisma.TransactionUncheckedCreateInput;
  }

  /** 분류코드가 대분류면 소분류까지 포함해 검색. */
  private async buildWhere(
    query: TransactionQueryDto,
  ): Promise<Prisma.TransactionWhereInput> {
    const where: Prisma.TransactionWhereInput = {};
    if (query.type) where.type = query.type;
    if (query.paymentMethodId) where.paymentMethodId = query.paymentMethodId;
    if (query.methodType) {
      where.paymentMethod = { is: { methodType: query.methodType } };
    }

    if (query.categoryCode) {
      const children = await this.prisma.category.findMany({
        where: { parentCode: query.categoryCode },
        select: { code: true },
      });
      const codes = [query.categoryCode, ...children.map((c) => c.code)];
      where.categoryCode = { in: codes };
    }

    if (query.from || query.to) {
      where.transactionDate = {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      };
    }

    if (query.q) {
      where.OR = [
        { description: { contains: query.q, mode: 'insensitive' } },
        { memo: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    return where;
  }
}
