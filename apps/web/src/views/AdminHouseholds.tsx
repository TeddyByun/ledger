'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

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

export function AdminHouseholds() {
  const [rows, setRows] = useState<AdminHousehold[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AdminHousehold[]>('/admin/households')
      .then((r) => setRows(r))
      .catch((e) =>
        setError(
          e instanceof ApiError ? e.message : '전체 가구를 불러오지 못했습니다.',
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>가구 관리</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            플랫폼에 등록된 전체 가구 — 전체 운영 관리자 전용
          </p>
        </div>
        {!loading && !error && (
          <span className="tag">{rows.length}개 가구</span>
        )}
      </div>

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
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {rows.map((h) => (
            <div key={h.id} className="card pad-0">
              <div
                className="card-head"
                style={{ padding: '16px 20px 6px' }}
              >
                <div>
                  <h3 style={{ margin: 0 }}>
                    {h.name}
                    <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
                      #{h.id}
                    </span>
                  </h3>
                  <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                    생성 {fmtDate(h.createdAt)} · 구성원 {h.memberCount}명 · 거래{' '}
                    {h.transactionCount.toLocaleString('ko-KR')}건
                  </div>
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
                        <b style={{ fontSize: 13.5 }}>{m.name}</b>
                        {m.isSuperAdmin && (
                          <span className="pill settled" style={{ marginLeft: 8 }}>
                            운영 관리자
                          </span>
                        )}
                        {!m.isActive && (
                          <span className="pill plain" style={{ marginLeft: 6 }}>
                            비활성
                          </span>
                        )}
                        <div className="muted" style={{ fontSize: 11.5 }}>
                          {roleLabel(m.role)}
                          {m.email ? ` · ${m.email}` : ''}
                          {` · 최근 로그인 ${fmtDate(m.lastLoginAt)}`}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
