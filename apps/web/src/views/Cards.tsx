'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { PaymentMethod, DetectedCard } from '@/lib/types';

const ISSUERS = ['하나카드', '현대카드', '신한카드', '삼성카드', '국민카드', '롯데카드', '우리카드'];

type Mode = 'none' | 'view' | 'edit' | 'create';

interface CardForm {
  id?: number;
  issuer: string;
  name: string;
  cardNo: string;
  owner: string;
  memo: string;
}
const EMPTY: CardForm = { issuer: '하나카드', name: '', cardNo: '', owner: '본인', memo: '' };

export function Cards() {
  const [cards, setCards] = useState<PaymentMethod[]>([]);
  const [detected, setDetected] = useState<DetectedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>('none');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<CardForm>(EMPTY);
  const [busy, setBusy] = useState(false);

  const selected = cards.find((c) => c.id === selectedId) ?? null;
  const editing = mode === 'edit' || mode === 'create';

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

  const viewCard = (pm: PaymentMethod) => {
    setError(null);
    setSelectedId(pm.id);
    setMode('view');
  };

  const startEdit = () => {
    if (!selected) return;
    setForm({
      id: selected.id,
      issuer: selected.issuer ?? '',
      name: selected.name,
      cardNo: '', // 마스킹 저장 → 변경 시에만 새로 입력
      owner: selected.owner ?? '',
      memo: selected.memo ?? '',
    });
    setMode('edit');
  };

  const startCreate = () => {
    setError(null);
    setSelectedId(null);
    setForm(EMPTY);
    setMode('create');
  };

  const cancel = () => {
    setError(null);
    setMode(selected ? 'view' : 'none');
  };

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
        memo: form.memo,
      };
      if (mode === 'edit' && form.id !== undefined) {
        await api.patch(`/payment-methods/${form.id}`, body);
        await load();
        setSelectedId(form.id);
      } else {
        const created = await api.post<PaymentMethod>('/payment-methods', body);
        await load();
        setSelectedId(created?.id ?? null);
      }
      setMode('view');
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

  const remove = async (pm: PaymentMethod) => {
    if (!confirm(`'${pm.name}' 카드를 삭제할까요?`)) return;
    setError(null);
    try {
      await api.del(`/payment-methods/${pm.id}`);
      await load();
      if (selectedId === pm.id) {
        setSelectedId(null);
        setMode('none');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const registerDetected = (d: DetectedCard) => {
    const owner = d.sampleLabel?.match(/(본인|가족)/)?.[0] ?? '본인';
    setSelectedId(null);
    setForm({ ...EMPTY, cardNo: d.cardNo, owner, name: `카드 ${d.cardNo}` });
    setMode('create');
  };

  // 발급사 옵션 — 기존 값이 목록에 없으면 추가
  const issuerOptions =
    form.issuer && !ISSUERS.includes(form.issuer)
      ? [form.issuer, ...ISSUERS]
      : ISSUERS;

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
          {/* 등록된 카드 목록 */}
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
                <p>아래 “+ 새 카드 추가”로 등록하세요.</p>
              </div>
            ) : (
              <div style={{ padding: '4px 12px 4px' }}>
                {cards.map((pm) => (
                  <div
                    key={pm.id}
                    onClick={() => viewCard(pm)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '11px 8px',
                      borderBottom: '1px solid var(--line)',
                      cursor: 'pointer',
                      borderRadius: 8,
                      background:
                        selectedId === pm.id ? 'var(--brand-soft)' : 'transparent',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ fontSize: 14 }}>{pm.name}</b>
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {pm.issuer ?? ''}
                        {pm.cardNo ? ` · ${pm.cardNo}` : ''}
                        {pm.owner ? ` · ${pm.owner}` : ''}
                      </div>
                    </div>
                    <span className="muted" style={{ fontSize: 16, flex: 'none' }}>
                      ›
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ padding: '10px 14px 16px' }}>
              <button
                className="btn primary"
                onClick={startCreate}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                + 새 카드 추가
              </button>
            </div>
          </div>

          {/* 우측: 카드 정보 / 수정 / 추가 */}
          <div className="card" style={{ alignSelf: 'start' }}>
            <div className="card-head">
              <h3>
                {mode === 'create'
                  ? '새 카드'
                  : mode === 'edit'
                    ? '카드 정보 수정'
                    : '카드 정보'}
              </h3>
              {mode === 'view' && selected && (
                <div className="r" style={{ display: 'flex', gap: 6 }}>
                  <button className="btn ghost sm" onClick={startEdit}>
                    수정
                  </button>
                  <button
                    className="btn ghost sm"
                    style={{ color: 'var(--expense)' }}
                    onClick={() => remove(selected)}
                  >
                    삭제
                  </button>
                </div>
              )}
            </div>

            {mode === 'view' && selected ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{selected.name}</div>
                <Info label="발급사" value={selected.issuer || '—'} />
                <Info label="카드번호" value={selected.cardNo || '—'} mono />
                <Info label="명의" value={selected.owner || '—'} />
                <Info label="메모" value={selected.memo || '—'} />
              </div>
            ) : editing ? (
              <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="field">
                  <label>발급사</label>
                  <select
                    className="select"
                    value={form.issuer}
                    onChange={(e) => setForm({ ...form, issuer: e.target.value })}
                  >
                    {issuerOptions.map((i) => (
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
                  <label>
                    카드번호 {mode === 'edit' && <span className="muted">(변경 시에만 입력)</span>}
                  </label>
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
                <div className="field">
                  <label>메모</label>
                  <textarea
                    className="input"
                    value={form.memo}
                    onChange={(e) => setForm({ ...form, memo: e.target.value })}
                    placeholder="연회비, 적립·할인 혜택, 결제일 등 자유 메모"
                    rows={3}
                    style={{ resize: 'vertical', minHeight: 64, fontFamily: 'inherit' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn primary"
                    type="submit"
                    disabled={busy}
                    style={{ flex: 1, justifyContent: 'center', padding: 11 }}
                  >
                    {busy ? '저장 중…' : mode === 'edit' ? '수정 저장' : '카드 추가'}
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={cancel}
                    disabled={busy}
                    style={{ flex: 'none' }}
                  >
                    취소
                  </button>
                </div>
              </form>
            ) : (
              <div className="empty">
                <h3>카드를 선택하세요</h3>
                <p>왼쪽에서 카드 이름을 클릭하면 정보가 표시됩니다.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function Info({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div
        className={mono ? 'mono' : undefined}
        style={{ fontSize: 14, padding: '2px 0', whiteSpace: 'pre-wrap' }}
      >
        {value}
      </div>
    </div>
  );
}
