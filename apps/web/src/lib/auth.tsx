'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, setAccessToken, type Session } from './api';

interface AuthState {
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: {
    email: string;
    password: string;
    displayName?: string;
    householdName?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 새로고침 시 Refresh 쿠키로 세션 복원
    api.restore().then((s) => {
      setSession(s);
      setLoading(false);
    });
  }, []);

  const login = async (email: string, password: string) => {
    setSession(await api.login(email, password));
  };
  const signup: AuthState['signup'] = async (input) => {
    setSession(await api.signup(input));
  };
  const logout = async () => {
    await api.logout();
    setAccessToken(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
