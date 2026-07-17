'use client';

import { useState } from 'react';

export type SortDir = 'asc' | 'desc';
export interface SortItem {
  col: string;
  dir: SortDir;
}

/**
 * 다중 컬럼 정렬 상태.
 * - 헤더 클릭: 단일 정렬(같은 컬럼이면 방향 토글)
 * - Ctrl/⌘+클릭: 선택 순서대로 정렬 컬럼 추가(이미 있으면 방향 토글)
 */
export function useSort(initial: SortItem[] = []) {
  const [sort, setSort] = useState<SortItem[]>(initial);

  const toggle = (col: string, additive: boolean) => {
    setSort((prev) => {
      const idx = prev.findIndex((s) => s.col === col);
      const flip = (d: SortDir): SortDir => (d === 'asc' ? 'desc' : 'asc');
      if (additive) {
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { col, dir: flip(next[idx]!.dir) };
          return next;
        }
        return [...prev, { col, dir: 'asc' }];
      }
      // 단일 정렬
      if (idx >= 0 && prev.length === 1) return [{ col, dir: flip(prev[idx]!.dir) }];
      return [{ col, dir: 'asc' }];
    });
  };

  const param = sort.map((s) => `${s.col}:${s.dir}`).join(',');
  return { sort, toggle, param, reset: () => setSort(initial) };
}

/** 정렬 가능한 테이블 헤더 셀. */
export function SortTh({
  col,
  sort,
  onSort,
  align = 'left',
  children,
}: {
  col: string;
  sort: SortItem[];
  onSort: (col: string, additive: boolean) => void;
  align?: 'left' | 'right' | 'center';
  children: React.ReactNode;
}) {
  const idx = sort.findIndex((s) => s.col === col);
  const active = idx >= 0;
  const dir = active ? sort[idx]!.dir : null;
  const arrow = dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '';
  const order = sort.length > 1 && active ? idx + 1 : null;
  return (
    <th
      onClick={(e) => onSort(col, e.ctrlKey || e.metaKey)}
      title="클릭: 정렬 · Ctrl(⌘)+클릭: 다중 정렬"
      style={{
        textAlign: align,
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
      {active && (
        <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--brand-ink)' }}>
          {arrow}
          {order ?? ''}
        </span>
      )}
    </th>
  );
}
