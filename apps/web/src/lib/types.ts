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
