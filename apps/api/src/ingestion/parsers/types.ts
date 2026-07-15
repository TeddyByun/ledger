import { Issuer } from '@ledger/shared';

/** 정규화된 은행 거래 (→ bank_transaction) */
export interface NormalizedBankRow {
  txnAt: Date;
  txnTypeRaw: string | null;
  description: string | null;
  withdrawal: number;
  deposit: number;
  balance: number | null;
  branch: string | null;
  dedupHash: string;
}

/** 정규화된 카드 이용내역 (→ card_transaction) */
export interface NormalizedCardRow {
  cardLabel: string | null;
  cardNo: string | null; // 라벨에서 추출한 카드 식별번호(뒤 4자리) — 카드 목록 매핑 키
  txnDate: Date;
  merchantName: string;
  usageAmount: number;
  principal: number;
  fee: number;
  installmentPeriod: string | null;
  billingRound: string | null;
  benefitType: string | null;
  benefitAmount: number;
  region: string | null;
  saleType: string | null;
  isCanceled: boolean;
  point: number;
  dedupHash: string;
}

/** 정규화된 카드 명세서 (→ card_statement + rows) */
export interface NormalizedCardStatement {
  statementYm: string; // YYYY-MM
  billingDate: Date | null;
  totalAmount: number;
  totalCount: number;
  rows: NormalizedCardRow[];
}

export type ParseResult =
  | { kind: 'bank'; rows: NormalizedBankRow[] }
  | { kind: 'card'; statement: NormalizedCardStatement };

export interface ParseContext {
  issuer: Issuer;
  /** 명세서 기준월(YYYY-MM) — 헤더에서 못 뽑을 때 대비, 업로드 시 지정 가능 */
  statementYm?: string;
}

export interface StatementParser {
  readonly issuer: Issuer;
  parse(rows: string[][], ctx: ParseContext): ParseResult;
}

/** 필드 → 헤더 별칭 후보. 헤더 셀이 별칭을 포함하면 그 컬럼으로 매핑. */
export type FieldAliasMap = Record<string, string[]>;
