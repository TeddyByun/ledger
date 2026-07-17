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

/** 삼성카드 이용상세 컬럼 별칭 (일시불/할부 시트 공통). */
const ALIASES: FieldAliasMap = {
  txnDate: ['이용일'],
  cardLabel: ['이용구분'],
  merchantName: ['가맹점'],
  usageAmount: ['이용금액'],
  benefitType: ['이용혜택'],
  benefitAmount: ['혜택금액'],
  installmentPeriod: ['개월'],
  billingRound: ['회차'],
  principal: ['원금'],
  fee: ['이자/수수료', '이자', '수수료'],
  point: ['적립금액'],
  balanceAfter: ['입금후잔액'],
};

const norm = (v?: string): string | null => (v ?? '').trim() || null;

/**
 * 삼성카드 전용 파서.
 * - 시트 2개(일시불/할부)를 이어 읽음(readTabular 가 전 시트 concat)
 * - 이용구분("본 인 252")에서 카드번호(252)·명의 추출
 * - 날짜 yyyymmdd, 금액 = 원금 + 이자/수수료
 * - 소계/합계 행 스킵. 청구월은 업로드 지정(ctx) 우선, 없으면 사용월+1 추정.
 */
export class SamsungCardParser implements StatementParser {
  readonly issuer = Issuer.SAMSUNG_CARD;

  parse(rows: string[][], ctx: ParseContext): ParseResult {
    const { headerIndex, columns } = locateHeader(rows, ALIASES);
    const out: NormalizedCardRow[] = [];

    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i]!;
      const merchant = (cell(row, columns, 'merchantName') ?? '').trim();
      if (!merchant || /합계|소계/.test(merchant)) continue;

      const txnDate = parseDate(cell(row, columns, 'txnDate'));
      if (!txnDate) continue;

      const usageAmount = parseAmount(cell(row, columns, 'usageAmount')) ?? 0;
      const principal = parseAmount(cell(row, columns, 'principal')) ?? usageAmount;
      const fee = parseAmount(cell(row, columns, 'fee')) ?? 0;
      const benefitAmount = parseAmount(cell(row, columns, 'benefitAmount')) ?? 0;
      const installmentPeriod = norm(cell(row, columns, 'installmentPeriod'));
      const billingRound = norm(cell(row, columns, 'billingRound'));

      // 이용구분은 '본 인 252' / '가족 …' 형태. 해외이용 섹션은 컬럼 구성이 달라
      // 이 자리에 접수일(예: 20260504)이 들어오는데, 해당 매출은 일시불에 이미
      // 포함된 상세이므로 제외한다(중복 적재·가짜 카드번호 방지).
      const label = norm(cell(row, columns, 'cardLabel'));
      const compact = (label ?? '').replace(/\s/g, '');
      if (!/(본인|가족)/.test(compact)) continue;
      const cardNo = compact.match(/\d+/)?.[0] ?? null;

      out.push({
        cardLabel: label,
        cardNo,
        txnDate,
        merchantName: merchant,
        usageAmount,
        principal,
        fee,
        installmentPeriod,
        billingRound,
        benefitType: norm(cell(row, columns, 'benefitType')),
        benefitAmount,
        region: null,
        saleType: installmentPeriod ? '할부' : '일시불',
        isCanceled: usageAmount < 0,
        point: parseAmount(cell(row, columns, 'point')) ?? 0,
        dedupHash: dedupHash([
          this.issuer,
          txnDate.toISOString(),
          merchant,
          usageAmount,
          principal,
          benefitAmount,
          cardNo,
        ]),
      });
    }

    const statementYm = ctx.statementYm ?? this.inferBillingMonth(out);
    return {
      kind: 'card',
      statement: {
        statementYm,
        billingDate: statementYm ? new Date(`${statementYm}-01T00:00:00Z`) : null,
        totalAmount: out.reduce((s, r) => s + (r.isCanceled ? 0 : r.principal + r.fee), 0),
        totalCount: out.length,
        rows: out,
      },
    };
  }

  /** 청구월 = 최대 사용월 + 1개월 (명세서에 청구월 표기가 없을 때). */
  private inferBillingMonth(rows: NormalizedCardRow[]): string {
    if (rows.length === 0) return '';
    const max = rows
      .map((r) => r.txnDate)
      .reduce((a, b) => (a > b ? a : b));
    const d = new Date(Date.UTC(max.getUTCFullYear(), max.getUTCMonth() + 1, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
}
