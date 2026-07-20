'use client';

import { won } from '@/lib/format';
import { compact, niceCeil, colorOf, splitYm } from '@/components/chart-utils';

export interface StackSeries {
  key: string;
  name: string;
  values: number[]; // months 와 같은 순서/길이
}

/**
 * 월별 단일 누적 막대차트. X=월, Y=금액.
 * 한 달에 막대 하나이고, 막대는 series 순서대로 아래에서 위로 쌓인다.
 * 세그먼트 사이 2px 표면 간격 · hover 툴팁 · 범례는 차트 아래(데이터 레이블).
 */
export function StackedBarChart({
  months,
  series,
  height = 300,
  unitLabel = '지출',
}: {
  months: string[];
  series: StackSeries[];
  height?: number;
  unitLabel?: string;
}) {
  const W = 720;
  const H = height;
  const padL = 60;
  const padR = 14;
  const padT = 12;
  const padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseY = padT + plotH;

  const n = months.length || 1;
  const totals = months.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const rawMax = Math.max(1, ...totals);
  const step = niceCeil(rawMax / 4);
  const top = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((k) => k * step);

  const groupW = plotW / n;
  const barW = Math.max(4, groupW * 0.52);
  const y = (v: number) => baseY - (plotH * v) / top;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }}>
        {/* Y 격자선 + 금액 라벨 */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={padL - 8} y={y(t) + 3.5} fontSize={10} textAnchor="end" fill="var(--muted)">
              {compact(t)}
            </text>
          </g>
        ))}

        {months.map((ym, i) => {
          const cx = padL + i * groupW + groupW / 2;
          const x = cx - barW / 2;
          const { year, month } = splitYm(ym);
          const showYear = month === 1 || i === 0;
          let acc = 0;
          return (
            <g key={ym}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                if (v <= 0) return null;
                const y0 = y(acc);
                const y1 = y(acc + v);
                const h = y0 - y1;
                acc += v;
                if (h <= 0) return null;
                return (
                  <rect
                    key={s.key}
                    x={x}
                    y={y1}
                    width={barW}
                    height={Math.max(0.5, h - 2)} /* 2px 표면색 간격 */
                    rx={2}
                    fill={colorOf(s.key, si)}
                  >
                    <title>{`${ym} · ${unitLabel} · ${s.name} ₩${won(v)}`}</title>
                  </rect>
                );
              })}
              <text x={cx} y={baseY + 15} fontSize={10} textAnchor="middle" fill="var(--ink-2)">
                {month}
              </text>
              {showYear && (
                <text x={cx} y={baseY + 30} fontSize={9.5} textAnchor="middle" fill="var(--muted)">
                  {year}
                </text>
              )}
            </g>
          );
        })}

        <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="var(--line-2)" strokeWidth={1} />
      </svg>

      {/* 데이터 레이블(범례) — 차트 아래 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 14,
          marginTop: 12,
          paddingLeft: 8,
        }}
      >
        {series.map((s, si) => (
          <span
            key={s.key}
            style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
          >
            <span
              style={{
                width: 11,
                height: 11,
                borderRadius: 3,
                background: colorOf(s.key, si),
                display: 'inline-block',
              }}
            />
            <span className="muted" style={{ fontSize: 12 }}>
              {s.name}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
