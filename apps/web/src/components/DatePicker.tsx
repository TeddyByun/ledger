'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 일(day) 단위 날짜 선택기 — 네이티브 `input[type=date]` 대체.
 * 같은 앱의 {@link MonthPicker}와 테마·배치(포털+fixed)를 맞춰 통일감을 준다.
 * 요일색만 의미색(일=지출빨강·토=수입파랑)을 빌려 쓰고, 선택 강조는 브랜드 그라데이션.
 * 값 형식: 'YYYY-MM-DD'.
 */

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export function DatePicker({
  value,
  onChange,
  placeholder = '날짜 선택',
  disabled,
  allowClear = true,
  width = 150,
  min,
  max,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  width?: number;
  min?: string; // 'YYYY-MM-DD'
  max?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const now = new Date();
  const t = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
  const sel = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? { y: +value.slice(0, 4), m: +value.slice(5, 7) - 1, d: +value.slice(8, 10) }
    : null;

  // 표시 중인 달(연·월)
  const [view, setView] = useState({ y: sel?.y ?? t.y, m: sel?.m ?? t.m });
  useEffect(() => {
    if (open) setView({ y: sel?.y ?? t.y, m: sel?.m ?? t.m });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const H = 340;
    const W = 300;
    const up = r.bottom + H > window.innerHeight && r.top > H;
    setPos({
      top: up ? Math.max(8, r.top - H - 6) : r.bottom + 6,
      left: Math.min(Math.max(8, r.left), window.innerWidth - W - 8),
    });
  }, []);
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const n = e.target as Node;
      if (btnRef.current?.contains(n) || popRef.current?.contains(n)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const shiftMonth = (delta: number) => {
    const d = new Date(view.y, view.m + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };
  const shiftYear = (delta: number) => setView((v) => ({ ...v, y: v.y + delta }));
  const pick = (y: number, m: number, d: number) => {
    onChange(ymd(y, m, d));
    setOpen(false);
  };

  const first = new Date(view.y, view.m, 1);
  const startDow = first.getDay();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const cd = new Date(view.y, view.m, i - startDow + 1);
    return { y: cd.getFullYear(), m: cd.getMonth(), d: cd.getDate(), inMonth: cd.getMonth() === view.m };
  });

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="select"
        disabled={disabled}
        title={title}
        onClick={() => setOpen((o) => !o)}
        style={{
          width,
          padding: '7px 12px',
          textAlign: 'left',
          cursor: disabled ? 'default' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          fontFamily: value ? 'var(--mono)' : undefined,
          fontSize: 12.5,
          color: value ? 'var(--ink)' : 'var(--faint)',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value || placeholder}
        </span>
        <span className="muted" style={{ fontSize: 11, flex: 'none' }}>📅</span>
      </button>

      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popRef}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: 292,
              zIndex: 60,
              background: 'var(--surface)',
              borderRadius: 'var(--r)',
              boxShadow: 'var(--shadow-lg, var(--nm-out))',
              padding: 12,
            }}
          >
            {/* 연/월 이동 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" className="cal-nav" onClick={() => shiftYear(-1)} aria-label="이전 해">«</button>
                <button type="button" className="cal-nav" onClick={() => shiftMonth(-1)} aria-label="이전 달">‹</button>
              </div>
              <b style={{ fontSize: 14, fontFamily: 'var(--mono)' }}>
                {view.y}년 {view.m + 1}월
              </b>
              <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" className="cal-nav" onClick={() => shiftMonth(1)} aria-label="다음 달">›</button>
                <button type="button" className="cal-nav" onClick={() => shiftYear(1)} aria-label="다음 해">»</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
              {WD.map((w, i) => (
                <div
                  key={w}
                  style={{
                    textAlign: 'center',
                    fontSize: 11.5,
                    padding: '4px 0',
                    color: i === 0 ? 'var(--expense)' : i === 6 ? 'var(--income)' : 'var(--muted)',
                  }}
                >
                  {w}
                </div>
              ))}
              {cells.map((c, i) => {
                const col = i % 7;
                const key = ymd(c.y, c.m, c.d);
                const isSel = !!sel && c.y === sel.y && c.m === sel.m && c.d === sel.d;
                const isToday = c.y === t.y && c.m === t.m && c.d === t.d;
                const disabledCell = (!!min && key < min) || (!!max && key > max);
                const color = isSel
                  ? '#fff'
                  : disabledCell || !c.inMonth
                    ? 'var(--faint)'
                    : col === 0
                      ? 'var(--expense)'
                      : col === 6
                        ? 'var(--income)'
                        : 'var(--ink)';
                return (
                  <button
                    type="button"
                    key={i}
                    disabled={disabledCell}
                    className={`cal-cell${isSel ? ' sel' : ''}`}
                    onClick={() => pick(c.y, c.m, c.d)}
                    style={{
                      height: 34,
                      borderRadius: 9,
                      fontSize: 13,
                      color,
                      fontWeight: isSel || isToday ? 800 : 400,
                      background: isSel ? 'var(--grad)' : 'transparent',
                      boxShadow: isSel
                        ? 'var(--glow, none)'
                        : isToday
                          ? 'inset 0 0 0 1.6px var(--brand-ink)'
                          : undefined,
                      cursor: disabledCell ? 'default' : 'pointer',
                      opacity: disabledCell ? 0.4 : 1,
                    }}
                  >
                    {c.d}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
              <button type="button" className="cal-foot" onClick={() => pick(t.y, t.m, t.d)}>
                오늘
              </button>
              {allowClear && (
                <button
                  type="button"
                  className="cal-foot"
                  style={{ color: 'var(--expense)' }}
                  disabled={!value}
                  onClick={() => {
                    onChange('');
                    setOpen(false);
                  }}
                >
                  지우기
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
