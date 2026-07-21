'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { TrendChart, type TrendMonth, type TrendSeries } from '@/components/TrendChart';
import { StackedBarChart, type StackSeries } from '@/components/StackedBarChart';
import { GroupedBarChart } from '@/components/GroupedBarChart';
import { buildColorMap } from '@/components/chart-utils';
import type { View } from '@/components/Shell';

/** 기본 기간 = 올해 1월 ~ 이번 달 */
function thisYearRange(): { from: string; to: string } {
  const d = new Date();
  const y = d.getFullYear();
  return { from: `${y}-01`, to: `${y}-${String(d.getMonth() + 1).padStart(2, '0')}` };
}

export function Dashboard(_props: { onNavigate: (v: View) => void }) {
  const [trend, setTrend] = useState<TrendMonth[] | null>(null);
  const [trendSeries, setTrendSeries] = useState<TrendSeries[]>([]);
  const [paymentSeries, setPaymentSeries] = useState<StackSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState(thisYearRange);
  const [applied, setApplied] = useState(thisYearRange);

  const load = useCallback(async (f: { from: string; to: string }) => {
    const p = new URLSearchParams();
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
    const d = await api.get<{
      months: TrendMonth[];
      series: TrendSeries[];
      paymentSeries: StackSeries[];
    }>(`/stats/monthly-trend?${p.toString()}`);
    setTrend(d.months);
    setTrendSeries(d.series ?? []);
    setPaymentSeries(d.paymentSeries ?? []);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    load(applied)
      .catch((e) => {
        setTrend(null);
        setError((e as Error).message);
      })
      .finally(() => setLoading(false));
  }, [applied, load]);

  const search = () => setApplied(draft);
  const reset = () => {
    const d = thisYearRange();
    setDraft(d);
    setApplied(d);
  };

  const range =
    trend && trend.length > 0 ? `${trend[0]!.ym} ~ ${trend[trend.length - 1]!.ym}` : '올해';

  // 분류 색을 한 번만 배정해 두 차트(누적/비교)가 같은 분류에 같은 색을 쓰게 한다.
  // '기타'는 회색이고 팔레트 슬롯을 소비하지 않아 8색을 넘겨 순환하지 않는다.
  const catColors = buildColorMap(trendSeries.map((s) => s.key));
  const expenseSeries = trendSeries.filter((s) => s.type === 'expense');

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          집계 / <b>월별 거래 추이</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>월별 거래 추이</h1>
            <p>{range} 수입·지출과 결제수단별 지출 추이입니다. 기본은 올해입니다.</p>
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
        ) : (
          <>
            {/* 1. 월별 수입·지출 (분류별 누적) */}
            <Section
              title="월별 수입·지출 (최근 12개월)"
              sub="월마다 왼쪽=수입, 오른쪽=지출. 각 막대는 분류별로 누적되며 전체 높이가 그 달 총액입니다."
              empty={!trend || trend.every((m) => m.income === 0 && m.expense === 0)}
              emptyMsg="집계할 거래가 없습니다."
            >
              <div className="card">
                {trend && <TrendChart data={trend} series={trendSeries} colors={catColors} />}
              </div>
            </Section>

            {/* 2. 결제수단별 월별 지출 (누적) */}
            <Section
              title="결제수단별 월별 지출 (최근 12개월)"
              sub="월별 총지출을 결제수단(계좌·카드)별로 누적. 막대 전체 높이가 그 달 총지출입니다."
              empty={!trend || paymentSeries.length === 0}
              emptyMsg="집계할 지출이 없습니다."
            >
              <div className="card">
                {trend && (
                  <StackedBarChart
                    months={trend.map((m) => m.ym)}
                    series={paymentSeries}
                    unitLabel="지출"
                  />
                )}
              </div>
            </Section>

            {/* 3. 대분류별 월별 지출 비교 (그룹 막대) */}
            <Section
              title="대분류별 월별 지출 비교"
              sub="월마다 대분류 막대가 나란히 표시되어 분류 간 지출 규모를 비교할 수 있습니다."
              empty={!trend || expenseSeries.length === 0}
              emptyMsg="집계할 지출이 없습니다."
            >
              <div className="card">
                {trend && (
                  <GroupedBarChart
                    months={trend.map((m) => m.ym)}
                    series={expenseSeries.map((s) => ({
                      key: s.key,
                      name: s.name,
                      values: s.values,
                    }))}
                    colors={catColors}
                    unitLabel="지출"
                  />
                )}
              </div>
            </Section>
          </>
        )}
      </main>
    </>
  );
}

function Section({
  title,
  sub,
  empty,
  emptyMsg,
  children,
}: {
  title: string;
  sub: string;
  empty: boolean;
  emptyMsg: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ marginBottom: 10 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>{title}</h2>
        <div className="muted" style={{ fontSize: 12 }}>
          {sub}
        </div>
      </div>
      {empty ? (
        <div className="card">
          <div className="empty">
            <p>{emptyMsg}</p>
          </div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
