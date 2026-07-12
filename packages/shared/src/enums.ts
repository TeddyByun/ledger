/**
 * 공통 열거형 — 웹·모바일·백엔드가 공유하는 도메인 상수.
 * DATABASE.md 의 CHECK 제약과 1:1로 대응한다.
 */

/** 거래 유형 (transaction.type / category.type) */
export const TransactionType = {
  INCOME: 'income',
  EXPENSE: 'expense',
} as const;
export type TransactionType =
  (typeof TransactionType)[keyof typeof TransactionType];

/** 결제수단 유형 (payment_method.method_type) */
export const MethodType = {
  BANK: 'bank',
  CARD: 'card',
} as const;
export type MethodType = (typeof MethodType)[keyof typeof MethodType];

/** 거래 상태 (transaction.status) */
export const TransactionStatus = {
  SETTLED: 'settled',
  PENDING: 'pending',
  INFO: 'info',
} as const;
export type TransactionStatus =
  (typeof TransactionStatus)[keyof typeof TransactionStatus];

/** 집계 제외 사유 (bank_transaction.exclude_reason) */
export const ExcludeReason = {
  CARD_SETTLEMENT: 'card_settlement',
  SELF_TRANSFER: 'self_transfer',
} as const;
export type ExcludeReason = (typeof ExcludeReason)[keyof typeof ExcludeReason];

/** 가맹점 자동분류 매칭 방식 (merchant_category_map.match_type) */
export const MatchType = {
  CONTAINS: 'contains',
  EXACT: 'exact',
  REGEX: 'regex',
} as const;
export type MatchType = (typeof MatchType)[keyof typeof MatchType];

/** 적재 잡 상태 (import 파이프라인) */
export const ImportJobStatus = {
  QUEUED: 'queued',
  PARSING: 'parsing',
  CLASSIFYING: 'classifying',
  REVIEW: 'review',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;
export type ImportJobStatus =
  (typeof ImportJobStatus)[keyof typeof ImportJobStatus];

/** 명세서 발급사 (파서 어댑터 선택 키) */
export const Issuer = {
  HANA_BANK: 'hana_bank',
  HANA_CARD: 'hana_card',
  HYUNDAI_CARD: 'hyundai_card',
  SHINHAN_CARD: 'shinhan_card',
  SAMSUNG_CARD: 'samsung_card',
} as const;
export type Issuer = (typeof Issuer)[keyof typeof Issuer];
