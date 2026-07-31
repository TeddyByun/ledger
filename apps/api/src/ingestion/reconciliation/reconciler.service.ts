import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EXCLUDE_CATEGORY_NAMES } from '../../common/exclude-category.js';
import { excludedPaymentMethodIds } from '../../common/exclude-payment.js';

/** classifyAsExclusion 이 받는 은행 원천 행의 최소 형태. */
interface BankRowLite {
  id: number;
  householdId: number;
  paymentMethodId: number;
  txnAt: Date;
  withdrawal: unknown;
  deposit: unknown;
  description: string | null;
}

/**
 * 대사(reconciliation) — 은행 원천 중 실지출이 아닌 행을 '분류 제외'로 자동 분류(DATABASE.md §7).
 *  1) 카드대금 결제 출금(타사카드/하나카드) → '분류 제외'
 *  2) 본인 계좌 간 이체(동일 금액·같은 날·본인 명의) → '분류 제외'
 * 업로드·자동분류 양쪽에서 호출된다. '분류 제외' 분류가 없으면 exclude_reason 으로 폴백.
 */
@Injectable()
export class ReconcilerService {
  constructor(private readonly prisma: PrismaService) {}

  /** '분류 제외' 분류 코드(지출/수입). 카테고리가 없으면 undefined. */
  private async exclusionCodes(): Promise<{ expense?: string; income?: string }> {
    const cats = await this.prisma.category.findMany({
      where: { name: { in: EXCLUDE_CATEGORY_NAMES } },
      select: { code: true, type: true },
    });
    return {
      expense: cats.find((c) => c.type === 'expense')?.code,
      income: cats.find((c) => c.type === 'income')?.code,
    };
  }

  /** 은행 행 하나를 '분류 제외' 거래로 생성·연결. 생성했으면 true, 코드 없으면 false. */
  private async classifyAsExclusion(
    b: BankRowLite,
    codes: { expense?: string; income?: string },
    months: Set<string>,
  ): Promise<boolean> {
    const isExpense = Number(b.withdrawal) > 0;
    const amount = isExpense ? Number(b.withdrawal) : Number(b.deposit);
    const code = isExpense ? codes.expense : codes.income;
    if (!code) return false;
    const day = startOfDay(b.txnAt);
    const tx = await this.prisma.transaction.create({
      data: {
        householdId: b.householdId,
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
      // 분류 제외 거래로 확정하면서 구버전 exclude_reason 표시는 정리
      data: { transactionId: tx.id, isClassified: 'Y', excludeReason: null },
    });
    months.add(b.txnAt.toISOString().slice(0, 7));
    return true;
  }

  /**
   * 카드대금 결제 출금(구분명에 '카드') → '분류 제외'(지출)로 자동 분류.
   * 분류된 월을 months 에 추가. 반환값은 처리한 행 수.
   */
  async classifyCardSettlements(months: Set<string>): Promise<number> {
    const rows = await this.prisma.bankTransaction.findMany({
      where: {
        withdrawal: { gt: 0 },
        transactionId: null, // 아직 거래 미생성
        txnType: { name: { contains: '카드' } },
        // 미표시(null) + 구버전에서 이미 card_settlement 로 표시된 행 모두 승격
        OR: [{ excludeReason: null }, { excludeReason: 'card_settlement' }],
      },
    });
    if (rows.length === 0) return 0;

    const codes = await this.exclusionCodes();
    // '분류 제외'(지출) 분류가 없으면 기존 방식(exclude_reason)으로 폴백
    if (!codes.expense) {
      await this.prisma.bankTransaction.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { excludeReason: 'card_settlement', isClassified: 'Y' },
      });
      return rows.length;
    }
    let count = 0;
    for (const b of rows) {
      if (await this.classifyAsExclusion(b, codes, months)) count++;
    }
    return count;
  }

  /**
   * 본인 계좌 간 이체 — 같은 이름(내용)·같은 날·동일 금액의 (출금 A) ↔ (입금 B)를 한 쌍으로 인식.
   * 두 계좌 모두 본인 명의일 때, 출금→'지출 분류 제외'·입금→'수입 분류 제외'로 보정한다.
   * 이미 분류/제외된 행도 대상에 포함(계좌를 나눠 업로드해 한쪽이 먼저 분류돼도 짝을 맞춤).
   * 분류된 월을 months 에 추가(호출자가 집계 재계산). 반환값은 보정한 행 수.
   */
  async classifySelfTransfers(months: Set<string>): Promise<number> {
    const codes = await this.exclusionCodes();
    let count = 0;

    // (a) 구버전에서 이미 self_transfer 로 표시된 행 → '분류 제외'로 승격
    if (codes.expense || codes.income) {
      const marked = await this.prisma.bankTransaction.findMany({
        where: { transactionId: null, excludeReason: 'self_transfer' },
      });
      for (const b of marked) {
        if (await this.classifyAsExclusion(b, codes, months)) count++;
      }
    }
    if (!codes.expense && !codes.income) return count; // 분류 제외 카테고리 없으면 종료

    // (b) 이름+날짜+금액이 일치하는 (출금↔입금, 본인 계좌) 쌍 — 이미 분류/제외된 행도 포함
    const rows = await this.prisma.bankTransaction.findMany({
      include: {
        paymentMethod: true,
        transaction: { select: { categoryCode: true } },
      },
    });
    const nd = (s: string | null) => (s ?? '').replace(/\s/g, '');
    const keyOf = (amount: number, at: Date) =>
      `${amount}|${at.toISOString().slice(0, 10)}`;
    // 아직 거래·제외로 확정되지 않은 순수 미분류 행
    const isPending = (r: (typeof rows)[number]) =>
      !r.transactionId && !r.excludeReason;

    // 입금 행을 (금액|날짜) 키로 색인
    const depByKey = new Map<string, typeof rows>();
    for (const d of rows) {
      if (Number(d.deposit) <= 0) continue;
      const key = keyOf(Number(d.deposit), d.txnAt);
      const list = depByKey.get(key) ?? [];
      list.push(d);
      depByKey.set(key, list);
    }

    const used = new Set<number>();
    for (const w of rows) {
      const amt = Number(w.withdrawal);
      if (amt <= 0 || used.has(w.id)) continue;
      const candidates = depByKey.get(keyOf(amt, w.txnAt));
      if (!candidates) continue;
      const wDesc = nd(w.description);
      const pair = candidates.find(
        (d) =>
          !used.has(d.id) &&
          d.paymentMethodId !== w.paymentMethodId &&
          isOwnPair(w.paymentMethod?.owner, d.paymentMethod?.owner) &&
          // 이미 분류/제외된 행을 건드릴 땐 '같은 이름' 필수(오탐 방지),
          // 둘 다 순수 미분류면 이름 없이도 매칭(기존 동작 유지).
          ((wDesc !== '' && nd(d.description) === wDesc) ||
            (isPending(w) && isPending(d))),
      );
      if (!pair) continue;
      used.add(w.id);
      used.add(pair.id);
      if (await this.ensureBankExclusion(w, codes, months)) count++;
      if (await this.ensureBankExclusion(pair, codes, months)) count++;
    }
    return count;
  }

  /** 은행 행을 방향에 맞는 '분류 제외'로 보정 — 이미 분류돼 있으면 분류만 교체, 아니면 거래 생성. */
  private async ensureBankExclusion(
    row: BankRowLite & {
      excludeReason?: string | null;
      transactionId?: number | null;
      transaction?: { categoryCode: string } | null;
    },
    codes: { expense?: string; income?: string },
    months: Set<string>,
  ): Promise<boolean> {
    const isExpense = Number(row.withdrawal) > 0;
    const target = isExpense ? codes.expense : codes.income;
    if (!target) return false;
    if (row.transaction?.categoryCode === target) return false; // 이미 올바름

    if (row.transactionId) {
      // 이미 다른 분류로 잡힌 거래(예: 기타수입) → 분류만 '분류 제외'로 교체
      await this.prisma.transaction.update({
        where: { id: row.transactionId },
        data: { categoryCode: target },
      });
      if (row.excludeReason) {
        await this.prisma.bankTransaction.update({
          where: { id: row.id },
          data: { excludeReason: null },
        });
      }
    } else {
      const amount = isExpense ? Number(row.withdrawal) : Number(row.deposit);
      const day = startOfDay(row.txnAt);
      const tx = await this.prisma.transaction.create({
        data: {
          householdId: row.householdId,
          type: isExpense ? 'expense' : 'income',
          categoryCode: target,
          paymentMethodId: row.paymentMethodId,
          description: row.description,
          amount,
          transactionDate: day,
          settledDate: day,
          status: 'settled',
        },
      });
      await this.prisma.bankTransaction.update({
        where: { id: row.id },
        data: { transactionId: tx.id, isClassified: 'Y', excludeReason: null },
      });
    }
    months.add(row.txnAt.toISOString().slice(0, 7));
    return true;
  }

  /**
   * 집계 제외 결제수단(exclude_from_stats)의 은행 거래 → 방향별 '분류 제외'로 매핑.
   * 출금=지출 분류 제외 / 입금=수입 분류 제외. 이미 다른 분류면 교체.
   */
  async classifyExcludedBankPms(months: Set<string>): Promise<number> {
    const codes = await this.exclusionCodes();
    if (!codes.expense && !codes.income) return 0;
    const excludedPm = await excludedPaymentMethodIds(this.prisma);
    if (excludedPm.length === 0) return 0;

    const rows = await this.prisma.bankTransaction.findMany({
      where: { paymentMethodId: { in: excludedPm } },
      include: { transaction: { select: { categoryCode: true } } },
    });
    let count = 0;
    for (const r of rows) {
      if (Number(r.withdrawal) <= 0 && Number(r.deposit) <= 0) continue;
      if (await this.ensureBankExclusion(r, codes, months)) count++;
    }
    return count;
  }

  /**
   * 집계 제외 결제수단의 카드 거래 → '지출 분류 제외'로 매핑(카드는 항상 지출).
   * 취소행 제외. 이미 다른 분류면 교체.
   */
  async classifyExcludedCardPms(months: Set<string>): Promise<number> {
    const codes = await this.exclusionCodes();
    if (!codes.expense) return 0;
    const excludedPm = await excludedPaymentMethodIds(this.prisma);
    if (excludedPm.length === 0) return 0;

    const rows = await this.prisma.cardTransaction.findMany({
      where: { paymentMethodId: { in: excludedPm } },
      include: { transaction: { select: { categoryCode: true } } },
    });
    let count = 0;
    for (const c of rows) {
      if (c.transaction?.categoryCode === codes.expense) continue;
      const amount = Number(c.principal) + Number(c.fee);
      const day = startOfDay(c.txnDate);
      if (c.transactionId) {
        await this.prisma.transaction.update({
          where: { id: c.transactionId },
          data: { categoryCode: codes.expense },
        });
      } else {
        const tx = await this.prisma.transaction.create({
          data: {
            householdId: c.householdId,
            type: 'expense',
            categoryCode: codes.expense,
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
      months.add(c.txnDate.toISOString().slice(0, 7));
      count++;
    }
    return count;
  }
}

/** UTC 자정 기준 날짜(시분초 절삭). */
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** 두 계좌가 모두 본인 명의로 볼 수 있는지(동일 owner, 또는 '본인'). */
function isOwnPair(a?: string | null, b?: string | null): boolean {
  const own = (v?: string | null) => !v || v === '본인';
  return own(a) && own(b);
}
