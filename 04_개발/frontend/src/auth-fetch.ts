import { getProductApiBearerToken } from './auth-client';
import { authProvider, type AuthSurface } from './auth';

const DANJION_AUTH_MODE = import.meta.env.VITE_AUTH_MODE === 'danjion';
const TOKEN_REFRESH_SKEW_MS = 30_000;
const FALLBACK_CACHE_MS = 30_000;

type CachedToken = {
  token: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;
let tokenRequest: Promise<string> | null = null;

function jwtExpiryMs(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof decoded.exp === 'number' ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function freshBearerToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_SKEW_MS) {
    return cachedToken.token;
  }
  if (tokenRequest) return tokenRequest;

  tokenRequest = (async () => {
    const token = await getProductApiBearerToken();
    if (!token) throw new Error('로그인이 필요합니다.');
    const jwtExpiry = jwtExpiryMs(token);
    cachedToken = {
      token,
      expiresAt: jwtExpiry ?? Date.now() + FALLBACK_CACHE_MS
    };
    return token;
  })();

  try {
    return await tokenRequest;
  } finally {
    tokenRequest = null;
  }
}

export function clearProductApiBearerTokenCache(): void {
  cachedToken = null;
  tokenRequest = null;
}

async function authHeaders(surface: AuthSurface, forceRefresh = false): Promise<Headers> {
  const headers = new Headers();
  if (!DANJION_AUTH_MODE) {
    const legacy = new Headers(authProvider.headers(surface));
    legacy.forEach((value, key) => headers.set(key, value));
    return headers;
  }

  if (forceRefresh) clearProductApiBearerTokenCache();
  const token = await freshBearerToken();
  headers.set('authorization', `Bearer ${token}`);
  return headers;
}

function mergeHeaders(base: HeadersInit | undefined, auth: Headers): Headers {
  const headers = new Headers(base);
  auth.forEach((value, key) => headers.set(key, value));
  return headers;
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  surface: AuthSurface = 'resident'
): Promise<Response> {
  const firstAuth = await authHeaders(surface);
  const first = await fetch(input, {
    ...init,
    headers: mergeHeaders(init.headers, firstAuth)
  });

  if (!DANJION_AUTH_MODE || first.status !== 401) return first;

  const refreshedAuth = await authHeaders(surface, true);
  return fetch(input, {
    ...init,
    headers: mergeHeaders(init.headers, refreshedAuth)
  });
}
