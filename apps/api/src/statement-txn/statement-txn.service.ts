import { Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StatisticsService } from '../statistics/statistics.service.js';
import { ClassifierService } from '../ingestion/classification/classifier.service.js';
import { ReconcilerService } from '../ingestion/reconciliation/reconciler.service.js';
import { requireTenant } from '../common/tenant/tenant-context.js';
import { recurringKey } from '../common/fuzzy-key.js';
import { parseIdList } from '../common/parse-ids.js';
import { StatementTxnQueryDto } from './dto/query.dto.js';
import { UpdateBankTxnDto } from './dto/update-bank-txn.dto.js';


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
    private readonly reconciler: ReconcilerService,
  ) {}

  // ── 은행 원천 거래 (bank_transaction) ───────────────────
  async findBank(query: StatementTxnQueryDto) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const where = await this.buildBankWhere(query);

    const rows = await this.prisma.bankTransaction.findMany({
      where,
      include: BANK_INCLUDE,
      orderBy: this.bankOrderBy(query.sort),
      skip: offset,
      take: limit + 1,
    });

    const hasNext = rows.length > limit;
    const items = (hasNext ? rows.slice(0, limit) : rows).map((b) =>
      this.mapBank(b),
    );
    return { items, page: { nextCursor: null, hasNext } };
  }

  /** 은행 정렬 스펙 → orderBy(우선순위 순). 화이트리스트 외 무시, id 로 안정화. */
  private bankOrderBy(
    sort?: string,
  ): Prisma.BankTransactionOrderByWithRelationInput[] {
    const map: Record<
      string,
      (d: 'asc' | 'desc') => Prisma.BankTransactionOrderByWithRelationInput
    > = {
      date: (d) => ({ txnAt: d }),
      account: (d) => ({ paymentMethod: { name: d } }),
      type: (d) => ({ txnTypeRaw: d }),
      category: (d) => ({ transaction: { categoryCode: d } }),
      description: (d) => ({ description: d }),
      withdrawal: (d) => ({ withdrawal: d }),
      deposit: (d) => ({ deposit: d }),
      balance: (d) => ({ balance: d }),
    };
    const out = parseSort(sort, map);
    if (out.length === 0) out.push({ txnAt: 'desc' });
    out.push({ id: 'desc' });
    return out;
  }

  /** 은행 조회 조건에 해당하는 전체 거래의 합계(출금·입금·건수). */
  async findBankSummary(query: StatementTxnQueryDto) {
    const where = await this.buildBankWhere(query);
    const agg = await this.prisma.bankTransaction.aggregate({
      where,
      _sum: { withdrawal: true, deposit: true },
      _count: true,
    });
    return {
      count: agg._count,
      withdrawal: Number(agg._sum.withdrawal ?? 0),
      deposit: Number(agg._sum.deposit ?? 0),
    };
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
   * 정기지출(관리>정기지출) 기반 매칭기 로드.
   * 각 정기지출의 매칭 토큰(match_key 우선, 없으면 label 정규화)을 준비한다.
   * 거래 내용(정규화)에 토큰이 "포함"되면 그 정기지출의 분류로 자동 분류한다.
   */
  private async recurringMatchers(): Promise<
    { token: string; categoryCode: string; paymentMethodId: number | null }[]
  > {
    const recs = await this.prisma.recurringExpense.findMany({
      where: { isActive: 'Y' },
      select: {
        label: true,
        matchKey: true,
        categoryCode: true,
        paymentMethodId: true,
      },
    });
    const out: {
      token: string;
      categoryCode: string;
      paymentMethodId: number | null;
    }[] = [];
    for (const r of recs) {
      const token = (r.matchKey?.trim() || recurringKey(r.label)).trim();
      if (token.length < 2) continue; // 너무 짧은 토큰은 오탐 방지 위해 제외
      out.push({
        token,
        categoryCode: r.categoryCode,
        paymentMethodId: r.paymentMethodId,
      });
    }
    // 더 구체적인(긴) 토큰 우선
    out.sort((a, b) => b.token.length - a.token.length);
    return out;
  }

  /** 거래 내용에 정기지출 토큰이 포함되면 해당 분류 코드 반환. 결제수단 지정 시 일치해야 함. */
  private matchRecurring(
    matchers: {
      token: string;
      categoryCode: string;
      paymentMethodId: number | null;
    }[],
    text: string | null,
    paymentMethodId: number,
  ): string | null {
    const key = recurringKey(text);
    if (!key) return null;
    for (const m of matchers) {
      if (m.paymentMethodId != null && m.paymentMethodId !== paymentMethodId) {
        continue;
      }
      if (key.includes(m.token)) return m.categoryCode;
    }
    return null;
  }

  /**
   * 은행 미분류 거래 일괄 자동 분류.
   *  1) 제외(분류 불필요): 당행송금 → transfer, 카드대금(구분에 '카드') → card_settlement
   *  2) 정기지출 매칭: 관리>정기지출 항목명이 내용에 포함되면 그 분류로 자동 분류
   *  3) 이력 학습: 과거 이미 분류된 동일 내용(방향별)의 가장 최근 분류를 그대로 적용
   *  4) 규칙 보완: 가맹점 규칙(merchant_category_map)으로 마지막 시도
   */
  async autoClassifyBank() {
    const hid = requireTenant().householdId;
    const months = new Set<string>();

    // 0) 결제수단 집계 제외 → '분류 제외', 카드대금·본인 계좌 간 이체 → '분류 제외'
    await this.reconciler.classifyExcludedBankPms(months);
    const cardSettle = await this.reconciler.classifyCardSettlements(months);
    const selfTransfer = await this.reconciler.classifySelfTransfers(months);

    // 이력 맵 구성 — 방향(출금/입금)별 정규화 내용 → 최신 분류코드
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

    // 미분류 행 처리 — 명시적 분류 신호(정기지출/이력/키워드)는 당행송금 제외보다 우선.
    // 이미 'transfer'로 제외된 행도 재분류 대상에 포함(키워드 등록 후 반영되도록).
    const recMatchers = await this.recurringMatchers();
    const pending = await this.prisma.bankTransaction.findMany({
      where: {
        transactionId: null,
        OR: [{ excludeReason: null }, { excludeReason: 'transfer' }],
      },
    });
    let byRecurring = 0;
    let byHistory = 0;
    let byRule = 0;
    for (const b of pending) {
      const isExpense = Number(b.withdrawal) > 0;
      const amount = isExpense ? Number(b.withdrawal) : Number(b.deposit);
      if (amount <= 0) continue;
      const dir = isExpense ? 'out' : 'in';
      const norm = normKey(b.description);

      let code: string | null = null;
      let source: 'recurring' | 'history' | 'rule' | null = null;
      // 지출 건에 한해 정기지출 매칭 우선(사용자가 관리에서 지정한 의도)
      if (isExpense) {
        code = this.matchRecurring(recMatchers, b.description, b.paymentMethodId);
        if (code) source = 'recurring';
      }
      if (!code && norm) {
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
        // 분류되면 구버전 transfer 제외 표시는 정리
        data: { transactionId: tx.id, isClassified: 'Y', excludeReason: null },
      });
      months.add(b.txnAt.toISOString().slice(0, 7));
      if (source === 'recurring') byRecurring++;
      else if (source === 'history') byHistory++;
      else byRule++;
    }

    // 분류되지 않고 남은 당행송금은 '이체'로 제외 처리(키워드/이력에 안 걸린 실제 이체)
    const excTransfer = await this.prisma.bankTransaction.updateMany({
      where: {
        transactionId: null,
        excludeReason: null,
        txnType: { name: '당행송금' },
      },
      data: { excludeReason: 'transfer', isClassified: 'Y' },
    });

    for (const ym of months) await this.stats.rebuild(ym);
    return {
      classifiedCardSettlement: cardSettle,
      classifiedSelfTransfer: selfTransfer,
      excludedTransfer: excTransfer.count,
      classifiedByRecurring: byRecurring,
      classifiedByHistory: byHistory,
      classifiedByRule: byRule,
      remaining:
        pending.length - byRecurring - byHistory - byRule - excTransfer.count,
    };
  }

  /**
   * 은행 분류 불일치 — 조회 기간·계좌 내에서 '같은 내용(description)'이 2개 이상 서로 다른
   * 분류로 분류된 건을 반환. 방향(출금=지출/입금=수입)이 다르면 별개로 취급(오탐 방지).
   */
  async bankCategoryConflicts(query: StatementTxnQueryDto) {
    const where: Prisma.BankTransactionWhereInput = {
      transactionId: { not: null }, // 분류된 것만
    };
    const pmIds = parseIdList(query.paymentMethodIds, query.paymentMethodId);
    if (pmIds.length === 1) where.paymentMethodId = pmIds[0];
    else if (pmIds.length > 1) where.paymentMethodId = { in: pmIds };
    if (query.txnType) where.txnTypeRaw = query.txnType;
    if (query.from || query.to) {
      where.txnAt = {
        ...(query.from && { gte: new Date(`${query.from}T00:00:00.000Z`) }),
        ...(query.to && { lte: new Date(`${query.to}T23:59:59.999Z`) }),
      };
    }
    if (query.q) where.description = { contains: query.q, mode: 'insensitive' };

    const rows = await this.prisma.bankTransaction.findMany({
      where,
      select: {
        description: true,
        withdrawal: true,
        deposit: true,
        transaction: {
          select: { categoryCode: true, category: { select: { name: true } } },
        },
      },
    });

    // (방향:내용) → (분류코드 → { name, count })
    const byKey = new Map<
      string,
      { content: string; direction: 'out' | 'in'; cats: Map<string, { name: string; count: number }> }
    >();
    for (const r of rows) {
      const content = r.description?.trim();
      if (!content) continue;
      const code = r.transaction?.categoryCode;
      if (!code) continue;
      const direction = Number(r.withdrawal) > 0 ? 'out' : 'in';
      const key = `${direction}:${content}`;
      let g = byKey.get(key);
      if (!g) {
        g = { content, direction, cats: new Map() };
        byKey.set(key, g);
      }
      const name = r.transaction?.category?.name ?? code;
      const e = g.cats.get(code) ?? { name, count: 0 };
      e.count++;
      g.cats.set(code, e);
    }

    const items = [];
    for (const g of byKey.values()) {
      if (g.cats.size < 2) continue;
      const categories = [...g.cats.entries()]
        .map(([categoryCode, c]) => ({
          categoryCode,
          categoryName: c.name,
          count: c.count,
        }))
        .sort((a, b) => b.count - a.count);
      items.push({
        content: g.content,
        direction: g.direction,
        total: categories.reduce((s, c) => s + c.count, 0),
        categories,
      });
    }
    items.sort(
      (a, b) => b.categories.length - a.categories.length || b.total - a.total,
    );
    return { items };
  }

  // ── 카드 원천 거래 (card_transaction) ───────────────────
  async findCard(query: StatementTxnQueryDto) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const where = await this.buildCardWhere(query);

    const rows = await this.prisma.cardTransaction.findMany({
      where,
      include: {
        paymentMethod: { select: { id: true, name: true, cardNo: true } },
        transaction: {
          select: { categoryCode: true, category: { select: { name: true } } },
        },
      },
      orderBy: this.cardOrderBy(query.sort),
      skip: offset,
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
      billingRound: c.billingRound,
      isCanceled: c.isCanceled,
      cardLabel: c.cardLabel,
      cardNo: c.cardNo,
      card: c.paymentMethod
        ? { id: c.paymentMethod.id, name: c.paymentMethod.name, cardNo: c.paymentMethod.cardNo }
        : null,
      categoryCode: c.transaction?.categoryCode ?? null,
      categoryName: c.transaction?.category?.name ?? null,
    }));
    return { items, page: { nextCursor: null, hasNext } };
  }

  /** 카드 정렬 스펙 → orderBy(우선순위 순). 결제금액은 원금 기준 근사. */
  private cardOrderBy(
    sort?: string,
  ): Prisma.CardTransactionOrderByWithRelationInput[] {
    const map: Record<
      string,
      (d: 'asc' | 'desc') => Prisma.CardTransactionOrderByWithRelationInput
    > = {
      date: (d) => ({ txnDate: d }),
      card: (d) => ({ paymentMethod: { name: d } }),
      merchant: (d) => ({ merchantName: d }),
      category: (d) => ({ transaction: { categoryCode: d } }),
      installment: (d) => ({ installmentPeriod: d }),
      round: (d) => ({ billingRound: d }),
      usage: (d) => ({ usageAmount: d }),
      pay: (d) => ({ principal: d }),
    };
    const out = parseSort(sort, map);
    if (out.length === 0) out.push({ txnDate: 'desc' });
    out.push({ id: 'desc' });
    return out;
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

  /**
   * 분류 불일치 점검 — 조회 기간·카드 내에서 '같은 가맹점명'이 2개 이상 서로 다른 분류로
   * 분류된 건을 찾아 반환한다. (분류 필터는 무시 — 교차 분류를 봐야 하므로)
   */
  async cardCategoryConflicts(query: StatementTxnQueryDto) {
    const where: Prisma.CardTransactionWhereInput = {
      transactionId: { not: null }, // 분류된 것만
    };
    const pmIds = parseIdList(query.paymentMethodIds, query.paymentMethodId);
    if (pmIds.length === 1) where.paymentMethodId = pmIds[0];
    else if (pmIds.length > 1) where.paymentMethodId = { in: pmIds };
    if (query.from || query.to) {
      where.txnDate = {
        ...(query.from && { gte: new Date(`${query.from}T00:00:00.000Z`) }),
        ...(query.to && { lte: new Date(`${query.to}T00:00:00.000Z`) }),
      };
    }
    if (query.q) where.merchantName = { contains: query.q, mode: 'insensitive' };

    const rows = await this.prisma.cardTransaction.findMany({
      where,
      select: {
        merchantName: true,
        transaction: {
          select: { categoryCode: true, category: { select: { name: true } } },
        },
      },
    });

    // 가맹점명 → (분류코드 → { name, count })
    const byMerchant = new Map<string, Map<string, { name: string; count: number }>>();
    for (const r of rows) {
      const code = r.transaction?.categoryCode;
      if (!code) continue;
      const name = r.transaction?.category?.name ?? code;
      let cats = byMerchant.get(r.merchantName);
      if (!cats) {
        cats = new Map();
        byMerchant.set(r.merchantName, cats);
      }
      const e = cats.get(code) ?? { name, count: 0 };
      e.count++;
      cats.set(code, e);
    }

    const items = [];
    for (const [merchantName, cats] of byMerchant) {
      if (cats.size < 2) continue; // 서로 다른 분류가 2개 이상인 것만
      const categories = [...cats.entries()]
        .map(([categoryCode, c]) => ({
          categoryCode,
          categoryName: c.name,
          count: c.count,
        }))
        .sort((a, b) => b.count - a.count);
      items.push({
        merchantName,
        total: categories.reduce((s, c) => s + c.count, 0),
        categories,
      });
    }
    // 분류 가짓수 많은 순 → 건수 많은 순
    items.sort(
      (a, b) => b.categories.length - a.categories.length || b.total - a.total,
    );
    return { items };
  }

  /** 선택한 카드 거래들의 분류를 일괄 변경(미분류 행은 거래 생성·확정). */
  async bulkClassifyCard(ids: number[], categoryCode: string) {
    const hid = requireTenant().householdId;
    const rows = await this.prisma.cardTransaction.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        transactionId: true,
        txnDate: true,
        merchantName: true,
        principal: true,
        fee: true,
        paymentMethodId: true,
        isCanceled: true,
      },
    });
    const months = new Set<string>();
    let updated = 0;
    for (const c of rows) {
      const amount = Number(c.principal) + Number(c.fee);
      // 사용자가 명시적으로 선택한 행은 모두 분류 허용 —
      // 취소(환불), 미리입금/할인(마이너스), 포인트사용/청구할인(0원) 조정행 포함.
      // 금액은 결제금액(원금+수수료) 그대로 반영: 환불·할인은 음수라 지출에서 차감된다.
      const day = startOfDay(c.txnDate);
      if (c.transactionId) {
        await this.prisma.transaction.update({
          where: { id: c.transactionId },
          data: { categoryCode },
        });
      } else {
        const tx = await this.prisma.transaction.create({
          data: {
            householdId: hid,
            type: 'expense',
            categoryCode,
            paymentMethodId: c.paymentMethodId,
            description: c.merchantName,
            amount,
            transactionDate: day,
            settledDate: day,
            status: 'settled',
          },
        });
        await this.prisma.cardTransaction.update({
          where: { id: c.id },
          data: { transactionId: tx.id, isClassified: 'Y' },
        });
      }
      months.add(day.toISOString().slice(0, 7));
      updated++;
    }
    for (const ym of months) await this.stats.rebuild(ym);
    return { updated };
  }

  /** 선택한 카드 거래들을 일괄 삭제(연결된 거래도 함께 삭제). */
  async bulkDeleteCard(ids: number[]) {
    const rows = await this.prisma.cardTransaction.findMany({
      where: { id: { in: ids } },
      select: { id: true, transactionId: true, txnDate: true },
    });
    if (rows.length === 0) return { deleted: 0 };
    const months = new Set(rows.map((r) => r.txnDate.toISOString().slice(0, 7)));
    const txIds = rows
      .map((r) => r.transactionId)
      .filter((x): x is number => x != null);

    await this.prisma.cardTransaction.deleteMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });
    if (txIds.length) {
      await this.prisma.transaction.deleteMany({ where: { id: { in: txIds } } });
    }
    for (const ym of months) await this.stats.rebuild(ym);
    return { deleted: rows.length };
  }

  /**
   * 카드 미분류 거래 일괄 자동 분류 (은행과 동일 정책, 가맹점명 기준).
   *  1) 정기지출 매칭: 관리>정기지출 항목명이 가맹점명에 포함되면 그 분류로
   *  2) 이력 학습: 과거 분류된 동일 가맹점(정규화)의 가장 최근 분류
   *  3) 규칙 보완: 가맹점 규칙(merchant_category_map)
   * 취소·환불(is_canceled='Y')·결제금액 0 이하 조정행은 자동 대상에서 제외(수동 처리).
   */
  async autoClassifyCard() {
    const hid = requireTenant().householdId;
    const months = new Set<string>();

    // 0) 결제수단 집계 제외 카드 → '지출 분류 제외' (pending 조회 전에 먼저 확정)
    await this.reconciler.classifyExcludedCardPms(months);

    // 1) 이력 맵 — 가맹점명(정규화) → 최신 분류코드 (exact + fuzzy)
    const history = await this.prisma.cardTransaction.findMany({
      where: { transactionId: { not: null } },
      select: {
        merchantName: true,
        transaction: { select: { categoryCode: true } },
      },
      orderBy: { txnDate: 'desc' },
    });
    const exactMap = new Map<string, string>();
    const fuzzyMap = new Map<string, string>();
    for (const h of history) {
      const code = h.transaction?.categoryCode;
      if (!code) continue;
      const norm = normKey(h.merchantName);
      if (!norm) continue;
      if (!exactMap.has(norm)) exactMap.set(norm, code);
      const fk = fuzzyKey(h.merchantName);
      if (fk && !fuzzyMap.has(fk)) fuzzyMap.set(fk, code);
    }

    // 2) 미분류 행 처리
    const recMatchers = await this.recurringMatchers();
    // 취소행(is_canceled)도 포함 — 금액과 무관하게 같은 분류로 자동 분류(환불은 지출에서 차감)
    const pending = await this.prisma.cardTransaction.findMany({
      where: { transactionId: null },
    });
    let byRecurring = 0;
    let byHistory = 0;
    let byRule = 0;
    for (const c of pending) {
      // 금액 제한 없음: 환불(음수)·할인/포인트(0원) 조정행도 매칭되면 분류.
      // 음수는 해당 분류 지출에서 정확히 차감되므로 오분류 문제가 없다(취소행은 위 where 에서 제외).
      const amount = Number(c.principal) + Number(c.fee);
      const norm = normKey(c.merchantName);

      let code: string | null = null;
      let source: 'recurring' | 'history' | 'rule' | null = null;
      code = this.matchRecurring(recMatchers, c.merchantName, c.paymentMethodId);
      if (code) source = 'recurring';
      if (!code && norm) {
        code =
          exactMap.get(norm) ?? fuzzyMap.get(fuzzyKey(c.merchantName)) ?? null;
        if (code) source = 'history';
      }
      if (!code) {
        code = await this.classifier.classify(c.merchantName);
        if (code) source = 'rule';
      }
      if (!code) continue;

      const day = startOfDay(c.txnDate);
      const tx = await this.prisma.transaction.create({
        data: {
          householdId: hid,
          type: 'expense',
          categoryCode: code,
          paymentMethodId: c.paymentMethodId,
          description: c.merchantName,
          amount,
          transactionDate: day,
          settledDate: day,
          status: 'settled',
        },
      });
      await this.prisma.cardTransaction.update({
        where: { id: c.id },
        data: { transactionId: tx.id, isClassified: 'Y' },
      });
      months.add(day.toISOString().slice(0, 7));
      if (source === 'recurring') byRecurring++;
      else if (source === 'history') byHistory++;
      else byRule++;
    }

    for (const ym of months) await this.stats.rebuild(ym);
    return {
      classifiedByRecurring: byRecurring,
      classifiedByHistory: byHistory,
      classifiedByRule: byRule,
      remaining: pending.length - byRecurring - byHistory - byRule,
    };
  }

  // ── 엑셀(xlsx) 내보내기 ──────────────────────────────────
  /** 은행 조회 결과 전체를 xlsx 버퍼로. */
  async exportBank(query: StatementTxnQueryDto): Promise<Buffer> {
    const where = await this.buildBankWhere(query);
    const rows = await this.prisma.bankTransaction.findMany({
      where,
      include: BANK_INCLUDE,
      orderBy: this.bankOrderBy(query.sort),
    });
    const items = rows.map((b) => this.mapBank(b));
    const excl = (r: string | null) =>
      r === 'card_settlement'
        ? '카드대금'
        : r === 'self_transfer'
          ? '자기이체'
          : r === 'transfer'
            ? '이체'
            : '';

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('은행거래');
    ws.columns = [
      { header: '날짜', key: 'date', width: 12 },
      { header: '계좌', key: 'account', width: 18 },
      { header: '구분', key: 'type', width: 18 },
      { header: '분류', key: 'category', width: 14 },
      { header: '내용', key: 'desc', width: 32 },
      { header: '출금', key: 'withdrawal', width: 14 },
      { header: '입금', key: 'deposit', width: 14 },
      { header: '거래후잔액', key: 'balance', width: 16 },
      { header: '제외', key: 'exclude', width: 10 },
    ];
    for (const b of items) {
      ws.addRow({
        date: b.txnAt.toISOString().slice(0, 10),
        account: b.account?.name ?? '',
        type: b.txnTypeRaw ?? '',
        category: b.categoryName ?? '',
        desc: b.description ?? '',
        withdrawal: Number(b.withdrawal) || null,
        deposit: Number(b.deposit) || null,
        balance: b.balance != null ? Number(b.balance) : null,
        exclude: excl(b.excludeReason),
      });
    }
    formatSheet(ws, ['F', 'G', 'H']);
    return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
  }

  /** 카드 조회 결과 전체를 xlsx 버퍼로. */
  async exportCard(query: StatementTxnQueryDto): Promise<Buffer> {
    const where = await this.buildCardWhere(query);
    const rows = await this.prisma.cardTransaction.findMany({
      where,
      include: {
        paymentMethod: { select: { name: true, cardNo: true } },
        transaction: {
          select: { category: { select: { name: true } } },
        },
      },
      orderBy: this.cardOrderBy(query.sort),
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('카드거래');
    ws.columns = [
      { header: '이용일', key: 'date', width: 12 },
      { header: '카드', key: 'card', width: 20 },
      { header: '가맹점', key: 'merchant', width: 32 },
      { header: '분류', key: 'category', width: 14 },
      { header: '할부(개월)', key: 'months', width: 11 },
      { header: '할부회차', key: 'round', width: 10 },
      { header: '이용금액', key: 'usage', width: 14 },
      { header: '할인금액', key: 'discount', width: 12 },
      { header: '결제금액', key: 'pay', width: 14 },
    ];
    for (const c of rows) {
      const usage = Number(c.usageAmount);
      const pay = Number(c.principal) + Number(c.fee);
      const hasInst = /\d/.test(c.installmentPeriod ?? '');
      ws.addRow({
        date: c.txnDate.toISOString().slice(0, 10),
        card: c.paymentMethod?.name ?? c.cardLabel ?? '',
        merchant: c.merchantName,
        category: c.transaction?.category?.name ?? '',
        months: hasInst ? `${c.installmentPeriod}개월` : '일시불',
        round: hasInst && /\d/.test(c.billingRound ?? '') ? c.billingRound : '',
        usage,
        discount: usage - pay, // +는 할인, -는 수수료
        pay,
      });
    }
    formatSheet(ws, ['G', 'H', 'I']);
    return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
  }

  // ── helpers ─────────────────────────────────────────────
  private async categoryCodes(code: string): Promise<string[]> {
    const children = await this.prisma.category.findMany({
      where: { parentCode: code },
      select: { code: true },
    });
    return [code, ...children.map((c) => c.code)];
  }

  /**
   * 다중 분류 필터 조각 — categoryCodes(콤마) 또는 단일 categoryCode.
   * '-'(미분류)와 대분류(하위 포함)를 혼합 선택하면 OR 로 묶는다. bank/card 공용 필드.
   */
  private async categoryFilterFrag(
    q: StatementTxnQueryDto,
  ): Promise<Prisma.CardTransactionWhereInput> {
    const raw = splitCsv(q.categoryCodes, q.categoryCode);
    if (raw.length === 0) return {};
    const wantUncl = raw.includes('-');
    const expanded = new Set<string>();
    for (const c of raw.filter((x) => x !== '-')) {
      (await this.categoryCodes(c)).forEach((s) => expanded.add(s));
    }
    const conds: Prisma.CardTransactionWhereInput[] = [];
    if (wantUncl) conds.push({ transactionId: null });
    if (expanded.size > 0) {
      conds.push({ transaction: { is: { categoryCode: { in: [...expanded] } } } });
    }
    if (conds.length === 0) return {};
    if (conds.length === 1) return conds[0]!;
    return { OR: conds };
  }

  private async buildBankWhere(
    q: StatementTxnQueryDto,
  ): Promise<Prisma.BankTransactionWhereInput> {
    const where: Prisma.BankTransactionWhereInput = {};
    const pmIds = parseIdList(q.paymentMethodIds, q.paymentMethodId);
    if (pmIds.length === 1) where.paymentMethodId = pmIds[0];
    else if (pmIds.length > 1) where.paymentMethodId = { in: pmIds };
    const txnTypes = splitCsv(q.txnTypes, q.txnType);
    if (txnTypes.length === 1) where.txnTypeRaw = txnTypes[0];
    else if (txnTypes.length > 1) where.txnTypeRaw = { in: txnTypes };
    if (q.from || q.to) {
      where.txnAt = {
        ...(q.from && { gte: new Date(`${q.from}T00:00:00.000Z`) }),
        ...(q.to && { lte: new Date(`${q.to}T23:59:59.999Z`) }),
      };
    }
    Object.assign(where, await this.categoryFilterFrag(q));
    if (q.q) {
      where.description = { contains: q.q, mode: 'insensitive' };
    }
    return where;
  }

  private async buildCardWhere(
    q: StatementTxnQueryDto,
  ): Promise<Prisma.CardTransactionWhereInput> {
    const where: Prisma.CardTransactionWhereInput = {};
    const pmIds = parseIdList(q.paymentMethodIds, q.paymentMethodId);
    if (pmIds.length === 1) where.paymentMethodId = pmIds[0];
    else if (pmIds.length > 1) where.paymentMethodId = { in: pmIds };
    if (q.from || q.to) {
      where.txnDate = {
        ...(q.from && { gte: new Date(`${q.from}T00:00:00.000Z`) }),
        ...(q.to && { lte: new Date(`${q.to}T00:00:00.000Z`) }),
      };
    }
    // 할부 여부: 원거래 연결 유무로 판단
    if (q.installment === 'yes') where.installmentPlanId = { not: null };
    else if (q.installment === 'no') where.installmentPlanId = null;
    Object.assign(where, await this.categoryFilterFrag(q));
    if (q.q) {
      where.merchantName = { contains: q.q, mode: 'insensitive' };
    }
    return where;
  }

}

/** 정렬 스펙('col:dir,...') → orderBy 배열. 화이트리스트(map) 밖은 무시. */
function parseSort<T>(
  sort: string | undefined,
  map: Record<string, (d: 'asc' | 'desc') => T>,
): T[] {
  const out: T[] = [];
  for (const part of (sort ?? '').split(',')) {
    const [col, dirRaw] = part.split(':');
    const make = col ? map[col] : undefined;
    if (make) out.push(make(dirRaw === 'asc' ? 'asc' : 'desc'));
  }
  return out;
}

/** 콤마구분 문자열(우선) 또는 단일값 → 트림·빈값 제거된 배열. */
function splitCsv(csv?: string, single?: string): string[] {
  const src = csv != null && csv !== '' ? csv.split(',') : single ? [single] : [];
  return src.map((s) => s.trim()).filter(Boolean);
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** 헤더 볼드 + 지정 금액 컬럼에 천단위 숫자서식. */
function formatSheet(ws: ExcelJS.Worksheet, moneyCols: string[]): void {
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const col of moneyCols) ws.getColumn(col).numFmt = '#,##0';
}

/** 내용 정규화 — 공백 제거(대소문자 유지). 이력 매칭 키. */
function normKey(s: string | null): string {
  return (s ?? '').replace(/\s/g, '');
}

/** 느슨한 매칭 키 — 끝의 숫자(월/식별번호)를 떼어 반복 항목(예: METLIFE06193/05192) 그룹화. */
function fuzzyKey(s: string | null): string {
  return normKey(s).replace(/\d+$/, '');
}
