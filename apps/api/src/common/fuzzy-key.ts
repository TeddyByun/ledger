/** 내용 정규화 — 공백 제거(대소문자 유지). 반복 항목 매칭 키. */
export function normKey(s: string | null | undefined): string {
  return (s ?? '').replace(/\s/g, '');
}

/**
 * 느슨한 매칭 키 — 끝의 숫자(월/식별번호)를 떼어 반복 항목을 그룹화.
 * 예: METLIFE06193 / METLIFE05192 → METLIFE
 * (정기지출 탐지·이번 달 발생 매칭에 공용)
 */
export function fuzzyKey(s: string | null | undefined): string {
  return normKey(s).replace(/\d+$/, '');
}

/**
 * 정기지출 그룹화·매칭 전용 키 — 모든 숫자(가운데 월/식별번호 포함)와 기호를 제거하고
 * 문자만 남긴다. 예: 메리츠06-212 / 메리츠05-192 → "메리츠", 카카오페이((..)) → "카카오페이..".
 * 숫자만인 내용(예: 계좌번호 5459...)은 문자가 없어 비므로 fuzzyKey(끝숫자만 제거)로 폴백.
 * ⚠ 추천·recurring_expense.match_key·forecast 매칭에서 동일하게 사용해야 매칭이 일치한다.
 */
export function recurringKey(s: string | null | undefined): string {
  const letters = normKey(s)
    .replace(/[0-9]+/g, '')
    .replace(/[^\p{L}]/gu, '');
  return letters || fuzzyKey(s);
}
