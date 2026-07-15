import { Injectable, Logger } from '@nestjs/common';
import type { ImportJob } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { tenantStorage } from '../../common/tenant/tenant-context.js';
import { StatisticsService } from '../../statistics/statistics.service.js';
import { StorageService } from '../storage/storage.service.js';
import { ParserRegistry } from '../parsers/parser.registry.js';
import { ClassifierService } from '../classification/classifier.service.js';
import { ReconcilerService } from '../reconciliation/reconciler.service.js';
import { readTabular } from '../parsers/tabular.js';
import type { NormalizedBankRow, NormalizedCardRow } from '../parsers/types.js';
import { Issuer } from '@ledger/shared';

/** 은행 거래구분/적요 기반 카테고리 힌트 (DATABASE.md §7.1) */
const BANK_TYPE_HINT: Record<string, string> = {
  대출이자: '0101',
  보험료: '03',
  정기적금: '0202',
  청약종합: '0202',
};

@Injectable()
export class ImportPipelineService {
  private readonly log = new Logger(ImportPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly registry: ParserRegistry,
    private readonly classifier: ClassifierService,
    private readonly reconciler: ReconcilerService,
    private readonly stats: StatisticsService,
  ) {}

  /** 잡 1건 전체 처리: 파싱 → 적재 → 분류 → 대사 → 집계. */
  async process(jobId: string): Promise<void> {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    // 워커에서도 가구 스코프를 적용 — 대사/조회가 다른 가구 데이터를 건드리지 않도록.
    await tenantStorage.run(
      { userId: 0, householdId: job.householdId, role: 'owner' },
      () => this.runJob(job, jobId),
    );
  }

  private async runJob(job: ImportJob, jobId: string): Promise<void> {
    try {
      await this.setStatus(jobId, 'parsing');
      const buffer = await this.storage.load(job.fileKey);
      const rows = await readTabular(buffer, job.originalName ?? job.fileKey);
      const result = this.registry
        .get(job.issuer as Issuer)
        .parse(rows, { issuer: job.issuer as Issuer, statementYm: job.statementYm ?? undefined });

      await this.setStatus(jobId, 'classifying');
      const months = new Set<string>();
      let parsed = 0;
      let classified = 0;
      let pending = 0;

      if (result.kind === 'bank') {
        if (!job.paymentMethodId) throw new Error('bank import requires paymentMethodId');
        const r = await this.ingestBank(
          job.householdId,
          job.paymentMethodId,
          result.rows,
          jobId,
          months,
        );
        parsed = result.rows.length;
        classified = r.classified;
        pending = r.pending;
      } else {
        if (!job.paymentMethodId) throw new Error('card import requires paymentMethodId (card)');
        const r = await this.ingestCard(job.householdId, job.paymentMethodId, result.statement, months);
        parsed = result.statement.rows.length;
        classified = r.classified;
        pending = r.pending;
      }

      // 월 재집계
      for (const ym of months) await this.stats.rebuild(ym);

      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: pending > 0 ? 'review' : 'completed',
          parsedRows: parsed,
          classifiedRows: classified,
          pendingRows: pending,
        },
      });
    } catch (e) {
      this.log.error(`import ${jobId} failed`, e as Error);
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: { status: 'failed', error: (e as Error).message },
      });
    }
  }

  // ── 은행 ─────────────────────────────────────────────
  private async ingestBank(
    householdId: number,
    paymentMethodId: number,
    rows: NormalizedBankRow[],
    importBatch: string,
    months: Set<string>,
  ) {
    const types = await this.prisma.bankTxnType.findMany();
    // 1) 스테이징 적재 (dedup)
    for (const r of rows) {
      const { code, org } = this.matchBankType(r.txnTypeRaw, types);
      await this.prisma.bankTransaction.upsert({
        where: { dedupHash: r.dedupHash },
        update: {},
        create: {
          householdId,
          paymentMethodId,
          txnAt: r.txnAt,
          txnTypeCode: code,
          txnTypeRaw: r.txnTypeRaw,
          counterpartOrg: org,
          description: r.description,
          withdrawal: r.withdrawal,
          deposit: r.deposit,
          balance: r.balance,
          branch: r.branch,
          importBatch,
          dedupHash: r.dedupHash,
        },
      });
    }

    // 2) 대사 — 카드대금/자기이체 제외 표시
    await this.reconciler.markCardSettlements();
    await this.reconciler.markSelfTransfers();

    // 3) 미제외·미분류 행 → 거래 생성
    const staged = await this.prisma.bankTransaction.findMany({
      where: { paymentMethodId, transactionId: null, excludeReason: null },
      include: { txnType: true },
    });
    let classified = 0;
    let pending = 0;
    for (const b of staged) {
      const isExpense = Number(b.withdrawal) > 0;
      const amount = isExpense ? Number(b.withdrawal) : Number(b.deposit);
      if (amount === 0) continue;
      const categoryCode = isExpense
        ? (await this.classifier.classify(b.description ?? '')) ??
          BANK_TYPE_HINT[b.txnType?.name ?? ''] ??
          null
        : this.incomeHint(b.txnType?.name, b.description);

      if (!categoryCode) {
        pending++;
        continue;
      }
      const ym = b.txnAt.toISOString().slice(0, 7);
      months.add(ym);
      const tx = await this.prisma.transaction.create({
        data: {
          householdId,
          type: isExpense ? 'expense' : 'income',
          categoryCode,
          paymentMethodId,
          description: b.description,
          amount,
          transactionDate: startOfDay(b.txnAt),
          settledDate: startOfDay(b.txnAt),
          status: 'settled',
        },
      });
      await this.prisma.bankTransaction.update({
        where: { id: b.id },
        data: { transactionId: tx.id, isClassified: 'Y' },
      });
      classified++;
    }
    return { classified, pending };
  }

  // ── 카드 ─────────────────────────────────────────────
  private async ingestCard(
    householdId: number,
    paymentMethodId: number,
    statement: { statementYm: string; billingDate: Date | null; totalAmount: number; totalCount: number; rows: NormalizedCardRow[] },
    months: Set<string>,
  ) {
    const stmt = await this.prisma.cardStatement.upsert({
      where: {
        paymentMethodId_statementYm: { paymentMethodId, statementYm: statement.statementYm },
      },
      update: { totalAmount: statement.totalAmount, totalCount: statement.totalCount },
      create: {
        householdId,
        paymentMethodId,
        statementYm: statement.statementYm,
        billingDate: statement.billingDate,
        totalAmount: statement.totalAmount,
        totalCount: statement.totalCount,
      },
    });

    let classified = 0;
    let pending = 0;
    for (const r of statement.rows) {
      // dedup
      const exists = await this.prisma.cardTransaction.findUnique({
        where: { dedupHash: r.dedupHash },
      });
      if (exists) continue;

      const ct = await this.prisma.cardTransaction.create({
        data: {
          householdId,
          statementId: stmt.id,
          paymentMethodId,
          cardLabel: r.cardLabel,
          cardNo: r.cardNo,
          txnDate: r.txnDate,
          merchantName: r.merchantName,
          usageAmount: r.usageAmount,
          principal: r.principal,
          fee: r.fee,
          installmentPeriod: r.installmentPeriod,
          billingRound: r.billingRound,
          benefitType: r.benefitType,
          benefitAmount: r.benefitAmount,
          region: r.region,
          saleType: r.saleType,
          isCanceled: r.isCanceled ? 'Y' : 'N',
          point: r.point,
          dedupHash: r.dedupHash,
        },
      });

      // 실지출 금액 = 결제원금 + 이자. 취소/0원 정보성 행은 거래 미생성.
      const amount = r.principal + r.fee;
      if (r.isCanceled || amount <= 0) continue;

      const categoryCode = await this.classifier.classify(r.merchantName);
      if (!categoryCode) {
        pending++;
        continue;
      }
      // 할부는 청구월, 일시불은 이용일 기준(§7.2 회차별 월 집계)
      const isInstallment = !!r.installmentPeriod;
      const txnDate = isInstallment
        ? new Date(`${statement.statementYm}-01T00:00:00Z`)
        : startOfDay(r.txnDate);
      months.add(txnDate.toISOString().slice(0, 7));

      const tx = await this.prisma.transaction.create({
        data: {
          householdId,
          type: 'expense',
          categoryCode,
          paymentMethodId,
          description: r.merchantName,
          amount,
          transactionDate: txnDate,
          settledDate: statement.billingDate ?? txnDate,
          status: 'settled',
        },
      });
      await this.prisma.cardTransaction.update({
        where: { id: ct.id },
        data: { transactionId: tx.id, isClassified: 'Y' },
      });
      classified++;
    }
    return { classified, pending };
  }

  // ── helpers ──────────────────────────────────────────
  private matchBankType(
    raw: string | null,
    types: Array<{ code: string; name: string }>,
  ): { code: string | null; org: string | null } {
    if (!raw) return { code: null, org: null };
    const base = raw.split('(')[0]!.trim();
    const orgMatch = raw.match(/\(([^)]+)\)/);
    const org = orgMatch ? orgMatch[1]! : null;
    const t = types.find((x) => x.name === base);
    return { code: t?.code ?? null, org };
  }

  private incomeHint(typeName?: string | null, description?: string | null): string {
    if (typeName === '급여이체') return '13';
    if (typeName === '예금이자') return '16';
    if ((description ?? '').includes('캐시백')) return '15';
    return '17';
  }

  private async setStatus(jobId: string, status: 'parsing' | 'classifying') {
    await this.prisma.importJob.update({ where: { id: jobId }, data: { status } });
  }
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
