'use client';

import { useEffect, useRef, useState } from 'react';

export interface MSOption {
  value: string;
  label: string;
}

/**
 * 체크박스 드롭다운 멀티셀렉트. .select 스타일 버튼 + 팝오버(체크박스 목록).
 * selected(문자열 id 배열)와 onChange 로 제어. 바깥 클릭 시 닫힘.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  allLabel = '전체',
  minWidth = 180,
}: {
  options: MSOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  allLabel?: string;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label ?? '1개 선택'
        : `${selected.length}개 선택`;

  return (
    <div ref={ref} style={{ position: 'relative', minWidth }}>
      <button
        type="button"
        className="select"
        onClick={() => setOpen((o) => !o)}
        style={{
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: selected.length ? 'var(--ink)' : 'var(--faint)',
          }}
        >
          {summary}
        </span>
        <span className="muted" style={{ fontSize: 10, flex: 'none' }}>
          ▾
        </span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 20,
            background: 'var(--surface)',
            borderRadius: 'var(--r)',
            boxShadow: 'var(--nm-out)',
            padding: 6,
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '4px 8px 6px',
            }}
          >
            <span className="muted" style={{ fontSize: 11 }}>
              {selected.length}개 선택
            </span>
            {selected.length > 0 && (
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => onChange([])}
                style={{ padding: '2px 8px' }}
              >
                전체 해제
              </button>
            )}
          </div>
          {options.length === 0 ? (
            <div className="muted" style={{ fontSize: 12, padding: 8 }}>
              항목이 없습니다.
            </div>
          ) : (
            options.map((o) => (
              <label
                key={o.value}
                className="ms-opt"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 8px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={() => toggle(o.value)}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.label}
                </span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
