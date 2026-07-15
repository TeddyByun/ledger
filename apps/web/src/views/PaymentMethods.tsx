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
  const [cardNo, setCardNo] = useState('');
  const [owner, setOwner] = useState('');
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
        cardNo: methodType === 'card' ? cardNo || undefined : undefined,
        owner: owner || undefined,
      });
      setName('');
      setIssuer('');
      setCardNo('');
      setOwner('');
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

  const isCard = methodType === 'card';

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          설정 / <b>결제수단 · 카드 목록</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>결제수단</h1>
            <p>카드는 카드번호·명의를 등록하면 명세서 거래가 자동으로 매핑됩니다.</p>
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
                      <tr key={pm.id}>
                        <td>
                          <b>{pm.name}</b>
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
              <h3>새 결제수단</h3>
            </div>
            <form onSubmit={add} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                <label htmlFor="pm-name">이름</label>
                <input
                  id="pm-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={isCard ? '하나카드 Navy 본인' : '하나은행47307'}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="pm-issuer">발급사 (선택)</label>
                <input
                  id="pm-issuer"
                  className="input"
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                  placeholder={isCard ? '하나카드' : '하나은행'}
                />
              </div>
              {isCard && (
                <div className="field">
                  <label htmlFor="pm-cardno">카드번호</label>
                  <input
                    id="pm-cardno"
                    className="input"
                    value={cardNo}
                    onChange={(e) => setCardNo(e.target.value)}
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
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  placeholder="본인 / 가족"
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
