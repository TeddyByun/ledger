'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { won } from '@/lib/format';
import { MonthlyBars, Legend, type BarSeries } from '@/components/MonthlyBars';
import { TrendChart, type TrendMonth, type TrendSeries } from '@/components/TrendChart';
import { StackedBarChart, type StackSeries } from '@/components/StackedBarChart';
import type { View } from '@/components/Shell';

interface BankRow {
  id: number;
  name: string;
  income: number[];
  expense: number[];
  total: number;
}
interface CardRow {
  id: number;
  name: string;
  expense: number[];
  total: number;
}
interface CatRow {
  code: string;
  name: string;
  expense: number[];
  total: number;
}
interface DashboardData {
  year: number;
  bank: BankRow[];
  card: CardRow[];
  category: CatRow[];
}

const GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  gap: 14,
};

export function Dashboard(_props: { onNavigate: (v: View) => void }) {
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(nowYear);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [trend, setTrend] = useState<TrendMonth[] | null>(null);
  const [trendSeries, setTrendSeries] = useState<TrendSeries[]>([]);
  const [paymentSeries, setPaymentSeries] = useState<StackSeries[]>([]);

  useEffect(() => {
    setLoading(true);
    api
      .get<DashboardData>(`/stats/dashboard?year=${year}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [year]);

  // 최근 12개월 추이는 연도 선택과 무관 — 최초 1회만 로드
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
      .catch(() => setTrend(null));
  }, []);

  const banks = data?.bank ?? [];
  const cards = data?.card ?? [];
  const cats = data?.category ?? [];

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          집계 / <b>대시보드</b>
        </span>
        <div className="spacer" />
        <select
          className="select"
          style={{ width: 'auto' }}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {[nowYear, nowYear - 1, nowYear - 2].map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>대시보드</h1>
            <p>{year}년 계좌·카드·분류별 월별 추이입니다.</p>
          </div>
        </div>

        {/* 0. 최근 12개월 월별 수입·지출 (롤링) */}
        <Section
          title="월별 수입·지출 (최근 12개월)"
          sub="월마다 왼쪽=수입, 오른쪽=지출. 각 막대는 분류별로 누적되며 전체 높이가 그 달 총액입니다."
          empty={!trend || trend.every((m) => m.income === 0 && m.expense === 0)}
          emptyMsg={trend ? '집계할 거래가 없습니다.' : '불러오는 중…'}
        >
          <div className="card">
            {trend && <TrendChart data={trend} series={trendSeries} />}
          </div>
        </Section>

        {loading ? (
          <div className="card">
            <div className="skeleton" style={{ height: 120 }} />
          </div>
        ) : (
          <>
            {/* 1. 계좌별 월별 수입·지출 */}
            <Section
              title="계좌별 월별 수입·지출"
              sub="각 은행 계좌의 올해 월별 수입과 지출"
              legend={[
                { label: '수입', color: 'var(--income)' },
                { label: '지출', color: 'var(--expense)' },
              ]}
              empty={banks.length === 0}
              emptyMsg="은행 거래가 없습니다. 은행 명세서를 업로드하세요."
            >
              <div style={GRID}>
                {banks.map((b) => (
                  <ChartCard
                    key={b.id}
                    title={b.name}
                    stat={
                      <>
                        <span style={{ color: 'var(--income)' }}>+₩{won(sum(b.income))}</span>{' '}
                        <span style={{ color: 'var(--expense)' }}>−₩{won(sum(b.expense))}</span>
                      </>
                    }
                    series={[
                      { label: '수입', color: 'var(--income)', values: b.income },
                      { label: '지출', color: 'var(--expense)', values: b.expense },
                    ]}
                  />
                ))}
              </div>
            </Section>

            {/* 2. 카드별 월별 지출 */}
            <Section
              title="카드별 월별 지출"
              sub="각 카드의 올해 월별 지출(결제금액)"
              empty={cards.length === 0}
              emptyMsg="카드 거래가 없습니다. 카드 명세서를 업로드하세요."
            >
              <div style={GRID}>
                {cards.map((c) => (
                  <ChartCard
                    key={c.id}
                    title={c.name}
                    stat={<span style={{ color: 'var(--expense)' }}>−₩{won(c.total)}</span>}
                    series={[{ label: '지출', color: 'var(--expense)', values: c.expense }]}
                  />
                ))}
              </div>
            </Section>

            {/* 3. 분류별 월별 지출 */}
            <Section
              title="분류별 월별 지출"
              sub="대분류별 올해 월별 지출"
              empty={cats.length === 0}
              emptyMsg="분류된 지출이 없습니다."
            >
              <div style={GRID}>
                {cats.map((c) => (
                  <ChartCard
                    key={c.code}
                    title={c.name}
                    stat={<span style={{ color: 'var(--expense)' }}>−₩{won(c.total)}</span>}
                    series={[{ label: '지출', color: 'var(--brand)', values: c.expense }]}
                  />
                ))}
              </div>
            </Section>
          </>
        )}

        {/* 4. 결제수단별 월별 지출 (최근 12개월, 누적) */}
        <Section
          title="결제수단별 월별 지출 (최근 12개월)"
          sub="월별 총지출을 결제수단(계좌·카드)별로 누적. 막대 전체 높이가 그 달 총지출입니다."
          empty={!trend || paymentSeries.length === 0}
          emptyMsg={trend ? '집계할 지출이 없습니다.' : '불러오는 중…'}
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
      </main>
    </>
  );
}

function Section({
  title,
  sub,
  legend,
  empty,
  emptyMsg,
  children,
}: {
  title: string;
  sub: string;
  legend?: { label: string; color: string }[];
  empty: boolean;
  emptyMsg: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 10,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ fontSize: 16, margin: 0 }}>{title}</h2>
          <div className="muted" style={{ fontSize: 12 }}>
            {sub}
          </div>
        </div>
        {legend && <Legend items={legend} />}
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

function ChartCard({
  title,
  stat,
  series,
}: {
  title: string;
  stat: React.ReactNode;
  series: BarSeries[];
}) {
  return (
    <div className="card" style={{ padding: 14 }}>
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
          {title}
        </b>
        <span className="money" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {stat}
        </span>
      </div>
      <MonthlyBars series={series} />
    </div>
  );
}

function sum(a: number[]): number {
  return a.reduce((x, y) => x + y, 0);
}
