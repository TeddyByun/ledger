'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { HouseholdInfo, HouseholdMember } from '@/lib/types';

const RELATIONS = [
  { value: 'self', label: '본인' },
  { value: 'spouse', label: '배우자' },
  { value: 'child', label: '자녀' },
  { value: 'parent', label: '부모' },
  { value: 'other', label: '기타' },
];
const COLORS = ['#0F766E', '#245FA0', '#BE3B2A', '#B7791F', '#5B54B0', '#A8497E', '#3E7C4E'];
const relLabel = (r: string | null) =>
  RELATIONS.find((x) => x.value === r)?.label ?? r ?? '—';

interface MemberForm {
  id?: number;
  name: string;
  relation: string;
  isSelf: boolean;
  color: string;
  email: string;
  password: string;
  role: 'owner' | 'member' | 'viewer';
}
const EMPTY: MemberForm = {
  name: '',
  relation: 'spouse',
  isSelf: false,
  color: COLORS[1]!,
  email: '',
  password: '',
  role: 'member',
};

export function Family() {
  const { session } = useAuth();
  const isOwner = session?.household.role === 'owner';
  const [hh, setHh] = useState<HouseholdInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [form, setForm] = useState<MemberForm>(EMPTY);
  const [busy, setBusy] = useState(false);

  const editing = form.id !== undefined;

  const load = async () => {
    const data = await api.get<HouseholdInfo>('/household');
    setHh(data);
    setName(data.name);
  };

  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const saveName = async () => {
    setError(null);
    try {
      await api.patch('/household', { name });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const submitMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        relation: form.relation,
        isSelf: form.isSelf,
        color: form.color,
      };
      // 로그인 정보(선택) — 입력한 경우에만 전송
      if (form.email) body.email = form.email;
      if (form.email) body.role = form.role;
      if (form.password) body.password = form.password;
      if (editing) await api.patch(`/household/members/${form.id}`, body);
      else await api.post('/household/members', body);
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const edit = (m: HouseholdMember) =>
    setForm({
      id: m.id,
      name: m.name,
      relation: m.relation ?? 'other',
      isSelf: m.isSelf,
      color: m.color ?? COLORS[0]!,
      email: m.email ?? '',
      password: '',
      role: m.role ?? 'member',
    });

  const remove = async (m: HouseholdMember) => {
    if (!confirm(`구성원 '${m.name}'을(를) 삭제할까요?`)) return;
    try {
      await api.del(`/household/members/${m.id}`);
      if (form.id === m.id) setForm(EMPTY);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const members = hh?.members ?? [];

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          설정 / <b>가족 관리</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>가족 관리</h1>
            <p>가족(가구) 이름과 구성원을 등록·관리합니다. 구성원은 지출 명의로 쓰입니다.</p>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {/* 가구(가족) 이름 */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <h3>우리 가족</h3>
            <span className="sub">가구 이름</span>
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1 }}>
              <label>가족(가구) 이름</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isOwner}
                placeholder="우리집"
              />
            </div>
            {isOwner && (
              <button
                className="btn"
                onClick={saveName}
                disabled={!name || name === hh?.name}
                style={{ flex: 'none' }}
              >
                이름 저장
              </button>
            )}
          </div>
          {!isOwner && (
            <span className="muted" style={{ fontSize: 11.5 }}>
              가구 이름은 소유자(owner)만 변경할 수 있습니다.
            </span>
          )}
        </div>

        <div className="grid cols-2">
          {/* 구성원 목록 */}
          <div className="card pad-0" style={{ alignSelf: 'start' }}>
            <div className="card-head" style={{ padding: '18px 20px 0' }}>
              <h3>가족 구성원</h3>
              <div className="r">
                <span className="tag">{members.length}명</span>
              </div>
            </div>
            {loading ? (
              <div style={{ padding: 20 }}>
                <div className="skeleton" style={{ height: 20 }} />
              </div>
            ) : members.length === 0 ? (
              <div className="empty">
                <h3>등록된 구성원이 없어요</h3>
                <p>오른쪽에서 본인부터 추가해보세요.</p>
              </div>
            ) : (
              <div style={{ padding: '4px 12px 12px' }}>
                {members.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '11px 8px',
                      borderBottom: '1px solid var(--line)',
                    }}
                  >
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: '50%',
                        background: m.color ?? 'var(--muted)',
                        color: '#fff',
                        display: 'grid',
                        placeItems: 'center',
                        fontWeight: 700,
                        fontSize: 13,
                        flex: 'none',
                      }}
                    >
                      {m.name[0]}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ fontSize: 14 }}>{m.name}</b>
                      {m.isSelf && (
                        <span className="pill settled" style={{ marginLeft: 8 }}>
                          본인
                        </span>
                      )}
                      {m.email && (
                        <span className="pill plain" style={{ marginLeft: 6 }}>
                          로그인 · {m.role === 'owner' ? '소유자' : m.role === 'viewer' ? '뷰어' : '구성원'}
                        </span>
                      )}
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {relLabel(m.relation)}
                        {m.email ? ` · ${m.email}` : ''}
                      </div>
                    </div>
                    <button className="btn ghost sm" onClick={() => edit(m)}>
                      수정
                    </button>
                    <button
                      className="btn ghost sm"
                      style={{ color: 'var(--expense)' }}
                      onClick={() => remove(m)}
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 등록/수정 폼 */}
          <div className="card" style={{ alignSelf: 'start' }}>
            <div className="card-head">
              <h3>{editing ? '구성원 수정' : '구성원 추가'}</h3>
              {editing && (
                <div className="r">
                  <button className="btn ghost sm" onClick={() => setForm(EMPTY)}>
                    새로 추가
                  </button>
                </div>
              )}
            </div>
            <form onSubmit={submitMember} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="field">
                <label>이름</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="선영"
                  required
                />
              </div>
              <div className="field">
                <label>관계</label>
                <select
                  className="select"
                  value={form.relation}
                  onChange={(e) => setForm({ ...form, relation: e.target.value })}
                >
                  {RELATIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>색 태그</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {COLORS.map((c) => (
                    <button
                      type="button"
                      key={c}
                      onClick={() => setForm({ ...form, color: c })}
                      aria-label={c}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        background: c,
                        border: form.color === c ? '3px solid var(--ink)' : '1px solid var(--line)',
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'var(--ink-2)' }}>
                <input
                  type="checkbox"
                  checked={form.isSelf}
                  onChange={(e) => setForm({ ...form, isSelf: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: 'var(--brand)' }}
                />
                이 구성원을 <b>본인(대표)</b>으로 지정
              </label>

              {/* 로그인 정보(선택) — 앱에 로그인하는 구성원만 */}
              <div
                style={{
                  borderTop: '1px dashed var(--line-2)',
                  paddingTop: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }}>
                  로그인 정보 <span className="muted">(선택 — 앱에 로그인하는 구성원만)</span>
                </div>
                <div className="field">
                  <label>이메일</label>
                  <input
                    className="input"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="mom@example.com"
                  />
                </div>
                <div className="row">
                  <div className="field">
                    <label>
                      비밀번호 {editing && <span className="muted">(변경 시에만)</span>}
                    </label>
                    <input
                      className="input"
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="8자 이상"
                      minLength={8}
                    />
                  </div>
                  <div className="field">
                    <label>권한</label>
                    <select
                      className="select"
                      value={form.role}
                      onChange={(e) =>
                        setForm({ ...form, role: e.target.value as MemberForm['role'] })
                      }
                    >
                      <option value="owner">소유자</option>
                      <option value="member">구성원</option>
                      <option value="viewer">뷰어</option>
                    </select>
                  </div>
                </div>
                {!editing && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    앱을 안 쓰는 가족(자녀 등)은 로그인 정보를 비워두세요.
                  </span>
                )}
              </div>

              <button
                className="btn primary"
                type="submit"
                disabled={busy}
                style={{ justifyContent: 'center', padding: 11 }}
              >
                {busy ? '저장 중…' : editing ? '수정 저장' : '구성원 추가'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </>
  );
}
