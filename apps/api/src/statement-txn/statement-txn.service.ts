import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StatementTxnQueryDto } from './dto/query.dto.js';

interface Cursor {
  d: string; // ISO datetime/date
  id: number;
}

@Injectable()
export class StatementTxnService {
  constructor(private readonly prisma: PrismaService) {}

  // ── 은행 원천 거래 (bank_transaction) ───────────────────
  async findBank(query: StatementTxnQueryDto) {
    const limit = query.limit ?? 50;
    const cursor = this.decodeCursor(query.cursor);
    const base = await this.buildBankWhere(query);

    const where: Prisma.BankTransactionWhereInput = cursor
      ? {
          AND: [
            base,
            {
              OR: [
                { txnAt: { lt: new Date(cursor.d) } },
                { txnAt: new Date(cursor.d), id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : base;

    const rows = await this.prisma.bankTransaction.findMany({
      where,
      include: {
        paymentMethod: { select: { id: true, name: true, identifier: true } },
        txnType: { select: { name: true } },
        transaction: {
          select: { categoryCode: true, category: { select: { name: true } } },
        },
      },
      orderBy: [{ txnAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasNext = rows.length > limit;
    const items = (hasNext ? rows.slice(0, limit) : rows).map((b) => ({
      id: b.id,
      txnAt: b.txnAt,
      txnTypeRaw: b.txnTypeRaw,
      description: b.description,
      withdrawal: b.withdrawal,
      deposit: b.deposit,
      balance: b.balance,
      branch: b.branch,
      excludeReason: b.excludeReason,
      account: b.paymentMethod
        ? { id: b.paymentMethod.id, name: b.paymentMethod.name }
        : null,
      categoryCode: b.transaction?.categoryCode ?? null,
      categoryName: b.transaction?.category?.name ?? null,
    }));
    const last = items[items.length - 1];
    const nextCursor =
      hasNext && last ? this.encodeCursor(last.txnAt, last.id) : null;
    return { items, page: { nextCursor, hasNext } };
  }

  // ── 카드 원천 거래 (card_transaction) ───────────────────
  async findCard(query: StatementTxnQueryDto) {
    const limit = query.limit ?? 50;
    const cursor = this.decodeCursor(query.cursor);
    const base = await this.buildCardWhere(query);

    const where: Prisma.CardTransactionWhereInput = cursor
      ? {
          AND: [
            base,
            {
              OR: [
                { txnDate: { lt: new Date(cursor.d) } },
                { txnDate: new Date(cursor.d), id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : base;

    const rows = await this.prisma.cardTransaction.findMany({
      where,
      include: {
        paymentMethod: { select: { id: true, name: true, cardNo: true } },
        transaction: {
          select: { categoryCode: true, category: { select: { name: true } } },
        },
      },
      orderBy: [{ txnDate: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasNext = rows.length > limit;
    const items = (hasNext ? rows.slice(0, limit) : rows).map((c) => ({
      id: c.id,
      txnDate: c.txnDate,
      merchantName: c.merchantName,
      usageAmount: c.usageAmount,
      principal: c.principal,
      fee: c.fee,
      installmentPeriod: c.installmentPeriod,
      isCanceled: c.isCanceled,
      cardLabel: c.cardLabel,
      cardNo: c.cardNo,
      card: c.paymentMethod
        ? { id: c.paymentMethod.id, name: c.paymentMethod.name, cardNo: c.paymentMethod.cardNo }
        : null,
      categoryCode: c.transaction?.categoryCode ?? null,
      categoryName: c.transaction?.category?.name ?? null,
    }));
    const last = items[items.length - 1];
    const nextCursor =
      hasNext && last ? this.encodeCursor(last.txnDate, last.id) : null;
    return { items, page: { nextCursor, hasNext } };
  }

  // ── helpers ─────────────────────────────────────────────
  private async categoryCodes(code: string): Promise<string[]> {
    const children = await this.prisma.category.findMany({
      where: { parentCode: code },
      select: { code: true },
    });
    return [code, ...children.map((c) => c.code)];
  }

  private async buildBankWhere(
    q: StatementTxnQueryDto,
  ): Promise<Prisma.BankTransactionWhereInput> {
    const where: Prisma.BankTransactionWhereInput = {};
    if (q.paymentMethodId) where.paymentMethodId = q.paymentMethodId;
    if (q.from || q.to) {
      where.txnAt = {
        ...(q.from && { gte: new Date(`${q.from}T00:00:00.000Z`) }),
        ...(q.to && { lte: new Date(`${q.to}T23:59:59.999Z`) }),
      };
    }
    if (q.categoryCode) {
      where.transaction = {
        is: { categoryCode: { in: await this.categoryCodes(q.categoryCode) } },
      };
    }
    if (q.q) {
      where.description = { contains: q.q, mode: 'insensitive' };
    }
    return where;
  }

  private async buildCardWhere(
    q: StatementTxnQueryDto,
  ): Promise<Prisma.CardTransactionWhereInput> {
    const where: Prisma.CardTransactionWhereInput = {};
    if (q.paymentMethodId) where.paymentMethodId = q.paymentMethodId;
    if (q.from || q.to) {
      where.txnDate = {
        ...(q.from && { gte: new Date(`${q.from}T00:00:00.000Z`) }),
        ...(q.to && { lte: new Date(`${q.to}T00:00:00.000Z`) }),
      };
    }
    if (q.categoryCode) {
      where.transaction = {
        is: { categoryCode: { in: await this.categoryCodes(q.categoryCode) } },
      };
    }
    if (q.q) {
      where.merchantName = { contains: q.q, mode: 'insensitive' };
    }
    return where;
  }

  private encodeCursor(date: Date, id: number): string {
    return Buffer.from(JSON.stringify({ d: date.toISOString(), id })).toString(
      'base64url',
    );
  }

  private decodeCursor(c?: string): Cursor | undefined {
    if (!c) return undefined;
    try {
      const parsed = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
      return { d: String(parsed.d), id: Number(parsed.id) };
    } catch {
      return undefined;
    }
  }
}
