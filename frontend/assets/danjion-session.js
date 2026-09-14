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

  function accountRoleLabel(authorityResult) {
    const a = authorityResult && authorityResult.ok ? authorityResult.data : null;
    if (a && a.level === 'admin' && a.wildcard === true) return '최고관리자';
    if (a && a.level === 'operator' && a.wildcard === false) return '운영관리자';
    return '일반회원';
  }

  function accountShellPathEligible(loc) {
    const where = loc || (typeof location !== 'undefined' ? location : {});
    const path = String(where.pathname || '');
    const file = path.split('/').pop() || '';
    if (path.includes('/admin/')) return false;
    return !['', 'index.html', 'index2.html', 'app.html', 'app2.html'].includes(file);
  }

  async function initAccountShell(options = {}) {
    if (typeof document === 'undefined' || typeof fetch === 'undefined') return null;
    const loc = options.location || location;
    if (!accountShellPathEligible(loc)) return null;
    const apiBase = danjionApiBase(loc);
    if (!apiBase) return null;

    const authBase = danjionAuthBase(loc);
    const session = await request(fetch, joinUrl(authBase, '/api/auth/get-session'));
    if (!nativeSessionReady(session)) return null;

    const user = session.raw.user || {};
    const email = String(user.email || '').trim() || '로그인 계정';
    const authority = await request(fetch, joinUrl(apiBase, '/api/v1/admin/authority'));
    const role = accountRoleLabel(authority);
    const adminAllowed = !!(
      authority && authority.ok && authority.data &&
      ((authority.data.level === 'admin' && authority.data.wildcard === true) ||
       (authority.data.level === 'operator' && authority.data.wildcard === false))
    );

    if (!document.getElementById('danjion-account-shell-style')) {
      const style = document.createElement('style');
      style.id = 'danjion-account-shell-style';
      style.textContent = `
        .danjion-account-shell{position:fixed;top:84px;right:16px;z-index:180;display:flex;align-items:center;gap:8px;max-width:min(620px,calc(100vw - 32px));padding:8px 10px;background:rgba(255,253,248,.97);border:1px solid rgba(16,29,48,.18);box-shadow:0 8px 28px rgba(16,29,48,.12);backdrop-filter:blur(10px);font:700 12px/1.25 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#101d30}
        .danjion-account-shell__who{display:flex;align-items:center;gap:6px;min-width:0}
        .danjion-account-shell__email{max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .danjion-account-shell__role{padding:3px 7px;border-radius:999px;background:#101d30;color:#fff;white-space:nowrap}
        .danjion-account-shell a,.danjion-account-shell button{border:1px solid rgba(16,29,48,.25);background:#fffdf8;color:#101d30;padding:6px 9px;font:800 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-decoration:none;cursor:pointer}
        .danjion-account-shell button:hover,.danjion-account-shell a:hover{background:#f1ece2}
        @media(max-width:760px){.danjion-account-shell{top:auto;right:10px;left:10px;bottom:76px;justify-content:center;flex-wrap:wrap}.danjion-account-shell__email{max-width:46vw}}
      `;
      document.head.appendChild(style);
    }

    let shell = document.querySelector('.danjion-account-shell');
    if (!shell) {
      shell = document.createElement('div');
      shell.className = 'danjion-account-shell';
      shell.setAttribute('role', 'region');
      shell.setAttribute('aria-label', '현재 로그인 계정');
      document.body.appendChild(shell);
    }

    shell.innerHTML = '';
    const who = document.createElement('div');
    who.className = 'danjion-account-shell__who';
    const emailNode = document.createElement('span');
    emailNode.className = 'danjion-account-shell__email';
    emailNode.textContent = email;
    emailNode.title = email;
    const roleNode = document.createElement('span');
    roleNode.className = 'danjion-account-shell__role';
    roleNode.textContent = role;
    who.append(emailNode, roleNode);
    shell.appendChild(who);

    if (adminAllowed) {
      const admin = document.createElement('a');
      admin.href = '/admin/';
      admin.textContent = '관리자 콘솔';
      shell.appendChild(admin);
    }

    const logout = document.createElement('button');
    logout.type = 'button';
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
      try {
        ['danjionMember','danjionSignedUp','danjionAuthPending','danjionGuest','danjionPrototypeProvider']
          .forEach(key => sessionStorage.removeItem(key));
      } catch {}
      location.href = 'index.html';
    });
    shell.appendChild(logout);

    return { email, role, adminAllowed };
  }

  if (typeof document !== 'undefined') {
    const boot = () => { initAccountShell().catch(() => {}); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }

  global.DanjionSession = Object.freeze({
    danjionApiBase,
    danjionAuthBase,
    joinUrl,
    request,
    createSessionFetch,
    nativeSessionReady,
    accountRoleLabel,
    accountShellPathEligible,
    initAccountShell,
    PRODUCTION_PAGES_HOSTNAME,
    CANONICAL_PAGES_API_BASE,
    PRODUCTION_API_BASE
  });
})(typeof window !== 'undefined' ? window : globalThis);