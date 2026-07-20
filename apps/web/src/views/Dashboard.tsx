'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { TrendChart, type TrendMonth, type TrendSeries } from '@/components/TrendChart';
import { StackedBarChart, type StackSeries } from '@/components/StackedBarChart';
import type { View } from '@/components/Shell';

export function Dashboard(_props: { onNavigate: (v: View) => void }) {
  const [trend, setTrend] = useState<TrendMonth[] | null>(null);
  const [trendSeries, setTrendSeries] = useState<TrendSeries[]>([]);
  const [paymentSeries, setPaymentSeries] = useState<StackSeries[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ months: TrendMonth[]; series: TrendSeries[]; paymentSeries: StackSeries[] }>(
        '/stats/monthly-trend?months=12',
      )
      .then((d) => {
        setTrend(d.months);
        setTrendSeries(d.series ?? []);
        setPaymentSeries(d.paymentSeries ?? []);
      })
      .catch(() => setTrend(null))
      .finally(() => setLoading(false));
  }, []);

  const range =
    trend && trend.length > 0 ? `${trend[0]!.ym} ~ ${trend[trend.length - 1]!.ym}` : '최근 12개월';

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
            <p>최근 12개월({range}) 수입·지출과 결제수단별 지출 추이입니다.</p>
          </div>
        </div>

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
                {trend && <TrendChart data={trend} series={trendSeries} />}
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
