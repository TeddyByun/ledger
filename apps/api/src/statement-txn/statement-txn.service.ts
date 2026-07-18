import { Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StatisticsService } from '../statistics/statistics.service.js';
import { ClassifierService } from '../ingestion/classification/classifier.service.js';
import { requireTenant } from '../common/tenant/tenant-context.js';
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
      if (c.isCanceled === 'Y' || amount <= 0) continue;
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
    // 할부 여부: 원거래 연결 유무로 판단
    if (q.installment === 'yes') where.installmentPlanId = { not: null };
    else if (q.installment === 'no') where.installmentPlanId = null;
    // 분류: '-' 는 미분류(연결 거래 없음)만
    if (q.categoryCode === '-') {
      where.transactionId = null;
    } else if (q.categoryCode) {
      where.transaction = {
        is: { categoryCode: { in: await this.categoryCodes(q.categoryCode) } },
      };
    }
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
