(function (global) {
  'use strict';

  // Issue #469: canonical Pages application API traffic is first-party too.
  // Browser requests bind to the canonical Pages origin; a bounded Pages Function
  // forwards /api/v1/* to the fixed production Worker with the first-party
  // session cookie. Preview/local origins remain fail-closed unless an explicit
  // ?apiBase= is supplied.
  // Issue #790: canonical custom domain is primary Production authority,
  // while legacy Pages hostname is retained as fallback during migration.
  // Both bind the same-origin Pages Function facade for Better Auth and application API.
  const PRIMARY_PRODUCTION_HOSTNAME = 'danjion.padiem.net';
  const PRODUCTION_PAGES_HOSTNAME = 'danjion.pages.dev';

  function danjionApiBase(loc) {
    const where = loc || (typeof location !== 'undefined' ? location : {});
    const hostname = String(where.hostname || '').toLowerCase();

    // Security boundary: primary custom production always stays same-origin. Query
    // parameters can never redirect application API traffic off the primary host.
    if (hostname === PRIMARY_PRODUCTION_HOSTNAME) return '';

    // Security boundary: canonical production always stays same-origin. Query
    // parameters can never redirect application API traffic off the Pages host.
    if (hostname === PRODUCTION_PAGES_HOSTNAME) return '';

    let params;
    try { params = new URLSearchParams(where.search || ''); } catch { params = new URLSearchParams(); }
    if (params.has('apiBase')) {
      return String(params.get('apiBase') || '').trim().replace(/\/+$/, '');
    }
    return '';
  }

  function isCanonicalProduction(loc) {
    const where = loc || (typeof location !== 'undefined' ? location : {});
    const hostname = String(where.hostname || '').toLowerCase();
    return hostname === PRIMARY_PRODUCTION_HOSTNAME || hostname === PRODUCTION_PAGES_HOSTNAME;
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
  // danjionApiBase() now follows the same same-origin boundary for production
  // application APIs so /api/v1/* reaches the canonical Pages app facade.
  function danjionAuthBase(loc) {
    const where = loc || (typeof location !== 'undefined' ? location : {});
    const hostname = String(where.hostname || '').toLowerCase();

    // Security boundary: primary custom production Better Auth must remain on the
    // same-origin facade even if a crafted link supplies ?apiBase=.
    if (hostname === PRIMARY_PRODUCTION_HOSTNAME) return '';

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

  // Issue #810: the Pages app facade answers every request with a bounded,
  // non-sensitive `x-danjion-auth-bridge` disposition so a real auth-bridge
  // failure is distinguishable from an ordinary authorization denial.
  // The header carries only a closed enum value -- never a cookie, session
  // token, JWT, Authorization header, or any user-identifying value -- so it is
  // safe to surface to the browser and to observability.
  const AUTH_BRIDGE_DISPOSITIONS = Object.freeze([
    'no-cookie', 'session-failed', 'session-invalid', 'direct-jwt',
    'no-session-token', 'token-failed', 'token-invalid', 'fallback-jwt'
  ]);
  const AUTH_BRIDGE_DISPOSITION_SET = new Set(AUTH_BRIDGE_DISPOSITIONS);
  // Dispositions that mean the bridge could not resolve a valid session into
  // bearer authority. `no-cookie` and `session-invalid` are the guest/signed-out
  // and stale-session cases; the rest are server-side exchange failures.
  const AUTH_BRIDGE_FAILURES = Object.freeze([
    'no-cookie', 'session-failed', 'session-invalid',
    'no-session-token', 'token-failed', 'token-invalid'
  ]);
  const AUTH_BRIDGE_FAILURE_SET = new Set(AUTH_BRIDGE_FAILURES);

  function authBridgeDisposition(response) {
    let raw = null;
    try { raw = response.headers?.get?.('x-danjion-auth-bridge') || null; } catch { raw = null; }
    const value = String(raw || '').trim().toLowerCase();
    if (!value || !AUTH_BRIDGE_DISPOSITION_SET.has(value)) return null;
    return value;
  }

  const FONT_SIZE_STORAGE_KEY = 'danjion-font-size';
  const FONT_SIZE_VALUES = Object.freeze(['small', 'normal', 'large']);
  const FONT_SIZE_SCALE = Object.freeze({ small: '0.94', normal: '1', large: '1.1' });

  function normalizeFontSize(value) {
    const text = String(value || '').trim().toLowerCase();
    return FONT_SIZE_VALUES.includes(text) ? text : 'normal';
  }

  function readFontSizePreference() {
    try {
      return normalizeFontSize(global.localStorage?.getItem(FONT_SIZE_STORAGE_KEY));
    } catch (_) {
      return 'normal';
    }
  }

  function syncFontSizeControls(size) {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    document.querySelectorAll('.size-option,[data-size]').forEach((node) => {
      if (!node.dataset || !node.dataset.size) return;
      const active = node.dataset.size === size;
      node.classList.toggle('active', active);
      if (node.hasAttribute('aria-pressed')) node.setAttribute('aria-pressed', String(active));
    });
  }

  function applyFontSizePreference(value) {
    const size = normalizeFontSize(value);
    try {
      global.localStorage?.setItem(FONT_SIZE_STORAGE_KEY, size);
    } catch (_) {}
    if (typeof document !== 'undefined') {
      try {
        document.documentElement.style.setProperty('--scale', FONT_SIZE_SCALE[size]);
      } catch (_) {}
      if (document.body) document.body.dataset.fontSize = size;
      syncFontSizeControls(size);
    }
    return size;
  }

  function bootFontSizePreference() {
    if (typeof document === 'undefined') return;
    const size = readFontSizePreference();
    try {
      document.documentElement.style.setProperty('--scale', FONT_SIZE_SCALE[size]);
    } catch (_) {}
    if (document.body) {
      document.body.dataset.fontSize = size;
      syncFontSizeControls(size);
      return;
    }
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) document.body.dataset.fontSize = readFontSizePreference();
      syncFontSizeControls(readFontSizePreference());
    }, { once: true });
  }

  bootFontSizePreference();
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('storage', (event) => {
      if (!event || event.key !== FONT_SIZE_STORAGE_KEY || !event.newValue) return;
      applyFontSizePreference(event.newValue);
    });
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
      const authBridge = authBridgeDisposition(response);
      if (!response.ok) {
        const error = payload?.error || null;
        if (response.status === 401 || response.status === 403) {
          return { ok: false, reason: 'auth-required', status: response.status, error, authBridge };
        }
        return { ok: false, reason: 'server-error', status: response.status, error, authBridge };
      }
      return { ok: true, status: response.status, data: payload?.data ?? null, raw: payload, requestId: payload?.requestId ?? null, authBridge };
    } catch (error) {
      return { ok: false, reason: 'network-error', status: 0, error };
    }
  }

  // #810: a 401 on an application API call is only a genuine "your session
  // really is gone" when the bridge could not resolve a session at all. When the
  // bridge resolved a session but the exchange failed, the honest cause is a
  // server-side bridge fault, not an expired login. Both still fail closed; this
  // only selects the truthful user-facing explanation.
  function authFailureKind(result) {
    if (!result || result.reason !== 'auth-required') return null;
    const disposition = result.authBridge;
    if (result.status === 403) return 'forbidden';
    if (disposition && AUTH_BRIDGE_FAILURE_SET.has(disposition)) {
      return disposition === 'no-cookie' || disposition === 'session-invalid'
        ? 'signed-out'
        : 'bridge-fault';
    }
    return 'auth-required';
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
  function fetchSession(fetchImpl, loc, init = {}) {
    const authBase = danjionAuthBase(loc);
    return request(fetchImpl, joinUrl(authBase, '/api/auth/get-session'), init);
  }

  // #1023: one bounded, session-verified sign-out primitive for every ordinary
  // service surface. A successful POST is not enough: the canonical session
  // readback must also succeed and report no live Better Auth session before
  // local auth markers are cleared. The same abort signal bounds both requests.
  async function verifiedSignOut(fetchImpl, options = {}) {
    const impl = fetchImpl || global.fetch;
    const loc = options.location;
    const requestedTimeout = Number(options.timeoutMs);
    const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? requestedTimeout
      : 10000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const authBase = danjionAuthBase(loc);
      const result = await request(impl, joinUrl(authBase, '/api/auth/sign-out'), {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({})
      });
      if (!result.ok) return { ok: false, stage: 'sign-out', result };

      const after = await fetchSession(impl, loc, { signal: controller.signal });
      if (!after || !after.ok) return { ok: false, stage: 'session-readback', result: after };
      if (nativeSessionReady(after)) return { ok: false, stage: 'session-still-active', result: after };

      clearLocalAuthMarkers();
      return { ok: true, stage: 'signed-out', result: after };
    } catch (error) {
      return {
        ok: false,
        stage: error && error.name === 'AbortError' ? 'timeout' : 'network-error',
        error
      };
    } finally {
      clearTimeout(timer);
    }
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

  const RESERVED_AUTHORITY_IDENTITY_LABELS = new Set(['최고관리자','일반관리자','운영관리자']);

  function visibleAccountIdentity(user, authKind) {
    const record = user && typeof user === 'object' ? user : {};
    const rawName = String(record.name || '').trim();
    const email = String(record.email || '').trim();
    const safeName = rawName && !RESERVED_AUTHORITY_IDENTITY_LABELS.has(rawName) ? rawName : '';
    if (safeName) return safeName;
    if (authKind && authKind.hasSocial) {
      return authKind.socialLabel ? authKind.socialLabel + ' 사용자' : '소셜 사용자';
    }
    const localPart = email.includes('@') ? email.split('@')[0].trim() : '';
    return localPart || '사용자';
  }

  function maskEmailAddress(value) {
    const email = String(value || '').trim();
    const match = /^([^@\s]+)@([^@\s]+)$/.exec(email);
    if (!match) return '';
    const local = match[1];
    const domain = match[2];
    const visible = local.slice(0, Math.min(3, Math.max(1, local.length)));
    return visible + '•••@' + domain;
  }

  const ACCOUNT_SUPER_LABEL = '최고관리자';
  const ACCOUNT_OPERATOR_LABEL = '운영관리자';
  const ACCOUNT_MEMBER_LABEL = '일반회원';

  function normalizeAccountAuthority(result) {
    const closed = (state, label = '') => Object.freeze({ state, label, canAdmin: false, wildcard: false, scopes: [] });
    if (!result || typeof result !== 'object') return closed('error', '권한 확인 불가');
    if (!result.ok) {
      if (result.status === 403) return closed('member', ACCOUNT_MEMBER_LABEL);
      if (result.status === 401) return closed('signed-out');
      return closed('error', '권한 확인 불가');
    }
    const raw = result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data : null;
    const scopes = raw && Array.isArray(raw.scopes) && raw.scopes.every((scope) => typeof scope === 'string')
      ? raw.scopes.slice()
      : null;
    if (raw && raw.level === 'admin' && raw.wildcard === true && scopes && scopes.includes('*')) {
      return Object.freeze({ state: 'admin', label: ACCOUNT_SUPER_LABEL, canAdmin: true, wildcard: true, scopes });
    }
    if (raw && raw.level === 'operator' && raw.wildcard === false && scopes && scopes.length > 0 && !scopes.includes('*')) {
      return Object.freeze({ state: 'operator', label: ACCOUNT_OPERATOR_LABEL, canAdmin: true, wildcard: false, scopes });
    }
    return closed('invalid', '권한 확인 불가');
  }

  async function fetchAccountAuthority(fetchImpl, loc) {
    const apiBase = danjionApiBase(loc);
    const where = loc || (typeof location !== 'undefined' ? location : {});
    const hostname = String(where.hostname || '').toLowerCase();
    const canonicalProduction = hostname === PRIMARY_PRODUCTION_HOSTNAME || hostname === PRODUCTION_PAGES_HOSTNAME;
    if (!apiBase && !canonicalProduction) return Object.freeze({ state: 'unbound', label: '', canAdmin: false, wildcard: false, scopes: [] });
    return normalizeAccountAuthority(
      await request(fetchImpl || global.fetch, joinUrl(apiBase, '/api/v1/admin/authority'))
    );
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

    const host = document.querySelector('.identity') || document.querySelector('[data-account-host]');
    if (!host) return null;

    const authBase = danjionAuthBase(loc);
    const session = await request(fetch, joinUrl(authBase, '/api/auth/get-session'));

    // Signed-out Production service pages must not strand a guest inside the
    // product shell. Reuse the existing header slot as a navigation-only entry
    // to the canonical landing auth modal; never duplicate auth or carry PII.
    if (!nativeSessionReady(session)) {
      const hostname = String(loc.hostname || '').toLowerCase();
      const canonicalProduction = hostname === PRIMARY_PRODUCTION_HOSTNAME || hostname === PRODUCTION_PAGES_HOSTNAME;
      if (!canonicalProduction) return null;
      host.classList.remove('danjion-account-host');
      host.classList.add('danjion-guest-auth-host');
      host.textContent = '';
      const guestAuth = document.createElement('a');
      guestAuth.className = 'danjion-guest-auth-entry';
      guestAuth.href = 'index.html?auth=login';
      guestAuth.textContent = '로그인 · 가입';
      guestAuth.setAttribute('aria-label', '로그인 또는 가입');
      host.append(guestAuth);
      return { state: 'guest' };
    }

    const [accounts, authority] = await Promise.all([
      fetchLinkedAccounts(fetch, loc),
      fetchAccountAuthority(fetch, loc)
    ]);

    const email = String(session.raw.user?.email || '').trim();
    const emailVerified = session.raw.user?.emailVerified === true;
    const authKind = accountAuthKind(accounts);
    if (!email) return null;

    host.classList.remove('danjion-guest-auth-host');
    host.classList.add('danjion-account-host');
    host.textContent = '';

    if (!document.getElementById('danjion-account-menu-style')) {
      const style = document.createElement('style');
      style.id = 'danjion-account-menu-style';
      style.textContent = 'body .danjion-service-header .identity.danjion-account-host,.danjion-account-host{position:relative!important;display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;align-items:center!important;justify-content:flex-end!important;gap:10px!important;max-width:none!important;overflow:visible!important;white-space:normal!important}.danjion-admin-quick-entry{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 16px;border:1px solid var(--amber,#c58a2a);border-radius:0;color:inherit;text-decoration:none;font:800 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0;white-space:nowrap;background:transparent}.danjion-admin-quick-entry:hover{background:#101d30;color:#fff;border-color:#101d30}.danjion-account-trigger{display:flex;align-items:center;gap:9px;border:0;background:transparent;color:inherit;padding:7px 4px;cursor:pointer;font:inherit}.danjion-account-avatar{width:31px;height:31px;border-radius:50%;display:grid;place-items:center;background:#101d30;color:#fff;font-size:13px;font-weight:900}.danjion-account-label{display:grid;gap:2px;text-align:left;min-width:0}.danjion-account-label b{font-size:12px;line-height:1.1;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.danjion-account-label span{font-size:10px;line-height:1.1;opacity:.58}.danjion-account-label span.is-warning{color:#b9382a;opacity:1;font-weight:900}.danjion-account-caret{font-size:10px;opacity:.55}.danjion-account-menu{position:absolute;top:calc(100% + 10px);right:0;width:260px;background:#fffdf8;border:1px solid rgba(16,29,48,.14);box-shadow:0 18px 40px rgba(16,29,48,.15);padding:10px;z-index:220}.danjion-account-menu[hidden]{display:none}.danjion-account-email{padding:10px 10px 8px;font-size:12px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.danjion-account-authority-row{padding:0 10px 10px;border-bottom:1px solid rgba(16,29,48,.1);font-size:11px;font-weight:900;color:#314cf4}.danjion-account-actions{display:grid;padding-top:6px}.danjion-account-actions a,.danjion-account-actions button{display:flex;align-items:center;width:100%;min-height:38px;border:0;background:transparent;color:#101d30;padding:0 10px;text-align:left;text-decoration:none;font:800 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}.danjion-account-actions a:hover,.danjion-account-actions button:hover{background:#f1ece2}.danjion-account-actions .danger{color:#a53628;border-top:1px solid rgba(16,29,48,.08);margin-top:4px;padding-top:4px}@media(max-width:760px){.danjion-account-host{margin-left:auto!important;gap:6px!important}.danjion-admin-quick-entry{min-height:36px;padding:0 10px;font-size:11px}.danjion-account-label{display:none}.danjion-account-trigger{padding:4px}.danjion-account-menu{position:fixed;top:66px;right:10px;left:auto;width:min(280px,calc(100vw - 20px))}}';
      document.head.appendChild(style);
    }

    let adminQuickEntry = null;
    if (authority.canAdmin) {
      adminQuickEntry = document.createElement('a');
      adminQuickEntry.className = 'danjion-admin-quick-entry';
      adminQuickEntry.href = '/admin/';
      adminQuickEntry.textContent = '관리자 콘솔';
      adminQuickEntry.setAttribute('aria-label', authority.label ? authority.label + ' 관리자 콘솔' : '관리자 콘솔');
    }

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'danjion-account-trigger';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');

    const visibleIdentity = visibleAccountIdentity(session.raw.user, authKind);

    const avatar = document.createElement('span');
    avatar.className = 'danjion-account-avatar';
    avatar.textContent = visibleIdentity.slice(0,1).toUpperCase();

    const label = document.createElement('span');
    label.className = 'danjion-account-label';
    const labelMain = document.createElement('b');
    labelMain.textContent = visibleIdentity;
    label.append(labelMain);
    const loginMethodLabel = authKind.hasSocial
      ? (authKind.socialLabel ? authKind.socialLabel + ' 로그인' : '소셜 로그인')
      : authKind.credentialOnly
        ? '이메일 로그인'
        : '계정';

    const caret = document.createElement('span');
    caret.className = 'danjion-account-caret';
    caret.textContent = '▾';
    trigger.append(avatar, label, caret);

    const menu = document.createElement('div');
    menu.className = 'danjion-account-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', loginMethodLabel + ' 계정 메뉴');

    const emailNode = document.createElement('div');
    emailNode.className = 'danjion-account-email';
    emailNode.textContent = authKind.hasSocial
      ? (authKind.socialLabel ? authKind.socialLabel + ' 로그인 계정' : '소셜 로그인 계정')
      : email;
    emailNode.title = authKind.hasSocial ? '' : email;

    const authorityNode = document.createElement('div');
    authorityNode.className = 'danjion-account-authority-row';
    authorityNode.textContent = authority.label ? '권한 · ' + authority.label : '권한 · 확인 불가';

    const actions = document.createElement('div');
    actions.className = 'danjion-account-actions';
    const my = document.createElement('a');
    my.href = '19_내정보_메인.html';
    my.textContent = '내정보';
    const settings = document.createElement('a');
    settings.href = '24_설정.html';
    settings.textContent = '설정';
    actions.append(my, settings);
    if (authority.canAdmin) {
      const admin = document.createElement('a');
      admin.href = '/admin/';
      admin.textContent = '관리자 콘솔';
      actions.append(admin);
    }

    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'danger';
    logout.textContent = '로그아웃';
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      logout.textContent = '로그아웃 중';
      const outcome = await verifiedSignOut(fetch);
      if (!outcome.ok) {
        logout.disabled = false;
        logout.textContent = '로그아웃';
        return;
      }
      location.href = 'index.html?intro=1';
    });
    actions.append(logout);
    menu.append(emailNode, authorityNode, actions);

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

    if (adminQuickEntry) host.append(adminQuickEntry);
    host.append(trigger, menu);
    return { email, authority };
  }

  function loadServiceFooterRuntime() {
    if (typeof document === 'undefined') return false;
    if (!document.querySelector('.danjion-service-header')) return false;
    if (global.DanjionServiceFooter && typeof global.DanjionServiceFooter.mount === 'function') {
      global.DanjionServiceFooter.mount();
      return true;
    }
    if (document.querySelector('script[data-danjion-service-footer-runtime]')) return true;
    const script = document.createElement('script');
    script.src = 'assets/danjion-service-footer.js';
    script.setAttribute('data-danjion-service-footer-runtime', '');
    script.defer = true;
    document.body.append(script);
    return true;
  }

  if (typeof document !== 'undefined') {
    const bootServiceShell = () => {
      initAccountStrip().catch(() => {});
      loadServiceFooterRuntime();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootServiceShell, { once: true });
    else bootServiceShell();
  }

  global.DanjionSession = Object.freeze({
    danjionApiBase,
    isCanonicalProduction,
    danjionAuthBase,
    joinUrl,
    request,
    createSessionFetch,
    fetchSession,
    verifiedSignOut,
    fetchLinkedAccounts,
    linkedProviderIds,
    accountAuthKind,
    visibleAccountIdentity,
    maskEmailAddress,
    normalizeAccountAuthority,
    fetchAccountAuthority,
    emailVerificationCallbackURL,
    sendVerificationEmail,
    nativeSessionReady,
    authBridgeDisposition,
    authFailureKind,
    // #865: settings logout must reuse the canonical selective marker cleanup
    // instead of sessionStorage.clear(), which wipes unrelated leaf state.
    clearLocalAuthMarkers,
    FONT_SIZE_STORAGE_KEY,
    readFontSizePreference,
    applyFontSizePreference,
    normalizeFontSize,
    AUTH_BRIDGE_DISPOSITIONS,
    AUTH_BRIDGE_FAILURES,
    accountStripEligible,
    initAccountStrip,
    loadServiceFooterRuntime,
    PRIMARY_PRODUCTION_HOSTNAME,
    PRODUCTION_PAGES_HOSTNAME
  });
})(typeof window !== 'undefined' ? window : globalThis);
