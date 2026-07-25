'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { won } from '@/lib/format';
import type { View } from '@/components/Shell';

interface Contribution {
  kind: string;
  label: string;
  categoryCode?: string;
  predicted: number;
  occurred: number;
  remaining: number;
  status: string;
  basis: string;
  confidence: 'high' | 'med' | 'low';
}
interface ForecastData {
  ym: string;
  total: number;
  range: { low: number; high: number };
  abc: { A: number; B: number; C: number };
  progress: { day: number; days: number };
  prev: { ym: string; actual: number };
  contributions: Contribution[];
}

const KIND_LABEL: Record<string, string> = {
  R1: '경조사',
  R2: '공과금',
  R3: '할부',
  R4: '정기',
  R6: '연례',
  R7: '대출·적금',
  VAR: '변동',
};
const CONF_LABEL: Record<string, string> = { high: '높음', med: '중', low: '낮음' };

export function Forecast(_props: { onNavigate: (v: View) => void }) {
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ForecastData>('/stats/forecast')
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const abc = data?.abc ?? { A: 0, B: 0, C: 0 };
  const totalAbc = Math.max(1, abc.A + abc.B + abc.C);
  const deltaPct =
    data && data.prev.actual > 0
      ? Math.round(((data.total - data.prev.actual) / data.prev.actual) * 100)
      : null;

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          집계 / <b>예상 지출</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>예상 지출</h1>
            <p>정기지출·할부·공과금·경조사·변동을 규칙으로 합산한 이번 달 예상 총지출입니다.</p>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {loading ? (
          <div className="card">
            <div className="skeleton" style={{ height: 120 }} />
          </div>
        ) : !data ? (
          <div className="card">
            <div className="empty">
              <p>예측할 데이터가 없습니다.</p>
            </div>
          </div>
        ) : (
          <>
            {/* 요약 */}
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {data.ym} 예상 총지출
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--expense)', letterSpacing: '-0.03em' }}>
                  ₩{won(data.total)}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  범위 ₩{won(data.range.low)} ~ ₩{won(data.range.high)}
                </div>
                {deltaPct != null && (
                  <div style={{ fontSize: 13 }}>
                    지난달({data.prev.ym}) 실지출 ₩{won(data.prev.actual)} 대비{' '}
                    <b style={{ color: deltaPct >= 0 ? 'var(--expense)' : 'var(--income)' }}>
                      {deltaPct >= 0 ? '+' : ''}
                      {deltaPct}%
                    </b>
                  </div>
                )}
              </div>

              {/* A/B/C 분해 막대 */}
              <div style={{ marginTop: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    height: 26,
                    borderRadius: 8,
                    overflow: 'hidden',
                    boxShadow: 'var(--nm-in-sm)',
                    background: 'var(--surface-2)',
                  }}
                >
                  {([
                    ['A', abc.A, 'var(--c6)', '이미 지출'],
                    ['B', abc.B, 'var(--c4)', '남은 정기·스케줄'],
                    ['C', abc.C, 'var(--c1)', '예상 변동'],
                  ] as const).map(([k, v, color, title]) => (
                    <div
                      key={k}
                      title={`${title} ₩${won(v)}`}
                      style={{ width: `${(v / totalAbc) * 100}%`, background: color }}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 18, marginTop: 8, flexWrap: 'wrap' }}>
                  {([
                    ['이미 지출', abc.A, 'var(--c6)'],
                    ['남은 정기·스케줄', abc.B, 'var(--c4)'],
                    ['예상 변동', abc.C, 'var(--c1)'],
                  ] as const).map(([t, v, c]) => (
                    <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                      <span style={{ width: 11, height: 11, borderRadius: 3, background: c, display: 'inline-block' }} />
                      <span className="muted">{t}</span>
                      <b className="money">₩{won(v)}</b>
                    </span>
                  ))}
                  <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
                    경과 {data.progress.day}/{data.progress.days}일
                  </span>
                </div>
              </div>
            </div>

            {/* 규칙별 기여 */}
            <div className="card">
              <div className="card-head">
                <h3>규칙별 예측 내역</h3>
                <span className="sub">이미 발생분은 실제값, 미발생분은 예측</span>
              </div>
              <div className="tbl-wrap" style={{ boxShadow: 'none' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>규칙</th>
                      <th>항목</th>
                      <th style={{ textAlign: 'right' }}>예상</th>
                      <th style={{ textAlign: 'right' }}>발생</th>
                      <th style={{ textAlign: 'right' }}>남음</th>
                      <th>근거 · 신뢰</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.contributions.map((c, i) => (
                      <tr key={i}>
                        <td>
                          <span className="pill plain">{KIND_LABEL[c.kind] ?? c.kind}</span>
                        </td>
                        <td>
                          <b>{c.label}</b>
                        </td>
                        <td className="money">₩{won(c.predicted)}</td>
                        <td className="money muted">{c.occurred > 0 ? `₩${won(c.occurred)}` : '—'}</td>
                        <td className="money" style={{ color: c.remaining > 0 ? 'var(--expense)' : 'var(--muted)' }}>
                          {c.remaining > 0 ? `₩${won(c.remaining)}` : '—'}
                        </td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          {c.basis} · {CONF_LABEL[c.confidence] ?? c.confidence}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="callout" style={{ marginTop: 14 }}>
                정기지출·대출/적금 만기는 <b>관리 &gt; 정기지출</b>에서 추천을 확정하거나 직접
                설정하면 예측이 더 정확해집니다.
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
