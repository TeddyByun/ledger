import { Issuer } from '@ledger/shared';
import { parseAmount, parseDate } from './tabular.js';
import { cell, dedupHash, locateHeader } from './generic.js';
import type {
  FieldAliasMap,
  NormalizedBankRow,
  ParseContext,
  ParseResult,
  StatementParser,
} from './types.js';

const BANK_ALIASES: FieldAliasMap = {
  txnAt: ['거래일시', '거래일자', '거래일'],
  txnTypeRaw: ['구분', '거래구분'],
  description: ['적요', '내용', '기재내용'],
  withdrawal: ['출금액', '출금', '지급'],
  deposit: ['입금액', '입금', '입금금액'],
  balance: ['잔액', '거래후잔액'],
  branch: ['거래점', '거래점명', '취급점'],
};

/** 은행 명세서 파서 (Hana 등) — 헤더 기반 컬럼 매핑. */
export class GenericBankParser implements StatementParser {
  constructor(public readonly issuer: Issuer) {}

  parse(rows: string[][], _ctx: ParseContext): ParseResult {
    const account = this.extractAccount(rows);
    const { headerIndex, columns } = locateHeader(rows, BANK_ALIASES);
    if (headerIndex < 0) return { kind: 'bank', account, rows: [] };

    const out: NormalizedBankRow[] = [];
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i]!;
      const txnAt = parseDate(cell(row, columns, 'txnAt'));
      if (!txnAt) continue; // 합계/공백 행 skip

      const withdrawal = parseAmount(cell(row, columns, 'withdrawal')) ?? 0;
      const deposit = parseAmount(cell(row, columns, 'deposit')) ?? 0;
      const balanceRaw = cell(row, columns, 'balance');
      const balance = balanceRaw === '-' ? null : parseAmount(balanceRaw);
      const description = (cell(row, columns, 'description') ?? '').trim() || null;
      const txnTypeRaw = (cell(row, columns, 'txnTypeRaw') ?? '').trim() || null;
      const branch = (cell(row, columns, 'branch') ?? '').trim() || null;

      out.push({
        txnAt,
        txnTypeRaw,
        description,
        withdrawal,
        deposit,
        balance,
        branch,
        dedupHash: dedupHash([
          this.issuer,
          txnAt.toISOString(),
          withdrawal,
          deposit,
          balance,
          description,
        ]),
      });
    }
    return { kind: 'bank', account, rows: out };
  }

  /** 헤더의 계좌번호(예: 569-910201-47307) 추출. 뒤 세그먼트를 식별자로. */
  private extractAccount(rows: string[][]): {
    accountNo: string | null;
    identifier: string | null;
  } {
    for (const row of rows) {
      for (const c of row) {
        const m = c?.match(/(\d{3,}-\d{5,}-\d{4,})/);
        if (m) {
          const accountNo = m[1]!;
          return { accountNo, identifier: accountNo.split('-').pop() ?? null };
        }
      }
    }
    return { accountNo: null, identifier: null };
  }
}
