// Issue #469: canonical same-origin application API facade (Cloudflare Pages Function).
//
// Browser requests to https://danjion.pages.dev/api/v1/* arrive with the
// first-party Better Auth session cookie. This facade forwards those requests
// server-side to the fixed production Worker so protected application APIs see
// the same session without any browser cross-origin cookie dependency.
//
// Fail-closed guarantees:
//   * canonical Pages origin only;
//   * /api/v1/* only;
//   * fixed Worker upstream, never client-controlled;
//   * no auth minting, no dev bypass, no grant widening;
//   * Worker remains final authentication/authorization authority.

export const APP_FACADE_MARKER = 'danjion-app-facade/v1';
export const CANONICAL_PAGES_ORIGIN = 'https://danjion.pages.dev';
export const WORKER_API_BASE = 'https://padiem-danjion-api-production.padiem.workers.dev';
export const APP_PROXY_PREFIX = '/api/v1/';

const HOP_BY_HOP = new Set([
  'host', 'connection', 'keep-alive', 'upgrade', 'transfer-encoding',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer'
]);

const GUARDED_HEADERS = new Set(['origin', 'x-forwarded-host', 'x-forwarded-proto']);

export function isAppProxiedPath(pathname) {
  return pathname.startsWith(APP_PROXY_PREFIX);
}

export async function appFacadeFetch(context, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const { request, env } = context;
  const url = new URL(request.url);

  if (url.origin !== CANONICAL_PAGES_ORIGIN) {
    return new Response('not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  if (!isAppProxiedPath(url.pathname)) {
    return env.ASSETS.fetch(request);
  }

  const upstream = new URL(url.pathname, WORKER_API_BASE);
  upstream.search = url.search;

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || GUARDED_HEADERS.has(lower)) continue;
    headers.set(name, value);
  }
  headers.set('origin', CANONICAL_PAGES_ORIGIN);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', 'https');

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

  // A protected application API must not mint browser auth state. Session-cookie
  // ownership remains with the existing Better Auth facade under /api/auth/*.
  outHeaders.set('x-danjion-app-facade', APP_FACADE_MARKER);
  outHeaders.set('cache-control', 'no-store');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: outHeaders
  });
}
