'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { won } from '@/lib/format';
import type { Transaction, CursorPage } from '@/lib/types';
import type { View } from '@/components/Shell';

export function Dashboard({ onNavigate }: { onNavigate: (v: View) => void }) {
  const { session } = useAuth();
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [pmCount, setPmCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<CursorPage<Transaction>>('/transactions?limit=5'),
      api.get<{ id: number }[]>('/payment-methods'),
    ])
      .then(([tx, pms]) => {
        setTxns(tx.items);
        setPmCount(pms.length);
      })
      .finally(() => setLoading(false));
  }, []);

  const income = txns
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + Number(t.amount ?? 0), 0);
  const expense = txns
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s + Number(t.amount ?? 0), 0);

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          개요 / <b>대시보드</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>안녕하세요, {session?.user.displayName ?? '사용자'} 님</h1>
            <p>{session?.household.name}의 가계부 요약</p>
          </div>
          <div className="actions">
            <button className="btn primary" onClick={() => onNavigate('transactions')}>
              + 거래 입력
            </button>
          </div>
        </div>

        <div className="grid cols-3" style={{ marginBottom: 16 }}>
          <div className="stat accent-income">
            <div className="lbl">
              <span className="dot" style={{ background: 'var(--income)' }} />
              최근 수입 (표시분)
            </div>
            <div className="val income">
              <span className="w">₩</span>
              {won(income)}
            </div>
          </div>
          <div className="stat accent-expense">
            <div className="lbl">
              <span className="dot" style={{ background: 'var(--expense)' }} />
              최근 지출 (표시분)
            </div>
            <div className="val expense">
              <span className="w">₩</span>
              {won(expense)}
            </div>
          </div>
          <div className="stat accent-net">
            <div className="lbl">결제수단</div>
            <div className="val">
              {pmCount ?? '—'}
              <span className="w"> 개</span>
            </div>
          </div>
        </div>

        <div className="card pad-0">
          <div className="card-head" style={{ padding: '18px 20px 0' }}>
            <h3>최근 거래</h3>
            <div className="r">
              <button className="btn ghost sm" onClick={() => onNavigate('transactions')}>
                전체 보기
              </button>
            </div>
          </div>
          {loading ? (
            <div style={{ padding: 20, display: 'grid', gap: 10 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" style={{ height: 20 }} />
              ))}
            </div>
          ) : txns.length === 0 ? (
            <div className="empty">
              <h3>아직 거래가 없어요</h3>
              <p>결제수단을 만들고 첫 거래를 입력해보세요.</p>
              <button
                className="btn primary"
                onClick={() => onNavigate('transactions')}
                style={{ marginTop: 12 }}
              >
                거래 입력하기
              </button>
            </div>
          ) : (
            <div style={{ padding: '4px 20px 12px' }}>
              {txns.map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '11px 0',
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: 13.5 }}>{t.description ?? '(내용 없음)'}</b>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {t.category?.name} · {t.paymentMethod?.name} ·{' '}
                      {t.transactionDate.slice(0, 10)}
                    </div>
                  </div>
                  <div className={`money ${t.type === 'income' ? 'inc' : 'exp'}`}>
                    {t.type === 'income' ? '+' : '−'}₩{won(Number(t.amount ?? 0))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
