'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { won } from '@/lib/format';
import type {
  Transaction,
  CursorPage,
  PaymentMethod,
  Category,
} from '@/lib/types';

export function Transactions() {
  const [items, setItems] = useState<Transaction[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'' | 'income' | 'expense'>('');

  const [pms, setPms] = useState<PaymentMethod[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(
    async (reset: boolean) => {
      const params = new URLSearchParams({ limit: '20' });
      if (typeFilter) params.set('type', typeFilter);
      if (!reset && cursor) params.set('cursor', cursor);
      const res = await api.get<CursorPage<Transaction>>(
        `/transactions?${params.toString()}`,
      );
      setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.page.nextCursor);
      setHasNext(res.page.hasNext);
    },
    [cursor, typeFilter],
  );

  useEffect(() => {
    setLoading(true);
    load(true).catch((e) => setError(e.message)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

  useEffect(() => {
    api.get<PaymentMethod[]>('/payment-methods').then(setPms).catch(() => {});
    api.get<Category[]>('/categories').then(setCats).catch(() => {});
  }, []);

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          기록 / <b>거래 내역</b>
        </span>
        <div className="spacer" />
        <button className="btn primary sm" onClick={() => setShowForm((s) => !s)}>
          {showForm ? '닫기' : '+ 거래 입력'}
        </button>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>거래 내역</h1>
            <p>수기 입력한 거래와 명세서에서 분류된 거래.</p>
          </div>
          <div className="actions">
            <select
              className="select"
              style={{ width: 'auto' }}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as '' | 'income' | 'expense')}
            >
              <option value="">전체</option>
              <option value="expense">지출</option>
              <option value="income">수입</option>
            </select>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {showForm && (
          <NewTransaction
            pms={pms}
            cats={cats}
            onCreated={() => {
              setShowForm(false);
              setLoading(true);
              load(true).finally(() => setLoading(false));
            }}
          />
        )}

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>날짜</th>
                <th>분류</th>
                <th>내용</th>
                <th>결제수단</th>
                <th style={{ textAlign: 'right' }}>금액</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: 24 }}>
                    <div className="skeleton" style={{ height: 18 }} />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty">
                      <h3>거래가 없습니다</h3>
                      <p>위 “+ 거래 입력”으로 첫 거래를 추가하세요.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((t) => (
                  <tr key={t.id}>
                    <td className="date">{t.transactionDate.slice(0, 10)}</td>
                    <td>
                      <span className="tag">{t.category?.name ?? t.categoryCode}</span>
                    </td>
                    <td>
                      <b>{t.description ?? '(내용 없음)'}</b>
                    </td>
                    <td className="muted">{t.paymentMethod?.name ?? '—'}</td>
                    <td className={`money ${t.type === 'income' ? 'inc' : 'exp'}`}>
                      {t.type === 'income' ? '+' : '−'}₩{won(Number(t.amount ?? 0))}
                    </td>
                    <td>
                      <span className={`pill ${t.status === 'pending' ? 'pending' : 'settled'}`}>
                        {t.status === 'pending' ? '검토대기' : '확정'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="tfoot">
            <span>{items.length}건 표시</span>
            {hasNext && (
              <button className="btn sm" onClick={() => load(false)}>
                더 보기
              </button>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function NewTransaction({
  pms,
  cats,
  onCreated,
}: {
  pms: PaymentMethod[];
  cats: Category[];
  onCreated: () => void;
}) {
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [categoryCode, setCategoryCode] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [amount, setAmount] = useState('');
  const [transactionDate, setTransactionDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catOptions = cats
    .filter((c) => c.type === type)
    .sort((a, b) => a.code.localeCompare(b.code));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/transactions', {
        type,
        categoryCode,
        paymentMethodId: Number(paymentMethodId),
        amount: Number(amount),
        transactionDate,
        description: description || undefined,
      });
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiError && err.details?.length
          ? err.details.map((d) => d.message).join(', ')
          : (err as Error).message,
      );
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <h3>새 거래</h3>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row">
          <div className="field">
            <label>유형</label>
            <select
              className="select"
              value={type}
              onChange={(e) => {
                setType(e.target.value as 'expense' | 'income');
                setCategoryCode('');
              }}
            >
              <option value="expense">지출</option>
              <option value="income">수입</option>
            </select>
          </div>
          <div className="field">
            <label>분류</label>
            <select
              className="select"
              value={categoryCode}
              onChange={(e) => setCategoryCode(e.target.value)}
              required
            >
              <option value="">선택…</option>
              {catOptions.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.depth === 2 ? '  └ ' : ''}
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>결제수단</label>
            <select
              className="select"
              value={paymentMethodId}
              onChange={(e) => setPaymentMethodId(e.target.value)}
              required
            >
              <option value="">선택…</option>
              {pms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>금액</label>
            <input
              className="input"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="10000"
              min={1}
              required
            />
          </div>
          <div className="field">
            <label>날짜</label>
            <input
              className="input"
              type="date"
              value={transactionDate}
              onChange={(e) => setTransactionDate(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>내용</label>
            <input
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="대성석유 주유소"
            />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? '저장 중…' : '거래 저장'}
          </button>
        </div>
      </form>
    </div>
  );
}
