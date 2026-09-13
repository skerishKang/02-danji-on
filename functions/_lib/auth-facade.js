// Issue #444 Stage 1: dormant canonical same-origin auth facade (Cloudflare Pages Function).
//
// The facade proxies ONLY Better Auth / api-auth traffic from the canonical Pages
// origin to the production Worker, so a later frontend cutover can observe the
// session cookie first-party (PAGES_TO_WORKER_SESSION_OBSERVABILITY). In Stage 1
// the frontend still resolves the Worker base directly via DanjionSession;
// nothing in frontend/ links to these routes yet, so the facade stays dormant.
//
// Fail-closed guarantees:
//   * only https://danjion.pages.dev may invoke the proxy (preview/localhost 404);
//   * only /api/auth/* and /auth/social-start are proxied; every other path
//     falls through to the static asset router;
//   * the Worker keeps full ownership of state checks, CSRF, origin validation
//     and cookie hardening — the facade forwards bytes, it never mints auth.

export const AUTH_FACADE_MARKER = 'danjion-auth-facade/v1';
export const CANONICAL_PAGES_ORIGIN = 'https://danjion.pages.dev';
export const WORKER_API_BASE = 'https://padiem-danjion-api-production.padiem.workers.dev';
export const EXPECTED_GOOGLE_REDIRECT_URI = `${CANONICAL_PAGES_ORIGIN}/api/auth/callback/google`;

// Fixed internal request marker: the Worker's bounded public-base resolver only
// switches to the canonical Pages auth base when it sees this exact value plus
// the exact canonical Origin — both written by the facade itself, never taken
// from the client.
export const FACADE_REQUEST_MARKER_HEADER = 'x-danjion-auth-facade';
export const FACADE_REQUEST_MARKER_VALUE = 'canonical-pages-v1';

export const AUTH_PROXY_PREFIX = '/api/auth/';
export const SOCIAL_START_PATH = '/auth/social-start';

const HOP_BY_HOP = new Set([
  'host', 'connection', 'keep-alive', 'upgrade', 'transfer-encoding',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer'
]);

// Client-supplied authority signals must never reach the Worker through the
// facade: Origin is re-pinned and the internal marker is stripped and rewritten.
const FORGED_GUARDED_HEADERS = new Set(['origin', FACADE_REQUEST_MARKER_HEADER]);

export function isAuthProxiedPath(pathname) {
  return pathname.startsWith(AUTH_PROXY_PREFIX) || pathname === SOCIAL_START_PATH;
}

export async function authFacadeFetch(context, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const { request, env } = context;
  const url = new URL(request.url);

  if (url.origin !== CANONICAL_PAGES_ORIGIN) {
    return new Response('not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  if (!isAuthProxiedPath(url.pathname)) {
    return env.ASSETS.fetch(request);
  }

  const upstream = new URL(url.pathname, WORKER_API_BASE);
  upstream.search = url.search;

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || FORGED_GUARDED_HEADERS.has(lower)) continue;
    headers.set(name, value);
  }
  headers.set('origin', CANONICAL_PAGES_ORIGIN);
  headers.set(FACADE_REQUEST_MARKER_HEADER, FACADE_REQUEST_MARKER_VALUE);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));

  const method = request.method.toUpperCase();
  const upstreamRequest = new Request(upstream.toString(), {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : request.body,
    // duplex is required by Node's undici when streaming a body and is ignored
    // by the Workers runtime, so the module stays testable outside Cloudflare.
    duplex: 'half',
    redirect: 'manual'
  });

  const upstreamResponse = await fetchImpl(upstreamRequest);

  const outHeaders = new Headers();
  for (const [name, value] of upstreamResponse.headers) {
    const lower = name.toLowerCase();
    if (lower === 'set-cookie' || HOP_BY_HOP.has(lower)) continue;
    outHeaders.set(name, value);
  }
  const setCookies = typeof upstreamResponse.headers.getSetCookie === 'function'
    ? upstreamResponse.headers.getSetCookie()
    : [];
  for (const cookie of setCookies) outHeaders.append('set-cookie', cookie);
  outHeaders.set('x-danjion-auth-facade', AUTH_FACADE_MARKER);
  outHeaders.set('cache-control', 'no-store');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: outHeaders
  });
}
