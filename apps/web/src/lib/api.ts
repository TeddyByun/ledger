const BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000/api/v1';

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
  const res = await fetch(BASE + path, {
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
    const res = await fetch(BASE + '/auth/refresh', {
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
