'use client';

import { useAuth } from '@/lib/auth';
import { Login } from '@/components/Login';
import { Shell } from '@/components/Shell';

/**
 * 단일 페이지 진입점 — URL 라우팅 없이 상태로 화면 전환.
 * (code-server 등 하위경로 프록시 뒤에서 App Router 라우팅이 깨지는 문제 회피)
 */
export default function Home() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="center-screen">
        <div className="muted mono">불러오는 중…</div>
      </div>
    );
  }
  return session ? <Shell /> : <Login />;
}
