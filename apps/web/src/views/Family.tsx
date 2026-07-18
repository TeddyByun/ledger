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
const roleLabel = (r: string | null) =>
  r === 'owner' ? '소유자' : r === 'viewer' ? '뷰어' : '구성원';

type Mode = 'none' | 'view' | 'edit' | 'create';

interface MemberForm {
  id?: number;
  name: string;
  relation: string;
  isSelf: boolean;
  color: string;
  email: string;
  password: string;
  passwordConfirm: string;
  role: 'owner' | 'member' | 'viewer';
}
const EMPTY: MemberForm = {
  name: '',
  relation: 'spouse',
  isSelf: false,
  color: COLORS[1]!,
  email: '',
  password: '',
  passwordConfirm: '',
  role: 'member',
};

export function Family() {
  const { session } = useAuth();
  const isOwner = session?.household.role === 'owner';
  const [hh, setHh] = useState<HouseholdInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');

  const [mode, setMode] = useState<Mode>('none');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<MemberForm>(EMPTY);
  const [busy, setBusy] = useState(false);

  const members = hh?.members ?? [];
  const selected = members.find((m) => m.id === selectedId) ?? null;

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

  // 좌측 이름 클릭 → 정보 보기
  const viewMember = (m: HouseholdMember) => {
    setError(null);
    setSelectedId(m.id);
    setMode('view');
  };

  // 정보 → 수정
  const startEdit = () => {
    if (!selected) return;
    setForm({
      id: selected.id,
      name: selected.name,
      relation: selected.relation ?? 'other',
      isSelf: selected.isSelf,
      color: selected.color ?? COLORS[0]!,
      email: selected.email ?? '',
      password: '',
      passwordConfirm: '',
      role: selected.role ?? 'member',
    });
    setMode('edit');
  };

  // 하단 구성원 추가
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

  const submitMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // 비밀번호 확인 일치 검사(입력한 경우에만)
    if (form.password && form.password !== form.passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        relation: form.relation,
        isSelf: form.isSelf,
        color: form.color,
      };
      if (form.email) body.email = form.email;
      if (form.email) body.role = form.role;
      if (form.password) body.password = form.password;

      if (mode === 'edit' && form.id !== undefined) {
        await api.patch(`/household/members/${form.id}`, body);
        await load();
        setSelectedId(form.id);
      } else {
        const created = await api.post<HouseholdMember>('/household/members', body);
        await load();
        setSelectedId(created?.id ?? null);
      }
      setMode('view');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: HouseholdMember) => {
    if (!confirm(`구성원 '${m.name}'을(를) 삭제할까요?`)) return;
    setError(null);
    try {
      await api.del(`/household/members/${m.id}`);
      await load();
      if (selectedId === m.id) {
        setSelectedId(null);
        setMode('none');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const editing = mode === 'edit' || mode === 'create';

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          관리 / <b>가족 관리</b>
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
                <p>아래 “+ 구성원 추가”로 본인부터 등록해보세요.</p>
              </div>
            ) : (
              <div style={{ padding: '4px 12px 4px' }}>
                {members.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => viewMember(m)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '11px 8px',
                      borderBottom: '1px solid var(--line)',
                      cursor: 'pointer',
                      borderRadius: 8,
                      background:
                        selectedId === m.id ? 'var(--brand-soft)' : 'transparent',
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
                          로그인 · {roleLabel(m.role)}
                        </span>
                      )}
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {relLabel(m.relation)}
                        {m.email ? ` · ${m.email}` : ''}
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
                + 구성원 추가
              </button>
            </div>
          </div>

          {/* 우측: 구성원 정보 / 수정 / 추가 */}
          <div className="card" style={{ alignSelf: 'start' }}>
            <div className="card-head">
              <h3>
                {mode === 'create'
                  ? '구성원 추가'
                  : mode === 'edit'
                    ? '구성원 정보 수정'
                    : '구성원 정보'}
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

            {/* 보기 모드 */}
            {mode === 'view' && selected ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      background: selected.color ?? 'var(--muted)',
                      color: '#fff',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 700,
                      fontSize: 18,
                      flex: 'none',
                    }}
                  >
                    {selected.name[0]}
                  </span>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>
                      {selected.name}
                      {selected.isSelf && (
                        <span className="pill settled" style={{ marginLeft: 8 }}>
                          본인
                        </span>
                      )}
                    </div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      {relLabel(selected.relation)}
                    </div>
                  </div>
                </div>
                <Info label="이메일" value={selected.email || '미사용'} />
                <Info
                  label="로그인 권한"
                  value={selected.email ? roleLabel(selected.role) : '로그인 미사용'}
                />
              </div>
            ) : editing ? (
              /* 수정 / 추가 폼 */
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
                  <div className="row">
                    <div className="field">
                      <label>
                        비밀번호 {mode === 'edit' && <span className="muted">(변경 시에만)</span>}
                      </label>
                      <input
                        className="input"
                        type="password"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        placeholder="8자 이상"
                        minLength={8}
                        autoComplete="new-password"
                      />
                    </div>
                    <div className="field">
                      <label>비밀번호 확인</label>
                      <input
                        className="input"
                        type="password"
                        value={form.passwordConfirm}
                        onChange={(e) => setForm({ ...form, passwordConfirm: e.target.value })}
                        placeholder="한 번 더 입력"
                        minLength={8}
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                  {mode === 'create' && (
                    <span className="muted" style={{ fontSize: 11 }}>
                      앱을 안 쓰는 가족(자녀 등)은 로그인 정보를 비워두세요.
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn primary"
                    type="submit"
                    disabled={busy}
                    style={{ flex: 1, justifyContent: 'center', padding: 11 }}
                  >
                    {busy ? '저장 중…' : mode === 'edit' ? '수정 저장' : '구성원 추가'}
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
              /* 아무것도 선택 안 함 */
              <div className="empty">
                <h3>구성원을 선택하세요</h3>
                <p>왼쪽에서 이름을 클릭하면 정보가 표시됩니다.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div style={{ fontSize: 14, padding: '2px 0' }}>{value}</div>
    </div>
  );
}
