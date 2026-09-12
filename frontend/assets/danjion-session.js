(function (global) {
  'use strict';

  // Issue #419 [production promotion]: the canonical Pages hostname is the only
  // environment that auto-binds to the production API. Every other origin
  // (danjion-review.pages.dev, localhost, previews) stays fail-closed on the
  // static/demo lane unless an explicit ?apiBase= is provided.
  const PRODUCTION_PAGES_HOSTNAME = 'danjion.pages.dev';
  const PRODUCTION_API_BASE = 'https://padiem-danjion-api-production.padiem.workers.dev';

  function danjionApiBase(loc) {
    const where = loc || (typeof location !== 'undefined' ? location : {});
    let params;
    try { params = new URLSearchParams(where.search || ''); } catch { params = new URLSearchParams(); }
    if (params.has('apiBase')) {
      return String(params.get('apiBase') || '').trim().replace(/\/+$/, '');
    }
    const hostname = String(where.hostname || '').toLowerCase();
    if (hostname === PRODUCTION_PAGES_HOSTNAME) return PRODUCTION_API_BASE;
    return '';
  }

  function joinUrl(base, path) {
    const root = String(base || '').replace(/\/+$/, '');
    return `${root}${path}`;
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
      return { ok: true, status: response.status, data: payload?.data ?? null, requestId: payload?.requestId ?? null };
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

  global.DanjionSession = Object.freeze({
    danjionApiBase,
    joinUrl,
    request,
    createSessionFetch,
    PRODUCTION_PAGES_HOSTNAME,
    PRODUCTION_API_BASE
  });
})(typeof window !== 'undefined' ? window : globalThis);