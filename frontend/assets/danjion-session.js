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

  // Admin resident-exemption My Info lane: non-entry pages must never carry
  // Better Auth endpoint literals themselves (leaf-b14 Stage 2 invariant), so
  // the get-session read is exposed through this sanctioned auth runtime and
  // binds danjionAuthBase() exactly like the account strip does — canonical
  // Pages stays same-origin relative and a crafted ?apiBase= can never move it.
  function fetchSession(fetchImpl, loc) {
    const authBase = danjionAuthBase(loc);
    return request(fetchImpl, joinUrl(authBase, '/api/auth/get-session'));
  }

  // Better Auth officially exposes listAccounts for the current session. Keep
  // provider detection in this shared runtime so product pages never infer a
  // login method from an email domain or duplicate auth endpoint literals.
  function fetchLinkedAccounts(fetchImpl, loc) {
    const authBase = danjionAuthBase(loc);
    return request(fetchImpl, joinUrl(authBase, '/api/auth/list-accounts'));
  }

  function linkedProviderIds(result) {
    if (!result || !result.ok) return [];
    const rows = Array.isArray(result.raw)
      ? result.raw
      : Array.isArray(result.data)
        ? result.data
        : [];
    return Array.from(new Set(rows
      .map((row) => String(row && row.providerId || '').trim().toLowerCase())
      .filter(Boolean))).sort();
  }

  function accountAuthKind(accountResult) {
    const providers = linkedProviderIds(accountResult);
    const socials = providers.filter((provider) => ['naver','google','kakao'].includes(provider));
    const credentialOnly = providers.length === 1 && providers[0] === 'credential';
    const socialLabel = socials.includes('naver') ? '네이버'
      : socials.includes('google') ? 'Google'
      : socials.includes('kakao') ? '카카오'
      : '';
    return Object.freeze({ providers, hasSocial: socials.length > 0, credentialOnly, socialLabel });
  }

  // Canonical credential-account verification helper. This stays inside the
  // sanctioned auth runtime so non-entry pages never duplicate Better Auth
  // endpoint literals or bypass the same-origin Pages facade.
  function emailVerificationCallbackURL(loc) {
    const where = loc || (typeof location !== 'undefined' ? location : {});
    const origin = String(where.origin || '');
    if (!origin) return '/19_내정보_메인.html?emailVerified=1';
    return new URL('/19_내정보_메인.html?emailVerified=1', origin).toString();
  }

  function sendVerificationEmail(fetchImpl, email, loc) {
    const normalized = String(email || '').trim();
    if (!normalized) return Promise.resolve({ ok: false, reason: 'client-error', status: 0, error: { code: 'EMAIL_REQUIRED' } });
    const authBase = danjionAuthBase(loc);
    return request(fetchImpl, joinUrl(authBase, '/api/auth/send-verification-email'), {
      method: 'POST',
      body: JSON.stringify({
        email: normalized,
        callbackURL: emailVerificationCallbackURL(loc)
      })
    });
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
    if (document.querySelector('.danjion-account-menu')) return null;

    const authBase = danjionAuthBase(loc);
    const [session, accounts] = await Promise.all([
      request(fetch, joinUrl(authBase, '/api/auth/get-session')),
      fetchLinkedAccounts(fetch, loc)
    ]);
    if (!nativeSessionReady(session)) return null;

    const email = String(session.raw.user?.email || '').trim();
    const name = String(session.raw.user?.name || '').trim();
    const emailVerified = session.raw.user?.emailVerified === true;
    const authKind = accountAuthKind(accounts);
    if (!email) return null;

    const host = document.querySelector('.identity') || document.querySelector('[data-account-host]');
    if (!host) return null;
    host.classList.add('danjion-account-host');
    host.textContent = '';

    if (!document.getElementById('danjion-account-menu-style')) {
      const style = document.createElement('style');
      style.id = 'danjion-account-menu-style';
      style.textContent = '.danjion-account-host{position:relative!important;display:flex!important;align-items:center!important;justify-content:flex-end!important;max-width:none!important;overflow:visible!important;white-space:normal!important}.danjion-account-trigger{display:flex;align-items:center;gap:9px;border:0;background:transparent;color:inherit;padding:7px 4px;cursor:pointer;font:inherit}.danjion-account-avatar{width:31px;height:31px;border-radius:50%;display:grid;place-items:center;background:#101d30;color:#fff;font-size:13px;font-weight:900}.danjion-account-label{display:grid;gap:2px;text-align:left;min-width:0}.danjion-account-label b{font-size:12px;line-height:1.1;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.danjion-account-label span{font-size:10px;line-height:1.1;opacity:.58}.danjion-account-label span.is-warning{color:#b9382a;opacity:1;font-weight:900}.danjion-account-caret{font-size:10px;opacity:.55}.danjion-account-menu{position:absolute;top:calc(100% + 10px);right:0;width:260px;background:#fffdf8;border:1px solid rgba(16,29,48,.14);box-shadow:0 18px 40px rgba(16,29,48,.15);padding:10px;z-index:220}.danjion-account-menu[hidden]{display:none}.danjion-account-email{padding:10px 10px 12px;border-bottom:1px solid rgba(16,29,48,.1);font-size:12px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.danjion-account-actions{display:grid;padding-top:6px}.danjion-account-actions a,.danjion-account-actions button{display:flex;align-items:center;width:100%;min-height:38px;border:0;background:transparent;color:#101d30;padding:0 10px;text-align:left;text-decoration:none;font:800 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}.danjion-account-actions a:hover,.danjion-account-actions button:hover{background:#f1ece2}.danjion-account-actions .danger{color:#a53628;border-top:1px solid rgba(16,29,48,.08);margin-top:4px;padding-top:4px}@media(max-width:760px){.danjion-account-host{margin-left:auto!important}.danjion-account-label{display:none}.danjion-account-trigger{padding:4px}.danjion-account-menu{position:fixed;top:66px;right:10px;left:auto;width:min(280px,calc(100vw - 20px))}}';
      document.head.appendChild(style);
    }

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'danjion-account-trigger';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');

    const socialFallback = authKind.hasSocial
      ? (authKind.socialLabel ? authKind.socialLabel + ' 사용자' : '소셜 사용자')
      : '';
    const visibleIdentity = name || socialFallback || email.split('@')[0];

    const avatar = document.createElement('span');
    avatar.className = 'danjion-account-avatar';
    avatar.textContent = visibleIdentity.slice(0,1).toUpperCase();

    const label = document.createElement('span');
    label.className = 'danjion-account-label';
    const labelMain = document.createElement('b');
    labelMain.textContent = visibleIdentity;
    const labelSub = document.createElement('span');
    labelSub.textContent = authKind.hasSocial
      ? (authKind.socialLabel ? authKind.socialLabel + ' 로그인' : '소셜 로그인')
      : authKind.credentialOnly
        ? (emailVerified ? '이메일 계정' : '이메일 인증 필요')
        : '계정';
    if (authKind.credentialOnly && !emailVerified) labelSub.classList.add('is-warning');
    label.append(labelMain, labelSub);

    const caret = document.createElement('span');
    caret.className = 'danjion-account-caret';
    caret.textContent = '▾';
    trigger.append(avatar, label, caret);

    const menu = document.createElement('div');
    menu.className = 'danjion-account-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');

    const emailNode = document.createElement('div');
    emailNode.className = 'danjion-account-email';
    emailNode.textContent = authKind.hasSocial
      ? (authKind.socialLabel ? authKind.socialLabel + ' 로그인 계정' : '소셜 로그인 계정')
      : email;
    emailNode.title = authKind.hasSocial ? '' : email;

    const actions = document.createElement('div');
    actions.className = 'danjion-account-actions';
    const my = document.createElement('a');
    my.href = '19_내정보_메인.html';
    my.textContent = '내정보';
    const settings = document.createElement('a');
    settings.href = '24_설정.html';
    settings.textContent = '설정';
    if (authKind.credentialOnly && !emailVerified) {
      const resend = document.createElement('button');
      resend.type = 'button';
      resend.textContent = '인증메일 다시 받기';
      resend.addEventListener('click', async () => {
        resend.disabled = true;
        resend.textContent = '보내는 중';
        const result = await sendVerificationEmail(fetch, email, loc);
        if (result.ok) {
          resend.textContent = '인증메일을 보냈습니다';
          resend.title = '메일 제목: [단지온] 이메일 주소를 확인해 주세요';
          return;
        }
        resend.disabled = false;
        resend.textContent = '인증메일 다시 받기';
        resend.title = '인증메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.';
      });
      actions.append(my, settings, resend);
    } else {
      actions.append(my, settings);
    }

    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'danger';
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
    actions.append(logout);
    menu.append(emailNode, actions);

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
      trigger.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', (event) => {
      if (!host.contains(event.target)) {
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    host.append(trigger, menu);
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
    fetchSession,
    fetchLinkedAccounts,
    linkedProviderIds,
    accountAuthKind,
    emailVerificationCallbackURL,
    sendVerificationEmail,
    nativeSessionReady,
    accountStripEligible,
    initAccountStrip,
    PRODUCTION_PAGES_HOSTNAME,
    CANONICAL_PAGES_API_BASE,
    PRODUCTION_API_BASE
  });
})(typeof window !== 'undefined' ? window : globalThis);