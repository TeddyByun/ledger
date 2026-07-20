'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { won } from '@/lib/format';
import { MultiSelect } from '@/components/MultiSelect';
import { useSort, SortTh } from '@/components/sortable';
import type { PaymentMethod, Category } from '@/lib/types';

interface UnifiedRow {
  id: string;
  date: string; // ISO
  source: 'bank' | 'card';
  paymentMethodName: string;
  type: 'income' | 'expense';
  amount: number;
  description: string | null;
  categoryCode: string | null;
  categoryName: string | null;
}
interface UnifiedResponse {
  items: UnifiedRow[];
  summary: Summary;
  page: { offset: number; limit: number; hasNext: boolean; total: number };
}

interface Filters {
  from: string;
  to: string;
  type: string; // '' | 'income' | 'expense'
  methodType: string; // '' | 'bank' | 'card'
  paymentMethodIds: string[];
  categoryCode: string;
  q: string;
}
const EMPTY: Filters = {
  from: '',
  to: '',
  type: '',
  methodType: '',
  paymentMethodIds: [],
  categoryCode: '',
  q: '',
};

/** 년월(YYYY-MM) → 그 달 마지막 날짜(YYYY-MM-DD) */
function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const day = new Date(y!, m!, 0).getDate();
  return `${ym}-${String(day).padStart(2, '0')}`;
}
/** 기본 조회 시작월 = 3개월 전 (YYYY-MM) */
function defaultFromMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const withDefaults = (): Filters => ({ ...EMPTY, from: defaultFromMonth() });

interface Summary {
  incomeTotal: number;
  expenseTotal: number;
  net: number;
  incomeCount: number;
  expenseCount: number;
  count: number;
}

/** 필터 → 쿼리 파라미터(limit/cursor 제외) — 목록·합계 공용 */
function filterParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.from) p.set('from', `${f.from}-01`);
  if (f.to) p.set('to', monthEnd(f.to));
  if (f.type) p.set('type', f.type);
  if (f.methodType) p.set('methodType', f.methodType);
  if (f.paymentMethodIds.length) p.set('paymentMethodIds', f.paymentMethodIds.join(','));
  if (f.categoryCode) p.set('categoryCode', f.categoryCode);
  if (f.q) p.set('q', f.q);
  return p;
}

const PAGE = 50;

export function AllTransactions() {
  const [items, setItems] = useState<UnifiedRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pms, setPms] = useState<PaymentMethod[]>([]);
  const [cats, setCats] = useState<Category[]>([]);

  const [draft, setDraft] = useState<Filters>(withDefaults);
  const [applied, setApplied] = useState<Filters>(withDefaults);
  const [summary, setSummary] = useState<Summary | null>(null);
  const { sort, toggle, param: sortParam } = useSort([{ col: 'date', dir: 'desc' }]);

  const load = useCallback(
    async (reset: boolean, f: Filters, off: number, sp: string) => {
      const p = filterParams(f);
      p.set('limit', String(PAGE));
      p.set('offset', String(off));
      if (sp) p.set('sort', sp);
      const res = await api.get<UnifiedResponse>(`/transactions/unified?${p.toString()}`);
      setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
      setSummary(res.summary);
      setHasNext(res.page.hasNext);
      setOffset(res.page.offset);
    },
    [],
  );

  // 적용된 필터·정렬이 바뀌면 목록·합계 재조회
  useEffect(() => {
    setLoading(true);
    setError(null);
    load(true, applied, 0, sortParam)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [applied, sortParam, load]);

  useEffect(() => {
    api.get<PaymentMethod[]>('/payment-methods').then(setPms).catch(() => {});
    api.get<Category[]>('/categories').then(setCats).catch(() => {});
  }, []);

  const catOptions = [...cats].sort((a, b) => a.code.localeCompare(b.code));
  const pmOptions = pms.filter((p) => !draft.methodType || p.methodType === draft.methodType);

  const search = () => setApplied(draft);
  const reset = () => {
    const d = withDefaults();
    setDraft(d);
    setApplied(d);
  };

  const src = (r: UnifiedRow) => (r.source === 'card' ? '카드' : '은행');

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          거래내역 / <b>전체 거래</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>전체 거래</h1>
            <p>은행·카드 거래를 합쳐 수입/지출을 한 번에 조회합니다.</p>
          </div>
        </div>

        {/* 조건 검색 */}
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
            <div className="field" style={{ minWidth: 130 }}>
              <label>유형</label>
              <select
                className="select"
                value={draft.type}
                onChange={(e) => setDraft({ ...draft, type: e.target.value })}
              >
                <option value="">전체 유형</option>
                <option value="income">수입</option>
                <option value="expense">지출</option>
              </select>
            </div>
            <div className="field" style={{ minWidth: 130 }}>
              <label>원천</label>
              <select
                className="select"
                value={draft.methodType}
                onChange={(e) =>
                  setDraft({ ...draft, methodType: e.target.value, paymentMethodIds: [] })
                }
              >
                <option value="">전체 원천</option>
                <option value="bank">은행</option>
                <option value="card">카드</option>
              </select>
            </div>
            <div className="field" style={{ minWidth: 170 }}>
              <label>결제수단</label>
              <MultiSelect
                allLabel="전체 결제수단"
                minWidth={170}
                options={pmOptions.map((p) => ({ value: String(p.id), label: p.name }))}
                selected={draft.paymentMethodIds}
                onChange={(v) => setDraft({ ...draft, paymentMethodIds: v })}
              />
            </div>
            <div className="field" style={{ minWidth: 170 }}>
              <label>분류</label>
              <select
                className="select"
                value={draft.categoryCode}
                onChange={(e) => setDraft({ ...draft, categoryCode: e.target.value })}
              >
                <option value="">전체 분류</option>
                <option value="-">미분류 (-)</option>
                {catOptions.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.depth === 2 ? '　└ ' : ''}
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>내용</label>
              <input
                className="input"
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
                placeholder="내용/메모 검색 (예: 주유, 관리비)"
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

        {/* 합계 */}
        {summary && summary.count > 0 && (
          <div
            className="card"
            style={{
              marginBottom: 12,
              display: 'flex',
              gap: 20,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <b>합계 ({summary.count.toLocaleString()}건)</b>
            <span className="muted">|</span>
            <span>
              수입 <b style={{ color: 'var(--income)' }}>+₩{won(summary.incomeTotal)}</b>
              <span className="muted" style={{ fontSize: 12 }}> ({summary.incomeCount})</span>
            </span>
            <span>
              지출 <b style={{ color: 'var(--expense)' }}>−₩{won(summary.expenseTotal)}</b>
              <span className="muted" style={{ fontSize: 12 }}> ({summary.expenseCount})</span>
            </span>
            <span>
              순액{' '}
              <b style={{ color: summary.net >= 0 ? 'var(--income)' : 'var(--expense)' }}>
                {summary.net >= 0 ? '+' : '−'}₩{won(Math.abs(summary.net))}
              </b>
            </span>
          </div>
        )}

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <SortTh col="date" sort={sort} onSort={toggle}>날짜</SortTh>
                <SortTh col="source" sort={sort} onSort={toggle}>원천</SortTh>
                <SortTh col="payment" sort={sort} onSort={toggle}>결제수단</SortTh>
                <SortTh col="category" sort={sort} onSort={toggle}>분류</SortTh>
                <SortTh col="description" sort={sort} onSort={toggle}>내용</SortTh>
                <SortTh col="amount" sort={sort} onSort={toggle} align="right">
                  금액
                </SortTh>
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
                      <p>검색 조건을 바꿔보세요.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((t) => (
                  <tr key={t.id}>
                    <td className="date">{t.date.slice(0, 10)}</td>
                    <td>
                      <span className="pill plain">{src(t)}</span>
                    </td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                      {t.paymentMethodName}
                    </td>
                    <td>
                      {t.categoryName ? (
                        <span className="tag">{t.categoryName}</span>
                      ) : (
                        <span className="muted">미분류</span>
                      )}
                    </td>
                    <td>{t.description ?? '(내용 없음)'}</td>
                    <td className={`money ${t.type === 'income' ? 'inc' : 'exp'}`}>
                      {t.type === 'income' ? '+' : '−'}₩{won(t.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="tfoot">
            <span>
              {items.length}건 표시
              {summary && summary.count > items.length ? ` / 총 ${summary.count.toLocaleString()}건` : ''}
            </span>
            {hasNext && (
              <button
                className="btn sm"
                onClick={() => load(false, applied, offset + PAGE, sortParam)}
              >
                더 보기
              </button>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
