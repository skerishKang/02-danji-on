(function (global) {
  'use strict';

  // Issue #469: canonical Pages application API traffic is first-party too.
  // Browser requests bind to the canonical Pages origin; a bounded Pages Function
  // forwards /api/v1/* to the fixed production Worker with the first-party
  // session cookie. Preview/local origins remain fail-closed unless an explicit
  // ?apiBase= is supplied.
  const PRODUCTION_PAGES_HOSTNAME = 'danjion.pages.dev';
  const CANONICAL_PAGES_API_BASE = 'https://danjion.pages.dev';
  const PRODUCTION_API_BASE = 'https://padiem-danjion-api-production.padiem.workers.dev';

  function danjionApiBase(loc) {
    const where = loc || (typeof location !== 'undefined' ? location : {});
    const hostname = String(where.hostname || '').toLowerCase();

    // Security boundary: canonical production always stays same-origin. Query
    // parameters can never redirect application API traffic off the Pages host.
    if (hostname === PRODUCTION_PAGES_HOSTNAME) return CANONICAL_PAGES_API_BASE;

    let params;
    try { params = new URLSearchParams(where.search || ''); } catch { params = new URLSearchParams(); }
    if (params.has('apiBase')) {
      return String(params.get('apiBase') || '').trim().replace(/\/+$/, '');
    }
    return '';
  }

  function joinUrl(base, path) {
    const root = String(base || '').replace(/\/+$/, '');
    return `${root}${path}`;
  }

  // Issue #444 Stage 2 [frontend cutover]: browser Better Auth traffic
  // (social-start, get-session, sign-in/sign-up email, forget-password and every
  // other /api/auth/* call) binds the canonical Pages same-origin facade
  // (functions/_lib/auth-facade.js) instead of the Worker absolute base:
  //   * danjion.pages.dev always resolves to '' so auth requests are same-origin
  //     relative URLs served by the Pages Function facade; query parameters can
  //     never override the canonical production auth destination;
  //   * outside canonical production, an explicit ?apiBase= keeps its #419
  //     controlled-preview meaning and routes through the operator-configured
  //     base unchanged;
  //   * every other origin (previews, localhost, spoofed suffixes) resolves to
  //     '' with serverMode off — the demo lane never emits auth traffic, and the
  //     facade itself fail-closes (404) for any non-canonical origin.
  // danjionApiBase() itself is untouched: general application API traffic
  // remains bound to the production Worker.
  function danjionAuthBase(loc) {
    const where = loc || (typeof location !== 'undefined' ? location : {});
    const hostname = String(where.hostname || '').toLowerCase();

    // Security boundary: production Better Auth must remain on the canonical
    // same-origin Pages facade even if a crafted link supplies ?apiBase=.
    if (hostname === PRODUCTION_PAGES_HOSTNAME) return '';

    let params;
    try { params = new URLSearchParams(where.search || ''); } catch { params = new URLSearchParams(); }
    if (params.has('apiBase')) {
      return String(params.get('apiBase') || '').trim().replace(/\/+$/, '');
    }
    return '';
  }

  async function request(fetchImpl, url, init = {}) {
    try {
      const response = await fetchImpl(url, {
        ...init,
        credentials: 'include',
        headers: {
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(init.headers || {})
        }
      });
      let payload;
      try { payload = await response.json(); } catch { payload = null; }
      if (!response.ok) {
        const error = payload?.error || null;
        if (response.status === 401 || response.status === 403) {
          return { ok: false, reason: 'auth-required', status: response.status, error };
        }
        return { ok: false, reason: 'server-error', status: response.status, error };
      }
      return { ok: true, status: response.status, data: payload?.data ?? null, raw: payload, requestId: payload?.requestId ?? null };
    } catch (error) {
      return { ok: false, reason: 'network-error', status: 0, error };
    }
  }

  function createSessionFetch(apiBase) {
    const base = String(apiBase || '').replace(/\/+$/, '');
    return function sessionFetch(fetchImpl, path, init = {}) {
      return request(fetchImpl, joinUrl(base, path), init);
    };
  }

  // #444: Better Auth /api/auth/get-session answers natively — { session, user }
  // when authenticated, null when not — never the DanjiOn { data } envelope.
  function nativeSessionReady(result) {
    return !!(result && result.ok && result.raw && typeof result.raw === 'object' && result.raw.session && result.raw.user);
  }

  global.DanjionSession = Object.freeze({
    danjionApiBase,
    danjionAuthBase,
    joinUrl,
    request,
    createSessionFetch,
    nativeSessionReady,
    PRODUCTION_PAGES_HOSTNAME,
    CANONICAL_PAGES_API_BASE,
    PRODUCTION_API_BASE
  });
})(typeof window !== 'undefined' ? window : globalThis);