export interface CursorPage<T> {
  items: T[];
  page: { nextCursor: string | null; hasNext: boolean };
}

export interface ImportJob {
  id: string;
  issuer: string;
  status: 'queued' | 'parsing' | 'classifying' | 'review' | 'completed' | 'failed';
  parsedRows: number;
  classifiedRows: number;
  pendingRows: number;
  error: string | null;
}

export interface PaymentMethod {
  id: number;
  name: string;
  methodType: 'bank' | 'card';
  issuer: string | null;
  identifier: string | null;
  cardNo: string | null;
  owner: string | null;
}

export interface HouseholdMember {
  id: number;
  name: string;
  relation: string | null;
  isSelf: boolean;
  color: string | null;
  sortOrder: number;
  email: string | null;
  role: 'owner' | 'member' | 'viewer';
}

export interface HouseholdInfo {
  id: number;
  name: string;
  role: string;
  members: HouseholdMember[];
}

export interface DetectedCard {
  cardNo: string;
  sampleLabel: string | null;
  txnCount: number;
}

export interface Category {
  code: string;
  name: string;
  type: 'income' | 'expense';
  depth: number;
  parentCode: string | null;
}

export interface Transaction {
  id: number;
  type: 'income' | 'expense';
  categoryCode: string;
  amount: string | null;
  description: string | null;
  transactionDate: string;
  status: 'settled' | 'pending' | 'info';
  category?: { name: string } | null;
  paymentMethod?: { name: string } | null;
  counterparty?: { name: string } | null;
}

/** 은행 원천 거래 (bank_transaction) */
export interface BankTxn {
  id: number;
  txnAt: string;
  txnTypeRaw: string | null;
  description: string | null;
  withdrawal: string;
  deposit: string;
  balance: string | null;
  branch: string | null;
  excludeReason: string | null;
  account: { id: number; name: string } | null;
  categoryCode: string | null;
  categoryName: string | null;
}

/** 카드 원천 거래 (card_transaction) */
export interface CardTxn {
  id: number;
  txnDate: string;
  merchantName: string;
  usageAmount: string;
  principal: string;
  fee: string;
  installmentPeriod: string | null;
  isCanceled: 'Y' | 'N';
  cardLabel: string | null;
  cardNo: string | null;
  card: { id: number; name: string; cardNo: string | null } | null;
  categoryCode: string | null;
  categoryName: string | null;
}
