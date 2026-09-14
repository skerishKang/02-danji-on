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

  function clearLocalAuthMarkers() {
    try {
      ['danjionMember','danjionSignedUp','danjionAuthPending','danjionGuest','danjionPrototypeProvider']
        .forEach((key) => sessionStorage.removeItem(key));
    } catch {}
  }

  function accountStripEligible(loc) {
    const where = loc || (typeof location !== 'undefined' ? location : {});
    const file = String(where.pathname || '').split('/').pop() || '';
    if (String(where.pathname || '').includes('/admin/')) return false;
    return !['', 'index.html', 'index2.html', 'app.html', 'app2.html'].includes(file);
  }

  async function initAccountStrip(options = {}) {
    if (typeof document === 'undefined' || typeof fetch === 'undefined') return null;
    const loc = options.location || location;
    if (!accountStripEligible(loc)) return null;
    if (document.querySelector('.danjion-account-session')) return null;

    const authBase = danjionAuthBase(loc);
    const session = await request(fetch, joinUrl(authBase, '/api/auth/get-session'));
    if (!nativeSessionReady(session)) return null;

    const email = String(session.raw.user?.email || '').trim();
    if (!email) return null;

    if (!document.getElementById('danjion-account-session-style')) {
      const style = document.createElement('style');
      style.id = 'danjion-account-session-style';
      style.textContent = '.danjion-account-session{position:fixed;top:68px;right:14px;z-index:190;display:flex;align-items:center;gap:8px;max-width:min(520px,calc(100vw - 28px));padding:8px 10px;background:rgba(255,253,248,.97);border:1px solid rgba(16,29,48,.18);box-shadow:0 8px 26px rgba(16,29,48,.12);backdrop-filter:blur(10px);font:800 12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#101d30}.danjion-account-session__email{max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.danjion-account-session__logout{border:1px solid rgba(16,29,48,.25);background:#fffdf8;color:#101d30;padding:6px 9px;font:800 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}.danjion-account-session__logout:hover{background:#f1ece2}@media(max-width:760px){.danjion-account-session{top:auto;right:10px;left:10px;bottom:76px;justify-content:space-between}.danjion-account-session__email{max-width:65vw}}';
      document.head.appendChild(style);
    }

    const shell = document.createElement('div');
    shell.className = 'danjion-account-session';
    shell.setAttribute('role', 'region');
    shell.setAttribute('aria-label', '현재 로그인 계정');

    const emailNode = document.createElement('span');
    emailNode.className = 'danjion-account-session__email';
    emailNode.textContent = '현재 계정 · ' + email;
    emailNode.title = email;

    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'danjion-account-session__logout';
    logout.textContent = '로그아웃';
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      logout.textContent = '로그아웃 중';
      const result = await request(fetch, joinUrl(authBase, '/api/auth/sign-out'), {
        method: 'POST',
        body: JSON.stringify({})
      });
      if (!result.ok) {
        logout.disabled = false;
        logout.textContent = '로그아웃';
        return;
      }
      clearLocalAuthMarkers();
      location.href = 'index.html?intro=1';
    });

    shell.append(emailNode, logout);
    document.body.appendChild(shell);
    return { email };
  }

  if (typeof document !== 'undefined') {
    const bootAccountStrip = () => { initAccountStrip().catch(() => {}); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootAccountStrip, { once: true });
    else bootAccountStrip();
  }

  global.DanjionSession = Object.freeze({
    danjionApiBase,
    danjionAuthBase,
    joinUrl,
    request,
    createSessionFetch,
    nativeSessionReady,
    accountStripEligible,
    initAccountStrip,
    PRODUCTION_PAGES_HOSTNAME,
    CANONICAL_PAGES_API_BASE,
    PRODUCTION_API_BASE
  });
})(typeof window !== 'undefined' ? window : globalThis);