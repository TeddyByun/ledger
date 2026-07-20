'use client';

import { won } from '@/lib/format';

export interface BarSeries {
  label: string;
  color: string; // CSS color (var(--income) 등)
  values: number[]; // 길이 12 (1~12월)
}

/**
 * 월별(1~12) 막대 차트 — 소형 다중용. 1~2개 시리즈(그룹 막대).
 * - 얇은 막대 + 둥근 상단, 2px 간격, 하단 기준선, 월 눈금
 * - 각 막대에 hover 툴팁(<title>): "N월 · 라벨 ₩금액"
 * - 색은 CSS 변수(테마 대응). 색만으로 구분하지 않도록 그룹 위치 + 범례 병행.
 */
export function MonthlyBars({
  series,
  height = 108,
  months,
}: {
  series: BarSeries[];
  height?: number;
  /** 롤링 기간용 'YYYY-MM' 배열. 없으면 1~12월(달력 연도)로 표기. */
  months?: string[];
}) {
  const W = 300;
  const H = height;
  const padT = 8;
  const padB = 16;
  const chartH = H - padT - padB;
  const baseY = H - padB;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const groupW = W / 12;
  const n = series.length;
  const gap = 2;
  const innerPad = 4;
  const barW = Math.max(2.5, (groupW - innerPad * 2 - (n - 1) * gap) / n);
  const h = (v: number) => (chartH * v) / max;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }}>
      {/* 기준선 */}
      <line x1={0} y1={baseY} x2={W} y2={baseY} stroke="var(--line)" strokeWidth={1} />
      {Array.from({ length: 12 }, (_, mi) => {
        const gx = mi * groupW + innerPad;
        return series.map((s, si) => {
          const v = s.values[mi] ?? 0;
          const bh = h(v);
          const x = gx + si * (barW + gap);
          return (
            <rect
              key={`${si}-${mi}`}
              x={x}
              y={baseY - bh}
              width={barW}
              height={Math.max(0, bh)}
              rx={2}
              fill={s.color}
            >
              <title>{`${months?.[mi] ?? `${mi + 1}월`} · ${s.label} ₩${won(v)}`}</title>
            </rect>
          );
        });
      })}
      {Array.from({ length: 12 }, (_, mi) => (
        <text
          key={`t${mi}`}
          x={mi * groupW + groupW / 2}
          y={H - 4}
          fontSize={8}
          textAnchor="middle"
          fill="var(--muted)"
        >
          {months?.[mi] ? Number(months[mi]!.split('-')[1]) : mi + 1}
        </text>
      ))}
    </svg>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      {items.map((i) => (
        <span key={i.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span
            style={{ width: 10, height: 10, borderRadius: 3, background: i.color, display: 'inline-block' }}
          />
          <span className="muted">{i.label}</span>
        </span>
      ))}
    </div>
  );
}
