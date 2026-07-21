'use client';

import { won } from '@/lib/format';
import { compact, niceCeil, colorOf, splitYm } from '@/components/chart-utils';

export interface GroupSeries {
  key: string;
  name: string;
  values: number[]; // months 와 같은 순서/길이
}

/**
 * 월별 그룹 막대차트 — 한 달에 시리즈 수만큼 막대가 나란히 서서 서로 비교된다.
 * (누적이 아니라 병렬 배치라 계좌 간 크기 비교에 적합)
 * X=월, Y=금액. 범례는 차트 아래.
 */
export function GroupedBarChart({
  months,
  series,
  height = 300,
  unitLabel = '지출',
  colors,
}: {
  months: string[];
  series: GroupSeries[];
  height?: number;
  unitLabel?: string;
  /** key→색 맵. 주면 그대로 쓰고(차트 간 색 일치), 없으면 순서대로 배정. */
  colors?: Record<string, string>;
}) {
  const colorFor = (k: string, i: number) => colors?.[k] ?? colorOf(k, i);
  const W = 720;
  const H = height;
  const padL = 60;
  const padR = 14;
  const padT = 12;
  const padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseY = padT + plotH;

  const nM = months.length || 1;
  const nS = Math.max(1, series.length);
  const rawMax = Math.max(1, ...series.flatMap((s) => s.values));
  const step = niceCeil(rawMax / 4);
  const top = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((k) => k * step);

  const groupW = plotW / nM;
  const innerPad = Math.min(8, groupW * 0.12);
  const gap = nS > 1 ? 2 : 0;
  const barW = Math.max(2, (groupW - innerPad * 2 - (nS - 1) * gap) / nS);
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

        {months.map((ym, mi) => {
          const gx = padL + mi * groupW + innerPad;
          const cx = padL + mi * groupW + groupW / 2;
          const { year, month } = splitYm(ym);
          const showYear = month === 1 || mi === 0;
          return (
            <g key={ym}>
              {series.map((s, si) => {
                const v = s.values[mi] ?? 0;
                const x = gx + si * (barW + gap);
                const h = baseY - y(v);
                if (h <= 0) return null;
                return (
                  <rect
                    key={s.key}
                    x={x}
                    y={y(v)}
                    width={barW}
                    height={Math.max(0.5, h)}
                    rx={2}
                    fill={colorFor(s.key, si)}
                  >
                    <title>{`${ym} · ${s.name} · ${unitLabel} ₩${won(v)}`}</title>
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

      {/* 범례 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 12, paddingLeft: 8 }}>
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
                background: colorFor(s.key, si),
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
