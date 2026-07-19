'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { won } from '@/lib/format';
import { useSort, SortTh } from '@/components/sortable';
import type { CardTxn, CursorPage, PaymentMethod, Category } from '@/lib/types';

interface Filters {
  paymentMethodId: string;
  from: string;
  to: string;
  installment: string; // '' 전체 | 'yes' 할부 | 'no' 일시불
  categoryCode: string;
  q: string;
}
const EMPTY: Filters = {
  paymentMethodId: '',
  from: '',
  to: '',
  installment: '',
  categoryCode: '',
  q: '',
};

interface CardSummary {
  count: number;
  usageAmount: number;
  payAmount: number;
}

/** 금액 표기 — 음수(할인·환급)는 −₩ 대신 ₩ 앞에 부호를 붙여 표시 */
function signed(n: number): string {
  return n < 0 ? `−₩${won(-n)}` : `₩${won(n)}`;
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

/** 년월(YYYY-MM) → 그 달 마지막 날짜(YYYY-MM-DD) */
function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const day = new Date(y!, m!, 0).getDate();
  return `${ym}-${String(day).padStart(2, '0')}`;
}

/** 필터 → 쿼리 파라미터(limit/cursor 제외) — 목록·합계 공용. 기간은 년월 → 일자 변환 */
function filterParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.paymentMethodId) p.set('paymentMethodId', f.paymentMethodId);
  if (f.from) p.set('from', `${f.from}-01`);
  if (f.to) p.set('to', monthEnd(f.to));
  if (f.installment) p.set('installment', f.installment);
  if (f.categoryCode) p.set('categoryCode', f.categoryCode);
  if (f.q) p.set('q', f.q);
  return p;
}

/** 기본 조회 시작월 = 3개월 전 (YYYY-MM) */
function defaultFromMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** 기본 필터 — 조회 시작월만 3개월 전으로 채움 */
const withDefaults = (): Filters => ({ ...EMPTY, from: defaultFromMonth() });

export function CardTransactions() {
  const [items, setItems] = useState<CardTxn[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cards, setCards] = useState<PaymentMethod[]>([]);
  const [cats, setCats] = useState<Category[]>([]);

  const [draft, setDraft] = useState<Filters>(withDefaults);
  const [applied, setApplied] = useState<Filters>(withDefaults);
  const { sort, toggle, param: sortParam } = useSort([{ col: 'date', dir: 'desc' }]);
  // 조회 조건 전체에 대한 합계(이용금액·결제금액·건수)
  const [summary, setSummary] = useState<CardSummary | null>(null);

  // 선택 + 일괄 작업
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkCat, setBulkCat] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const clearSel = () => setSelected(new Set());
  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bulkClassify = async () => {
    if (!bulkCat || selected.size === 0) return;
    setBulkBusy(true);
    setError(null);
    try {
      await api.post('/card-transactions/bulk-classify', {
        ids: [...selected],
        categoryCode: bulkCat,
      });
      setBulkCat('');
      clearSel();
      await load(true, applied, sortParam, 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };
  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`선택한 ${selected.size}건을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setBulkBusy(true);
    setError(null);
    try {
      await api.post('/card-transactions/bulk-delete', { ids: [...selected] });
      clearSel();
      await load(true, applied, sortParam, 0);
      api
        .get<CardSummary>(`/card-transactions/summary?${filterParams(applied)}`)
        .then(setSummary)
        .catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const load = useCallback(
    async (reset: boolean, f: Filters, sp: string, offset: number) => {
      const params = filterParams(f);
      params.set('limit', '30');
      params.set('offset', String(offset));
      if (sp) params.set('sort', sp);
      const res = await api.get<CursorPage<CardTxn>>(`/card-transactions?${params}`);
      setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
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
    setSelected(new Set());
    load(true, applied, sortParam, 0)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    api
      .get<CardSummary>(`/card-transactions/summary?${filterParams(applied)}`)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [applied, sortParam, load]);

  const exportXlsx = () => {
    const p = filterParams(applied);
    if (sortParam) p.set('sort', sortParam);
    api
      .download(`/card-transactions/export?${p}`, '카드거래.xlsx')
      .catch((e) => setError((e as Error).message));
  };

  const search = () => setApplied(draft);
  const reset = () => {
    setDraft(withDefaults());
    setApplied(withDefaults());
  };

  // '집계제외'(및 하위)는 수입 유형이지만 카드 지출에도 지정 가능해야 함
  const excludeRootCodes = cats.filter((c) => c.name === '집계제외').map((c) => c.code);
  const catOptions = [...cats]
    .filter(
      (c) =>
        c.type === 'expense' ||
        c.name === '집계제외' ||
        (!!c.parentCode && excludeRootCodes.includes(c.parentCode)),
    )
    .sort((a, b) => a.code.localeCompare(b.code));
  const allChecked = items.length > 0 && items.every((c) => selected.has(c.id));
  const toggleAll = () =>
    setSelected(allChecked ? new Set() : new Set(items.map((c) => c.id)));

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          거래내역 / <b>카드 거래</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>카드 거래 내역</h1>
            <p>카드 이용내역 · 결제금액(원금+수수료). 조건으로 검색하세요.</p>
          </div>
          <div className="actions">
            <button className="btn" onClick={exportXlsx}>
              엑셀 저장
            </button>
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
            <div className="field" style={{ minWidth: 120 }}>
              <label>할부</label>
              <select
                className="select"
                value={draft.installment}
                onChange={(e) => setDraft({ ...draft, installment: e.target.value })}
              >
                <option value="">전체</option>
                <option value="no">일시불</option>
                <option value="yes">할부</option>
              </select>
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

        {selected.size > 0 && (
          <div
            className="card"
            style={{
              marginBottom: 12,
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <b>{selected.size}건 선택</b>
            <span className="muted">|</span>
            <select
              className="select"
              style={{ width: 'auto', minWidth: 160 }}
              value={bulkCat}
              onChange={(e) => setBulkCat(e.target.value)}
            >
              <option value="">분류 선택…</option>
              {catOptions.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.depth === 2 ? '　└ ' : ''}
                  {c.name}
                </option>
              ))}
            </select>
            <button
              className="btn primary"
              disabled={!bulkCat || bulkBusy}
              onClick={bulkClassify}
            >
              {bulkBusy ? '처리 중…' : '분류 일괄 적용'}
            </button>
            <button
              className="btn"
              style={{ color: 'var(--expense)' }}
              disabled={bulkBusy}
              onClick={bulkDelete}
            >
              선택 삭제
            </button>
            <button className="btn ghost" onClick={clearSel} disabled={bulkBusy}>
              선택 해제
            </button>
          </div>
        )}

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 32, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="전체 선택"
                  />
                </th>
                <SortTh col="date" sort={sort} onSort={toggle}>이용일</SortTh>
                <SortTh col="card" sort={sort} onSort={toggle}>카드</SortTh>
                <SortTh col="merchant" sort={sort} onSort={toggle}>가맹점</SortTh>
                <SortTh col="category" sort={sort} onSort={toggle}>분류</SortTh>
                <SortTh col="installment" sort={sort} onSort={toggle}>할부</SortTh>
                <SortTh col="round" sort={sort} onSort={toggle}>할부회차</SortTh>
                <SortTh col="usage" sort={sort} onSort={toggle} align="right">이용금액</SortTh>
                <th style={{ textAlign: 'right' }}>할인금액</th>
                <SortTh col="pay" sort={sort} onSort={toggle} align="right">결제금액</SortTh>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} style={{ padding: 24 }}>
                    <div className="skeleton" style={{ height: 18 }} />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <div className="empty">
                      <h3>카드 거래가 없습니다</h3>
                      <p>조건을 바꾸거나 “명세서 업로드”에서 카드 명세서를 올리세요.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((c) => {
                  const pay = Number(c.principal) + Number(c.fee);
                  const discount = Number(c.usageAmount) - pay; // 할인 = 이용금액 − 결제금액
                  return (
                    <tr
                      key={c.id}
                      className={selected.has(c.id) ? 'row-sel' : ''}
                      style={c.isCanceled === 'Y' ? { opacity: 0.55 } : undefined}
                    >
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleOne(c.id)}
                          aria-label="행 선택"
                        />
                      </td>
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
                        {signed(Number(c.usageAmount))}
                      </td>
                      <td
                        className="money"
                        style={{
                          color:
                            discount > 0
                              ? 'var(--income)'
                              : discount < 0
                                ? 'var(--expense)'
                                : 'var(--muted)',
                        }}
                        title={discount < 0 ? '해외이용수수료 등' : undefined}
                      >
                        {discount > 0
                          ? `−₩${won(discount)}`
                          : discount < 0
                            ? `+₩${won(-discount)}`
                            : '—'}
                      </td>
                      <td className={`money ${pay < 0 ? 'inc' : 'exp'}`}>
                        {pay < 0 ? `+₩${won(-pay)}` : `−₩${won(pay)}`}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {summary && summary.count > 0 && (
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--line)', fontWeight: 700 }}>
                  <td colSpan={7} style={{ textAlign: 'right' }}>
                    합계 ({summary.count.toLocaleString()}건)
                  </td>
                  <td className="money" style={{ color: 'var(--ink-2)' }}>
                    ₩{won(summary.usageAmount)}
                  </td>
                  {(() => {
                    const d = summary.usageAmount - summary.payAmount;
                    return (
                      <td
                        className="money"
                        style={{ color: d > 0 ? 'var(--income)' : d < 0 ? 'var(--expense)' : 'var(--muted)' }}
                      >
                        {d > 0 ? `−₩${won(d)}` : d < 0 ? `+₩${won(-d)}` : '—'}
                      </td>
                    );
                  })()}
                  <td className="money exp">−₩{won(summary.payAmount)}</td>
                </tr>
              </tfoot>
            )}
          </table>
          <div className="tfoot">
            <span>{items.length}건 표시</span>
            {hasNext && (
              <button className="btn sm" onClick={() => load(false, applied, sortParam, items.length)}>
                더 보기
              </button>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
