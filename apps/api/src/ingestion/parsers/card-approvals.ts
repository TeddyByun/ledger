import { Issuer } from '@ledger/shared';
import { cell, dedupHash, locateHeader } from './generic.js';
import { parseAmount, parseDate, parseDateTime } from './tabular.js';
import type { FieldAliasMap, NormalizedCardRow, ParseContext, ParseResult } from './types.js';

const ALIASES: FieldAliasMap = {
  txnDate: ['승인일자', '이용일'],
  merchantName: ['가맹점명'],
  usageAmount: ['승인금액'],
  cardLabel: ['본인가족구분', '이용카드'],
  cardNo: ['카드번호'],
  approvalNo: ['승인번호'],
  installmentPeriod: ['할부개월', '할부기간'],
  status: ['취소여부', '상태'],
  acquired: ['매입'],
  principal: ['매입금액'],
  benefitAmount: ['매입할인금액'],
  canceledAmount: ['매입취소금액'],
  billingDate: ['결제일'],
};

/** 삼성·하나 승인내역. 청구명세서에는 승인번호 열이 없어 기존 파서로 넘긴다. */
export function parseCardApprovals(rows: string[][], ctx: ParseContext): ParseResult | null {
  const { headerIndex, columns } = locateHeader(rows, ALIASES);
  if (['txnDate', 'merchantName', 'usageAmount', 'cardLabel', 'approvalNo']
    .some((field) => columns[field] === undefined)) return null;

  const isHana = ctx.issuer === Issuer.HANA_CARD;
  const out: NormalizedCardRow[] = [];
  let billingDate: Date | null = null;

  for (const row of rows.slice(headerIndex + 1)) {
    const txnDate = parseDateTime(cell(row, columns, 'txnDate'));
    const merchantName = (cell(row, columns, 'merchantName') ?? '').trim();
    if (!txnDate || !merchantName) continue;

    const rawUsage = parseAmount(cell(row, columns, 'usageAmount'));
    if (rawUsage === null) throw new Error('카드 이용내역의 승인금액을 읽을 수 없습니다.');
    const status = cell(row, columns, 'status') ?? '';
    const canceled = /취소/.test(status);
    // 삼성은 승인과 취소를 각각 표시한다. 취소 금액은 음수로 상계한다.
    const usageAmount = !isHana && canceled ? -Math.abs(rawUsage) : rawUsage;
    const fullyCanceled = isHana && canceled && !/부분/.test(status) && rawUsage >= 0;
    const acquired = cell(row, columns, 'acquired') ?? '';
    const discount = parseAmount(cell(row, columns, 'benefitAmount')) ?? 0;
    let principal = usageAmount;
    if (isHana && acquired === '매입') {
      principal = parseAmount(cell(row, columns, 'principal')) ?? usageAmount;
      const canceledAmount = parseAmount(cell(row, columns, 'canceledAmount')) ?? 0;
      if (canceledAmount > 0 && principal > 0) principal = Math.max(0, principal - canceledAmount);
    }
    // 하나 미매입 행의 매입금액 0은 아직 청구액이 없다는 뜻이므로 승인금액을 사용한다.
    // 상태가 전체 취소인 행은 별도 환불행이 아닌 원승인 상태이므로 지출을 0으로 한다.
    if (fullyCanceled) principal = 0;

    const label = (cell(row, columns, 'cardLabel') ?? '').trim();
    const cardNo = (isHana ? label : cell(row, columns, 'cardNo') ?? '')
      .match(/(\d{3,4})\D*$/)?.[1] ?? null;
    const months = Number(cell(row, columns, 'installmentPeriod'));
    const installmentPeriod = months > 1 ? String(months) : null;
    const due = parseDate(cell(row, columns, 'billingDate'));
    if (due && (!billingDate || due > billingDate)) billingDate = due;

    out.push({
      cardLabel: isHana ? label || null : [label, cardNo].filter(Boolean).join(' ') || null,
      cardNo,
      approvalNo: cell(row, columns, 'approvalNo')?.trim() || null,
      txnDate,
      merchantName,
      usageAmount,
      principal,
      fee: 0,
      installmentPeriod,
      // 승인내역에는 월 청구액·청구회차가 없다. 임의로 분할하지 않는다.
      billingRound: null,
      benefitType: discount > 0 ? '할인' : null,
      benefitAmount: discount,
      region: null,
      saleType: installmentPeriod ? '할부' : '일시불',
      isCanceled: fullyCanceled || (!isHana && canceled) || usageAmount < 0,
      point: 0,
      dedupHash: dedupHash([
        ctx.issuer, 'approval', cardNo, cell(row, columns, 'approvalNo'),
        txnDate.toISOString(), merchantName, usageAmount, principal,
      ]),
    });
  }

  // 결제일이 없는 승인내역은 기존 삼성 파서와 동일하게 최근 사용월의 다음 달로 묶는다.
  const latest = out.reduce<Date | null>((max, row) =>
    !max || row.txnDate > max ? row.txnDate : max, null);
  const inferred = latest
    ? new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth() + 1, 1))
    : null;
  const statementYm = ctx.statementYm ?? (billingDate ?? inferred)?.toISOString().slice(0, 7) ?? '';

  return {
    kind: 'card',
    statement: {
      statementYm,
      billingDate: billingDate ?? (statementYm ? new Date(`${statementYm}-01T00:00:00Z`) : null),
      totalAmount: out.reduce((sum, row) => sum + row.principal + row.fee, 0),
      totalCount: out.length,
      rows: out,
    },
  };
}
