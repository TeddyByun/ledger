'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { won } from '@/lib/format';
import { MonthlyBars } from '@/components/MonthlyBars';

interface PmRow {
  id: number;
  name: string;
  methodType: 'bank' | 'card' | string;
  values: number[];
  total: number;
}
interface PaymentTrendData {
  months: string[]; // 'YYYY-MM' × 12
  items: PmRow[];
}

const GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: 14,
};

export function PaymentTrend() {
  const [data, setData] = useState<PaymentTrendData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<PaymentTrendData>('/stats/payment-trend?months=12')
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const months = data?.months ?? [];
  const items = data?.items ?? [];
  const banks = items.filter((i) => i.methodType === 'bank');
  const cards = items.filter((i) => i.methodType === 'card');
  const range =
    months.length > 0 ? `${months[0]} ~ ${months[months.length - 1]}` : '최근 12개월';

  const section = (title: string, sub: string, list: PmRow[], emptyMsg: string) => (
    <div style={{ marginBottom: 22 }}>
      <div style={{ marginBottom: 10 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>{title}</h2>
        <div className="muted" style={{ fontSize: 12 }}>
          {sub}
        </div>
      </div>
      {list.length === 0 ? (
        <div className="card">
          <div className="empty">
            <p>{emptyMsg}</p>
          </div>
        </div>
      ) : (
        <div style={GRID}>
          {list.map((p) => (
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
  );

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
            <p>결제수단(계좌·카드)마다 최근 12개월({range}) 월별 지출입니다.</p>
          </div>
        </div>

        {loading ? (
          <div className="card">
            <div className="skeleton" style={{ height: 120 }} />
          </div>
        ) : items.length === 0 ? (
          <div className="card">
            <div className="empty">
              <h3>집계할 지출이 없습니다</h3>
              <p>명세서를 업로드하고 분류하면 결제수단별 추이가 표시됩니다.</p>
            </div>
          </div>
        ) : (
          <>
            {section('계좌', '은행 계좌별 월별 지출(출금)', banks, '계좌 지출이 없습니다.')}
            {section('카드', '카드별 월별 지출(결제금액)', cards, '카드 지출이 없습니다.')}
          </>
        )}
      </main>
    </>
  );
}
