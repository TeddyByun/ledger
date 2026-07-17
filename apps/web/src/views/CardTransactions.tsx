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

interface CardSummary {
  count: number;
  usageAmount: number;
  payAmount: number;
}

/** 할부(총 개월) 표기 — 숫자 개월이 있으면 'N개월', 아니면 '일시불' */
function installmentMonths(c: CardTxn): string {
  const p = c.installmentPeriod ?? '';
  return /\d/.test(p) ? `${p}개월` : '일시불';
}
/** 할부회차 — 이번 명세서의 결제 회차. 일시불이면 '—' */
function installmentRound(c: CardTxn): string {
  const p = c.installmentPeriod ?? '';
  const round = (c.billingRound ?? '').trim();
  if (!/\d/.test(p) || !/\d/.test(round)) return '—';
  return `${round}회차`;
}

/** 필터 → 쿼리 파라미터(limit/cursor 제외) — 목록·합계 공용 */
function filterParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.paymentMethodId) p.set('paymentMethodId', f.paymentMethodId);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.categoryCode) p.set('categoryCode', f.categoryCode);
  if (f.q) p.set('q', f.q);
  return p;
}

/** 기본 조회 시작일 = 3개월 전 1일 (YYYY-MM-DD) */
function defaultFrom(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
/** 기본 필터 — 조회 시작일만 3개월 전 1일로 채움 */
const withDefaults = (): Filters => ({ ...EMPTY, from: defaultFrom() });

export function CardTransactions() {
  const [items, setItems] = useState<CardTxn[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cards, setCards] = useState<PaymentMethod[]>([]);
  const [cats, setCats] = useState<Category[]>([]);

  const [draft, setDraft] = useState<Filters>(withDefaults);
  const [applied, setApplied] = useState<Filters>(withDefaults);
  // 조회 조건 전체에 대한 합계(이용금액·결제금액·건수)
  const [summary, setSummary] = useState<CardSummary | null>(null);

  const load = useCallback(
    async (reset: boolean, f: Filters, cur: string | null) => {
      const params = filterParams(f);
      params.set('limit', '30');
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
    setSummary(null);
    load(true, applied, null)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    api
      .get<CardSummary>(`/card-transactions/summary?${filterParams(applied)}`)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [applied, load]);

  const search = () => setApplied(draft);
  const reset = () => {
    setDraft(withDefaults());
    setApplied(withDefaults());
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
                <th>할부회차</th>
                <th style={{ textAlign: 'right' }}>이용금액</th>
                <th style={{ textAlign: 'right' }}>결제금액</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: 24 }}>
                    <div className="skeleton" style={{ height: 18 }} />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8}>
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
                      <td className="muted">{installmentMonths(c)}</td>
                      <td className="muted">{installmentRound(c)}</td>
                      <td className="money" style={{ color: 'var(--ink-2)' }}>
                        ₩{won(Number(c.usageAmount))}
                      </td>
                      <td className="money exp">−₩{won(pay)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {summary && summary.count > 0 && (
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--line)', fontWeight: 700 }}>
                  <td colSpan={6} style={{ textAlign: 'right' }}>
                    합계 ({summary.count.toLocaleString()}건)
                  </td>
                  <td className="money" style={{ color: 'var(--ink-2)' }}>
                    ₩{won(summary.usageAmount)}
                  </td>
                  <td className="money exp">−₩{won(summary.payAmount)}</td>
                </tr>
              </tfoot>
            )}
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
