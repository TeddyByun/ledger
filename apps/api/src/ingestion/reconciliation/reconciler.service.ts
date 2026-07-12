import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * 대사(reconciliation) — 은행 원천 중 실지출이 아닌 행을 exclude_reason 으로 표시(DATABASE.md §7).
 *  1) 카드대금 결제 출금(타사카드/하나카드) → card_settlement
 *  2) 본인 계좌 간 이체(동일 금액·반대 방향·본인 명의) → self_transfer
 * 표시된 행은 transaction 미연결로 두어 지출 집계에서 자동 제외된다.
 */
@Injectable()
export class ReconcilerService {
  constructor(private readonly prisma: PrismaService) {}

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
   * 두 계좌 모두 본인 명의(owner)일 때만 제외 처리.
   */
  async markSelfTransfers(): Promise<number> {
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
    const res = await this.prisma.bankTransaction.updateMany({
      where: { id: { in: [...matchedIds] } },
      data: { excludeReason: 'self_transfer', isClassified: 'Y' },
    });
    return res.count;
  }
}

/** 두 계좌가 모두 본인 명의로 볼 수 있는지(동일 owner, 또는 '본인'). */
function isOwnPair(a?: string | null, b?: string | null): boolean {
  const own = (v?: string | null) => !v || v === '본인';
  return own(a) && own(b);
}
