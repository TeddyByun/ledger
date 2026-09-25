type MoneyValue = number | string | { toString(): string };

export interface CardAmountRow {
  usageAmount: MoneyValue;
  principal: MoneyValue;
  fee: MoneyValue;
  installmentPeriod?: string | null;
  isCanceled?: 'Y' | 'N' | boolean;
}

/** 카드 목록·합계·내보내기 공통 금액. 원금에는 이미 청구할인이 반영되어 있다. */
export function cardAmounts(row: CardAmountRow) {
  const principal = Number(row.principal);
  const feeAmount = Number(row.fee);
  const installment = Number(row.installmentPeriod?.match(/\d+/)?.[0] ?? 0) > 1;
  // 저장된 할부 이용금액은 이번 회차 원금+이자다. 이자를 별도 표시할 때는 원금만 사용한다.
  const usageAmount = installment ? principal : Number(row.usageAmount);
  const canceled = row.isCanceled === 'Y' || row.isCanceled === true;
  // 취소·환불은 할인이 아니다. 수수료도 할인에서 상계하지 않는다.
  const discountAmount = canceled || usageAmount < 0 || principal < 0
    ? 0 : Math.max(0, usageAmount - principal);
  return { usageAmount, discountAmount, feeAmount, payAmount: principal + feeAmount };
}
