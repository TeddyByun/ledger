export interface CursorPage<T> {
  items: T[];
  page: { nextCursor: string | null; hasNext: boolean };
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
