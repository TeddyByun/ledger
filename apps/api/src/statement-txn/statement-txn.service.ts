import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StatisticsService } from '../statistics/statistics.service.js';
import { requireTenant } from '../common/tenant/tenant-context.js';
import { StatementTxnQueryDto } from './dto/query.dto.js';
import { UpdateBankTxnDto } from './dto/update-bank-txn.dto.js';

interface Cursor {
  d: string; // ISO datetime/date
  id: number;
}

/** bank_transaction 조회 시 공통 include */
const BANK_INCLUDE = {
  paymentMethod: { select: { id: true, name: true, identifier: true } },
  txnType: { select: { name: true } },
  transaction: {
    select: { categoryCode: true, category: { select: { name: true } } },
  },
} satisfies Prisma.BankTransactionInclude;

type BankRow = Prisma.BankTransactionGetPayload<{ include: typeof BANK_INCLUDE }>;

@Injectable()
export class StatementTxnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: StatisticsService,
  ) {}

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
      include: BANK_INCLUDE,
      orderBy: [{ txnAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasNext = rows.length > limit;
    const items = (hasNext ? rows.slice(0, limit) : rows).map((b) =>
      this.mapBank(b),
    );
    const last = items[items.length - 1];
    const nextCursor =
      hasNext && last ? this.encodeCursor(last.txnAt, last.id) : null;
    return { items, page: { nextCursor, hasNext } };
  }

  private mapBank(b: BankRow) {
    return {
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
    };
  }

  async findBankOne(id: number) {
    const b = await this.prisma.bankTransaction.findUnique({
      where: { id },
      include: BANK_INCLUDE,
    });
    if (!b) throw new NotFoundException(`bank transaction ${id} not found`);
    return this.mapBank(b);
  }

  /**
   * 은행 거래 건별 수정 — 적요(내용)/분류.
   * - 분류 지정: 미분류 행은 거래를 생성해 확정(제외표시 해제), 이미 연결됐으면 갱신.
   * - 분류 해제(빈값): 연결된 거래 삭제 후 미분류로 되돌림.
   * - 적요: bank_transaction + 연결 거래에 함께 반영.
   */
  async updateBank(id: number, dto: UpdateBankTxnDto) {
    const b = await this.prisma.bankTransaction.findUnique({
      where: { id },
      include: { transaction: true },
    });
    if (!b) throw new NotFoundException(`bank transaction ${id} not found`);

    const ym = b.txnAt.toISOString().slice(0, 7);
    const desc =
      dto.description !== undefined
        ? dto.description.trim() || null
        : b.description;

    // ── 분류 ──
    if (dto.categoryCode !== undefined) {
      const code = dto.categoryCode.trim();
      if (code) {
        const isExpense = Number(b.withdrawal) > 0;
        const amount = isExpense ? Number(b.withdrawal) : Number(b.deposit);
        if (amount > 0) {
          if (b.transactionId) {
            await this.prisma.transaction.update({
              where: { id: b.transactionId },
              data: {
                categoryCode: code,
                type: isExpense ? 'expense' : 'income',
                description: desc,
              },
            });
          } else {
            const day = startOfDay(b.txnAt);
            const tx = await this.prisma.transaction.create({
              data: {
                householdId: requireTenant().householdId,
                type: isExpense ? 'expense' : 'income',
                categoryCode: code,
                paymentMethodId: b.paymentMethodId,
                description: desc,
                amount,
                transactionDate: day,
                settledDate: day,
                status: 'settled',
              },
            });
            await this.prisma.bankTransaction.update({
              where: { id },
              data: {
                transactionId: tx.id,
                isClassified: 'Y',
                excludeReason: null,
              },
            });
          }
        }
      } else if (b.transactionId) {
        // 분류 해제 → 거래 삭제, 미분류로
        await this.prisma.bankTransaction.update({
          where: { id },
          data: { transactionId: null, isClassified: 'N' },
        });
        await this.prisma.transaction.delete({ where: { id: b.transactionId } });
      }
    }

    // ── 적요(내용) ──
    if (dto.description !== undefined) {
      await this.prisma.bankTransaction.update({
        where: { id },
        data: { description: desc },
      });
      // 분류 분기에서 이미 갱신하지 않은 경우에만 연결 거래에 동기화
      if (b.transactionId && dto.categoryCode === undefined) {
        await this.prisma.transaction.update({
          where: { id: b.transactionId },
          data: { description: desc },
        });
      }
    }

    await this.stats.rebuild(ym);
    return this.findBankOne(id);
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

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
