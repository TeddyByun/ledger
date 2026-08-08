'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const shift = (base: Date, months: number) =>
  ymOf(new Date(base.getFullYear(), base.getMonth() + months, 1));

/**
 * 년월 선택기 — 네이티브 `input[type=month]` 대체.
 *
 * 네이티브 팝업은 스크롤로 월을 굴려야 해서 느리고 테마와도 겉돈다.
 * 이 컨트롤은 **연도 이동 + 12개월 그리드**라 최대 2클릭이면 선택되고,
 * 자주 쓰는 값(+12/+24/+36개월)은 칩 한 번으로 끝난다.
 *
 * 팝오버는 `.tbl-wrap`(overflow:auto) 안에서 잘리지 않도록 **포털 + fixed 배치**로 띄운다.
 */
export function MonthPicker({
  value,
  onChange,
  placeholder = '선택 안 함',
  disabled,
  allowClear = true,
  width = 132,
  quickOffsets = [12, 24, 36],
  highlight,
  title,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  width?: number;
  /** 빠른 선택 칩(개월 수). 빈 배열이면 숨김 */
  quickOffsets?: number[];
  /** 입력이 필요한 상태 강조(경고 테두리) */
  highlight?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number((value ?? ymOf(new Date())).slice(0, 4)));
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const curYm = ymOf(today);
  const selYear = value ? Number(value.slice(0, 4)) : null;
  const selMonth = value ? Number(value.slice(5, 7)) : null;

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const H = 300; // 팝오버 대략 높이
    const W = 268;
    const up = r.bottom + H > window.innerHeight && r.top > H;
    setPos({
      top: up ? Math.max(8, r.top - H - 6) : r.bottom + 6,
      left: Math.min(Math.max(8, r.left), window.innerWidth - W - 8),
      up,
    });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
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

  // 값이 바뀌면(외부 갱신 포함) 표시 연도를 맞춘다
  useEffect(() => {
    if (value) setYear(Number(value.slice(0, 4)));
  }, [value]);

  const pick = (m: number) => {
    onChange(`${year}-${String(m).padStart(2, '0')}`);
    setOpen(false);
  };

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
          padding: '7px 10px',
          textAlign: 'left',
          cursor: disabled ? 'default' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          fontFamily: value ? 'var(--mono)' : undefined,
          fontSize: 12.5,
          color: value ? 'var(--ink)' : 'var(--faint)',
          ...(highlight ? { boxShadow: '0 0 0 2px var(--warn)' } : {}),
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value ?? placeholder}
        </span>
        <span className="muted" style={{ fontSize: 11, flex: 'none' }}>
          ▾
        </span>
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
              width: 268,
              zIndex: 60,
              background: 'var(--surface)',
              borderRadius: 'var(--r)',
              boxShadow: 'var(--shadow-lg)',
              padding: 12,
            }}
          >
            {/* 연도 이동 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => setYear((y) => y - 1)}
                style={{ padding: '4px 10px' }}
                aria-label="이전 해"
              >
                ‹
              </button>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <b style={{ fontSize: 15, fontFamily: 'var(--mono)' }}>{year}</b>
                <span className="muted" style={{ fontSize: 11 }}>
                  년
                </span>
              </div>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => setYear((y) => y + 1)}
                style={{ padding: '4px 10px' }}
                aria-label="다음 해"
              >
                ›
              </button>
            </div>

            {/* 12개월 그리드 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {MONTHS.map((label, i) => {
                const m = i + 1;
                const ym = `${year}-${String(m).padStart(2, '0')}`;
                const isSel = selYear === year && selMonth === m;
                const isNow = ym === curYm;
                const isPast = ym < curYm;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => pick(m)}
                    title={ym}
                    style={{
                      padding: '9px 0',
                      fontSize: 12.5,
                      fontWeight: isSel ? 800 : 600,
                      borderRadius: 10,
                      border: isNow && !isSel ? '1px solid var(--brand-ink)' : '1px solid transparent',
                      cursor: 'pointer',
                      color: isSel ? '#fff' : isPast ? 'var(--faint)' : 'var(--ink-2)',
                      background: isSel ? 'var(--grad)' : 'var(--surface-2)',
                      boxShadow: isSel ? 'var(--glow)' : 'var(--nm-in-sm)',
                      transition: 'transform .08s ease, color .12s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSel) e.currentTarget.style.color = 'var(--ink)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSel) e.currentTarget.style.color = isPast ? 'var(--faint)' : 'var(--ink-2)';
                      e.currentTarget.style.transform = 'none';
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* 빠른 선택 */}
            {quickOffsets.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: '1px solid var(--line)',
                }}
              >
                <button
                  type="button"
                  className="btn ghost sm"
                  style={{ padding: '4px 9px', fontSize: 11.5 }}
                  onClick={() => {
                    onChange(curYm);
                    setOpen(false);
                  }}
                >
                  이번 달
                </button>
                {quickOffsets.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="btn ghost sm"
                    style={{ padding: '4px 9px', fontSize: 11.5 }}
                    title={shift(today, n)}
                    onClick={() => {
                      onChange(shift(today, n));
                      setOpen(false);
                    }}
                  >
                    +{n}개월
                  </button>
                ))}
              </div>
            )}

            {/* 해제 */}
            {allowClear && (
              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
                  {value ? `선택: ${value}` : '선택 없음'}
                </span>
                <button
                  type="button"
                  className="btn ghost sm"
                  style={{ padding: '4px 9px', fontSize: 11.5, color: 'var(--expense)' }}
                  disabled={!value}
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  선택 해제
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
