'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { won } from '@/lib/format';
import { useSort, SortTh } from '@/components/sortable';
import type { BankTxn, CursorPage, PaymentMethod, Category } from '@/lib/types';

interface Filters {
  paymentMethodId: string;
  from: string;
  to: string;
  txnType: string;
  categoryCode: string;
  q: string;
}
const EMPTY: Filters = {
  paymentMethodId: '',
  from: '',
  to: '',
  txnType: '',
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
/** 기본 필터 — 조회 시작월만 3개월 전으로 채움 */
const withDefaults = (): Filters => ({ ...EMPTY, from: defaultFromMonth() });

interface BankSummary {
  count: number;
  withdrawal: number;
  deposit: number;
}

/** 필터 → 쿼리 파라미터(limit/cursor 제외) — 목록·합계 공용. 기간은 년월 → 일자 변환 */
function filterParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.paymentMethodId) p.set('paymentMethodId', f.paymentMethodId);
  if (f.from) p.set('from', `${f.from}-01`);
  if (f.to) p.set('to', monthEnd(f.to));
  if (f.txnType) p.set('txnType', f.txnType);
  if (f.categoryCode) p.set('categoryCode', f.categoryCode);
  if (f.q) p.set('q', f.q);
  return p;
}

interface AutoResult {
  excludedTransfer: number;
  excludedCard: number;
  classifiedByHistory: number;
  classifiedByRule: number;
  remaining: number;
}

export function BankTransactions() {
  const [items, setItems] = useState<BankTxn[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { sort, toggle, param: sortParam } = useSort([{ col: 'date', dir: 'desc' }]);

  const [accounts, setAccounts] = useState<PaymentMethod[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [types, setTypes] = useState<string[]>([]);

  // 입력 중 필터 vs 실제 적용된 필터 분리 (검색 버튼/Enter 시 적용)
  const [draft, setDraft] = useState<Filters>(withDefaults);
  const [applied, setApplied] = useState<Filters>(withDefaults);
  // 조회 조건 전체에 대한 합계(출금·입금·건수)
  const [summary, setSummary] = useState<BankSummary | null>(null);

  // 건별 인라인 편집
  const [editId, setEditId] = useState<number | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editCat, setEditCat] = useState('');
  const [saving, setSaving] = useState(false);

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
      await api.post('/bank-transactions/bulk-classify', {
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
      await api.post('/bank-transactions/bulk-delete', { ids: [...selected] });
      clearSel();
      await load(true, applied, sortParam, 0);
      // 삭제로 건수·합계가 바뀌므로 합계 재조회
      api
        .get<BankSummary>(`/bank-transactions/summary?${filterParams(applied)}`)
        .then(setSummary)
        .catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  // 일괄 자동 분류
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoResult, setAutoResult] = useState<AutoResult | null>(null);
  const runAuto = async () => {
    setAutoBusy(true);
    setAutoResult(null);
    setError(null);
    try {
      const r = await api.post<AutoResult>('/bank-transactions/auto-classify');
      setAutoResult(r);
      await load(true, applied, sortParam, 0); // 목록 새로고침
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAutoBusy(false);
    }
  };

  const startEdit = (b: BankTxn) => {
    setEditId(b.id);
    setEditDesc(b.description ?? '');
    setEditCat(b.categoryCode ?? '');
  };
  const cancelEdit = () => setEditId(null);
  const saveEdit = async (b: BankTxn) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patch<BankTxn>(`/bank-transactions/${b.id}`, {
        description: editDesc,
        categoryCode: editCat,
      });
      setItems((prev) => prev.map((x) => (x.id === b.id ? updated : x)));
      setEditId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const load = useCallback(
    async (reset: boolean, f: Filters, sp: string, offset: number) => {
      const params = filterParams(f);
      params.set('limit', '30');
      params.set('offset', String(offset));
      if (sp) params.set('sort', sp);
      const res = await api.get<CursorPage<BankTxn>>(`/bank-transactions?${params}`);
      setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
      setHasNext(res.page.hasNext);
    },
    [],
  );

  useEffect(() => {
    api
      .get<PaymentMethod[]>('/payment-methods')
      .then((pm) => setAccounts(pm.filter((p) => p.methodType === 'bank')))
      .catch(() => {});
    api.get<Category[]>('/categories').then(setCats).catch(() => {});
    api.get<string[]>('/bank-transactions/types').then(setTypes).catch(() => {});
  }, []);

  // applied 가 바뀌면 처음부터 다시 로드 + 선택 초기화 + 합계 갱신
  useEffect(() => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setSummary(null);
    load(true, applied, sortParam, 0)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    api
      .get<BankSummary>(`/bank-transactions/summary?${filterParams(applied)}`)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [applied, sortParam, load]);

  const exportXlsx = () => {
    const p = filterParams(applied);
    if (sortParam) p.set('sort', sortParam);
    api
      .download(`/bank-transactions/export?${p}`, '은행거래.xlsx')
      .catch((e) => setError((e as Error).message));
  };

  const search = () => setApplied(draft);
  const reset = () => {
    setDraft(withDefaults());
    setApplied(withDefaults());
  };

  const catOptions = [...cats].sort((a, b) => a.code.localeCompare(b.code));
  // '집계제외'(및 하위)는 수입/지출 유형과 무관하게 항상 선택 가능해야 함
  const excludeRootCodes = cats.filter((c) => c.name === '집계제외').map((c) => c.code);
  const isExcludeCat = (c: Category) =>
    c.name === '집계제외' || (!!c.parentCode && excludeRootCodes.includes(c.parentCode));
  const allChecked = items.length > 0 && items.every((b) => selected.has(b.id));
  const toggleAll = () =>
    setSelected(allChecked ? new Set() : new Set(items.map((b) => b.id)));

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          거래내역 / <b>은행 거래</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>은행 거래 내역</h1>
            <p>계좌 입출금 내역 · 거래 후 잔액. 조건으로 검색하세요.</p>
          </div>
          <div className="actions">
            <button className="btn" onClick={exportXlsx}>
              엑셀 저장
            </button>
            <button className="btn primary" onClick={runAuto} disabled={autoBusy}>
              {autoBusy ? '자동 분류 중…' : '자동 분류'}
            </button>
          </div>
        </div>

        {autoResult && (
          <div className="callout" style={{ marginBottom: 16, fontSize: 13 }}>
            자동 분류 완료 —{' '}
            <b>이력 {autoResult.classifiedByHistory}건</b> · 규칙{' '}
            {autoResult.classifiedByRule}건 분류, 이체 제외{' '}
            {autoResult.excludedTransfer}건
            {autoResult.excludedCard > 0 && `, 카드대금 제외 ${autoResult.excludedCard}건`}
            . 남은 미분류 <b>{autoResult.remaining}건</b>은 아래에서 “수정”으로 분류하면
            다음 자동 분류 때 같은 내용에 적용됩니다.
          </div>
        )}

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
            <div className="field" style={{ minWidth: 180 }}>
              <label>계좌</label>
              <select
                className="select"
                value={draft.paymentMethodId}
                onChange={(e) => setDraft({ ...draft, paymentMethodId: e.target.value })}
              >
                <option value="">전체 계좌</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ minWidth: 150 }}>
              <label>구분</label>
              <select
                className="select"
                value={draft.txnType}
                onChange={(e) => setDraft({ ...draft, txnType: e.target.value })}
              >
                <option value="">전체 구분</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
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
              <label>내용</label>
              <input
                className="input"
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
                placeholder="적요 검색 (예: 이자, 관리비)"
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
                <SortTh col="date" sort={sort} onSort={toggle}>날짜</SortTh>
                <SortTh col="account" sort={sort} onSort={toggle}>계좌</SortTh>
                <SortTh col="type" sort={sort} onSort={toggle}>구분</SortTh>
                <SortTh col="category" sort={sort} onSort={toggle}>분류</SortTh>
                <SortTh col="description" sort={sort} onSort={toggle}>내용</SortTh>
                <SortTh col="withdrawal" sort={sort} onSort={toggle} align="right">출금</SortTh>
                <SortTh col="deposit" sort={sort} onSort={toggle} align="right">입금</SortTh>
                <SortTh col="balance" sort={sort} onSort={toggle} align="right">거래 후 잔액</SortTh>
                <th style={{ textAlign: 'center' }}>관리</th>
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
                      <h3>거래가 없습니다</h3>
                      <p>조건을 바꾸거나 “명세서 업로드”에서 은행 명세서를 올리세요.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((b) => {
                  const w = Number(b.withdrawal);
                  const d = Number(b.deposit);
                  const isEditing = editId === b.id;
                  // 방향(출금=지출, 입금=수입)에 맞는 분류만 선택지로
                  const rowType = w > 0 ? 'expense' : 'income';
                  const editCatOptions = catOptions.filter(
                    (c) => c.type === rowType || isExcludeCat(c),
                  );
                  return (
                    <tr key={b.id} className={selected.has(b.id) ? 'row-sel' : ''}>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selected.has(b.id)}
                          onChange={() => toggleOne(b.id)}
                          aria-label="행 선택"
                        />
                      </td>
                      <td className="date">
                        {b.txnAt.slice(0, 10)}
                        {b.txnAt.slice(11, 19) !== '00:00:00' && (
                          <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                            {b.txnAt.slice(11, 16)}
                          </span>
                        )}
                      </td>
                      <td className="muted">{b.account?.name ?? '—'}</td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                        {b.txnTypeRaw ?? '—'}
                      </td>
                      <td>
                        {isEditing ? (
                          <select
                            className="select"
                            value={editCat}
                            onChange={(e) => setEditCat(e.target.value)}
                            style={{ minWidth: 140 }}
                          >
                            <option value="">미분류</option>
                            {editCatOptions.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.depth === 2 ? '　└ ' : ''}
                                {c.name}
                              </option>
                            ))}
                          </select>
                        ) : b.categoryName ? (
                          <span className="tag">{b.categoryName}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            className="input"
                            value={editDesc}
                            onChange={(e) => setEditDesc(e.target.value)}
                            style={{ minWidth: 160 }}
                          />
                        ) : (
                          <>
                            <b>{b.description ?? '(내용 없음)'}</b>
                            {b.excludeReason && (
                              <span className="pill plain" style={{ marginLeft: 6 }}>
                                {b.excludeReason === 'card_settlement'
                                  ? '카드대금'
                                  : b.excludeReason === 'self_transfer'
                                    ? '자기이체'
                                    : b.excludeReason === 'transfer'
                                      ? '이체'
                                      : '제외'}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className={`money ${w > 0 ? 'exp' : ''}`}>
                        {w > 0 ? `−₩${won(w)}` : ''}
                      </td>
                      <td className={`money ${d > 0 ? 'inc' : ''}`}>
                        {d > 0 ? `+₩${won(d)}` : ''}
                      </td>
                      <td className="money" style={{ color: 'var(--ink-2)' }}>
                        {b.balance != null ? `₩${won(Number(b.balance))}` : '—'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                        {isEditing ? (
                          <>
                            <button
                              className="btn primary sm"
                              onClick={() => saveEdit(b)}
                              disabled={saving}
                            >
                              {saving ? '저장…' : '저장'}
                            </button>
                            <button
                              className="btn ghost sm"
                              onClick={cancelEdit}
                              disabled={saving}
                              style={{ marginLeft: 4 }}
                            >
                              취소
                            </button>
                          </>
                        ) : (
                          <button className="btn ghost sm" onClick={() => startEdit(b)}>
                            수정
                          </button>
                        )}
                      </td>
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
                  <td className="money exp">
                    {summary.withdrawal > 0 ? `−₩${won(summary.withdrawal)}` : ''}
                  </td>
                  <td className="money inc">
                    {summary.deposit > 0 ? `+₩${won(summary.deposit)}` : ''}
                  </td>
                  <td colSpan={2} />
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
