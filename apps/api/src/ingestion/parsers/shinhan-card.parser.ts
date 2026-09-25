import { Issuer } from '@ledger/shared';
import { parseAmount, parseDateTime } from './tabular.js';
import { dedupHash, locateHeader } from './generic.js';
import type {
  NormalizedCardRow,
  ParseContext,
  ParseResult,
  StatementParser,
} from './types.js';

/**
 * 신한카드 고정 컬럼 (2줄 헤더라 별칭 대신 인덱스 고정).
 * 이용일 | 이용카드 | 이용가맹점 | 이용금액 | 할부기간 | 회차 | 원금 | 수수료(이자) | 적용구분 | 결제후잔액 | 적립율
 */
const COL = {
  txnDate: 0,
  cardLabel: 1,
  merchant: 2,
  usageAmount: 3,
  installmentPeriod: 4,
  billingRound: 5,
  principal: 6,
  fee: 7,
  saleType: 8,
} as const;

const norm = (v?: string): string | null => (v ?? '').trim() || null;

/**
 * 신한카드 전용 파서 (SheetJS 폴백으로 읽음).
 * - 금액 = 이번달 납부원금 + 수수료(이자) (이용금액 아님, 할인 반영)
 * - 이용카드("본인253"/"가족160")에서 카드번호·명의 추출 — 본인/가족 혼재 매핑
 * - 취소/원거래는 납부원금 0 → amount 0 으로 자동 상계(집계 제외)
 */
export class ShinhanCardParser implements StatementParser {
  readonly issuer = Issuer.SHINHAN_CARD;

  parse(rows: string[][], ctx: ParseContext): ParseResult {
    // 다음달 예정 명세서는 정식 명세서와 열 순서·이름이 다르다.
    const upcoming = locateHeader(rows, {
      txnDate: ['거래일자'], cardLabel: ['이용카드'], merchant: ['이용가맹점'],
      usageAmount: ['거래금액'], installmentPeriod: ['이용개월'],
      billingRound: ['청구회차'], principal: ['결제금액'],
      fee: ['수수료(이자)'], saleType: ['거래구분'],
    });
    const isUpcoming = upcoming.columns.txnDate !== undefined &&
      upcoming.columns.usageAmount !== undefined && upcoming.columns.principal !== undefined;
    const columns = isUpcoming ? upcoming.columns : COL;
    const statementYm = this.extractYm(rows, ctx);
    const billingDate = this.extractBillingDate(rows, statementYm);
    const total = this.extractTotal(rows);

    // 상세내역 헤더("이용일" + "이용가맹점") 위치
    const h = isUpcoming ? upcoming.headerIndex : rows.findIndex(
      (r) => r.some((c) => c.includes('이용일')) && r.some((c) => c.includes('이용가맹점')),
    );
    const out: NormalizedCardRow[] = [];

    // 이용일이 비어있는 청구 행(연회비 등)은 명세서의 최근 이용일로 귀속 →
    // 결제일(익월)이 아닌 '사용월' 집계에 포함되도록 한다.
    const usageFallbackDate =
      rows
        .slice(h + 1)
        .map((r) => parseDateTime(r?.[columns.txnDate!]))
        .filter((d): d is Date => d != null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    for (let i = h + 1; i < rows.length && h >= 0; i++) {
      const row = rows[i]!;
      const merchantRaw = (row[columns.merchant!] ?? '').trim();
      // 가맹점명 끝의 마스킹된 카드번호 제거: "기본연회비****-****-****-253*" → "기본연회비"
      const merchant = merchantRaw.replace(/\*{3,}.*$/, '').trim();
      if (!merchant || /합계|소계/.test(merchant)) continue;

      const label = norm(row[columns.cardLabel!]); // 본인253 / 가족160
      // 이용카드가 본인/가족(카드) 행만 거래로 인정 → 할인/요약 섹션 제외
      if (!label || !/(본인|가족)/.test(label)) continue;
      const cardNo = label.match(/\d+/)?.[0] ?? null;

      // 일반 거래의 날짜를 읽지 못하면 업로드 전체를 중단한다. 청구월 1일로 대체하지 않는다.
      const rawDate = (row[columns.txnDate!] ?? '').trim();
      const datedAdjustment = !rawDate && /연회비|미리입금|포인트.*납부|할인.*금액/.test(merchant);
      const txnDate = parseDateTime(rawDate) ?? (datedAdjustment ? usageFallbackDate : null);
      if (!txnDate) throw new Error(`신한카드 ${i + 1}행(${merchant})의 이용일 '${rawDate || '빈 값'}'을 읽을 수 없습니다. 거래일을 임의로 대체하지 않았습니다.`);

      const rawUsage = parseAmount(row[columns.usageAmount!]) ?? 0;
      const principal = parseAmount(row[columns.principal!]) ?? 0;
      const fee = parseAmount(row[columns.fee!]) ?? 0;
      // 해외이용: 이용금액 칸이 외화(원금보다 작음) → 원화 원금을 이용금액으로.
      const isOverseas = principal > 0 && rawUsage > 0 && rawUsage < principal;
      const usageAmount = isOverseas ? principal : rawUsage;
      const saleType = norm(row[columns.saleType!]);
      const isCanceled = saleType === '취소' || rawUsage < 0;

      out.push({
        cardLabel: label,
        cardNo,
        txnDate,
        merchantName: merchant,
        usageAmount,
        principal,
        fee,
        // 예정 명세서는 일시불의 개월·회차를 0으로 기록한다.
        installmentPeriod: isUpcoming && Number(row[columns.installmentPeriod!]) <= 1
          ? null : norm(row[columns.installmentPeriod!]),
        billingRound: isUpcoming && Number(row[columns.billingRound!]) <= 0
          ? null : norm(row[columns.billingRound!]),
        benefitType: saleType, // 할인/취소
        benefitAmount: 0, // 신한은 원금에 할인 반영(별도 금액 미제공)
        region: isOverseas ? '해외' : null,
        saleType,
        isCanceled,
        point: 0,
        dedupHash: dedupHash([
          this.issuer,
          txnDate.toISOString(),
          merchant,
          usageAmount,
          principal,
          cardNo,
          norm(row[columns.installmentPeriod!]),
          norm(row[columns.billingRound!]),
        ]),
      });
    }

    return {
      kind: 'card',
      statement: {
        statementYm,
        billingDate,
        totalAmount:
          total ??
          out.reduce((s, r) => s + (r.isCanceled ? 0 : r.principal + r.fee), 0),
        totalCount: out.length,
        rows: out,
      },
    };
  }

  private extractYm(rows: string[][], ctx: ParseContext): string {
    for (const row of rows)
      for (const c of row) {
        const m = c?.match(/(\d{4})년\s*(\d{1,2})월/);
        if (m) return `${m[1]}-${String(+m[2]!).padStart(2, '0')}`;
      }
    return ctx.statementYm ?? '';
  }

  /** 청구월과 같은 달의 YYYY.MM.DD = 결제일. */
  private extractBillingDate(rows: string[][], ym: string): Date | null {
    for (const row of rows)
      for (const c of row) {
        const m = c?.match(/(\d{4})\.(\d{2})\.(\d{2})/);
        if (m && `${m[1]}-${m[2]}` === ym) {
          return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
        }
      }
    return null;
  }

  /** "입금할 금액 … 802748" → 합계. */
  private extractTotal(rows: string[][]): number | null {
    for (const row of rows) {
      if (row.some((c) => c?.includes('입금할 금액'))) {
        const nums = row
          .map((c) => parseAmount(c))
          .filter((n): n is number => n !== null && n > 0);
        if (nums.length) return Math.max(...nums);
      }
    }
    return null;
  }
}
