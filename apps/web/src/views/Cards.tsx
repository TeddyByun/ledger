'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { PaymentMethod, DetectedCard } from '@/lib/types';

const ISSUERS = ['하나카드', '현대카드', '신한카드', '삼성카드', '국민카드', '롯데카드', '우리카드'];

interface CardForm {
  id?: number;
  issuer: string;
  name: string;
  cardNo: string;
  owner: string;
}

const EMPTY: CardForm = { issuer: '하나카드', name: '', cardNo: '', owner: '본인' };

export function Cards() {
  const [cards, setCards] = useState<PaymentMethod[]>([]);
  const [detected, setDetected] = useState<DetectedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CardForm>(EMPTY);
  const [busy, setBusy] = useState(false);

  const editing = form.id !== undefined;

  const load = async () => {
    const [pms, det] = await Promise.all([
      api.get<PaymentMethod[]>('/payment-methods?methodType=card'),
      api.get<DetectedCard[]>('/payment-methods/detected-cards').catch(() => []),
    ]);
    setCards(pms);
    setDetected(det);
  };

  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const reset = () => setForm(EMPTY);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        name: form.name,
        methodType: 'card',
        issuer: form.issuer || undefined,
        cardNo: form.cardNo || undefined,
        owner: form.owner || undefined,
      };
      if (editing) await api.patch(`/payment-methods/${form.id}`, body);
      else await api.post('/payment-methods', body);
      reset();
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'CONFLICT'
          ? '같은 이름의 카드가 이미 있습니다.'
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  const edit = (pm: PaymentMethod) =>
    setForm({
      id: pm.id,
      issuer: pm.issuer ?? '',
      name: pm.name,
      cardNo: '', // 마스킹 저장이라 재입력(비우면 기존 유지 아님 — 필요시 새로 입력)
      owner: pm.owner ?? '',
    });

  const remove = async (pm: PaymentMethod) => {
    if (!confirm(`'${pm.name}' 카드를 삭제할까요?`)) return;
    try {
      await api.del(`/payment-methods/${pm.id}`);
      if (form.id === pm.id) reset();
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const registerDetected = (d: DetectedCard) => {
    const owner = d.sampleLabel?.match(/(본인|가족)/)?.[0] ?? '본인';
    setForm({ ...EMPTY, cardNo: d.cardNo, owner, name: `카드 ${d.cardNo}` });
  };

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          설정 / <b>카드 관리</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>카드 관리</h1>
            <p>카드번호·명의를 등록하면 명세서 거래가 자동으로 그 카드에 매핑됩니다.</p>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {/* 감지된 미등록 카드 */}
        {detected.length > 0 && (
          <div className="card" style={{ marginBottom: 16, borderColor: 'var(--warn)' }}>
            <div className="card-head">
              <h3>명세서에서 감지된 미등록 카드</h3>
              <span className="sub">업로드한 명세서에 있으나 아직 등록되지 않은 카드번호</span>
            </div>
            <div className="wrap-gap" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {detected.map((d) => (
                <div
                  key={d.cardNo}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    padding: '10px 14px',
                    background: 'var(--surface-2)',
                  }}
                >
                  <div>
                    <b className="mono">···· {d.cardNo}</b>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {d.sampleLabel ?? ''} · {d.txnCount}건
                    </div>
                  </div>
                  <button className="btn primary sm" onClick={() => registerDetected(d)}>
                    등록
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid cols-2">
          {/* 등록된 카드 */}
          <div className="card pad-0" style={{ alignSelf: 'start' }}>
            <div className="card-head" style={{ padding: '18px 20px 0' }}>
              <h3>등록된 카드</h3>
              <div className="r">
                <span className="tag">{cards.length}개</span>
              </div>
            </div>
            {loading ? (
              <div style={{ padding: 20, display: 'grid', gap: 10 }}>
                <div className="skeleton" style={{ height: 20 }} />
              </div>
            ) : cards.length === 0 ? (
              <div className="empty">
                <h3>등록된 카드가 없어요</h3>
                <p>오른쪽에서 카드를 추가하세요.</p>
              </div>
            ) : (
              <div className="tbl-wrap" style={{ border: 'none', boxShadow: 'none' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>카드</th>
                      <th>카드번호</th>
                      <th>명의</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map((pm) => (
                      <tr key={pm.id}>
                        <td>
                          <b>{pm.name}</b>
                          <div className="muted" style={{ fontSize: 11.5 }}>
                            {pm.issuer ?? ''}
                          </div>
                        </td>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {pm.cardNo ?? '—'}
                        </td>
                        <td className="muted">{pm.owner ?? '—'}</td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                          <button className="btn ghost sm" onClick={() => edit(pm)}>
                            수정
                          </button>
                          <button
                            className="btn ghost sm"
                            style={{ color: 'var(--expense)' }}
                            onClick={() => remove(pm)}
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 등록/수정 폼 */}
          <div className="card" style={{ alignSelf: 'start' }}>
            <div className="card-head">
              <h3>{editing ? '카드 수정' : '새 카드'}</h3>
              {editing && (
                <div className="r">
                  <button className="btn ghost sm" onClick={reset}>
                    새 카드로
                  </button>
                </div>
              )}
            </div>
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="field">
                <label>발급사</label>
                <select
                  className="select"
                  value={form.issuer}
                  onChange={(e) => setForm({ ...form, issuer: e.target.value })}
                >
                  {ISSUERS.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>카드 이름/별칭</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="하나카드 Navy 본인"
                  required
                />
              </div>
              <div className="field">
                <label>카드번호 {editing && <span className="muted">(변경 시에만 입력)</span>}</label>
                <input
                  className="input"
                  value={form.cardNo}
                  onChange={(e) => setForm({ ...form, cardNo: e.target.value })}
                  placeholder="5699-1020-1234-7322"
                  inputMode="numeric"
                />
                <span className="muted" style={{ fontSize: 11 }}>
                  뒤 4자리만 남기고 마스킹되어 저장됩니다.
                </span>
              </div>
              <div className="field">
                <label>명의</label>
                <input
                  className="input"
                  value={form.owner}
                  onChange={(e) => setForm({ ...form, owner: e.target.value })}
                  placeholder="본인 / 가족"
                />
              </div>
              <button
                className="btn primary"
                type="submit"
                disabled={busy}
                style={{ justifyContent: 'center', padding: 11 }}
              >
                {busy ? '저장 중…' : editing ? '수정 저장' : '카드 추가'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </>
  );
}
