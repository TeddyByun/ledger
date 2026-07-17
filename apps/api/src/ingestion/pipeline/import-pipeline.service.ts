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

/** 발급사 → 은행 표기(자동 생성 계좌 이름·issuer 용) */
const ISSUER_BANK_LABEL: Record<string, string> = {
  hana_bank: '하나은행',
};

/** 발급사 → 카드 표기(자동 생성 카드 이름·issuer 용) */
const ISSUER_CARD_LABEL: Record<string, string> = {
  hana_card: '하나카드',
  hyundai_card: '현대카드',
  shinhan_card: '신한카드',
  samsung_card: '삼성카드',
};

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

      // 파싱 결과가 비면 발급사↔파일 불일치일 가능성이 큼 → 명확한 안내
      const rowCount =
        result.kind === 'bank'
          ? result.rows.length
          : result.statement.rows.length;
      if (rowCount === 0) {
        const label =
          ISSUER_BANK_LABEL[job.issuer] ??
          ISSUER_CARD_LABEL[job.issuer] ??
          job.issuer;
        throw new Error(
          `파일에서 거래 내역을 찾지 못했습니다. 선택한 발급사(${label})가 업로드한 파일과 맞는지 확인하세요.`,
        );
      }

      if (result.kind === 'bank') {
        // 계좌는 파일 헤더에서 자동 인식(없으면 업로드 시 지정한 것 사용)
        const pmId =
          job.paymentMethodId ??
          (await this.resolveBankAccount(
            job.householdId,
            job.issuer,
            result.account,
          ));
        const r = await this.ingestBank(
          job.householdId,
          pmId,
          result.rows,
          jobId,
          months,
        );
        parsed = result.rows.length;
        classified = r.classified;
        pending = r.pending;
      } else {
        const s = result.statement;
        const meta = { statementYm: s.statementYm, billingDate: s.billingDate };
        parsed = s.rows.length;
        if (job.paymentMethodId) {
          // 업로드 시 카드를 직접 지정 → 전체 행을 해당 카드로
          const r = await this.ingestCard(
            job.householdId,
            job.paymentMethodId,
            { ...meta, totalAmount: s.totalAmount, totalCount: s.totalCount },
            s.rows,
            months,
          );
          classified = r.classified;
          pending = r.pending;
        } else {
          // 카드 미지정 → 파일의 카드번호별로 그룹화해 자동 매칭/등록
          const groups = new Map<string, NormalizedCardRow[]>();
          for (const row of s.rows) {
            // 카드번호가 있으면 번호로, 없으면(현대 등) 이용카드 라벨로 카드 구분
            const digits = (row.cardNo ?? '').replace(/\D/g, '');
            const key = digits || `L:${(row.cardLabel ?? '').trim()}`;
            const g = groups.get(key);
            if (g) g.push(row);
            else groups.set(key, [row]);
          }
          for (const [, rows] of groups) {
            // 실제 카드번호(현대는 없음)와 이용카드 라벨을 넘겨 카드 해석
            const pmId = await this.resolveCardAccount(
              job.householdId,
              job.issuer,
              rows[0]?.cardNo ?? '',
              rows[0]?.cardLabel ?? null,
            );
            const r = await this.ingestCard(
              job.householdId,
              pmId,
              {
                ...meta,
                totalAmount: groups.size === 1 ? s.totalAmount : null,
                totalCount: rows.length,
              },
              rows,
              months,
            );
            classified += r.classified;
            pending += r.pending;
          }
        }
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

  /** 파일에서 인식한 계좌를 등록 계좌와 매칭(없으면 자동 생성). */
  private async resolveBankAccount(
    householdId: number,
    issuer: string,
    account: { accountNo: string | null; identifier: string | null },
  ): Promise<number> {
    if (!account.accountNo && !account.identifier) {
      throw new Error('계좌를 파일에서 인식하지 못했습니다. 업로드 시 계좌를 선택하세요.');
    }
    const or: Array<Record<string, string>> = [];
    if (account.accountNo) or.push({ accountNo: account.accountNo });
    if (account.identifier) or.push({ identifier: account.identifier });
    const found = await this.prisma.paymentMethod.findFirst({
      where: { methodType: 'bank', OR: or },
    });
    if (found) return found.id;

    // 미등록 → 자동 생성
    const label = ISSUER_BANK_LABEL[issuer] ?? '은행';
    const name = `${label}${account.identifier ?? account.accountNo}`;
    try {
      const created = await this.prisma.paymentMethod.create({
        data: {
          householdId,
          methodType: 'bank',
          name,
          issuer: label,
          accountNo: account.accountNo,
          identifier: account.identifier,
        },
      });
      return created.id;
    } catch {
      // 이름 충돌 등 → 이름으로 재조회
      const byName = await this.prisma.paymentMethod.findFirst({
        where: { methodType: 'bank', name },
      });
      if (byName) return byName.id;
      throw new Error('계좌 자동 등록에 실패했습니다.');
    }
  }

  /** 파일에서 인식한 카드번호를 등록 카드와 매칭(없으면 자동 생성). */
  private async resolveCardAccount(
    householdId: number,
    issuer: string,
    cardNo: string,
    cardLabel: string | null,
  ): Promise<number> {
    const label = ISSUER_CARD_LABEL[issuer] ?? '카드';
    const digits = cardNo.replace(/\D/g, '');

    // 카드번호가 없는 발급사(현대 등) → 이용카드 라벨별로 카드 매칭/생성
    if (!digits) {
      const lbl = (cardLabel ?? '').trim();
      const name = lbl ? `${label} ${lbl}` : label; // 예) '현대카드 본인 ZERO'
      const existing = await this.prisma.paymentMethod.findFirst({
        where: { methodType: 'card', name },
      });
      if (existing) return existing.id;
      try {
        const created = await this.prisma.paymentMethod.create({
          data: { householdId, methodType: 'card', name, issuer: label },
        });
        return created.id;
      } catch {
        const byName = await this.prisma.paymentMethod.findFirst({
          where: { methodType: 'card', name },
        });
        if (byName) return byName.id;
        throw new Error('카드 자동 등록에 실패했습니다.');
      }
    }

    // 등록 카드 중 카드번호 뒷자리가 일치하는 것 찾기(마스킹 저장 대응)
    const cards = await this.prisma.paymentMethod.findMany({
      where: { methodType: 'card', cardNo: { not: null } },
      select: { id: true, cardNo: true },
    });
    const match = (a: string, b: string) =>
      a.length >= 3 && b.length >= 3 && (a.endsWith(b) || b.endsWith(a));
    const found = cards.find((c) =>
      match((c.cardNo ?? '').replace(/\D/g, ''), digits),
    );
    if (found) return found.id;

    // 미등록 → 자동 생성. 이름은 '발급사 + 뒤4자리'로 간결하게(본인/가족 라벨은 참고용).
    const owner = cardLabel?.match(/(본인|가족)/)?.[1];
    const name = owner ? `${label} ${owner} ${digits}` : `${label} ${digits}`;
    try {
      const created = await this.prisma.paymentMethod.create({
        data: {
          householdId,
          methodType: 'card',
          name,
          issuer: label,
          cardNo: digits,
        },
      });
      return created.id;
    } catch {
      const byName = await this.prisma.paymentMethod.findFirst({
        where: { methodType: 'card', name },
      });
      if (byName) return byName.id;
      throw new Error('카드 자동 등록에 실패했습니다.');
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
      // dedup은 가구 내에서만(같은 명세서를 다른 가구가 올려도 충돌 없음).
      const exists = await this.prisma.bankTransaction.findFirst({
        where: { dedupHash: r.dedupHash },
        select: { id: true },
      });
      if (exists) continue;
      await this.prisma.bankTransaction.create({
        data: {
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
    meta: {
      statementYm: string;
      billingDate: Date | null;
      totalAmount: number | null;
      totalCount: number;
    },
    rows: NormalizedCardRow[],
    months: Set<string>,
  ) {
    const stmt = await this.prisma.cardStatement.upsert({
      where: {
        paymentMethodId_statementYm: { paymentMethodId, statementYm: meta.statementYm },
      },
      update: { totalAmount: meta.totalAmount, totalCount: meta.totalCount },
      create: {
        householdId,
        paymentMethodId,
        statementYm: meta.statementYm,
        billingDate: meta.billingDate,
        totalAmount: meta.totalAmount,
        totalCount: meta.totalCount,
      },
    });

    let classified = 0;
    let pending = 0;
    for (const r of rows) {
      // dedup은 가구 내에서만
      const exists = await this.prisma.cardTransaction.findFirst({
        where: { dedupHash: r.dedupHash },
        select: { id: true },
      });
      if (exists) continue;

      const usageDate = startOfDay(r.txnDate);
      const isInstallment = isInstallmentPeriod(r.installmentPeriod);
      // 할부 표시 이용일 = 최초구매일의 '일' + (회차−1)개월 → 해당 명세서 월에 표기.
      const displayDate = isInstallment
        ? installmentUsageDate(usageDate, r.billingRound)
        : usageDate;
      // 집계월(파생 거래)은 할부=청구월, 일시불=이용일 기준(§7.2 회차별 월 집계).
      const effectiveDate = isInstallment
        ? new Date(`${meta.statementYm}-01T00:00:00Z`)
        : usageDate;

      // 할부: 최초 거래 정보를 원거래 테이블에 적재(회차마다 참조)
      let installmentPlanId: number | null = null;
      if (isInstallment && r.usageAmount > 0) {
        installmentPlanId = await this.upsertInstallmentPlan(
          householdId,
          paymentMethodId,
          r,
        );
      }
      // 할부 월 청구건의 '이용금액' = 이번달 청구액(원금+이자). 전체금액은 원거래 테이블.
      const storedUsage = isInstallment ? r.principal + r.fee : r.usageAmount;

      const ct = await this.prisma.cardTransaction.create({
        data: {
          householdId,
          statementId: stmt.id,
          paymentMethodId,
          installmentPlanId,
          cardLabel: r.cardLabel,
          cardNo: r.cardNo,
          txnDate: displayDate,
          merchantName: r.merchantName,
          usageAmount: storedUsage,
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
      months.add(effectiveDate.toISOString().slice(0, 7));

      const tx = await this.prisma.transaction.create({
        data: {
          householdId,
          type: 'expense',
          categoryCode,
          paymentMethodId,
          description: r.merchantName,
          amount,
          transactionDate: effectiveDate,
          settledDate: meta.billingDate ?? effectiveDate,
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

  /** 할부 원거래(최초 구매) 적재/조회 — 회차마다 동일 원거래를 참조. */
  private async upsertInstallmentPlan(
    householdId: number,
    paymentMethodId: number,
    r: NormalizedCardRow,
  ): Promise<number> {
    const totalMonths =
      parseInt((r.installmentPeriod ?? '').replace(/\D/g, ''), 10) || 0;
    const original = startOfDay(r.txnDate);
    const dedupKey = [
      r.cardNo ?? '',
      r.merchantName,
      original.toISOString().slice(0, 10),
      r.usageAmount,
      totalMonths,
    ].join('|');
    const plan = await this.prisma.installmentPlan.upsert({
      where: { householdId_dedupKey: { householdId, dedupKey } },
      update: {},
      create: {
        householdId,
        paymentMethodId,
        cardNo: r.cardNo,
        merchantName: r.merchantName,
        originalDate: original,
        totalAmount: r.usageAmount,
        totalMonths,
        dedupKey,
      },
    });
    return plan.id;
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

/** 할부 여부 — 개월 값에 숫자가 있으면 할부. '-'·''·null·'일시불'은 일시불. */
function isInstallmentPeriod(period: string | null): boolean {
  return !!period && /\d/.test(period);
}

/**
 * 할부 표시 이용일 = 최초구매일의 '일' + (회차−1)개월.
 * 예) 최초 1/5 · 3회차 → 3/5. 각 회차가 해당 명세서(사용) 월에 표기된다.
 * 짧은 달로 일자 오버플로우 시 그 달 말일로 클램프.
 */
function installmentUsageDate(original: Date, round: string | null): Date {
  const r = parseInt((round ?? '').replace(/\D/g, ''), 10);
  const add = Number.isFinite(r) && r >= 1 ? r - 1 : 0;
  const y = original.getUTCFullYear();
  const m = original.getUTCMonth();
  const day = original.getUTCDate();
  const d = new Date(Date.UTC(y, m + add, day));
  if (d.getUTCDate() !== day) return new Date(Date.UTC(y, m + add + 1, 0));
  return d;
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
