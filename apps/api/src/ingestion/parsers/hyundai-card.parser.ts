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

/** 현대카드 결제상세내역 컬럼 별칭 (R3 헤더). */
const ALIASES: FieldAliasMap = {
  txnDate: ['이용일'],
  cardLabel: ['이용카드'],
  merchantName: ['이용가맹점'],
  usageAmount: ['이용금액'],
  installmentPeriod: ['할부/회차', '할부'],
  benefitAmount: ['예상적립/할인'], // ± : 음수=할인, 양수=적립
  principal: ['결제원금'],
  balanceAfter: ['결제후잔액'],
  fee: ['수수료(이자)', '수수료', '이자'],
};

const norm = (v?: string): string | null => (v ?? '').trim() || null;

/** 엑셀 날짜 시리얼(46080 등) → Date. 1899-12-30 기준(1900 윤년 버그 포함). */
function excelSerialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
}

/**
 * 현대카드 전용 파서.
 * - 이용일이 엑셀 시리얼 숫자 → 날짜 변환
 * - 소계/합계 행 스킵, 총합계 행에서 합계·건수 추출
 * - 금액 = 결제원금 + 수수료(이자), 예상적립/할인 부호로 할인/적립 분리
 * - 할부(할부/회차 존재)는 원 이용일 보존 + 파이프라인이 청구월로 집계
 * - 이용카드 라벨에 카드번호가 없어 card_no = null
 */
export class HyundaiCardParser implements StatementParser {
  readonly issuer = Issuer.HYUNDAI_CARD;

  parse(rows: string[][], ctx: ParseContext): ParseResult {
    const statementYm = this.extractYm(rows, ctx);
    const { total, count } = this.extractTotal(rows);
    const { headerIndex, columns } = locateHeader(rows, ALIASES);
    const out: NormalizedCardRow[] = [];

    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i]!;
      const rawDate = (cell(row, columns, 'txnDate') ?? '').trim();
      const merchant = (cell(row, columns, 'merchantName') ?? '').trim();

      // 소계/합계 행 스킵
      if (!merchant || /소계|합계/.test(merchant)) continue;

      let txnDate = parseDate(rawDate);
      if (!txnDate && /^\d{4,6}$/.test(rawDate)) {
        const n = Number(rawDate);
        if (n > 40000 && n < 60000) txnDate = excelSerialToDate(n);
      }
      if (!txnDate) continue;

      const usageAmount = parseAmount(cell(row, columns, 'usageAmount')) ?? 0;
      const principal = parseAmount(cell(row, columns, 'principal')) ?? usageAmount;
      const fee = parseAmount(cell(row, columns, 'fee')) ?? 0;

      // 예상적립/할인: 음수=할인(혜택금액), 양수=적립(포인트)
      const pm = parseAmount(cell(row, columns, 'benefitAmount')) ?? 0;
      const benefitAmount = pm < 0 ? pm : 0;
      const point = pm > 0 ? pm : 0;

      // 할부/회차 "3/3" → [할부개월, 회차]
      const inst = norm(cell(row, columns, 'installmentPeriod'));
      let installmentPeriod: string | null = null;
      let billingRound: string | null = null;
      if (inst && inst.includes('/')) {
        const [p, r] = inst.split('/');
        installmentPeriod = p?.trim() || null;
        billingRound = r?.trim() || null;
      }

      out.push({
        cardLabel: norm(cell(row, columns, 'cardLabel')),
        cardNo: null, // 현대 명세서는 이용카드에 번호 없음
        txnDate,
        merchantName: merchant,
        usageAmount,
        principal,
        fee,
        installmentPeriod,
        billingRound,
        benefitType: benefitAmount < 0 ? '할인' : point > 0 ? '적립' : null,
        benefitAmount,
        region: null,
        saleType: installmentPeriod ? '할부' : '일시불',
        isCanceled: usageAmount < 0,
        point,
        // 할부는 회차 포함해 월별로 다른 건으로 인식(중복제거 방지)
        dedupHash: dedupHash([
          this.issuer,
          txnDate.toISOString(),
          merchant,
          usageAmount,
          principal,
          pm,
          billingRound,
        ]),
      });
    }

    return {
      kind: 'card',
      statement: {
        statementYm,
        billingDate: statementYm ? new Date(`${statementYm}-01T00:00:00Z`) : null,
        totalAmount:
          total ??
          out.reduce((s, r) => s + (r.isCanceled ? 0 : r.principal + r.fee), 0),
        totalCount: count ?? out.length,
        rows: out,
      },
    };
  }

  /** "2026년 04월 이용대금명세서" → 청구월. */
  private extractYm(rows: string[][], ctx: ParseContext): string {
    for (const row of rows) {
      for (const c of row) {
        const m = c?.match(/(\d{4})년\s*(\d{1,2})월/);
        if (m) return `${m[1]}-${String(+m[2]!).padStart(2, '0')}`;
      }
    }
    return ctx.statementYm ?? '';
  }

  /** "총 합계 32 건 … 781446" → 합계·건수. */
  private extractTotal(rows: string[][]): { total: number | null; count: number | null } {
    for (const row of rows) {
      const joined = row.join(' ');
      if (/총\s*합계/.test(joined)) {
        const cnt = joined.match(/(\d+)\s*건/);
        const nums = row
          .map((c) => parseAmount(c))
          .filter((n): n is number => n !== null && n > 0);
        return {
          total: nums.length ? Math.max(...nums) : null,
          count: cnt ? +cnt[1]! : null,
        };
      }
    }
    return { total: null, count: null };
  }
}
