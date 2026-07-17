'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { won } from '@/lib/format';
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

/** 기본 조회 시작일 = 3개월 전 1일 (YYYY-MM-DD) */
function defaultFrom(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
/** 기본 필터 — 조회 시작일만 3개월 전 1일로 채움 */
const withDefaults = (): Filters => ({ ...EMPTY, from: defaultFrom() });

interface AutoResult {
  excludedTransfer: number;
  excludedCard: number;
  classifiedByHistory: number;
  classifiedByRule: number;
  remaining: number;
}

export function BankTransactions() {
  const [items, setItems] = useState<BankTxn[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<PaymentMethod[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [types, setTypes] = useState<string[]>([]);

  // 입력 중 필터 vs 실제 적용된 필터 분리 (검색 버튼/Enter 시 적용)
  const [draft, setDraft] = useState<Filters>(withDefaults);
  const [applied, setApplied] = useState<Filters>(withDefaults);

  // 건별 인라인 편집
  const [editId, setEditId] = useState<number | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editCat, setEditCat] = useState('');
  const [saving, setSaving] = useState(false);

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
      await load(true, applied, null); // 목록 새로고침
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
    async (reset: boolean, f: Filters, cur: string | null) => {
      const params = new URLSearchParams({ limit: '30' });
      if (f.paymentMethodId) params.set('paymentMethodId', f.paymentMethodId);
      if (f.from) params.set('from', f.from);
      if (f.to) params.set('to', f.to);
      if (f.txnType) params.set('txnType', f.txnType);
      if (f.categoryCode) params.set('categoryCode', f.categoryCode);
      if (f.q) params.set('q', f.q);
      if (!reset && cur) params.set('cursor', cur);
      const res = await api.get<CursorPage<BankTxn>>(`/bank-transactions?${params}`);
      setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.page.nextCursor);
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

  // applied 가 바뀌면 처음부터 다시 로드
  useEffect(() => {
    setLoading(true);
    setError(null);
    load(true, applied, null)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [applied, load]);

  const search = () => setApplied(draft);
  const reset = () => {
    setDraft(withDefaults());
    setApplied(withDefaults());
  };

  const catOptions = [...cats].sort((a, b) => a.code.localeCompare(b.code));

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          기록 / <b>은행 거래</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>은행 거래 내역</h1>
            <p>계좌 입출금 내역 · 거래 후 잔액. 조건으로 검색하세요.</p>
          </div>
          <div className="actions">
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

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>날짜</th>
                <th>계좌</th>
                <th>구분</th>
                <th>분류</th>
                <th>내용</th>
                <th style={{ textAlign: 'right' }}>출금</th>
                <th style={{ textAlign: 'right' }}>입금</th>
                <th style={{ textAlign: 'right' }}>거래 후 잔액</th>
                <th style={{ textAlign: 'center' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ padding: 24 }}>
                    <div className="skeleton" style={{ height: 18 }} />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9}>
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
                  const editCatOptions = catOptions.filter((c) => c.type === rowType);
                  return (
                    <tr key={b.id}>
                      <td className="date">{b.txnAt.slice(0, 10)}</td>
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
