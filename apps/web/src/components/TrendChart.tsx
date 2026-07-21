'use client';

import { won } from '@/lib/format';
import { compact, niceCeil, colorOf as colorForKey, splitYm } from '@/components/chart-utils';

export interface TrendMonth {
  ym: string; // 'YYYY-MM'
  income: number;
  expense: number;
}
export interface TrendSeries {
  key: string;
  name: string;
  type: 'income' | 'expense';
  values: number[]; // 월 순서
}



/**
 * 최근 N개월 월별 수입·지출 누적 막대차트.
 * X=월, Y=금액. 월마다 막대 2개(수입/지출)이고 각 막대는 대분류별로 누적된다.
 * 세그먼트 사이 2px 표면색 간격, hover 툴팁, 범례는 차트 아래.
 */
export function TrendChart({
  data,
  series,
  height = 320,
  colors,
}: {
  data: TrendMonth[];
  series: TrendSeries[];
  height?: number;
  /** key→색 맵. 주면 그대로 쓰고(차트 간 색 일치), 없으면 순서대로 배정. */
  colors?: Record<string, string>;
}) {
  const colorOf = (s: TrendSeries, i: number) => colors?.[s.key] ?? colorForKey(s.key, i);
  const W = 720;
  const H = height;
  const padL = 60;
  const padR = 14;
  const padT = 12;
  const padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseY = padT + plotH;

  const rawMax = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]));
  const step = niceCeil(rawMax / 4);
  const top = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((k) => k * step);

  const n = data.length || 1;
  const groupW = plotW / n;
  const innerPad = groupW * 0.16;
  const gap = 3;
  const barW = Math.max(3, (groupW - innerPad * 2 - gap) / 2);
  const y = (v: number) => baseY - (plotH * v) / top;
  const ymOf = splitYm;

  // 색 인덱스는 유형별로 0부터 — 수입/지출이 서로 다른 색을 갖도록 전체 순서로 부여
  const colorIdx = new Map<string, number>();
  series.forEach((s, i) => colorIdx.set(s.key, i));

  const incomeSeries = series.filter((s) => s.type === 'income');
  const expenseSeries = series.filter((s) => s.type === 'expense');

  /** 한 막대(누적) 렌더 — 아래에서 위로 쌓는다. */
  const stack = (list: TrendSeries[], mi: number, x: number, label: string) => {
    let acc = 0;
    const out: React.ReactNode[] = [];
    list.forEach((s) => {
      const v = s.values[mi] ?? 0;
      if (v <= 0) return;
      const y0 = y(acc);
      const y1 = y(acc + v);
      const h = Math.max(0, y0 - y1);
      acc += v;
      if (h <= 0) return;
      out.push(
        <rect
          key={`${s.key}-${mi}`}
          x={x}
          y={y1}
          width={barW}
          height={Math.max(0.5, h - 2)} /* 2px 표면색 간격 */
          rx={2}
          fill={colorOf(s, colorIdx.get(s.key) ?? 0)}
        >
          <title>{`${data[mi]?.ym ?? ''} · ${label} · ${s.name} ₩${won(v)}`}</title>
        </rect>,
      );
    });
    return out;
  };

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }}>
        {/* Y 격자선 + 라벨 */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={padL - 8} y={y(t) + 3.5} fontSize={10} textAnchor="end" fill="var(--muted)">
              {compact(t)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const gx = padL + i * groupW + innerPad;
          const { year, month } = ymOf(d.ym);
          const showYear = month === 1 || i === 0;
          return (
            <g key={d.ym}>
              {stack(incomeSeries, i, gx, '수입')}
              {stack(expenseSeries, i, gx + barW + gap, '지출')}
              <text
                x={gx + barW + gap / 2}
                y={baseY + 15}
                fontSize={10}
                textAnchor="middle"
                fill="var(--ink-2)"
              >
                {month}
              </text>
              {showYear && (
                <text
                  x={gx + barW + gap / 2}
                  y={baseY + 30}
                  fontSize={9.5}
                  textAnchor="middle"
                  fill="var(--muted)"
                >
                  {year}
                </text>
              )}
            </g>
          );
        })}

        <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="var(--line-2)" strokeWidth={1} />
      </svg>

      {/* 데이터 레이블(범례) — 차트 아래. 좌: 수입 / 우: 지출 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 12, paddingLeft: 8 }}>
        {(['income', 'expense'] as const).map((t) => {
          const list = t === 'income' ? incomeSeries : expenseSeries;
          if (list.length === 0) return null;
          return (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <b
                style={{
                  fontSize: 11.5,
                  color: t === 'income' ? 'var(--income)' : 'var(--expense)',
                  whiteSpace: 'nowrap',
                }}
              >
                {t === 'income' ? '수입' : '지출'}
              </b>
              {list.map((s) => (
                <span
                  key={s.key}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
                >
                  <span
                    style={{
                      width: 11,
                      height: 11,
                      borderRadius: 3,
                      background: colorOf(s, colorIdx.get(s.key) ?? 0),
                      display: 'inline-block',
                    }}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>
                    {s.name}
                  </span>
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
