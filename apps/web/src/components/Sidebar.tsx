'use client';

import { useEffect, useId, useState } from 'react';
import { useAuth } from '@/lib/auth';
import type { View } from '@/components/Shell';

type NavItem = { view: View; label: string; group: string };

const NAV: NavItem[] = [
  { view: 'dashboard', label: '월별 거래 추이', group: '집계' },
  { view: 'payment-trend', label: '월별 결제수단별 지출 추이', group: '집계' },
  { view: 'forecast', label: '예상 수입•지출', group: '집계' },
  { view: 'all-transactions', label: '전체 거래', group: '거래내역' },
  { view: 'bank-transactions', label: '은행 거래', group: '거래내역' },
  { view: 'card-transactions', label: '카드 거래', group: '거래내역' },
  { view: 'family', label: '가족 관리', group: '관리' },
  { view: 'cards', label: '카드 관리', group: '관리' },
  { view: 'payment-methods', label: '결제수단', group: '관리' },
  { view: 'categories', label: '분류 관리', group: '관리' },
  { view: 'recurring-incomes', label: '정기수입', group: '관리' },
  { view: 'recurring-expenses', label: '정기지출', group: '관리' },
  { view: 'classify-keywords', label: '자동분류 키워드', group: '관리' },
  { view: 'imports', label: '명세서 업로드', group: '관리' },
];

/** 전체 운영(플랫폼) 관리자에게만 노출되는 메뉴. */
const ADMIN_NAV: NavItem[] = [
  { view: 'admin-households', label: '가구 관리', group: '운영 관리자' },
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
  const nav = user?.isSuperAdmin ? [...NAV, ...ADMIN_NAV] : NAV;

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const menuId = useId();
  const groups = [...new Set(nav.map((item) => item.group))];
  const activeGroup = nav.find((item) => item.view === view)?.group;

  // 본문 바로가기로 이동한 경우에도 현재 메뉴가 접힌 그룹 안에 숨지 않도록 한다.
  useEffect(() => {
    if (activeGroup) {
      setCollapsedGroups((current) => current[activeGroup]
        ? { ...current, [activeGroup]: false }
        : current);
    }
  }, [view, activeGroup]);
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

      <nav className="sidebar-nav" aria-label="주 메뉴">
        {groups.map((group, index) => {
          const expanded = !collapsedGroups[group];
          const panelId = `${menuId}-group-${index}`;
          return (
            <div className="nav-group" key={group}>
              <button
                type="button"
                className={`nav-group-toggle${activeGroup === group ? ' current' : ''}`}
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setCollapsedGroups((current) => ({
                  ...current,
                  [group]: !current[group],
                }))}
              >
                <span>{group}</span>
                <svg className="nav-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div className="nav" id={panelId} hidden={!expanded}>
                {nav.filter((item) => item.group === group).map((item) => (
                  <button
                    type="button"
                    key={item.view}
                    className={`nav-item${view === item.view ? ' active' : ''}`}
                    aria-current={view === item.view ? 'page' : undefined}
                    onClick={() => onNavigate(item.view)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

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
