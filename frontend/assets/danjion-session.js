(function (global) {
  'use strict';

  function danjionApiBase() {
    return (new URLSearchParams(location.search).get('apiBase') || '').replace(/\/+$/, '');
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
    createSessionFetch
  });
})(typeof window !== 'undefined' ? window : globalThis);