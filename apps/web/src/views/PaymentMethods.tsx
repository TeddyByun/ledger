'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { PaymentMethod } from '@/lib/types';

interface Form {
  name: string;
  methodType: 'card' | 'bank';
  issuer: string;
  cardNo: string;
  owner: string;
  memo: string;
  excludeFromStats: boolean;
}
const EMPTY: Form = {
  name: '',
  methodType: 'card',
  issuer: '',
  cardNo: '',
  owner: '',
  memo: '',
  excludeFromStats: false,
};

export function PaymentMethods() {
  const [items, setItems] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editId, setEditId] = useState<number | null>(null); // null = 추가 모드
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<PaymentMethod[]>('/payment-methods')
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const resetForm = () => {
    setEditId(null);
    setForm(EMPTY);
    setError(null);
  };

  const selectRow = (pm: PaymentMethod) => {
    setEditId(pm.id);
    setError(null);
    setForm({
      name: pm.name,
      methodType: pm.methodType,
      issuer: pm.issuer ?? '',
      cardNo: pm.cardNo ?? '',
      owner: pm.owner ?? '',
      memo: pm.memo ?? '',
      excludeFromStats: pm.excludeFromStats ?? false,
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const body = {
      name: form.name,
      methodType: form.methodType,
      issuer: form.issuer || undefined,
      cardNo: form.methodType === 'card' ? form.cardNo || undefined : undefined,
      owner: form.owner || undefined,
      memo: form.memo || undefined,
      excludeFromStats: form.excludeFromStats,
    };
    try {
      if (editId != null) await api.patch(`/payment-methods/${editId}`, body);
      else await api.post('/payment-methods', body);
      resetForm();
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'CONFLICT'
          ? '같은 이름의 결제수단이 이미 있습니다.'
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (editId == null) return;
    if (!confirm('이 결제수단을 삭제할까요? 연결된 거래가 있으면 삭제되지 않을 수 있습니다.'))
      return;
    setBusy(true);
    setError(null);
    try {
      await api.del(`/payment-methods/${editId}`);
      resetForm();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isCard = form.methodType === 'card';

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          관리 / <b>결제수단 · 카드 목록</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>결제수단</h1>
            <p>
              목록에서 항목을 선택하면 내용을 수정할 수 있습니다. 투자·저축 계좌 등은
              “수입·지출 집계 제외”로 설정하면 집계에서 빠집니다.
            </p>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="grid cols-2">
          <div className="card pad-0" style={{ alignSelf: 'start' }}>
            <div className="card-head" style={{ padding: '18px 20px 0' }}>
              <h3>등록된 결제수단</h3>
              <div className="r">
                <span className="tag">{items.length}개</span>
              </div>
            </div>
            {loading ? (
              <div style={{ padding: 20, display: 'grid', gap: 10 }}>
                {[0, 1].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 20 }} />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="empty">
                <h3>아직 결제수단이 없어요</h3>
                <p>오른쪽에서 첫 결제수단을 추가하세요.</p>
              </div>
            ) : (
              <div className="tbl-wrap" style={{ border: 'none', boxShadow: 'none' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th>유형</th>
                      <th>카드번호</th>
                      <th>명의</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((pm) => (
                      <tr
                        key={pm.id}
                        onClick={() => selectRow(pm)}
                        style={{
                          cursor: 'pointer',
                          background:
                            editId === pm.id ? 'var(--brand-soft)' : undefined,
                        }}
                      >
                        <td>
                          <b>{pm.name}</b>
                          {pm.excludeFromStats && (
                            <span className="pill plain" style={{ marginLeft: 6 }}>
                              집계 제외
                            </span>
                          )}
                          <div className="muted" style={{ fontSize: 11.5 }}>
                            {pm.issuer ?? ''}
                          </div>
                        </td>
                        <td>
                          <span className="pill plain">
                            {pm.methodType === 'card' ? '카드' : '계좌'}
                          </span>
                        </td>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {pm.cardNo ?? '—'}
                        </td>
                        <td className="muted">{pm.owner ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card" style={{ alignSelf: 'start' }}>
            <div className="card-head">
              <h3>{editId != null ? '결제수단 수정' : '새 결제수단'}</h3>
              {editId != null && (
                <button className="btn ghost sm" onClick={resetForm}>
                  + 새로 추가
                </button>
              )}
            </div>
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="field">
                <label htmlFor="pm-type">유형</label>
                <select
                  id="pm-type"
                  className="select"
                  value={form.methodType}
                  onChange={(e) => set('methodType', e.target.value as 'card' | 'bank')}
                >
                  <option value="card">카드</option>
                  <option value="bank">은행 계좌</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="pm-name">이름</label>
                <input
                  id="pm-name"
                  className="input"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder={isCard ? '하나카드 Navy 본인' : '하나은행47307'}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="pm-issuer">발급사 (선택)</label>
                <input
                  id="pm-issuer"
                  className="input"
                  value={form.issuer}
                  onChange={(e) => set('issuer', e.target.value)}
                  placeholder={isCard ? '하나카드' : '하나은행'}
                />
              </div>
              {isCard && (
                <div className="field">
                  <label htmlFor="pm-cardno">카드번호</label>
                  <input
                    id="pm-cardno"
                    className="input"
                    value={form.cardNo}
                    onChange={(e) => set('cardNo', e.target.value)}
                    placeholder="5699-1020-1234-7322"
                    inputMode="numeric"
                  />
                  <span className="muted" style={{ fontSize: 11 }}>
                    뒤 4자리만 남기고 마스킹되어 저장됩니다.
                  </span>
                </div>
              )}
              <div className="field">
                <label htmlFor="pm-owner">명의 (선택)</label>
                <input
                  id="pm-owner"
                  className="input"
                  value={form.owner}
                  onChange={(e) => set('owner', e.target.value)}
                  placeholder="본인 / 가족"
                />
              </div>
              <div className="field">
                <label htmlFor="pm-memo">메모 (선택)</label>
                <input
                  id="pm-memo"
                  className="input"
                  value={form.memo}
                  onChange={(e) => set('memo', e.target.value)}
                  placeholder="연회비, 적립 혜택 등"
                />
              </div>

              <label
                style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13.5 }}
              >
                <input
                  type="checkbox"
                  checked={form.excludeFromStats}
                  onChange={(e) => set('excludeFromStats', e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  수입·지출 집계에서 제외
                  <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>
                    투자·저축 계좌처럼 실제 수입/지출이 아닌 결제수단. 추이·합계에서 빠집니다.
                  </span>
                </span>
              </label>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn primary"
                  type="submit"
                  disabled={busy}
                  style={{ flex: 1, justifyContent: 'center', padding: 11 }}
                >
                  {busy ? '저장 중…' : editId != null ? '수정 저장' : '추가'}
                </button>
                {editId != null && (
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={del}
                    style={{ color: 'var(--danger, #BE3B2A)' }}
                  >
                    삭제
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      </main>
    </>
  );
}
