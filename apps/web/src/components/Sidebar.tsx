'use client';

import { useAuth } from '@/lib/auth';
import type { View } from '@/components/Shell';

const NAV: { view: View; label: string; group: string }[] = [
  { view: 'dashboard', label: '월별 거래 추이', group: '집계' },
  { view: 'payment-trend', label: '월별 결제수단별 지출 추이', group: '집계' },
  { view: 'all-transactions', label: '전체 거래', group: '거래내역' },
  { view: 'bank-transactions', label: '은행 거래', group: '거래내역' },
  { view: 'card-transactions', label: '카드 거래', group: '거래내역' },
  { view: 'family', label: '가족 관리', group: '관리' },
  { view: 'cards', label: '카드 관리', group: '관리' },
  { view: 'payment-methods', label: '결제수단', group: '관리' },
  { view: 'categories', label: '분류 관리', group: '관리' },
  { view: 'imports', label: '명세서 업로드', group: '관리' },
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
