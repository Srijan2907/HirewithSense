import type { AuthResponse } from '@hws/shared';
import { useAuth } from './auth-store';

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const V1 = `${API_BASE}/api/v1`;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

let refreshing: Promise<string | null> | null = null;

/** Rotate the refresh cookie for a new access token. Shared across concurrent 401s. */
export async function refreshSession(): Promise<string | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${V1}/auth/refresh`, { method: 'POST', credentials: 'include' });
        if (!res.ok) {
          useAuth.getState().clear();
          return null;
        }
        const data = (await res.json()) as AuthResponse;
        useAuth.getState().setSession(data.user, data.accessToken);
        return data.accessToken;
      } catch {
        return null;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip auth header / refresh handling. */
  anonymous?: boolean;
  raw?: boolean;
}

async function parseError(res: Response): Promise<ApiError> {
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    /* non-json */
  }
  const err = payload?.error ?? {};
  return new ApiError(res.status, err.code ?? 'http_error', err.message ?? res.statusText ?? 'Request failed', err.details, err.requestId);
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, anonymous, raw, headers: extraHeaders, ...init } = opts;
  const doFetch = async (token: string | null) => {
    const headers = new Headers(extraHeaders);
    if (!(body instanceof FormData) && body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (token && !anonymous) headers.set('authorization', `Bearer ${token}`);
    return fetch(`${V1}${path}`, {
      ...init,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  };

  let res = await doFetch(useAuth.getState().accessToken);
  if (res.status === 401 && !anonymous) {
    const token = await refreshSession();
    if (token) res = await doFetch(token);
  }
  if (!res.ok) throw await parseError(res);
  if (raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const get = <T>(path: string, opts?: RequestOptions) => api<T>(path, { ...opts, method: 'GET' });
export const post = <T>(path: string, body?: unknown, opts?: RequestOptions) => api<T>(path, { ...opts, method: 'POST', body });
export const put = <T>(path: string, body?: unknown, opts?: RequestOptions) => api<T>(path, { ...opts, method: 'PUT', body });
export const patch = <T>(path: string, body?: unknown, opts?: RequestOptions) => api<T>(path, { ...opts, method: 'PATCH', body });
export const del = <T>(path: string, opts?: RequestOptions) => api<T>(path, { ...opts, method: 'DELETE' });

/**
 * Stream a server-sent-events POST endpoint (used for the interviewer's next question). Uses fetch so the
 * Authorization header can be sent; EventSource cannot do that.
 */
export async function streamSse<T>(path: string, onEvent: (ev: T) => void, opts: { body?: unknown; signal?: AbortSignal } = {}): Promise<void> {
  const run = async (token: string | null) => {
    const headers: Record<string, string> = { accept: 'text/event-stream' };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    return fetch(`${V1}${path}`, { method: 'POST', headers, credentials: 'include', body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: opts.signal });
  };
  let res = await run(useAuth.getState().accessToken);
  if (res.status === 401) {
    const token = await refreshSession();
    if (token) res = await run(token);
  }
  if (!res.ok) throw await parseError(res);
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (line) onEvent(JSON.parse(line.slice(5).trim()) as T);
    }
  }
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const data = await post<AuthResponse>('/auth/login', { email, password }, { anonymous: true });
  useAuth.getState().setSession(data.user, data.accessToken);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await post('/auth/logout', undefined, { anonymous: true });
  } finally {
    useAuth.getState().clear();
  }
}

export function adoptSession(data: AuthResponse) {
  useAuth.getState().setSession(data.user, data.accessToken);
}
