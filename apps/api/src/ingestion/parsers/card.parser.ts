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

/**
 * 카드사별 헤더 별칭. 컬럼명만 다르므로 하나의 제네릭 파서를 설정으로 재사용한다.
 * (하나·현대·신한·삼성 명세서의 이용상세내역 컬럼을 모두 수용)
 */
const CARD_ALIASES: FieldAliasMap = {
  txnDate: ['이용일', '거래일자', '이용일자'],
  cardLabel: ['이용카드', '이용구분', '카드'],
  merchantName: ['가맹점', '이용가맹점', '가맹점명'],
  usageAmount: ['이용금액'],
  // 실제 청구액: 결제원금 / 이번달 납부금액(원금) / 원금
  principal: ['결제원금', '납부금액', '원금'],
  fee: ['수수료', '이자'],
  installmentPeriod: ['할부기간', '할부/회차', '개월', '할부'],
  billingRound: ['청구회차', '회차'],
  benefitType: ['이용혜택', '적용구분', '적용 구분'],
  benefitAmount: ['혜택금액', '예상적립/할인', '할인금액'],
  region: ['이용지역'],
  saleType: ['혜택구분', '적용구분'],
  point: ['적립금액', '포인트'],
};

export class GenericCardParser implements StatementParser {
  constructor(public readonly issuer: Issuer) {}

  parse(rows: string[][], ctx: ParseContext): ParseResult {
    const { headerIndex, columns } = locateHeader(rows, CARD_ALIASES);
    const out: NormalizedCardRow[] = [];

    if (headerIndex >= 0) {
      for (let i = headerIndex + 1; i < rows.length; i++) {
        const row = rows[i]!;
        const txnDate = parseDate(cell(row, columns, 'txnDate'));
        const merchant = (cell(row, columns, 'merchantName') ?? '').trim();
        if (!txnDate || !merchant) continue; // 소계/합계/공백 행 skip

        const usageAmount = parseAmount(cell(row, columns, 'usageAmount')) ?? 0;
        // 결제원금이 없으면 이용금액으로 대체
        const principal = parseAmount(cell(row, columns, 'principal')) ?? usageAmount;
        const fee = parseAmount(cell(row, columns, 'fee')) ?? 0;
        const benefitAmount = parseAmount(cell(row, columns, 'benefitAmount')) ?? 0;
        const saleType = (cell(row, columns, 'saleType') ?? '').trim() || null;
        const benefitType = (cell(row, columns, 'benefitType') ?? '').trim() || null;
        const isCanceled =
          usageAmount < 0 || saleType === '취소' || benefitType === '취소';

        out.push({
          cardLabel: (cell(row, columns, 'cardLabel') ?? '').trim() || null,
          txnDate,
          merchantName: merchant,
          usageAmount,
          principal,
          fee,
          installmentPeriod: (cell(row, columns, 'installmentPeriod') ?? '').trim() || null,
          billingRound: (cell(row, columns, 'billingRound') ?? '').trim() || null,
          benefitType,
          benefitAmount,
          region: (cell(row, columns, 'region') ?? '').trim() || null,
          saleType,
          isCanceled,
          point: parseAmount(cell(row, columns, 'point')) ?? 0,
          dedupHash: dedupHash([
            this.issuer,
            txnDate.toISOString(),
            merchant,
            usageAmount,
            principal,
            benefitAmount,
          ]),
        });
      }
    }

    // 명세서 기준월: ctx 우선, 없으면 최빈 거래월에서 유추
    const statementYm = ctx.statementYm ?? inferYm(out);
    const totalAmount = out.reduce(
      (s, r) => s + (r.isCanceled ? 0 : r.principal + r.fee),
      0,
    );

    return {
      kind: 'card',
      statement: {
        statementYm,
        billingDate: null,
        totalAmount,
        totalCount: out.length,
        rows: out,
      },
    };
  }
}

function inferYm(rows: NormalizedCardRow[]): string {
  if (rows.length === 0) return '';
  const counts = new Map<string, number>();
  for (const r of rows) {
    const ym = r.txnDate.toISOString().slice(0, 7);
    counts.set(ym, (counts.get(ym) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}
