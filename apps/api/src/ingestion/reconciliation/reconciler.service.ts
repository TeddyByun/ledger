import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EXCLUDE_CATEGORY_NAMES } from '../../common/exclude-category.js';

/**
 * 대사(reconciliation) — 은행 원천 중 실지출이 아닌 행을 처리(DATABASE.md §7).
 *  1) 카드대금 결제 출금(타사카드/하나카드) → exclude_reason='card_settlement'
 *  2) 본인 계좌 간 이체(동일 금액·같은 날·본인 명의) → '분류 제외' 분류로 자동 분류
 * 업로드·자동분류 양쪽에서 호출된다.
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

  /** 카드대금 출금 식별 — 카드 명세서 결제계좌 + 총액 + 결제월로 매칭. */
  async markCardSettlements(): Promise<number> {
    // 구분명이 카드결제(타사카드/하나카드/...카드)인 미분류 출금 행
    const candidates = await this.prisma.bankTransaction.findMany({
      where: {
        withdrawal: { gt: 0 },
        transactionId: null,
        excludeReason: null,
        txnType: { name: { contains: '카드' } },
      },
      select: { id: true },
    });
    if (candidates.length === 0) return 0;
    const res = await this.prisma.bankTransaction.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: { excludeReason: 'card_settlement', isClassified: 'Y' },
    });
    return res.count;
  }

  /**
   * 본인 계좌 간 이체 — 같은 날짜·동일 금액의 (출금 A) ↔ (입금 B)를 한 쌍으로 인식.
   * 두 계좌 모두 본인 명의(owner)일 때만, 양쪽을 '분류 제외' 분류로 자동 분류(거래 생성)한다.
   * 분류된 월을 months 에 추가(호출자가 집계 재계산). 반환값은 분류한 행 수.
   */
  async classifySelfTransfers(months: Set<string>): Promise<number> {
    const rows = await this.prisma.bankTransaction.findMany({
      where: { transactionId: null, excludeReason: null },
      include: { paymentMethod: true },
    });

    const withdrawals = rows.filter((r) => Number(r.withdrawal) > 0);
    const deposits = rows.filter((r) => Number(r.deposit) > 0);
    const matchedIds = new Set<number>();

    for (const w of withdrawals) {
      const amt = Number(w.withdrawal);
      const day = w.txnAt.toISOString().slice(0, 10);
      const pair = deposits.find(
        (d) =>
          !matchedIds.has(d.id) &&
          Number(d.deposit) === amt &&
          d.txnAt.toISOString().slice(0, 10) === day &&
          d.paymentMethodId !== w.paymentMethodId &&
          isOwnPair(w.paymentMethod?.owner, d.paymentMethod?.owner),
      );
      if (pair) {
        matchedIds.add(w.id);
        matchedIds.add(pair.id);
      }
    }
    if (matchedIds.size === 0) return 0;

    const codes = await this.exclusionCodes();
    const matched = rows.filter((r) => matchedIds.has(r.id));

    // '분류 제외' 분류가 없으면 기존 방식(exclude_reason)으로 폴백
    if (!codes.expense && !codes.income) {
      await this.prisma.bankTransaction.updateMany({
        where: { id: { in: matched.map((m) => m.id) } },
        data: { excludeReason: 'self_transfer', isClassified: 'Y' },
      });
      return matched.length;
    }

    let count = 0;
    for (const b of matched) {
      const isExpense = Number(b.withdrawal) > 0;
      const amount = isExpense ? Number(b.withdrawal) : Number(b.deposit);
      const code = isExpense ? codes.expense : codes.income;
      if (!code) continue;
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
        data: { transactionId: tx.id, isClassified: 'Y' },
      });
      months.add(b.txnAt.toISOString().slice(0, 7));
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
