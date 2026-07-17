import { Issuer } from '@ledger/shared';
import { parseAmount, parseDate } from './tabular.js';
import { cell, dedupHash, locateHeader } from './generic.js';
import type {
  FieldAliasMap,
  NormalizedCardRow,
  ParseContext,
  ParseResult,
  StatementParser,
} from './types.js';

/** 하나카드 이용상세내역 컬럼 별칭 (R29 헤더). */
const ALIASES: FieldAliasMap = {
  txnDate: ['거래일자'],
  merchantName: ['가맹점명'],
  usageAmount: ['이용금액'],
  installmentPeriod: ['할부기간', '할부 기간'],
  billingRound: ['청구회차', '청구 회차'],
  principal: ['결제원금'],
  fee: ['수수료'],
  benefitType: ['이용혜택'],
  benefitAmount: ['혜택금액'],
  region: ['이용지역'],
  saleType: ['혜택구분'],
  point: ['포인트'],
};

const norm = (v?: string): string | null => (v ?? '').trim() || null;

/**
 * 하나카드 전용 파서.
 * - 헤더에서 청구월·결제일·합계 추출 (사용월≠청구월)
 * - 카드 구분 그룹 헤더 행(#tag1카드 … 본인 7322) 감지 → 카드번호·라벨을 이후 거래에 적용
 * - 금액 = 결제원금 + 수수료
 */
export class HanaCardParser implements StatementParser {
  readonly issuer = Issuer.HANA_CARD;

  parse(rows: string[][], ctx: ParseContext): ParseResult {
    const { billingDate, statementYm } = this.extractBilling(rows, ctx);
    const totalHeader = this.extractTotal(rows);

    const { headerIndex, columns } = locateHeader(rows, ALIASES);
    const out: NormalizedCardRow[] = [];
    let curLabel: string | null = null;
    let curCardNo: string | null = null;

    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i]!;
      const txnDate = parseDate(cell(row, columns, 'txnDate'));

      if (!txnDate) {
        // 날짜가 없으면 카드 그룹 헤더(본인/가족 + 카드번호)인지 확인
        const label = this.detectCardLabel(row);
        if (label) {
          curLabel = label.label;
          curCardNo = label.cardNo;
        }
        continue; // 소계/여백/그룹헤더 skip
      }

      const merchant = (cell(row, columns, 'merchantName') ?? '').trim();
      if (!merchant) continue;

      const usageAmount = parseAmount(cell(row, columns, 'usageAmount')) ?? 0;
      const principal = parseAmount(cell(row, columns, 'principal')) ?? usageAmount;
      const fee = parseAmount(cell(row, columns, 'fee')) ?? 0;
      const benefitAmount = parseAmount(cell(row, columns, 'benefitAmount')) ?? 0;
      const saleType = norm(cell(row, columns, 'saleType'));
      const isCanceled = usageAmount < 0 || saleType === '취소';
      const billingRound = norm(cell(row, columns, 'billingRound'));

      out.push({
        cardLabel: curLabel,
        cardNo: curCardNo,
        txnDate,
        merchantName: merchant,
        usageAmount,
        principal,
        fee,
        installmentPeriod: norm(cell(row, columns, 'installmentPeriod')),
        billingRound,
        benefitType: norm(cell(row, columns, 'benefitType')),
        benefitAmount,
        region: norm(cell(row, columns, 'region')),
        saleType,
        isCanceled,
        point: parseAmount(cell(row, columns, 'point')) ?? 0,
        // 할부는 회차를 포함해 월별로 다른 건으로 인식(중복제거 방지)
        dedupHash: dedupHash([
          this.issuer,
          txnDate.toISOString(),
          merchant,
          usageAmount,
          principal,
          benefitAmount,
          curCardNo,
          billingRound,
        ]),
      });
    }

    const totalAmount =
      totalHeader ??
      out.reduce((s, r) => s + (r.isCanceled ? 0 : r.principal + r.fee), 0);

    return {
      kind: 'card',
      statement: {
        statementYm,
        billingDate,
        totalAmount,
        totalCount: out.length,
        rows: out,
      },
    };
  }

  /** "#tag1카드 Navy 본인 7322" 같은 그룹 헤더 → { label, 뒤 4자리 }. */
  private detectCardLabel(
    row: string[],
  ): { label: string; cardNo: string } | null {
    const text = (row.find((c) => c && c.trim()) ?? '').trim();
    if (!text || !/(본인|가족)/.test(text)) return null;
    const m = text.match(/(\d{4})(?!.*\d)/); // 마지막 4자리 숫자
    return { label: text, cardNo: m ? m[1]! : '' };
  }

  /** 헤더의 "YYYY년 MM월 DD일" 결제일 → billingDate + statement_ym(청구월). */
  private extractBilling(
    rows: string[][],
    ctx: ParseContext,
  ): { billingDate: Date | null; statementYm: string } {
    for (const row of rows) {
      for (const c of row) {
        const m = c?.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
        if (m) {
          const y = +m[1]!;
          const mo = +m[2]!;
          return {
            billingDate: new Date(Date.UTC(y, mo - 1, +m[3]!)),
            statementYm: `${y}-${String(mo).padStart(2, '0')}`,
          };
        }
      }
    }
    return { billingDate: null, statementYm: ctx.statementYm ?? '' };
  }

  /** "합계(입금하실 금액)" 행의 최대 금액 = 청구 합계. */
  private extractTotal(rows: string[][]): number | null {
    for (const row of rows) {
      if (row.some((c) => c?.includes('입금하실'))) {
        const nums = row
          .map((c) => parseAmount(c))
          .filter((n): n is number => n !== null);
        if (nums.length) return Math.max(...nums);
      }
    }
    return null;
  }
}
