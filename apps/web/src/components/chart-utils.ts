/** 차트 공통 유틸 — 금액 축 표기, 눈금 반올림, 분류 색상. */

/** 금액 축 라벨용 압축 표기: 30,000,000 → 3,000만, 120,000,000 → 1.2억 */
export function compact(n: number): string {
  if (n === 0) return '0';
  if (n >= 1e8) {
    const v = n / 1e8;
    return `${v % 1 === 0 ? v : v.toFixed(1)}억`;
  }
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString()}만`;
  return n.toLocaleString();
}

/** 축 최대값용 '보기 좋은' 올림 (1/2/2.5/5/10 × 10^n) */
export function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * p;
}

/**
 * 고정 순서 카테고리 색상 — 절대 순환시키지 않는다.
 * 다크 표면(#241f42) 기준 팔레트 검증 통과(명도대역/채도/CVD/대비).
 * 슬롯을 넘어서는 항목은 '기타'로 접어 --c-other(회색)를 쓴다.
 */
export const CAT_COLORS = [
  'var(--c1)',
  'var(--c2)',
  'var(--c3)',
  'var(--c4)',
  'var(--c5)',
  'var(--c6)',
  'var(--c7)',
  'var(--c8)',
];

/** key 가 '__other__' 로 끝나면 회색, 아니면 고정 슬롯 색. */
export function colorOf(key: string, i: number): string {
  return key.endsWith('__other__') ? 'var(--c-other)' : CAT_COLORS[i % CAT_COLORS.length]!;
}

/** 'YYYY-MM' → { year, month } */
export function splitYm(s: string): { year: string; month: number } {
  const [yy, mm] = s.split('-');
  return { year: yy ?? '', month: Number(mm) };
}
