'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { PaymentMethod } from '@/lib/types';

export function PaymentMethods() {
  const [items, setItems] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [methodType, setMethodType] = useState<'card' | 'bank'>('card');
  const [issuer, setIssuer] = useState('');
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

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/payment-methods', {
        name,
        methodType,
        issuer: issuer || undefined,
      });
      setName('');
      setIssuer('');
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

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          설정 / <b>결제수단</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>결제수단</h1>
            <p>카드와 은행 계좌를 등록합니다.</p>
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
                      <th>발급사</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((pm) => (
                      <tr key={pm.id}>
                        <td>
                          <b>{pm.name}</b>
                        </td>
                        <td>
                          <span className="pill plain">
                            {pm.methodType === 'card' ? '카드' : '계좌'}
                          </span>
                        </td>
                        <td className="muted">{pm.issuer ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card" style={{ alignSelf: 'start' }}>
            <div className="card-head">
              <h3>새 결제수단</h3>
            </div>
            <form onSubmit={add} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="field">
                <label htmlFor="pm-name">이름</label>
                <input
                  id="pm-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="하나카드47307"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="pm-type">유형</label>
                <select
                  id="pm-type"
                  className="select"
                  value={methodType}
                  onChange={(e) => setMethodType(e.target.value as 'card' | 'bank')}
                >
                  <option value="card">카드</option>
                  <option value="bank">은행 계좌</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="pm-issuer">발급사 (선택)</label>
                <input
                  id="pm-issuer"
                  className="input"
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                  placeholder="하나카드 / 하나은행"
                />
              </div>
              <button
                className="btn primary"
                type="submit"
                disabled={busy}
                style={{ justifyContent: 'center', padding: 11 }}
              >
                {busy ? '추가 중…' : '추가'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </>
  );
}
