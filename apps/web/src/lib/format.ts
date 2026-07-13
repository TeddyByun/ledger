/** 원화 숫자 포맷 (₩ 기호는 마크업에서 별도 표기) */
export function won(n: number): string {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n));
}

/** 통화 전체 표기 — ₩6,700,225 */
export function krw(n: number): string {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(n);
}
