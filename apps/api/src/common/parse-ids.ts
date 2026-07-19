/**
 * 결제수단 등 ID 필터 파싱. 콤마구분 문자열(다중) 우선, 없으면 단일값 사용.
 * 예: parseIdList('1,2,3') → [1,2,3] · parseIdList(undefined, 5) → [5]
 */
export function parseIdList(csv?: string, single?: number): number[] {
  const out: number[] = [];
  if (csv) {
    for (const part of csv.split(',')) {
      const n = Number(part.trim());
      if (Number.isInteger(n) && n > 0) out.push(n);
    }
  } else if (single && single > 0) {
    out.push(single);
  }
  return out;
}
