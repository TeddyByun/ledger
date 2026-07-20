'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { won } from '@/lib/format';
import { MonthlyBars } from '@/components/MonthlyBars';
import { GroupedBarChart } from '@/components/GroupedBarChart';

interface PmRow {
  id: number;
  name: string;
  methodType: 'bank' | 'card' | string;
  values: number[];
  total: number;
}
interface PaymentTrendData {
  months: string[]; // 'YYYY-MM'
  items: PmRow[];
}

const GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: 14,
};

/** 기본 기간 = 올해 1월 ~ 이번 달 */
function thisYearRange(): { from: string; to: string } {
  const d = new Date();
  const y = d.getFullYear();
  return { from: `${y}-01`, to: `${y}-${String(d.getMonth() + 1).padStart(2, '0')}` };
}

export function PaymentTrend() {
  const [data, setData] = useState<PaymentTrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState(thisYearRange);
  const [applied, setApplied] = useState(thisYearRange);

  const load = useCallback(async (f: { from: string; to: string }) => {
    const p = new URLSearchParams();
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
    const res = await api.get<PaymentTrendData>(`/stats/payment-trend?${p.toString()}`);
    setData(res);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    load(applied)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [applied, load]);

  const months = data?.months ?? [];
  const items = data?.items ?? [];
  const banks = items.filter((i) => i.methodType === 'bank');
  const cards = items.filter((i) => i.methodType === 'card');

  const search = () => setApplied(draft);
  const reset = () => {
    const d = thisYearRange();
    setDraft(d);
    setApplied(d);
  };

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          집계 / <b>월별 결제수단별 지출 추이</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>월별 결제수단별 지출 추이</h1>
            <p>결제수단(계좌·카드)별 월별 지출입니다. 기본은 올해입니다.</p>
          </div>
        </div>

        {/* 기간 선택 */}
        <div className="card" style={{ marginBottom: 16 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
          >
            <div className="field">
              <label>기간 (년월)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  className="input"
                  type="month"
                  value={draft.from}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                />
                <span className="muted">~</span>
                <input
                  className="input"
                  type="month"
                  value={draft.to}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" type="submit">
                검색
              </button>
              <button className="btn ghost" type="button" onClick={reset}>
                올해로 초기화
              </button>
            </div>
          </form>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {loading ? (
          <div className="card">
            <div className="skeleton" style={{ height: 120 }} />
          </div>
        ) : items.length === 0 ? (
          <div className="card">
            <div className="empty">
              <h3>집계할 지출이 없습니다</h3>
              <p>기간을 바꾸거나, 명세서를 업로드하고 분류해 보세요.</p>
            </div>
          </div>
        ) : (
          <>
            {/* 계좌 — 하나의 그래프에서 월별 계좌 비교 */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ marginBottom: 10 }}>
                <h2 style={{ fontSize: 16, margin: 0 }}>계좌</h2>
                <div className="muted" style={{ fontSize: 12 }}>
                  월마다 계좌별 막대가 나란히 표시됩니다(출금 기준).
                </div>
              </div>
              {banks.length === 0 ? (
                <div className="card">
                  <div className="empty">
                    <p>계좌 지출이 없습니다.</p>
                  </div>
                </div>
              ) : (
                <div className="card">
                  <GroupedBarChart
                    months={months}
                    series={banks.map((b) => ({
                      key: `pm-${b.id}`,
                      name: b.name,
                      values: b.values,
                    }))}
                    unitLabel="지출"
                  />
                </div>
              )}
            </div>

            {/* 카드 — 카드별 개별 차트 */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ marginBottom: 10 }}>
                <h2 style={{ fontSize: 16, margin: 0 }}>카드</h2>
                <div className="muted" style={{ fontSize: 12 }}>
                  카드별 월별 지출(결제금액)
                </div>
              </div>
              {cards.length === 0 ? (
                <div className="card">
                  <div className="empty">
                    <p>카드 지출이 없습니다.</p>
                  </div>
                </div>
              ) : (
                <div style={GRID}>
                  {cards.map((p) => (
                    <div key={p.id} className="card" style={{ padding: 14 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                          gap: 8,
                          marginBottom: 6,
                        }}
                      >
                        <b
                          style={{
                            fontSize: 13.5,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {p.name}
                        </b>
                        <span
                          className="money"
                          style={{ fontSize: 12, whiteSpace: 'nowrap', color: 'var(--expense)' }}
                        >
                          −₩{won(p.total)}
                        </span>
                      </div>
                      <MonthlyBars
                        months={months}
                        series={[{ label: '지출', color: 'var(--expense)', values: p.values }]}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}
