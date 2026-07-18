'use client';

import { won } from '@/lib/format';

export interface TrendMonth {
  ym: string; // 'YYYY-MM'
  income: number;
  expense: number;
}

/** 금액 축 라벨용 압축 표기: 30,000,000 → 3,000만, 120,000,000 → 1.2억 */
function compact(n: number): string {
  if (n === 0) return '0';
  if (n >= 1e8) {
    const v = n / 1e8;
    return `${v % 1 === 0 ? v : v.toFixed(1)}억`;
  }
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString()}만`;
  return n.toLocaleString();
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * p;
}

/**
 * 최근 N개월 월별 수입·지출 그룹 막대차트.
 * X=월, Y=금액. 수입=파랑, 지출=빨강(의미색). Y축 격자선·라벨, 연 경계 표시, hover 툴팁.
 */
export function TrendChart({ data, height = 300 }: { data: TrendMonth[]; height?: number }) {
  const W = 720;
  const H = height;
  const padL = 60;
  const padR = 14;
  const padT = 12;
  const padB = 40;
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
  const ym = (s: string) => {
    const [yy, mm] = s.split('-');
    return { year: yy ?? '', month: Number(mm) };
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }}>
      {/* Y 격자선 + 라벨 */}
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={padL}
            y1={y(t)}
            x2={W - padR}
            y2={y(t)}
            stroke="var(--line)"
            strokeWidth={1}
          />
          <text x={padL - 8} y={y(t) + 3.5} fontSize={10} textAnchor="end" fill="var(--muted)">
            {compact(t)}
          </text>
        </g>
      ))}

      {/* 막대 */}
      {data.map((d, i) => {
        const gx = padL + i * groupW + innerPad;
        const { year, month } = ym(d.ym);
        const showYear = month === 1 || i === 0;
        return (
          <g key={d.ym}>
            <rect
              x={gx}
              y={y(d.income)}
              width={barW}
              height={Math.max(0, baseY - y(d.income))}
              rx={2}
              fill="var(--income)"
            >
              <title>{`${d.ym} · 수입 ₩${won(d.income)}`}</title>
            </rect>
            <rect
              x={gx + barW + gap}
              y={y(d.expense)}
              width={barW}
              height={Math.max(0, baseY - y(d.expense))}
              rx={2}
              fill="var(--expense)"
            >
              <title>{`${d.ym} · 지출 ₩${won(d.expense)}`}</title>
            </rect>
            {/* X 라벨: 월 */}
            <text
              x={gx + barW + gap / 2}
              y={baseY + 15}
              fontSize={10}
              textAnchor="middle"
              fill="var(--ink-2)"
            >
              {month}
            </text>
            {/* 연 경계 표시 */}
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

      {/* 기준선 */}
      <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="var(--line-2)" strokeWidth={1} />
    </svg>
  );
}
