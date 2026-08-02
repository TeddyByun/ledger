'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { won } from '@/lib/format';
import { MonthPicker } from '@/components/MonthPicker';
import { SortTh, useSort } from '@/components/sortable';
import type { Category, PaymentMethod } from '@/lib/types';

type Cadence = 'monthly' | 'annual' | 'schedule';
type AmountType = 'fixed' | 'variable';

interface Suggestion {
  matchKey: string;
  label: string;
  categoryCode: string;
  categoryName: string;
  paymentMethodId: number | null;
  paymentMethodName: string | null;
  amount: number;
  amountType: AmountType;
  cadence: Cadence;
  months: number[];
  dayOfMonth: number | null;
  monthsPresent: number;
  lastDate: string | null;
  lastAmount: number;
  occurrences: number;
  basis: string;
  confidence: 'high' | 'med' | 'low';
  recentStart: boolean;
}

interface RecurringRow {
  id: number;
  label: string;
  categoryCode: string;
  categoryName: string;
  paymentMethodName: string | null;
  amount: number;
  amountType: AmountType;
  cadence: Cadence;
  months: number[];
  startYm: string | null;
  endYm: string | null;
  dayOfMonth: number | null;
  source: 'auto' | 'manual';
  isActive: 'Y' | 'N';
  status: 'occurred' | 'due' | 'overdue' | 'ended' | 'off';
  occurredAmount: number;
  remainingMonths: number | null;
  needsMaturity: boolean;
}

const CADENCE_LABEL: Record<Cadence, string> = {
  monthly: '매월',
  annual: '연례',
  schedule: '만기까지',
};
const CADENCE_ORDER: Record<Cadence, number> = { monthly: 0, annual: 1, schedule: 2 };
const STATUS_ORDER: Record<string, number> = {
  overdue: 0,
  due: 1,
  occurred: 2,
  off: 3,
  ended: 4,
};
const AMOUNT_TYPE_LABEL: Record<AmountType, string> = { fixed: '고정', variable: '변동' };
const STATUS_LABEL: Record<string, { t: string; c: string }> = {
  occurred: { t: '발생', c: 'var(--good)' },
  due: { t: '예정', c: 'var(--muted)' },
  overdue: { t: '지연', c: 'var(--warn)' },
  ended: { t: '만기종료', c: 'var(--faint)' },
  off: { t: '해당월 아님', c: 'var(--faint)' },
};

export function RecurringExpenses() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [rows, setRows] = useState<RecurringRow[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [pms, setPms] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [sug, list] = await Promise.all([
      api.get<Suggestion[]>('/recurring-expenses/suggestions'),
      api.get<RecurringRow[]>('/recurring-expenses'),
    ]);
    setSuggestions(sug);
    setRows(list);
  }, []);

  useEffect(() => {
    Promise.all([
      load(),
      api.get<Category[]>('/categories').then(setCats),
      api.get<PaymentMethod[]>('/payment-methods').then(setPms),
    ])
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [load]);

  const catName = (code: string) => cats.find((c) => c.code === code)?.name ?? code;

  // 목록 정렬(클라이언트) — 헤더 클릭 토글, Ctrl/⌘+클릭 다중 정렬
  const { sort, toggle: toggleSort } = useSort([]);
  const sortedRows = useMemo(() => {
    if (sort.length === 0) return rows;
    const val = (r: RecurringRow, col: string): string | number | null => {
      switch (col) {
        case 'active':
          return r.isActive === 'Y' ? 0 : 1;
        case 'label':
          return r.label;
        case 'category':
          return r.categoryName;
        case 'cadence':
          return CADENCE_ORDER[r.cadence];
        case 'amount':
          return r.amount;
        case 'amountType':
          return r.amountType === 'fixed' ? 0 : 1;
        case 'day':
          return r.dayOfMonth;
        case 'endYm':
          return r.endYm;
        case 'status':
          return STATUS_ORDER[r.status] ?? 9;
        default:
          return null;
      }
    };
    return [...rows].sort((a, b) => {
      for (const s of sort) {
        const av = val(a, s.col);
        const bv = val(b, s.col);
        // 값이 없는 행은 방향과 무관하게 항상 뒤로
        if (av == null || bv == null) {
          if (av == bv) continue;
          return av == null ? 1 : -1;
        }
        const c =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av).localeCompare(String(bv), 'ko');
        if (c !== 0) return s.dir === 'asc' ? c : -c;
      }
      return 0;
    });
  }, [rows, sort]);

  const confirmSuggestion = async (s: Suggestion) => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/recurring-expenses', {
        label: s.label.slice(0, 60),
        categoryCode: s.categoryCode,
        paymentMethodId: s.paymentMethodId ?? undefined,
        amount: s.amount,
        amountType: s.amountType,
        cadence: s.cadence,
        months: s.cadence === 'annual' ? s.months : undefined,
        dayOfMonth: s.dayOfMonth ?? undefined,
        matchKey: s.matchKey,
        source: 'auto',
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: number, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/recurring-expenses/${id}`, body);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: RecurringRow) => {
    if (!confirm(`'${r.label}' 정기지출을 삭제할까요?`)) return;
    setBusy(true);
    try {
      await api.del(`/recurring-expenses/${r.id}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          관리 / <b>정기지출</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>정기지출</h1>
            <p>매월 반복되는 지출을 추천에서 확정하거나 직접 추가하면 예상 지출에 반영됩니다.</p>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {loading ? (
          <div className="card">
            <div className="skeleton" style={{ height: 120 }} />
          </div>
        ) : (
          <>
            {/* 추천 */}
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="card-head">
                <h3>추천</h3>
                <span className="sub">이력에서 찾은 반복 지출 후보 · [+ 확정]하면 예측에 포함 · <b>월 예상금액</b>은 한 달에 나가는 금액(월 합계의 중앙값)입니다</span>
              </div>
              {suggestions.length === 0 ? (
                <div className="empty">
                  <p>새로운 추천이 없습니다.</p>
                </div>
              ) : (
                <div className="tbl-wrap" style={{ boxShadow: 'none' }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{ width: 74 }}>주기</th>
                        <th>항목</th>
                        <th style={{ width: 92 }}>금액변동</th>
                        <th style={{ width: 118, textAlign: 'right' }} title="한 달에 나가는 금액(월 합계의 중앙값). 한 달에 여러 번 쓰면 그 합계입니다">
                          월 예상금액
                        </th>
                        <th style={{ width: 104 }}>마지막 지출일</th>
                        <th style={{ width: 118, textAlign: 'right' }}>마지막 지출액</th>
                        <th style={{ width: 74 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {suggestions.slice(0, 30).map((s) => (
                        <tr key={`${s.categoryCode}-${s.matchKey}`}>
                          <td>
                            <span className="pill plain">{CADENCE_LABEL[s.cadence]}</span>
                          </td>
                          <td>
                            <b style={{ fontSize: 13.5 }}>{s.label}</b>
                            {s.recentStart && (
                              <span className="pill income" style={{ marginLeft: 6 }}>
                                신규
                              </span>
                            )}
                            <div className="muted" style={{ fontSize: 11.5 }}>
                              {s.categoryName} · {s.basis} · {s.occurrences}건 · 신뢰 {s.confidence}
                            </div>
                          </td>
                          <td>
                            <span className="pill plain">{AMOUNT_TYPE_LABEL[s.amountType]}</span>
                          </td>
                          <td className="money" style={{ color: 'var(--expense)' }}>
                            −₩{won(s.amount)}
                          </td>
                          <td className="mono" style={{ fontSize: 12.5 }}>
                            {s.lastDate ?? '—'}
                          </td>
                          <td className="money">{s.lastAmount > 0 ? `−₩${won(s.lastAmount)}` : '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn primary sm"
                              disabled={busy}
                              onClick={() => confirmSuggestion(s)}
                            >
                              + 확정
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 내 정기지출 */}
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="card-head">
                <h3>내 정기지출</h3>
                <span className="sub">체크(활성)된 항목만 예측에 반영됩니다 · 예상금액·금액변동·예상 지출일·만기는 표에서 바로 수정 · 컬럼명을 클릭하면 정렬(Ctrl+클릭=다중)</span>
              </div>
              {rows.length === 0 ? (
                <div className="empty">
                  <p>확정된 정기지출이 없습니다. 위 추천에서 확정하거나 아래에서 직접 추가하세요.</p>
                </div>
              ) : (
                <div className="tbl-wrap" style={{ boxShadow: 'none' }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <SortTh col="active" sort={sort} onSort={toggleSort} align="center">
                          포함
                        </SortTh>
                        <SortTh col="label" sort={sort} onSort={toggleSort}>
                          항목
                        </SortTh>
                        <SortTh col="category" sort={sort} onSort={toggleSort}>
                          분류
                        </SortTh>
                        <SortTh col="cadence" sort={sort} onSort={toggleSort}>
                          주기
                        </SortTh>
                        <SortTh col="amount" sort={sort} onSort={toggleSort} align="right">
                          예상금액
                        </SortTh>
                        <SortTh col="amountType" sort={sort} onSort={toggleSort}>
                          금액변동
                        </SortTh>
                        <SortTh col="day" sort={sort} onSort={toggleSort}>
                          예상 지출일
                        </SortTh>
                        <SortTh col="endYm" sort={sort} onSort={toggleSort}>
                          만기
                        </SortTh>
                        <SortTh col="status" sort={sort} onSort={toggleSort}>
                          이번 달
                        </SortTh>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((r) => {
                        const st = STATUS_LABEL[r.status] ?? STATUS_LABEL.due!;
                        return (
                          <tr key={r.id} style={r.isActive === 'N' ? { opacity: 0.5 } : undefined}>
                            <td style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={r.isActive === 'Y'}
                                disabled={busy}
                                onChange={(e) =>
                                  patch(r.id, { isActive: e.target.checked ? 'Y' : 'N' })
                                }
                                aria-label="예측 포함"
                              />
                            </td>
                            <td>
                              <b>{r.label}</b>
                              {r.source === 'auto' && (
                                <span className="muted" style={{ fontSize: 11 }}>
                                  {' '}
                                  · 추천
                                </span>
                              )}
                            </td>
                            <td>
                              <span className="tag">{r.categoryName}</span>
                            </td>
                            <td className="muted">
                              {CADENCE_LABEL[r.cadence]}
                              {r.cadence === 'annual' && r.months.length > 0 && (
                                <div className="muted" style={{ fontSize: 11 }}>
                                  {r.months.join(',')}월
                                </div>
                              )}
                            </td>
                            <td className="money">
                              <AmountEdit
                                value={r.amount}
                                disabled={busy}
                                onCommit={(v) => patch(r.id, { amount: v })}
                              />
                            </td>
                            <td>
                              <select
                                className="select"
                                value={r.amountType}
                                disabled={busy}
                                title="고정 = 매월 같은 금액 · 변동 = 달마다 달라짐(예상금액은 평균치)"
                                onChange={(e) => patch(r.id, { amountType: e.target.value })}
                                style={{ width: 92, padding: '6px 8px' }}
                              >
                                <option value="fixed">고정</option>
                                <option value="variable">변동</option>
                              </select>
                            </td>
                            <td>
                              <DayEdit
                                value={r.dayOfMonth}
                                disabled={busy}
                                onCommit={(v) => patch(r.id, { dayOfMonth: v })}
                              />
                            </td>
                            <td>
                              {/* 만기는 주기와 무관하게 모든 항목에 지정 가능(할부·구독 등) */}
                              <MonthPicker
                                value={r.endYm}
                                disabled={busy}
                                placeholder="만기 없음"
                                highlight={r.needsMaturity}
                                title="만기 년월 — 이 달까지만 예측에 포함됩니다"
                                onChange={(v) => patch(r.id, { endYm: v })}
                              />
                              {r.needsMaturity && (
                                <div className="muted" style={{ fontSize: 11, color: 'var(--warn)' }}>
                                  만기 입력 필요
                                </div>
                              )}
                              {r.remainingMonths != null && r.endYm && (
                                <div className="muted" style={{ fontSize: 11 }}>
                                  잔여 {r.remainingMonths}개월
                                </div>
                              )}
                              {!r.endYm && !r.needsMaturity && (
                                <div className="muted" style={{ fontSize: 11 }}>
                                  만기 없음(계속)
                                </div>
                              )}
                            </td>
                            <td>
                              <span style={{ color: st.c, fontSize: 12, fontWeight: 600 }}>
                                {st.t}
                              </span>
                              {r.occurredAmount > 0 && (
                                <div className="muted" style={{ fontSize: 11 }}>
                                  ₩{won(r.occurredAmount)}
                                </div>
                              )}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                className="btn ghost sm"
                                style={{ color: 'var(--expense)' }}
                                disabled={busy}
                                onClick={() => remove(r)}
                              >
                                삭제
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <AddForm cats={cats} pms={pms} busy={busy} onAdd={(body) => {
              setBusy(true);
              setError(null);
              api
                .post('/recurring-expenses', body)
                .then(load)
                .catch((e) => setError((e as Error).message))
                .finally(() => setBusy(false));
            }} catName={catName} />
          </>
        )}
      </main>
    </>
  );
}

/** 예상 지출일(1~31) 인라인 편집 — 비우면 미지정. */
function DayEdit({
  value,
  disabled,
  onCommit,
}: {
  value: number | null;
  disabled?: boolean;
  onCommit: (v: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? '' : String(value));

  useEffect(() => {
    if (!editing) setDraft(value == null ? '' : String(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    if (t === '') {
      if (value != null) onCommit(null);
      return;
    }
    const n = Math.round(Number(t));
    if (!Number.isFinite(n) || n < 1 || n > 31 || n === value) {
      setDraft(value == null ? '' : String(value));
      return;
    }
    onCommit(n);
  };

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        title="클릭해서 예상 지출일 수정 (1~31, 비우면 미지정)"
        onClick={() => setEditing(true)}
        style={{
          background: 'transparent',
          border: 'none',
          borderRadius: 8,
          padding: '4px 6px',
          cursor: disabled ? 'default' : 'text',
          color: value == null ? 'var(--faint)' : 'var(--ink-2)',
          font: 'inherit',
          fontVariantNumeric: 'tabular-nums',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.boxShadow = 'var(--nm-in-sm)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        {value == null ? '미지정' : `매월 ${value}일`}
        <span className="muted" style={{ fontSize: 10.5 }}>
          ✎
        </span>
      </button>
    );
  }

  return (
    <input
      className="input"
      type="number"
      min={1}
      max={31}
      autoFocus
      placeholder="1~31"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(value == null ? '' : String(value));
          setEditing(false);
        }
      }}
      style={{ width: 78, padding: '6px 8px', textAlign: 'right' }}
    />
  );
}

/** 예상금액 인라인 편집 — 클릭하면 입력, Enter/포커스아웃 저장, Esc 취소. */
function AmountEdit({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const n = Math.round(Number(draft.replace(/[^0-9.]/g, '')));
    if (!Number.isFinite(n) || n <= 0 || n === value) {
      setDraft(String(value));
      return;
    }
    onCommit(n);
  };

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        title="클릭해서 예상금액 수정"
        onClick={() => setEditing(true)}
        style={{
          background: 'transparent',
          border: 'none',
          borderRadius: 8,
          padding: '4px 6px',
          cursor: disabled ? 'default' : 'text',
          color: 'var(--expense)',
          font: 'inherit',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.boxShadow = 'var(--nm-in-sm)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        −₩{won(value)}
        <span className="muted" style={{ fontSize: 10.5 }}>
          ✎
        </span>
      </button>
    );
  }

  return (
    <input
      className="input"
      type="number"
      min={0}
      step={100}
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(String(value));
          setEditing(false);
        }
      }}
      style={{ width: 116, padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
    />
  );
}

function AddForm({
  cats,
  pms,
  busy,
  onAdd,
  catName,
}: {
  cats: Category[];
  pms: PaymentMethod[];
  busy: boolean;
  onAdd: (body: Record<string, unknown>) => void;
  catName: (c: string) => string;
}) {
  const [label, setLabel] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [amount, setAmount] = useState('');
  const [cadence, setCadence] = useState<Cadence>('monthly');
  const [months, setMonths] = useState<number[]>([]);
  const [amountType, setAmountType] = useState<AmountType>('fixed');
  const [endYm, setEndYm] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const catOptions = [...cats]
    .filter((c) => c.type === 'expense')
    .sort((a, b) => a.code.localeCompare(b.code));

  const toggleMonth = (m: number) =>
    setMonths((p) =>
      p.includes(m) ? p.filter((x) => x !== m) : [...p, m].sort((a, b) => a - b),
    );

  const annualNeedsMonth = cadence === 'annual' && months.length === 0;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label || !categoryCode || !amount || annualNeedsMonth) return;
    onAdd({
      label,
      categoryCode,
      amount: Number(amount),
      amountType,
      cadence,
      months: cadence === 'annual' ? months : undefined,
      endYm: endYm || undefined,
      paymentMethodId: paymentMethodId ? Number(paymentMethodId) : undefined,
      source: 'manual',
    });
    setLabel('');
    setAmount('');
    setEndYm('');
    setAmountType('fixed');
    setMonths([]);
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>직접 추가</h3>
        <span className="sub">추천에 없는 정기지출을 등록</span>
      </div>
      <form onSubmit={submit} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label>항목명</label>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: 넷플릭스, 월세" required />
        </div>
        <div className="field" style={{ minWidth: 150 }}>
          <label>분류</label>
          <select className="select" value={categoryCode} onChange={(e) => setCategoryCode(e.target.value)} required>
            <option value="">선택…</option>
            {catOptions.map((c) => (
              <option key={c.code} value={c.code}>
                {c.depth === 2 ? '　└ ' : ''}
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ minWidth: 130 }}>
          <label>주기</label>
          <select className="select" value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
            <option value="monthly">매월</option>
            <option value="annual">연례</option>
            <option value="schedule">만기까지(대출·적금)</option>
          </select>
        </div>
        {cadence === 'annual' && (
          <div className="field" style={{ minWidth: 260 }}>
            <label>발생 월 {annualNeedsMonth && <span style={{ color: 'var(--warn)' }}>· 선택 필요</span>}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`btn sm ${months.includes(m) ? 'primary' : 'ghost'}`}
                  onClick={() => toggleMonth(m)}
                  style={{ padding: '4px 0', minWidth: 30, justifyContent: 'center' }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field" style={{ minWidth: 120 }}>
          <label>예상금액</label>
          <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="30000" min={0} required />
        </div>
        <div className="field" style={{ minWidth: 130 }}>
          <label>금액변동여부</label>
          <select
            className="select"
            value={amountType}
            title="고정 = 매월 같은 금액(월세·구독·할부금) · 변동 = 달마다 달라짐(공과금·통신비 등, 예상금액은 평균치)"
            onChange={(e) => setAmountType(e.target.value as AmountType)}
          >
            <option value="fixed">고정</option>
            <option value="variable">변동</option>
          </select>
        </div>
        <div className="field" style={{ minWidth: 130 }}>
          <label>만기 년월(선택)</label>
          <MonthPicker
            value={endYm || null}
            placeholder="만기 없음"
            width={150}
            title="이 달까지만 예측에 포함됩니다. 비우면 계속 반복"
            onChange={(v) => setEndYm(v ?? '')}
          />
        </div>
        <div className="field" style={{ minWidth: 150 }}>
          <label>결제수단(선택)</label>
          <select className="select" value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
            <option value="">지정 안 함</option>
            {pms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn primary" type="submit" disabled={busy || !label || !categoryCode || !amount || annualNeedsMonth}>
          추가
        </button>
        {categoryCode && (
          <span className="muted" style={{ fontSize: 11 }}>
            {catName(categoryCode)}
          </span>
        )}
      </form>
    </div>
  );
}
