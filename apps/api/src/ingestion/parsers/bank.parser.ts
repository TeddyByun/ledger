import { Issuer } from '@ledger/shared';
import { parseAmount, parseDateTime } from './tabular.js';
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

/**
 * 금액 셀에서 끝의 괄호 주석을 분리한다. 예: "100,000(41)" → { amount:100000, note:"(41)" }
 * 괄호가 없으면 note=null. 금액 없으면 0.
 */
function splitAmountNote(raw: string | undefined): { amount: number; note: string | null } {
  const s = (raw ?? '').trim();
  const m = s.match(/(\([^)]*\))\s*$/);
  const note = m ? m[1]!.trim() : null;
  const amountStr = m ? s.slice(0, m.index).trim() : s;
  return { amount: parseAmount(amountStr) ?? 0, note };
}

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
      const txnAt = parseDateTime(cell(row, columns, 'txnAt'));
      if (!txnAt) continue; // 합계/공백 행 skip

      // 일부 계좌(예: 청약)는 금액 뒤에 '(납부회차)'가 붙는다 → 금액만 파싱하고
      // 괄호 부분은 적요(내용) 뒤에 그대로 이어붙인다. 예: "100,000(41)"
      const wSplit = splitAmountNote(cell(row, columns, 'withdrawal'));
      const dSplit = splitAmountNote(cell(row, columns, 'deposit'));
      const withdrawal = wSplit.amount;
      const deposit = dSplit.amount;
      const balanceRaw = cell(row, columns, 'balance');
      const balance = balanceRaw === '-' ? null : parseAmount(balanceRaw);
      const notes = [dSplit.note, wSplit.note].filter((s): s is string => !!s);
      const baseDesc = (cell(row, columns, 'description') ?? '').trim();
      const description = [baseDesc, ...notes].filter(Boolean).join(' ') || null;
      const txnTypeRaw = (cell(row, columns, 'txnTypeRaw') ?? '').trim() || null;
      const branch = (cell(row, columns, 'branch') ?? '').trim() || null;

      // dedup 키는 '날짜'(시각 제외) 기준 — 시각을 넣으면 재업로드 중복방지가 깨지고
      // 기존 데이터와도 어긋난다. 시각은 txnAt 에만 담아 정렬/표시에 쓴다.
      const dateKey = new Date(
        Date.UTC(txnAt.getUTCFullYear(), txnAt.getUTCMonth(), txnAt.getUTCDate()),
      ).toISOString();

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
          dateKey,
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
