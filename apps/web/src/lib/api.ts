/**
 * API 베이스 주소 결정 (브라우저 런타임).
 * 1) NEXT_PUBLIC_API_BASE 가 있으면 그대로 사용.
 * 2) code-server 프록시(.../absproxy/3000 또는 .../proxy/3000) 아래면 같은 베이스에서
 *    :4000 API 프록시 경로를 유도 → .../proxy/4000/api/v1
 * 3) 그 외(일반 도메인·로컬)는 같은 오리진의 /api/v1.
 *    next.config.mjs 의 rewrites 가 이를 API 서버로 프록시한다.
 *    (브라우저의 localhost 를 가리키지 않도록 절대 http://localhost 로 두지 말 것)
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
    _base = origin + '/api/v1';
    return _base;
  }
  _base = 'http://localhost:4000/api/v1';
  return _base;
}

let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};

/**
 * 세션이 완전히 끊겼을 때(리프레시까지 실패) 호출 — AuthProvider 가 로그인 화면으로 전환.
 */
let onAuthLost: (() => void) | null = null;
export const setAuthLostHandler = (fn: (() => void) | null) => {
  onAuthLost = fn;
};

export interface Session {
  user: {
    id: number;
    email: string;
    displayName: string | null;
    isSuperAdmin?: boolean;
  };
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
    // 리프레시까지 실패 = 세션 만료 → 로그인 화면으로 전환(오류 배너 대신)
    accessToken = null;
    onAuthLost?.();
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

/**
 * Refresh 쿠키로 세션 복원. 성공 시 access 토큰 저장 + 세션 반환.
 *
 * 리프레시 토큰은 서버에서 **1회용으로 회전(rotate)** 되므로, 동시에 여러 요청이 401 을
 * 만나 각자 리프레시를 호출하면 첫 번째만 성공하고 나머지는 실패("Unauthorized")한다.
 * → 진행 중인 리프레시를 **하나로 공유**해 동시 요청이 같은 결과를 기다리게 한다.
 */
let refreshPromise: Promise<Session | null> | null = null;
function tryRefresh(): Promise<Session | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}
async function doRefresh(): Promise<Session | null> {
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
  /** 파일 업로드(multipart). content-type 은 브라우저가 boundary 로 자동 설정. */
  async upload<T>(path: string, form: FormData): Promise<T> {
    const send = () =>
      fetch(getBase() + path, {
        method: 'POST',
        body: form,
        credentials: 'include',
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      });
    let res = await send();
    if (res.status === 401) {
      if (await tryRefresh()) res = await send();
      else {
        accessToken = null;
        onAuthLost?.();
      }
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = body?.error ?? {};
      throw new ApiError(
        res.status,
        err.code ?? 'ERROR',
        err.message ?? '업로드에 실패했습니다.',
        err.details,
      );
    }
    return body as T;
  },
  /** 파일 다운로드(xlsx 등). 응답 blob 을 브라우저 저장 트리거. */
  async download(path: string, fallbackName: string): Promise<void> {
    const send = () =>
      fetch(getBase() + path, {
        credentials: 'include',
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      });
    let res = await send();
    if (res.status === 401) {
      if (await tryRefresh()) res = await send();
      else {
        accessToken = null;
        onAuthLost?.();
      }
    }
    if (!res.ok) {
      throw new ApiError(res.status, 'EXPORT_FAILED', '내보내기에 실패했습니다.');
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    let name = fallbackName;
    const m =
      cd.match(/filename\*=UTF-8''([^;]+)/i) ?? cd.match(/filename="?([^";]+)"?/i);
    if (m?.[1]) {
      try {
        name = decodeURIComponent(m[1]);
      } catch {
        name = m[1];
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
