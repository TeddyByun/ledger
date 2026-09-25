import { normKey } from '../common/fuzzy-key.js';

export interface FlowBank { id: number; name: string; accountNo?: string | null }
export interface BankFlowRow {
  id: number; paymentMethodId: number; txnAt: Date; description: string | null;
  txnTypeRaw?: string | null; deposit: unknown; withdrawal: unknown;
  excludeReason?: string | null; transaction?: { categoryCode: string | null } | null;
}
const digits = (s: string) => s.replace(/\D/g, '');

/** 범위 안의 다른 통장 번호가 명시된 거래만 내부 이동이다. 적금·청약 등 범위 밖 번호는 외부다. */
export function referencedBank(label: string, banks: FlowBank[], ownId?: number): FlowBank | undefined {
  const numbers = label.match(/\d+(?:-\d+)*/g)?.map(digits) ?? [];
  return banks.find((b) => b.id !== ownId && b.accountNo && numbers.includes(digits(b.accountNo)));
}

export function isCardSettlement(row: Pick<BankFlowRow, 'description' | 'txnTypeRaw' | 'excludeReason' | 'withdrawal'>): boolean {
  return Number(row.withdrawal) > 0 && (row.excludeReason === 'card_settlement' ||
    /카드/.test(`${row.description ?? ''} ${row.txnTypeRaw ?? ''}`));
}

/** 같은 날·금액에 이름 또는 기존 이체 분류까지 일치하는 서로 다른 기준 통장 거래를 1:1로 연결한다. */
export function internalBankTransfers(rows: BankFlowRow[], banks: FlowBank[], excludedCodes: Set<string>): Set<number> {
  const scope = new Set(banks.map((b) => b.id));
  const candidates = rows.filter((r) => scope.has(r.paymentMethodId));
  const internal = new Set<number>();
  const paired = new Set<number>();
  const excluded = (r: BankFlowRow) => r.excludeReason === 'self_transfer' || excludedCodes.has(r.transaction?.categoryCode ?? '');
  for (const r of candidates) {
    if (referencedBank(r.description ?? '', banks, r.paymentMethodId)) internal.add(r.id);
  }
  const deposits = new Map<string, BankFlowRow[]>();
  const key = (amount: number, date: Date) => `${amount}|${date.toISOString().slice(0, 10)}`;
  for (const r of candidates) {
    if (Number(r.deposit) <= 0) continue;
    const k = key(Number(r.deposit), r.txnAt);
    deposits.set(k, [...(deposits.get(k) ?? []), r]);
  }
  for (const w of candidates) {
    if (Number(w.withdrawal) <= 0 || isCardSettlement(w)) continue;
    const match = deposits.get(key(Number(w.withdrawal), w.txnAt))?.find((d) =>
      d.paymentMethodId !== w.paymentMethodId && !paired.has(d.id) &&
      ((normKey(w.description) !== '' && normKey(w.description) === normKey(d.description)) ||
        excluded(w) || excluded(d) || internal.has(w.id) || internal.has(d.id)));
    if (match) {
      internal.add(w.id); internal.add(match.id);
      paired.add(w.id); paired.add(match.id);
    }
  }
  return internal;
}
