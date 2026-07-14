'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';

export function Login() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await signup({ email, password, displayName, householdName });
      // 성공 시 AuthProvider 의 session 이 세팅되어 상위에서 Shell 로 전환됨
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'INVALID_CREDENTIALS'
            ? '이메일 또는 비밀번호가 올바르지 않습니다.'
            : err.message
          : '문제가 발생했습니다.',
      );
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div className="logo" style={{ padding: '0 0 22px', justifyContent: 'center' }}>
          <div className="mark">₩</div>
          <div className="name">
            가계부<small>Ledger</small>
          </div>
        </div>

        <div className="card">
          <h1 style={{ fontFamily: 'var(--serif)', fontSize: 24, marginBottom: 4 }}>
            {mode === 'login' ? '다시 오셨네요' : '계정 만들기'}
          </h1>
          <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
            {mode === 'login'
              ? '로그인하고 이번 달 가계부를 이어서 정리하세요.'
              : '가입하면 기본 가구가 자동으로 만들어집니다.'}
          </p>

          {error && <div className="error-banner">{error}</div>}

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label htmlFor="email">이메일</label>
              <input
                id="email"
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="pw">비밀번호</label>
              <input
                id="pw"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8자 이상"
                minLength={8}
                required
              />
            </div>
            {mode === 'signup' && (
              <div className="row">
                <div className="field">
                  <label htmlFor="dn">이름</label>
                  <input
                    id="dn"
                    className="input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="테디"
                  />
                </div>
                <div className="field">
                  <label htmlFor="hh">가구 이름</label>
                  <input
                    id="hh"
                    className="input"
                    value={householdName}
                    onChange={(e) => setHouseholdName(e.target.value)}
                    placeholder="우리집"
                  />
                </div>
              </div>
            )}

            <button
              className="btn primary"
              type="submit"
              disabled={busy}
              style={{ justifyContent: 'center', padding: 12, marginTop: 4 }}
            >
              {busy ? '처리 중…' : mode === 'login' ? '로그인' : '가입하기'}
            </button>
          </form>

          <p className="muted" style={{ textAlign: 'center', fontSize: 13, marginTop: 20 }}>
            {mode === 'login' ? '계정이 없으신가요? ' : '이미 계정이 있으신가요? '}
            <a
              style={{ fontWeight: 700, cursor: 'pointer' }}
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login');
                setError(null);
              }}
            >
              {mode === 'login' ? '가입하기' : '로그인'}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
