/**
 * API 베이스 주소 결정 (브라우저 런타임).
 * 1) NEXT_PUBLIC_API_BASE 가 있으면 그대로 사용.
 * 2) code-server 프록시(.../absproxy/3000 또는 .../proxy/3000) 아래면 같은 베이스에서
 *    :4000 API 프록시 경로를 유도 → .../proxy/4000/api/v1
 * 3) 그 외(로컬 직접 실행)는 localhost:4000.
 */
let _base: string | null = null;
function getBase(): string {
  if (_base) return _base;
  if (process.env.NEXT_PUBLIC_API_BASE) {
    _base = process.env.NEXT_PUBLIC_API_BASE;
    return _base;
  }
  if (typeof window !== 'undefined') {
    const { origin, pathname } = window.location;
    const m = pathname.match(/^(.*)\/(?:abs)?proxy\/3000(?:\/|$)/);
    if (m) {
      _base = origin + m[1] + '/proxy/4000/api/v1';
      return _base;
    }
  }
  _base = 'http://localhost:4000/api/v1';
  return _base;
}

let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};

export interface Session {
  user: { id: number; email: string; displayName: string | null };
  household: { id: number; name: string; role: string };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { message: string; field?: string }[],
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  opts: RequestInit = {},
  retry = true,
): Promise<T> {
  const res = await fetch(getBase() + path, {
    ...opts,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...opts.headers,
    },
  });

  if (
    res.status === 401 &&
    retry &&
    !path.startsWith('/auth/refresh') &&
    !path.startsWith('/auth/login')
  ) {
    const restored = await tryRefresh();
    if (restored) return request<T>(path, opts, false);
  }

  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new ApiError(
      res.status,
      err.code ?? 'ERROR',
      err.message ?? '요청에 실패했습니다.',
      err.details,
    );
  }
  return body as T;
}

/** Refresh 쿠키로 세션 복원. 성공 시 access 토큰 저장 + 세션 반환. */
async function tryRefresh(): Promise<Session | null> {
  try {
    const res = await fetch(getBase() + '/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    accessToken = data.accessToken;
    return { user: data.user, household: data.household };
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  async login(email: string, password: string): Promise<Session> {
    const data = await request<{ accessToken: string } & Session>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    );
    accessToken = data.accessToken;
    return { user: data.user, household: data.household };
  },
  async signup(input: {
    email: string;
    password: string;
    displayName?: string;
    householdName?: string;
  }): Promise<Session> {
    const data = await request<{ accessToken: string } & Session>(
      '/auth/signup',
      { method: 'POST', body: JSON.stringify(input) },
    );
    accessToken = data.accessToken;
    return { user: data.user, household: data.household };
  },
  restore: tryRefresh,
  async logout() {
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    accessToken = null;
  },
};
