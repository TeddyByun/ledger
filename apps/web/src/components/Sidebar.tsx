'use client';

import { useAuth } from '@/lib/auth';
import type { View } from '@/components/Shell';

const NAV: { view: View; label: string; group: string }[] = [
  { view: 'dashboard', label: '대시보드', group: '개요' },
  { view: 'transactions', label: '거래 내역', group: '기록' },
  { view: 'imports', label: '명세서 업로드', group: '기록' },
  { view: 'family', label: '가족 관리', group: '설정' },
  { view: 'cards', label: '카드 관리', group: '설정' },
  { view: 'payment-methods', label: '결제수단', group: '설정' },
];

export function Sidebar({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (v: View) => void;
}) {
  const { session, logout } = useAuth();
  const hh = session?.household;
  const user = session?.user;

  let lastGroup = '';
  return (
    <aside className="sidebar">
      <div className="logo">
        <div className="mark">₩</div>
        <div className="name">
          가계부<small>Ledger</small>
        </div>
      </div>

      <div className="hh">
        <div className="av">{hh?.name?.[0] ?? '가'}</div>
        <div className="info">
          <b>{hh?.name ?? '가구'}</b>
          <span>{hh?.role === 'owner' ? '소유자' : hh?.role}</span>
        </div>
      </div>

      {NAV.map((item) => {
        const showLabel = item.group !== lastGroup;
        lastGroup = item.group;
        return (
          <div key={item.view}>
            {showLabel && <div className="nav-label">{item.group}</div>}
            <nav className="nav">
              <a
                className={view === item.view ? 'active' : ''}
                onClick={() => onNavigate(item.view)}
              >
                {item.label}
              </a>
            </nav>
          </div>
        );
      })}

      <div className="side-foot">
        <div className="userchip">
          <div className="av">{user?.displayName?.[0] ?? user?.email?.[0] ?? 'U'}</div>
          <div className="info">
            <b>{user?.displayName ?? '사용자'}</b>
            <span>{user?.email}</span>
          </div>
        </div>
        <button
          className="btn ghost sm"
          style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
          onClick={() => logout()}
        >
          로그아웃
        </button>
      </div>
    </aside>
  );
}
