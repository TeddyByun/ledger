import { createHash } from 'node:crypto';
import type { FieldAliasMap } from './types.js';

export type ColumnMap = Record<string, number>;

/**
 * 표 rows 에서 헤더 행을 찾고(별칭을 가장 많이 포함하는 행), 필드→컬럼 인덱스 맵을 만든다.
 * @returns { headerIndex, columns } — 헤더를 못 찾으면 headerIndex = -1
 */
export function locateHeader(
  rows: string[][],
  aliases: FieldAliasMap,
): { headerIndex: number; columns: ColumnMap } {
  const fields = Object.keys(aliases);
  let best = { headerIndex: -1, columns: {} as ColumnMap, score: 0 };

  rows.forEach((row, idx) => {
    const columns: ColumnMap = {};
    let score = 0;
    for (const field of fields) {
      const col = row.findIndex((cell) =>
        aliases[field]!.some((a) => cell.replace(/\s/g, '').includes(a.replace(/\s/g, ''))),
      );
      if (col >= 0 && columns[field] === undefined) {
        columns[field] = col;
        score++;
      }
    }
    if (score > best.score) best = { headerIndex: idx, columns, score };
  });

  return { headerIndex: best.headerIndex, columns: best.columns };
}

/** 컬럼 맵에서 셀 값을 안전하게 뽑는다. */
export function cell(row: string[], columns: ColumnMap, field: string): string | undefined {
  const idx = columns[field];
  if (idx === undefined) return undefined;
  return row[idx];
}

/** 안정적인 dedup 해시 — 동일 명세/거래 재업로드 시 중복 차단. */
export function dedupHash(parts: Array<string | number | null | undefined>): string {
  return createHash('sha1').update(parts.map((p) => p ?? '').join('|')).digest('hex');
}
