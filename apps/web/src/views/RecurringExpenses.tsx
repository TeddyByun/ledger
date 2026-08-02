'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { won } from '@/lib/format';
import type { Category, PaymentMethod } from '@/lib/types';

type Cadence = 'monthly' | 'annual' | 'schedule';

interface Suggestion {
  matchKey: string;
  label: string;
  categoryCode: string;
  categoryName: string;
  paymentMethodId: number | null;
  paymentMethodName: string | null;
  amount: number;
  cadence: Cadence;
  months: number[];
  dayOfMonth: number | null;
  monthsPresent: number;
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

  const confirmSuggestion = async (s: Suggestion) => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/recurring-expenses', {
        label: s.label.slice(0, 60),
        categoryCode: s.categoryCode,
        paymentMethodId: s.paymentMethodId ?? undefined,
        amount: s.amount,
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
                <span className="sub">이력에서 찾은 반복 지출 후보 · 체크(확정)하면 예측에 포함</span>
              </div>
              {suggestions.length === 0 ? (
                <div className="empty">
                  <p>새로운 추천이 없습니다.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  {suggestions.slice(0, 30).map((s) => (
                    <div
                      key={`${s.categoryCode}-${s.matchKey}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '8px 4px',
                        borderBottom: '1px solid var(--line)',
                      }}
                    >
                      <span className="pill plain" style={{ flex: 'none' }}>
                        {CADENCE_LABEL[s.cadence]}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <b style={{ fontSize: 13.5 }}>{s.label}</b>
                        {s.recentStart && (
                          <span className="pill income" style={{ marginLeft: 6 }}>
                            신규
                          </span>
                        )}
                        <div className="muted" style={{ fontSize: 11.5 }}>
                          {s.categoryName} · {s.basis} · 신뢰 {s.confidence}
                        </div>
                      </div>
                      <b className="money" style={{ color: 'var(--expense)', whiteSpace: 'nowrap' }}>
                        −₩{won(s.amount)}
                      </b>
                      <button
                        className="btn primary sm"
                        disabled={busy}
                        onClick={() => confirmSuggestion(s)}
                      >
                        + 확정
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 내 정기지출 */}
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="card-head">
                <h3>내 정기지출</h3>
                <span className="sub">체크(활성)된 항목만 예측에 반영됩니다</span>
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
                        <th style={{ width: 44, textAlign: 'center' }}>포함</th>
                        <th>항목</th>
                        <th>분류</th>
                        <th>주기</th>
                        <th style={{ textAlign: 'right' }}>예상금액</th>
                        <th>만기</th>
                        <th>이번 달</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
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
                            <td className="muted">{CADENCE_LABEL[r.cadence]}</td>
                            <td className="money" style={{ color: 'var(--expense)' }}>
                              −₩{won(r.amount)}
                            </td>
                            <td>
                              {r.cadence === 'schedule' ? (
                                <input
                                  className="input"
                                  type="month"
                                  value={r.endYm ?? ''}
                                  disabled={busy}
                                  onChange={(e) => patch(r.id, { endYm: e.target.value })}
                                  style={{
                                    width: 130,
                                    padding: '6px 8px',
                                    ...(r.needsMaturity
                                      ? { boxShadow: '0 0 0 2px var(--warn)' }
                                      : {}),
                                  }}
                                />
                              ) : (
                                <span className="muted">—</span>
                              )}
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
  const [endYm, setEndYm] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const catOptions = [...cats]
    .filter((c) => c.type === 'expense')
    .sort((a, b) => a.code.localeCompare(b.code));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label || !categoryCode || !amount) return;
    onAdd({
      label,
      categoryCode,
      amount: Number(amount),
      cadence,
      endYm: cadence === 'schedule' && endYm ? endYm : undefined,
      paymentMethodId: paymentMethodId ? Number(paymentMethodId) : undefined,
      source: 'manual',
    });
    setLabel('');
    setAmount('');
    setEndYm('');
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
        <div className="field" style={{ minWidth: 120 }}>
          <label>예상금액</label>
          <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="30000" min={0} required />
        </div>
        {cadence === 'schedule' && (
          <div className="field" style={{ minWidth: 130 }}>
            <label>만기 년월</label>
            <input className="input" type="month" value={endYm} onChange={(e) => setEndYm(e.target.value)} />
          </div>
        )}
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
        <button className="btn primary" type="submit" disabled={busy || !label || !categoryCode || !amount}>
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
