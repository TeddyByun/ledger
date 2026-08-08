'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface AdminMember {
  id: number;
  name: string;
  email: string | null;
  role: string;
  isActive: boolean;
  isSuperAdmin: boolean;
  lastLoginAt: string | null;
}
interface AdminHousehold {
  id: number;
  name: string;
  createdAt: string;
  transactionCount: number;
  memberCount: number;
  members: AdminMember[];
}

const roleLabel = (r: string) =>
  r === 'owner' ? '소유자' : r === 'viewer' ? '뷰어' : '구성원';
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('ko-KR') : '—';

const DELETE_MSG: Record<string, string> = {
  CANNOT_DELETE_OWN_HOUSEHOLD: '본인이 소속된 가구는 삭제할 수 없습니다.',
  CONTAINS_SUPER_ADMIN: '운영 관리자가 포함된 가구는 삭제할 수 없습니다.',
  HOUSEHOLD_NOT_FOUND: '이미 삭제된 가구입니다.',
};
const CREATE_MSG: Record<string, string> = {
  EMAIL_TAKEN: '이미 사용 중인 이메일입니다.',
};

export function AdminHouseholds() {
  const { session } = useAuth();
  const myHouseholdId = session?.household.id;

  const [rows, setRows] = useState<AdminHousehold[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 추가 폼
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [withOwner, setWithOwner] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPw, setOwnerPw] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<number | null>(null);

  // 가구 이름 수정 / 구성원 편집·추가
  const [editHhId, setEditHhId] = useState<number | null>(null);
  const [editHhName, setEditHhName] = useState('');
  const [memberEditId, setMemberEditId] = useState<number | null>(null);
  const [memberName, setMemberName] = useState('');
  const [addingHhId, setAddingHhId] = useState<number | null>(null);
  const [newMemberName, setNewMemberName] = useState('');

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  };
  const saveHhName = (h: AdminHousehold) => {
    if (!editHhName.trim()) return;
    act(async () => {
      await api.patch(`/admin/households/${h.id}`, { name: editHhName.trim() });
      setEditHhId(null);
    });
  };
  const saveMemberName = (h: AdminHousehold, m: AdminMember) => {
    if (!memberName.trim()) return;
    act(async () => {
      await api.patch(`/admin/households/${h.id}/members/${m.id}`, {
        name: memberName.trim(),
      });
      setMemberEditId(null);
    });
  };
  const delMember = (h: AdminHousehold, m: AdminMember) => {
    if (!confirm(`구성원 '${m.name}'을(를) 삭제할까요?`)) return;
    act(() => api.del(`/admin/households/${h.id}/members/${m.id}`));
  };
  const addMember = (h: AdminHousehold) => {
    if (!newMemberName.trim()) return;
    act(async () => {
      await api.post(`/admin/households/${h.id}/members`, {
        name: newMemberName.trim(),
        relation: 'other',
      });
      setAddingHhId(null);
      setNewMemberName('');
    });
  };

  const load = () => {
    setLoading(true);
    api
      .get<AdminHousehold[]>('/admin/households')
      .then(setRows)
      .catch((e) =>
        setError(
          e instanceof ApiError ? e.message : '전체 가구를 불러오지 못했습니다.',
        ),
      )
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const resetForm = () => {
    setName('');
    setWithOwner(false);
    setOwnerEmail('');
    setOwnerPw('');
    setOwnerName('');
    setFormError(null);
    setCreating(false);
  };

  const submitCreate = async () => {
    if (!name.trim()) {
      setFormError('가구 이름을 입력하세요.');
      return;
    }
    if (withOwner && (!ownerEmail.trim() || ownerPw.length < 8)) {
      setFormError('소유자 이메일과 8자 이상 비밀번호를 입력하세요.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post('/admin/households', {
        name: name.trim(),
        owner: withOwner
          ? {
              email: ownerEmail.trim(),
              password: ownerPw,
              displayName: ownerName.trim() || undefined,
            }
          : undefined,
      });
      resetForm();
      load();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      setFormError(
        CREATE_MSG[code] ??
          (e instanceof ApiError ? e.message : '가구 생성에 실패했습니다.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const deleteHousehold = async (h: AdminHousehold) => {
    const ok = window.confirm(
      `"${h.name}" 가구를 완전히 삭제합니다.\n구성원 ${h.memberCount}명 · 거래 ${h.transactionCount}건과 모든 관련 데이터가 삭제되며 되돌릴 수 없습니다.\n\n삭제하시겠습니까?`,
    );
    if (!ok) return;
    setDeletingId(h.id);
    try {
      await api.del(`/admin/households/${h.id}`);
      load();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      window.alert(
        DELETE_MSG[code] ??
          (e instanceof ApiError ? e.message : '가구 삭제에 실패했습니다.'),
      );
    } finally {
      setDeletingId(null);
    }
  };

  const deleteBlockReason = (h: AdminHousehold): string | null => {
    if (h.id === myHouseholdId) return '본인 소속 가구';
    if (h.members.some((m) => m.isSuperAdmin)) return '운영 관리자 포함';
    return null;
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>가구 관리</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            플랫폼에 등록된 전체 가구 — 전체 운영 관리자 전용
          </p>
        </div>
        <div className="r" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!loading && !error && <span className="tag">{rows.length}개 가구</span>}
          {!creating && (
            <button className="btn" onClick={() => setCreating(true)}>
              + 가구 추가
            </button>
          )}
        </div>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 16, padding: 18 }}>
          <div className="card-head" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>새 가구 추가</h3>
          </div>
          <div style={{ display: 'grid', gap: 12, maxWidth: 460 }}>
            <label style={{ display: 'grid', gap: 5 }}>
              <span className="muted" style={{ fontSize: 12.5 }}>가구 이름 *</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 우리집"
                autoFocus
              />
            </label>

            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
              <input
                type="checkbox"
                checked={withOwner}
                onChange={(e) => setWithOwner(e.target.checked)}
              />
              초기 소유자 계정 함께 만들기 (로그인 가능)
            </label>

            {withOwner && (
              <div style={{ display: 'grid', gap: 10, paddingLeft: 4, borderLeft: '2px solid var(--line)' }}>
                <label style={{ display: 'grid', gap: 5, paddingLeft: 10 }}>
                  <span className="muted" style={{ fontSize: 12.5 }}>소유자 이메일 *</span>
                  <input
                    className="input"
                    type="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    placeholder="owner@example.com"
                  />
                </label>
                <label style={{ display: 'grid', gap: 5, paddingLeft: 10 }}>
                  <span className="muted" style={{ fontSize: 12.5 }}>비밀번호 * (8자 이상)</span>
                  <input
                    className="input"
                    type="password"
                    value={ownerPw}
                    onChange={(e) => setOwnerPw(e.target.value)}
                  />
                </label>
                <label style={{ display: 'grid', gap: 5, paddingLeft: 10 }}>
                  <span className="muted" style={{ fontSize: 12.5 }}>표시 이름 (선택)</span>
                  <input
                    className="input"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="예: 홍길동"
                  />
                </label>
              </div>
            )}

            {formError && (
              <p style={{ color: 'var(--danger, #BE3B2A)', fontSize: 13, margin: 0 }}>
                {formError}
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
              <button className="btn" disabled={submitting} onClick={submitCreate}>
                {submitting ? '생성 중…' : '가구 생성'}
              </button>
              <button className="btn ghost" disabled={submitting} onClick={resetForm}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 20 }}>
          <div className="skeleton" style={{ height: 20 }} />
        </div>
      ) : error ? (
        <div className="card" style={{ padding: 20 }}>
          <p style={{ color: 'var(--danger, #BE3B2A)' }}>{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <h3>등록된 가구가 없어요</h3>
          <p>위 “+ 가구 추가”로 첫 가구를 만들어보세요.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {rows.map((h) => {
            const blocked = deleteBlockReason(h);
            return (
              <div key={h.id} className="card pad-0">
                <div className="card-head" style={{ padding: '16px 20px 6px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editHhId === h.id ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          className="input"
                          value={editHhName}
                          autoFocus
                          onChange={(e) => setEditHhName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && saveHhName(h)}
                          style={{ maxWidth: 260 }}
                        />
                        <button className="btn primary sm" onClick={() => saveHhName(h)}>저장</button>
                        <button className="btn ghost sm" onClick={() => setEditHhId(null)}>취소</button>
                      </div>
                    ) : (
                      <h3 style={{ margin: 0 }}>
                        {h.name}
                        <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
                          #{h.id}
                        </span>
                      </h3>
                    )}
                    <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                      생성 {fmtDate(h.createdAt)} · 구성원 {h.memberCount}명 · 거래{' '}
                      {h.transactionCount.toLocaleString('ko-KR')}건
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                    {editHhId !== h.id && (
                      <button
                        className="btn ghost sm"
                        onClick={() => {
                          setEditHhId(h.id);
                          setEditHhName(h.name);
                        }}
                      >
                        이름 수정
                      </button>
                    )}
                    <button
                      className="btn ghost sm"
                      disabled={!!blocked || deletingId === h.id}
                      title={blocked ?? '가구 삭제'}
                      onClick={() => deleteHousehold(h)}
                      style={{ color: blocked ? undefined : 'var(--danger, #BE3B2A)' }}
                    >
                      {deletingId === h.id ? '삭제 중…' : blocked ? `삭제 불가 · ${blocked}` : '삭제'}
                    </button>
                  </div>
                </div>
                <div style={{ padding: '4px 12px 10px' }}>
                  {h.members.length === 0 ? (
                    <div className="muted" style={{ padding: '8px 8px 4px', fontSize: 13 }}>
                      구성원 없음
                    </div>
                  ) : (
                    h.members.map((m) => (
                      <div
                        key={m.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '9px 8px',
                          borderBottom: '1px solid var(--line)',
                        }}
                      >
                        <span
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            background: 'var(--muted)',
                            color: '#fff',
                            display: 'grid',
                            placeItems: 'center',
                            fontWeight: 700,
                            fontSize: 12,
                            flex: 'none',
                          }}
                        >
                          {m.name[0]}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {memberEditId === m.id ? (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input
                                className="input"
                                value={memberName}
                                autoFocus
                                onChange={(e) => setMemberName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && saveMemberName(h, m)}
                                style={{ maxWidth: 180 }}
                              />
                              <button className="btn primary sm" onClick={() => saveMemberName(h, m)}>저장</button>
                              <button className="btn ghost sm" onClick={() => setMemberEditId(null)}>취소</button>
                            </div>
                          ) : (
                            <>
                              <b style={{ fontSize: 13.5 }}>{m.name}</b>
                              {m.isSuperAdmin && (
                                <span className="pill settled" style={{ marginLeft: 8 }}>운영 관리자</span>
                              )}
                              {!m.isActive && (
                                <span className="pill plain" style={{ marginLeft: 6 }}>비활성</span>
                              )}
                              <div className="muted" style={{ fontSize: 11.5 }}>
                                {roleLabel(m.role)}
                                {m.email ? ` · ${m.email}` : ''}
                                {` · 최근 로그인 ${fmtDate(m.lastLoginAt)}`}
                              </div>
                            </>
                          )}
                        </div>
                        {memberEditId !== m.id && !m.isSuperAdmin && (
                          <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
                            <button
                              className="btn ghost sm"
                              onClick={() => {
                                setMemberEditId(m.id);
                                setMemberName(m.name);
                              }}
                            >
                              수정
                            </button>
                            <button
                              className="btn ghost sm"
                              style={{ color: 'var(--danger, #BE3B2A)' }}
                              onClick={() => delMember(h, m)}
                            >
                              삭제
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  {addingHhId === h.id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '10px 8px' }}>
                      <input
                        className="input"
                        value={newMemberName}
                        autoFocus
                        placeholder="구성원 이름"
                        onChange={(e) => setNewMemberName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addMember(h)}
                        style={{ maxWidth: 200 }}
                      />
                      <button className="btn primary sm" onClick={() => addMember(h)}>추가</button>
                      <button className="btn ghost sm" onClick={() => setAddingHhId(null)}>취소</button>
                    </div>
                  ) : (
                    <button
                      className="btn ghost sm"
                      style={{ margin: '8px' }}
                      onClick={() => {
                        setAddingHhId(h.id);
                        setNewMemberName('');
                      }}
                    >
                      + 구성원 추가
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
