import { dedupHash } from '../parsers/generic.js';
import type { NormalizedBankRow, NormalizedCardRow } from '../parsers/types.js';

const PREFIX = 'v2:';
export const normalizedMerchant = (value: string | null | undefined) => (value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
export const isLegacyHash = (hash: string | null) => !hash?.startsWith(PREFIX);
const round = (value: string | null) => Number(value?.match(/\d+/)?.[0] ?? 0);

export function bankIdentity(paymentMethodId: number, row: NormalizedBankRow): string {
  return PREFIX + dedupHash(['bank', paymentMethodId, row.txnAt.toISOString(), row.withdrawal, row.deposit, normalizedMerchant(row.description)]);
}
export function cardIdentity(paymentMethodId: number, row: NormalizedCardRow, displayDate: Date): string {
  const at = new Date(displayDate);
  at.setUTCHours(row.txnDate.getUTCHours(), row.txnDate.getUTCMinutes(), row.txnDate.getUTCSeconds());
  const base = PREFIX + dedupHash(['card', paymentMethodId, at.toISOString(), normalizedMerchant(row.merchantName),
    row.principal + row.fee, round(row.installmentPeriod), round(row.billingRound), Number(row.isCanceled)]);
  // 실제 승인번호가 다르면 별도 결제다. 파일 안 행 순번을 발급해 별건으로 만들지는 않는다.
  return row.approvalNo ? `${base}:a${dedupHash([row.approvalNo]).slice(0, 16)}` : base;
}
export function compatibleCardIdentity(stored: string | null, incoming: string): boolean {
  if (!stored?.startsWith(PREFIX)) return false;
  const [a, approvalA] = stored.split(':a');
  const [b, approvalB] = incoming.split(':a');
  return a === b && (!approvalA || !approvalB || approvalA === approvalB);
}
export function sameLegacyCard(
  stored: { dedupHash: string | null; merchantName: string; installmentPeriod: string | null; billingRound: string | null; isCanceled: string; principal: unknown; fee: unknown },
  row: NormalizedCardRow,
): boolean {
  return isLegacyHash(stored.dedupHash) && Number(stored.principal) + Number(stored.fee) === row.principal + row.fee && normalizedMerchant(stored.merchantName) === normalizedMerchant(row.merchantName) &&
    round(stored.installmentPeriod) === round(row.installmentPeriod) && round(stored.billingRound) === round(row.billingRound) &&
    (stored.isCanceled === 'Y') === row.isCanceled;
}
export function duplicateKeyError(error: unknown): boolean {
  const e = error as { code?: string; meta?: { target?: string[] } };
  return e?.code === 'P2002' && !!e.meta?.target?.some((target) => /dedup_?hash/i.test(target));
}
