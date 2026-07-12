/**
 * 분류 코드 시드 (DATABASE.md §3.2) — Parent-Child 코드 관리.
 * 대분류 2자리, 소분류 4자리(상위코드 + 일련번호).
 */
import { TransactionType } from './enums.js';

export interface CategorySeed {
  code: string;
  parentCode: string | null;
  name: string;
  type: TransactionType;
  depth: 1 | 2;
  sortOrder: number;
}

export const EXPENSE_CATEGORIES: CategorySeed[] = [
  { code: '01', parentCode: null, name: '대출', type: TransactionType.EXPENSE, depth: 1, sortOrder: 1 },
  { code: '02', parentCode: null, name: '투자', type: TransactionType.EXPENSE, depth: 1, sortOrder: 2 },
  { code: '03', parentCode: null, name: '보험', type: TransactionType.EXPENSE, depth: 1, sortOrder: 3 },
  { code: '04', parentCode: null, name: '공과금', type: TransactionType.EXPENSE, depth: 1, sortOrder: 4 },
  { code: '05', parentCode: null, name: '생활', type: TransactionType.EXPENSE, depth: 1, sortOrder: 5 },
  { code: '0501', parentCode: '05', name: '월 생활비', type: TransactionType.EXPENSE, depth: 2, sortOrder: 1 },
  { code: '0502', parentCode: '05', name: 'ATM 출금', type: TransactionType.EXPENSE, depth: 2, sortOrder: 2 },
  { code: '0503', parentCode: '05', name: '기타', type: TransactionType.EXPENSE, depth: 2, sortOrder: 3 },
  { code: '06', parentCode: null, name: '통신', type: TransactionType.EXPENSE, depth: 1, sortOrder: 6 },
  { code: '07', parentCode: null, name: '건강', type: TransactionType.EXPENSE, depth: 1, sortOrder: 7 },
  { code: '08', parentCode: null, name: '교통', type: TransactionType.EXPENSE, depth: 1, sortOrder: 8 },
  { code: '09', parentCode: null, name: '차량', type: TransactionType.EXPENSE, depth: 1, sortOrder: 9 },
  { code: '10', parentCode: null, name: '경조사', type: TransactionType.EXPENSE, depth: 1, sortOrder: 10 },
  { code: '11', parentCode: null, name: '교육', type: TransactionType.EXPENSE, depth: 1, sortOrder: 11 },
  { code: '12', parentCode: null, name: '여가', type: TransactionType.EXPENSE, depth: 1, sortOrder: 12 },
];

/** 수입 분류 (수기 시트의 수입 항목 기반, 13~ 코드대 사용) */
export const INCOME_CATEGORIES: CategorySeed[] = [
  { code: '13', parentCode: null, name: '급여', type: TransactionType.INCOME, depth: 1, sortOrder: 1 },
  { code: '14', parentCode: null, name: '상여/추가금', type: TransactionType.INCOME, depth: 1, sortOrder: 2 },
  { code: '15', parentCode: null, name: '캐시백/환급', type: TransactionType.INCOME, depth: 1, sortOrder: 3 },
  { code: '16', parentCode: null, name: '이자', type: TransactionType.INCOME, depth: 1, sortOrder: 4 },
  { code: '17', parentCode: null, name: '기타수입', type: TransactionType.INCOME, depth: 1, sortOrder: 5 },
];

export const ALL_CATEGORIES: CategorySeed[] = [
  ...EXPENSE_CATEGORIES,
  ...INCOME_CATEGORIES,
];
