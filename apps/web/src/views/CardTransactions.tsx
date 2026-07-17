'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { won } from '@/lib/format';
import type { CardTxn, CursorPage, PaymentMethod, Category } from '@/lib/types';

interface Filters {
  paymentMethodId: string;
  from: string;
  to: string;
  categoryCode: string;
  q: string;
}
const EMPTY: Filters = { paymentMethodId: '', from: '', to: '', categoryCode: '', q: '' };

export function CardTransactions() {
  const [items, setItems] = useState<CardTxn[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cards, setCards] = useState<PaymentMethod[]>([]);
  const [cats, setCats] = useState<Category[]>([]);

  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);

  const load = useCallback(
    async (reset: boolean, f: Filters, cur: string | null) => {
      const params = new URLSearchParams({ limit: '30' });
      if (f.paymentMethodId) params.set('paymentMethodId', f.paymentMethodId);
      if (f.from) params.set('from', f.from);
      if (f.to) params.set('to', f.to);
      if (f.categoryCode) params.set('categoryCode', f.categoryCode);
      if (f.q) params.set('q', f.q);
      if (!reset && cur) params.set('cursor', cur);
      const res = await api.get<CursorPage<CardTxn>>(`/card-transactions?${params}`);
      setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.page.nextCursor);
      setHasNext(res.page.hasNext);
    },
    [],
  );

  useEffect(() => {
    api
      .get<PaymentMethod[]>('/payment-methods')
      .then((pm) => setCards(pm.filter((p) => p.methodType === 'card')))
      .catch(() => {});
    api.get<Category[]>('/categories').then(setCats).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    load(true, applied, null)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [applied, load]);

  const search = () => setApplied(draft);
  const reset = () => {
    setDraft(EMPTY);
    setApplied(EMPTY);
  };

  const catOptions = [...cats]
    .filter((c) => c.type === 'expense')
    .sort((a, b) => a.code.localeCompare(b.code));

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          기록 / <b>카드 거래</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>카드 거래 내역</h1>
            <p>카드 이용내역 · 결제금액(원금+수수료). 조건으로 검색하세요.</p>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
          >
            <div className="field" style={{ minWidth: 180 }}>
              <label>카드</label>
              <select
                className="select"
                value={draft.paymentMethodId}
                onChange={(e) => setDraft({ ...draft, paymentMethodId: e.target.value })}
              >
                <option value="">전체 카드</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.cardNo ? ` (${c.cardNo})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>기간</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  className="input"
                  type="date"
                  value={draft.from}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                />
                <span className="muted">~</span>
                <input
                  className="input"
                  type="date"
                  value={draft.to}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                />
              </div>
            </div>
            <div className="field" style={{ minWidth: 170 }}>
              <label>분류</label>
              <select
                className="select"
                value={draft.categoryCode}
                onChange={(e) => setDraft({ ...draft, categoryCode: e.target.value })}
              >
                <option value="">전체 분류</option>
                {catOptions.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.depth === 2 ? '　└ ' : ''}
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>가맹점</label>
              <input
                className="input"
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
                placeholder="가맹점명 검색 (예: 스타벅스)"
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" type="submit">
                검색
              </button>
              <button className="btn ghost" type="button" onClick={reset}>
                초기화
              </button>
            </div>
          </form>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>이용일</th>
                <th>카드</th>
                <th>가맹점</th>
                <th>분류</th>
                <th>할부</th>
                <th style={{ textAlign: 'right' }}>이용금액</th>
                <th style={{ textAlign: 'right' }}>결제금액</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ padding: 24 }}>
                    <div className="skeleton" style={{ height: 18 }} />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty">
                      <h3>카드 거래가 없습니다</h3>
                      <p>조건을 바꾸거나 “명세서 업로드”에서 카드 명세서를 올리세요.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((c) => {
                  const pay = Number(c.principal) + Number(c.fee);
                  return (
                    <tr key={c.id} style={c.isCanceled === 'Y' ? { opacity: 0.55 } : undefined}>
                      <td className="date">{String(c.txnDate).slice(0, 10)}</td>
                      <td className="muted">
                        {c.card?.name ?? c.cardLabel ?? '—'}
                        {c.cardNo ? <span className="muted"> · {c.cardNo}</span> : ''}
                      </td>
                      <td>
                        <b>{c.merchantName}</b>
                        {c.isCanceled === 'Y' && (
                          <span className="pill plain" style={{ marginLeft: 6 }}>
                            취소
                          </span>
                        )}
                      </td>
                      <td>
                        {c.categoryName ? (
                          <span className="tag">{c.categoryName}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="muted">{c.installmentPeriod ?? '일시불'}</td>
                      <td className="money" style={{ color: 'var(--ink-2)' }}>
                        ₩{won(Number(c.usageAmount))}
                      </td>
                      <td className="money exp">−₩{won(pay)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <div className="tfoot">
            <span>{items.length}건 표시</span>
            {hasNext && (
              <button className="btn sm" onClick={() => load(false, applied, cursor)}>
                더 보기
              </button>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
