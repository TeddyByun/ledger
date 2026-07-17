import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StatisticsService } from '../statistics/statistics.service.js';
import { ClassifierService } from '../ingestion/classification/classifier.service.js';
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
    private readonly classifier: ClassifierService,
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

  /** 가구 은행 거래에 존재하는 '구분'(txn_type_raw) 목록 — 필터 셀렉트용. */
  async bankTypes(): Promise<string[]> {
    const rows = await this.prisma.bankTransaction.findMany({
      where: { txnTypeRaw: { not: null } },
      distinct: ['txnTypeRaw'],
      select: { txnTypeRaw: true },
      orderBy: { txnTypeRaw: 'asc' },
    });
    return rows.map((r) => r.txnTypeRaw!).filter(Boolean);
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

  /** 선택한 은행 거래들의 분류를 일괄 변경(미분류 행은 거래 생성·확정). */
  async bulkClassifyBank(ids: number[], categoryCode: string) {
    const hid = requireTenant().householdId;
    const rows = await this.prisma.bankTransaction.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        transactionId: true,
        txnAt: true,
        withdrawal: true,
        deposit: true,
        description: true,
        paymentMethodId: true,
      },
    });
    const months = new Set<string>();
    let updated = 0;
    for (const b of rows) {
      const isExpense = Number(b.withdrawal) > 0;
      const amount = isExpense ? Number(b.withdrawal) : Number(b.deposit);
      if (amount <= 0) continue;
      const type = isExpense ? 'expense' : 'income';
      if (b.transactionId) {
        await this.prisma.transaction.update({
          where: { id: b.transactionId },
          data: { categoryCode, type },
        });
      } else {
        const day = startOfDay(b.txnAt);
        const tx = await this.prisma.transaction.create({
          data: {
            householdId: hid,
            type,
            categoryCode,
            paymentMethodId: b.paymentMethodId,
            description: b.description,
            amount,
            transactionDate: day,
            settledDate: day,
            status: 'settled',
          },
        });
        await this.prisma.bankTransaction.update({
          where: { id: b.id },
          data: { transactionId: tx.id, isClassified: 'Y', excludeReason: null },
        });
      }
      months.add(b.txnAt.toISOString().slice(0, 7));
      updated++;
    }
    for (const ym of months) await this.stats.rebuild(ym);
    return { updated };
  }

  /** 선택한 은행 거래들을 일괄 삭제(연결된 거래도 함께 삭제). */
  async bulkDeleteBank(ids: number[]) {
    const rows = await this.prisma.bankTransaction.findMany({
      where: { id: { in: ids } },
      select: { id: true, transactionId: true, txnAt: true },
    });
    if (rows.length === 0) return { deleted: 0 };
    const months = new Set(rows.map((r) => r.txnAt.toISOString().slice(0, 7)));
    const txIds = rows
      .map((r) => r.transactionId)
      .filter((x): x is number => x != null);

    // 원천(bank_transaction)이 FK를 보유 → 먼저 삭제 후 연결 거래 삭제
    await this.prisma.bankTransaction.deleteMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });
    if (txIds.length) {
      await this.prisma.transaction.deleteMany({ where: { id: { in: txIds } } });
    }
    for (const ym of months) await this.stats.rebuild(ym);
    return { deleted: rows.length };
  }

  /**
   * 은행 미분류 거래 일괄 자동 분류.
   *  1) 제외(분류 불필요): 당행송금 → transfer, 카드대금(구분에 '카드') → card_settlement
   *  2) 이력 학습: 과거 이미 분류된 동일 내용(방향별)의 가장 최근 분류를 그대로 적용
   *  3) 규칙 보완: 가맹점 규칙(merchant_category_map)으로 마지막 시도
   */
  async autoClassifyBank() {
    const hid = requireTenant().householdId;

    // 1) 제외 처리 — 분류가 필요 없는 이체/카드대금
    const excTransfer = await this.prisma.bankTransaction.updateMany({
      where: {
        transactionId: null,
        excludeReason: null,
        txnType: { name: '당행송금' },
      },
      data: { excludeReason: 'transfer', isClassified: 'Y' },
    });
    const excCard = await this.prisma.bankTransaction.updateMany({
      where: {
        withdrawal: { gt: 0 },
        transactionId: null,
        excludeReason: null,
        txnType: { name: { contains: '카드' } },
      },
      data: { excludeReason: 'card_settlement', isClassified: 'Y' },
    });

    // 2) 이력 맵 구성 — 방향(출금/입금)별 정규화 내용 → 최신 분류코드
    const history = await this.prisma.bankTransaction.findMany({
      where: { transactionId: { not: null }, description: { not: null } },
      select: {
        description: true,
        withdrawal: true,
        transaction: { select: { categoryCode: true } },
      },
      orderBy: { txnAt: 'desc' },
    });
    const exactMap = new Map<string, string>();
    const fuzzyMap = new Map<string, string>();
    for (const h of history) {
      const code = h.transaction?.categoryCode;
      if (!code) continue;
      const dir = Number(h.withdrawal) > 0 ? 'out' : 'in';
      const norm = normKey(h.description);
      if (!norm) continue;
      const ek = `${dir}:${norm}`;
      if (!exactMap.has(ek)) exactMap.set(ek, code);
      const fk = `${dir}:${fuzzyKey(h.description)}`;
      if (!fuzzyMap.has(fk)) fuzzyMap.set(fk, code);
    }

    // 3) 미분류 행 처리
    const pending = await this.prisma.bankTransaction.findMany({
      where: { transactionId: null, excludeReason: null },
    });
    const months = new Set<string>();
    let byHistory = 0;
    let byRule = 0;
    for (const b of pending) {
      const isExpense = Number(b.withdrawal) > 0;
      const amount = isExpense ? Number(b.withdrawal) : Number(b.deposit);
      if (amount <= 0) continue;
      const dir = isExpense ? 'out' : 'in';
      const norm = normKey(b.description);

      let code: string | null = null;
      let source: 'history' | 'rule' | null = null;
      if (norm) {
        code =
          exactMap.get(`${dir}:${norm}`) ??
          fuzzyMap.get(`${dir}:${fuzzyKey(b.description)}`) ??
          null;
        if (code) source = 'history';
      }
      if (!code) {
        code = await this.classifier.classify(b.description ?? '');
        if (code) source = 'rule';
      }
      if (!code) continue;

      const day = startOfDay(b.txnAt);
      const tx = await this.prisma.transaction.create({
        data: {
          householdId: hid,
          type: isExpense ? 'expense' : 'income',
          categoryCode: code,
          paymentMethodId: b.paymentMethodId,
          description: b.description,
          amount,
          transactionDate: day,
          settledDate: day,
          status: 'settled',
        },
      });
      await this.prisma.bankTransaction.update({
        where: { id: b.id },
        data: { transactionId: tx.id, isClassified: 'Y' },
      });
      months.add(b.txnAt.toISOString().slice(0, 7));
      if (source === 'history') byHistory++;
      else byRule++;
    }

    for (const ym of months) await this.stats.rebuild(ym);
    return {
      excludedTransfer: excTransfer.count,
      excludedCard: excCard.count,
      classifiedByHistory: byHistory,
      classifiedByRule: byRule,
      remaining: pending.length - byHistory - byRule,
    };
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

  /** 카드 조회 조건에 해당하는 전체 거래의 합계(이용금액·결제금액=원금+수수료·건수). */
  async findCardSummary(query: StatementTxnQueryDto) {
    const where = await this.buildCardWhere(query);
    const agg = await this.prisma.cardTransaction.aggregate({
      where,
      _sum: { usageAmount: true, principal: true, fee: true },
      _count: true,
    });
    const usageAmount = Number(agg._sum.usageAmount ?? 0);
    const payAmount =
      Number(agg._sum.principal ?? 0) + Number(agg._sum.fee ?? 0);
    return { count: agg._count, usageAmount, payAmount };
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
    if (q.txnType) where.txnTypeRaw = q.txnType;
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

/** 내용 정규화 — 공백 제거(대소문자 유지). 이력 매칭 키. */
function normKey(s: string | null): string {
  return (s ?? '').replace(/\s/g, '');
}

/** 느슨한 매칭 키 — 끝의 숫자(월/식별번호)를 떼어 반복 항목(예: METLIFE06193/05192) 그룹화. */
function fuzzyKey(s: string | null): string {
  return normKey(s).replace(/\d+$/, '');
}
