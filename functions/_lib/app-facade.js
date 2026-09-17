// Issue #469: canonical same-origin application API facade (Cloudflare Pages Function).
//
// Browser requests to https://danjion.pages.dev/api/v1/* arrive with the
// first-party Better Auth session cookie. This facade forwards those requests
// server-side to the fixed production Worker so protected application APIs see
// the same session without any browser cross-origin cookie dependency.
//
// Fail-closed guarantees:
//   * exact production or QA Pages origins only;
//   * /api/v1/* only;
//   * fixed Worker upstream, never client-controlled;
//   * no client-controlled auth, no dev bypass, no grant widening;
//   * first-party session cookies may be resolved server-side through Better
//     Auth get-session and its set-auth-jwt header for the Worker's bearer-only
//     auth boundary;
//   * Worker remains final authentication/authorization authority.

export const APP_FACADE_MARKER = 'danjion-app-facade/v1';
export const CANONICAL_PAGES_ORIGIN = 'https://danjion.pages.dev';
export const QA_PAGES_ORIGIN = 'https://danjion-qa.pages.dev';
export const WORKER_API_BASE = 'https://padiem-danjion-api-production.padiem.workers.dev';
export const QA_WORKER_API_BASE = 'https://padiem-danjion-api-qa.padiem.workers.dev';
export const APP_PROXY_PREFIX = '/api/v1/';

const HOP_BY_HOP = new Set([
  'host', 'connection', 'keep-alive', 'upgrade', 'transfer-encoding',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer'
]);

const GUARDED_HEADERS = new Set(['origin', 'x-forwarded-host', 'x-forwarded-proto', 'authorization']);
const AUTH_SESSION_PATH = '/api/auth/get-session';
const AUTH_TOKEN_PATH = '/api/auth/token';
const AUTH_FACADE_MARKER_HEADER = 'x-danjion-auth-facade';
const AUTH_FACADE_MARKER_VALUE = 'canonical-pages-v1';

function looksLikeJwt(value) {
  return typeof value === 'string' && value.split('.').length === 3 && value.length > 32;
}

function betterAuthSessionToken(cookieHeader) {
  const matches = [];
  for (const part of String(cookieHeader || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!/^(?:__Secure-|__Host-)?better-auth\.session_token$/.test(name)) continue;
    let value = part.slice(eq + 1).trim();
    try { value = decodeURIComponent(value); } catch {}
    if (value && !/\s/.test(value) && value.length >= 20 && value.length <= 1024) matches.push(value);
  }
  return matches.length === 1 ? matches[0] : null;
}

async function bearerFromSessionCookie(fetchImpl, request, url, upstreamBase) {
  const cookie = request.headers.get('cookie') || '';
  if (!cookie.trim()) return { bearer: null, disposition: 'no-cookie' };

  const headers = new Headers();
  headers.set('cookie', cookie);
  headers.set('origin', url.origin === QA_PAGES_ORIGIN ? QA_PAGES_ORIGIN : CANONICAL_PAGES_ORIGIN);
  headers.set(AUTH_FACADE_MARKER_HEADER, AUTH_FACADE_MARKER_VALUE);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', 'https');

  const sessionResponse = await fetchImpl(new Request(
    new URL(AUTH_SESSION_PATH, upstreamBase).toString(),
    { method: 'GET', headers, redirect: 'manual' }
  ));

  if (!sessionResponse.ok) return { bearer: null, disposition: 'session-failed' };

  let payload = null;
  try { payload = await sessionResponse.clone().json(); } catch {}
  const sessionReady = !!(
    payload && typeof payload === 'object' &&
    payload.session && payload.user
  );
  if (!sessionReady) return { bearer: null, disposition: 'session-invalid' };

  const directJwt = sessionResponse.headers.get('set-auth-jwt');
  if (looksLikeJwt(directJwt)) return { bearer: directJwt, disposition: 'direct-jwt' };

  // Better Auth's JWT /token endpoint accepts the opaque session token through
  // the Bearer plugin. Extract it only inside this server-side Pages Function;
  // neither the opaque session token nor the resulting JWT is returned to the
  // browser. This fallback is used only when a real get-session succeeded but
  // its set-auth-jwt header was absent or unusable.
  const sessionToken = betterAuthSessionToken(cookie);
  if (!sessionToken) return { bearer: null, disposition: 'no-session-token' };

  const tokenHeaders = new Headers(headers);
  tokenHeaders.set('authorization', `Bearer ${sessionToken}`);
  const tokenResponse = await fetchImpl(new Request(
    new URL(AUTH_TOKEN_PATH, upstreamBase).toString(),
    { method: 'GET', headers: tokenHeaders, redirect: 'manual' }
  ));
  if (!tokenResponse.ok) return { bearer: null, disposition: 'token-failed' };

  let tokenPayload = null;
  try { tokenPayload = await tokenResponse.json(); } catch {}
  const fallbackJwt = tokenPayload && typeof tokenPayload === 'object' ? tokenPayload.token : null;
  return looksLikeJwt(fallbackJwt)
    ? { bearer: fallbackJwt, disposition: 'fallback-jwt' }
    : { bearer: null, disposition: 'token-invalid' };
}

export function isAppProxiedPath(pathname) {
  return pathname.startsWith(APP_PROXY_PREFIX);
}

export async function appFacadeFetch(context, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const { request, env } = context;
  const url = new URL(request.url);

  const upstreamBase = url.origin === CANONICAL_PAGES_ORIGIN
    ? WORKER_API_BASE
    : url.origin === QA_PAGES_ORIGIN
      ? QA_WORKER_API_BASE
      : null;
  if (!upstreamBase) {
    return new Response('not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  if (!isAppProxiedPath(url.pathname)) {
    return env.ASSETS.fetch(request);
  }

  const upstream = new URL(url.pathname, upstreamBase);
  upstream.search = url.search;

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || GUARDED_HEADERS.has(lower)) continue;
    headers.set(name, value);
  }
  headers.set('origin', url.origin === QA_PAGES_ORIGIN ? QA_PAGES_ORIGIN : CANONICAL_PAGES_ORIGIN);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', 'https');

  // The browser owns only the first-party Better Auth session cookie. If that
  // session can be exchanged for a JWKS-verifiable JWT, attach it only to the
  // fixed server-to-server Worker request. Client-supplied Authorization is
  // always stripped above and can never become Worker authority.
  const bridge = await bearerFromSessionCookie(fetchImpl, request, url, upstreamBase);
  if (bridge.bearer) headers.set('authorization', `Bearer ${bridge.bearer}`);

  const method = request.method.toUpperCase();
  const upstreamRequest = new Request(upstream.toString(), {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : request.body,
    duplex: 'half',
    redirect: 'manual'
  });

  const upstreamResponse = await fetchImpl(upstreamRequest);
  const outHeaders = new Headers();
  for (const [name, value] of upstreamResponse.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'set-cookie') continue;
    outHeaders.set(name, value);
  }

  // Application APIs never mint browser auth state or expose the exchanged JWT.
  // Session-cookie ownership remains with the existing Better Auth facade under
  // /api/auth/*; the JWT exists only on this server-to-server hop.
  outHeaders.set('x-danjion-app-facade', APP_FACADE_MARKER);
  outHeaders.set('x-danjion-auth-bridge', bridge.disposition);
  outHeaders.set('cache-control', 'no-store');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: outHeaders
  });
}
