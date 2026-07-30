import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * 수입·지출 집계에서 제외할 결제수단 id 목록(payment_method.exclude_from_stats='true').
 * 투자·저축 계좌처럼 실제 수입/지출이 아닌 결제수단의 거래를 집계에서 빼는 데 쓴다.
 */
export async function excludedPaymentMethodIds(
  prisma: PrismaService,
): Promise<number[]> {
  const rows = await prisma.paymentMethod.findMany({
    where: { excludeFromStats: true },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
