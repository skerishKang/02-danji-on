import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Issue #460 [admin production]: the canonical V3 /admin/ surface is gated ONLY
// by GET /api/v1/admin/authority (server-side padiem_operator_grants of the
// signed-in actor's own account). The four designated administrator principals
// (Owner SUPER, Owner OPERATIONAL, Sibling SUPER, Sibling OPERATIONAL) are
// SEPARATE canonical users with separate grants — nothing here may assume or
// converge one principal into another. A wildcard SUPER answer renders the
// 최고관리자 view, a valid OPERATIONAL answer the 일반관리자 view, and every
// other answer — including malformed or empty HTTP 200 payloads — is rejected
// (least privilege is NOT an operator fallback at the entry boundary). No role
// may ever be inferred from email, login provider, browser storage, or query
// parameters, and the console ships read-only: no write verb exists anywhere.
// Run: node frontend/tests/leaf-b460-v3-admin-authority-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const CANONICAL_SLUG = 'banglim-myeongji-roadhill';
const SUPER_LABEL = '최고관리자';
const OPERATOR_LABEL = '일반관리자';

const sessionSrc = await read('../assets/danjion-session.js');
const authoritySrc = await read('../assets/danjion-admin-authority.js');
const consoleSrc = await read('../assets/danjion-admin-console.js');
const adminPage = await read('../admin/index.html');
const index = await read('../index.html');

const jsonResponse = (status, payload) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload
});

const loadAdminContext = (location) => {
  const ctx = { location, URL, URLSearchParams, console };
  vm.createContext(ctx);
  vm.runInContext(sessionSrc, ctx);
  vm.runInContext(authoritySrc, ctx);
  vm.runInContext(consoleSrc, ctx);
  return ctx;
};

/* ============ 1. authority validation is strict: malformed 200 is REJECTED === */
{
  const ctx = loadAdminContext({ hostname: 'danjion.pages.dev', search: '' });
  const { DanjionAdminAuthority: A } = ctx;
  assert.equal(A.AUTHORITY_PATH, '/api/v1/admin/authority', 'authority must bind the canonical endpoint');
  assert.equal(A.normalizeAuthority({ level: 'admin', label: SUPER_LABEL, wildcard: true, scopes: ['*'] }).state, 'admin',
    'a wildcard admin grant resolves the 최고관리자 view');
  assert.equal(A.normalizeAuthority({ level: 'operator', label: OPERATOR_LABEL, wildcard: false, scopes: ['business_application.review'] }).state, 'operator',
    'a valid bounded operator grant resolves the 일반관리자 view');
  assert.equal(A.normalizeAuthority({ level: 'admin', label: SUPER_LABEL, wildcard: false, scopes: ['business.review'] }).state, 'invalid',
    'level admin without the wildcard flag must be REJECTED, not demoted to operator');
  assert.equal(A.normalizeAuthority({ level: 'operator', label: OPERATOR_LABEL, wildcard: true, scopes: [] }).state, 'invalid',
    'wildcard true on an operator level is inconsistent and must be REJECTED');
  assert.equal(A.normalizeAuthority({ level: 'operator', wildcard: false, scopes: ['*'] }).state, 'invalid',
    'an operator grant carrying the wildcard scope must be REJECTED');
  assert.equal(A.normalizeAuthority({ level: 'manager', wildcard: false, scopes: [] }).state, 'invalid',
    'unknown levels must be REJECTED');
  assert.equal(A.normalizeAuthority({ wildcard: false, scopes: [] }).state, 'invalid',
    'a missing level must be REJECTED');
  const malformedWildcard = A.normalizeAuthority({ level: 'admin', wildcard: 'true', scopes: ['*'] });
  assert.equal(malformedWildcard.state, 'invalid', 'string-typed wildcard must be REJECTED, not coerced');
  assert.equal(malformedWildcard.wildcard, false, 'rejected authorities must never carry a truthy wildcard flag');
  assert.equal(A.normalizeAuthority({ level: 'admin', wildcard: true, scopes: 'business.review' }).state, 'invalid',
    'non-array scopes must be REJECTED');
  assert.equal(A.normalizeAuthority({ level: 'admin', wildcard: true, scopes: ['*', 7] }).state, 'invalid',
    'scopes arrays containing non-strings must be REJECTED');
  assert.equal(A.normalizeAuthority(null).state, 'invalid', 'empty 200 data must be REJECTED');
  assert.equal(A.normalizeAuthority({}).state, 'invalid', 'an empty object body must be REJECTED');
  assert.equal(A.normalizeAuthority([{ level: 'admin', wildcard: true }]).state, 'invalid', 'array bodies must be REJECTED');
  const rejected = A.normalizeAuthority(null);
  assert.equal(rejected.label, '', 'a rejected authority must carry no tier label');
  assert.equal(rejected.scopes.length, 0, 'a rejected authority must carry no scopes');
  assert.ok(A.SUPER_LABEL !== A.OPERATOR_LABEL, 'the two tiers must carry distinct server-pinned labels');
}

/* ================= 2. non-200 answers never open the admin surface ========= */
{
  const ctx = loadAdminContext({ hostname: 'danjion.pages.dev', search: '' });
  const { DanjionAdminAuthority: A } = ctx;
  assert.equal(A.classifyAuthority({ ok: true, data: { level: 'admin', wildcard: true, scopes: ['*'] } }).state, 'admin');
  assert.equal(A.classifyAuthority({ ok: false, status: 401 }).state, 'signed-out', '401 must render the signed-out restriction');
  assert.equal(A.classifyAuthority({ ok: false, status: 403 }).state, 'denied', '403 must render the no-grant restriction');
  assert.equal(A.classifyAuthority({ ok: false, status: 500 }).state, 'error', '5xx must fail closed');
  assert.equal(A.classifyAuthority({ ok: false, status: 0 }).state, 'error', 'network errors must fail closed');
  assert.equal(A.classifyAuthority(null).state, 'error', 'a missing outcome must fail closed');
  assert.equal(A.classifyAuthority({ ok: true, data: { level: 'operator', wildcard: false, scopes: ['business_application.review'] } }).state, 'operator',
    'a valid operator 200 must open the 일반관리자 surface');
  assert.equal(A.classifyAuthority({ ok: true, data: null }).state, 'invalid', 'a 200 with null data must classify as invalid');
  assert.equal(A.classifyAuthority({ ok: true, data: {} }).state, 'invalid', 'a 200 with an empty body must classify as invalid');
  assert.equal(A.hasAdminSurface({ state: 'invalid' }), false, 'a malformed 200 must never open the admin surface');
  assert.equal(A.hasAdminSurface({ state: 'denied' }), false, 'a denied authority must not open the admin surface');
  assert.equal(A.hasAdminSurface({ state: 'signed-out' }), false);
  assert.equal(A.hasAdminSurface({ state: 'unbound' }), false);
  assert.equal(A.hasAdminSurface({ state: 'error' }), false);
  assert.equal(A.hasAdminSurface({ state: 'operator' }), true);
  assert.equal(A.isSuperAdminAuthority({ state: 'admin', wildcard: true }), true);
  assert.equal(A.isSuperAdminAuthority({ state: 'admin', wildcard: false }), false, 'super view requires the wildcard flag');
  assert.equal(A.isSuperAdminAuthority({ state: 'operator', wildcard: true }), false, 'operator state can never be super');
}

/* ================= 3. fetchAuthority binds only the #419 resolver base ====== */
{
  const demo = loadAdminContext({ hostname: 'localhost', search: '' });
  const unbound = await demo.DanjionAdminAuthority.fetchAuthority(jsonResponse(200, { data: { level: 'admin', wildcard: true } }));
  assert.equal(unbound.state, 'unbound', 'the demo lane must never resolve any admin surface');

  const ctx = loadAdminContext({ hostname: 'danjion.pages.dev', search: '' });
  const { DanjionAdminAuthority: A } = ctx;
  const seen = [];
  const okFetch = async (url, init) => {
    seen.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ data: { level: 'admin', label: SUPER_LABEL, wildcard: true, scopes: ['*'] } }) };
  };
  const grant = await A.fetchAuthority(okFetch);
  assert.equal(grant.state, 'admin', 'canonical production wildcard grant resolves the super view');
  assert.ok(seen[0].url.endsWith('/api/v1/admin/authority'), 'authority must be fetched from the canonical path');
  assert.equal(seen[0].init.credentials, 'include', 'authority must ride the canonical session cookie');
  assert.equal(seen[0].init.method, undefined, 'authority must be a plain GET');

  const denied = await A.fetchAuthority(jsonResponse(403, { error: { code: 'PADIEM_GRANT_REQUIRED' } }), { apiBase: 'https://api.test' });
  assert.equal(denied.state, 'denied', 'an explicit 403 keeps the surface closed');

  const emptyOk = await A.fetchAuthority(jsonResponse(200, { data: null }), { apiBase: 'https://api.test' });
  assert.equal(emptyOk.state, 'invalid', 'an empty 200 must not reach the console as operator');
  assert.equal(A.hasAdminSurface(emptyOk), false, 'an empty 200 must never open the admin surface end to end');

  const emptyBase = await A.fetchAuthority(jsonResponse(200, { data: { level: 'admin', wildcard: true } }), { apiBase: '' });
  assert.equal(emptyBase.state, 'unbound', 'an empty base must short-circuit before any fetch');
}

/* ================= 4. console sections are GET-only and server-decided ===== */
{
  const ctx = loadAdminContext({ hostname: 'danjion.pages.dev', search: '' });
  const { DanjionAdminConsole: C, DanjionAdminAuthority: A } = ctx;
  assert.equal(C.COMPLEX_SLUG, CANONICAL_SLUG, 'the console must pin the canonical top-level complex slug');

  const operatorViews = C.consoleSections({ state: 'operator', wildcard: false });
  assert.equal(operatorViews.operational.length, C.OPERATIONAL_SECTIONS.length);
  assert.equal(operatorViews.privileged.length, 0, 'a bounded grant must never render the privileged area');
  const superViews = C.consoleSections(A.normalizeAuthority({ level: 'admin', wildcard: true, scopes: ['*'] }));
  assert.equal(superViews.privileged.length, 3, 'the wildcard grant unlocks the placeholder-only privileged area');

  const calls = [];
  const route = (status, payload) => async (url) => {
    calls.push(url);
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
  const byId = (id) => C.OPERATIONAL_SECTIONS.find((s) => s.id === id);

  const apps = await C.loadSection(route(200, { data: [{ id: 1 }] }), 'https://api.test', byId('applications'));
  assert.equal(apps.state, 'ready');
  assert.deepEqual([...apps.rows], [{ id: 1 }], 'raw-array payloads must extract as rows');
  assert.ok(calls.at(-1).includes(`/api/v1/admin/complexes/${CANONICAL_SLUG}/business-applications`),
    'sections must default to the canonical slug and the admin path');

  const news = await C.loadSection(route(200, { data: { submissions: [{ id: 2 }] } }), 'https://api.test', byId('residentNews'));
  assert.equal(news.rows.length, 1);
  assert.deepEqual({ ...news.rows[0] }, { id: 2 }, 'operator queue envelopes must extract from submissions');
  assert.ok(calls.at(-1).includes('/api/v1/operator/complexes/'), 'resident-news must use the operator queue path');

  const held = await C.loadSection(route(503, { error: { code: 'RESIDENT_VERIFICATION_POLICY_HOLD' } }), 'https://api.test', byId('verifications'));
  assert.equal(held.state, 'policy-hold', 'the verification policy hold must render as a server-side hold');
  assert.equal(held.code, 'RESIDENT_VERIFICATION_POLICY_HOLD');
  const scopeDenied = await C.loadSection(route(403, { error: { code: 'PADIEM_GRANT_REQUIRED' } }), 'https://api.test', byId('reports'));
  assert.equal(scopeDenied.state, 'scope-denied', 'per-section access is decided by the server grant scope');
  const signedOut = await C.loadSection(route(401, {}), 'https://api.test', byId('posts'));
  assert.equal(signedOut.state, 'signed-out');
  const broken = await C.loadSection(route(500, {}), 'https://api.test', byId('benefits'));
  assert.equal(broken.state, 'error', '5xx sections must render a neutral error, never stale rows');

  assert.equal(C.extractRows({ unexpected: 'shape' }).length, 0, 'unknown payload shapes extract zero rows');
  assert.equal(C.rowTitle({ business_name: '방림정육점' }), '방림정육점', 'snake_case rows must render');
  assert.equal(C.rowStatus({ status: 'pending' }), 'pending');
  assert.ok(C.rowMeta({ applicantName: '주민', created_at: '2026-09-14T00:00:00Z' }).includes('주민'));
}

/* ================= 5. the admin page renders from the server grant only ==== */
{
  assert.ok(adminPage.includes('<script src="/assets/danjion-session.js"></script>'), 'the admin page must load the canonical session runtime');
  const sessionAt = adminPage.indexOf('/assets/danjion-session.js');
  const authorityAt = adminPage.indexOf('/assets/danjion-admin-authority.js');
  const consoleAt = adminPage.indexOf('/assets/danjion-admin-console.js');
  assert.ok(sessionAt > -1 && sessionAt < authorityAt && authorityAt < consoleAt,
    'admin assets must load in session → authority → console order');
  assert.ok(adminPage.includes('authority.fetchAuthority(fetch)'), 'the page must render from the authority fetch outcome');
  assert.ok(adminPage.includes('hasAdminSurface(grant))renderConsole(grant)'), 'the console must render only for a granted surface');
  assert.ok(adminPage.includes('showRestricted(grant.state)'), 'ungmitted states must route to the restricted view');
  assert.ok(adminPage.includes('badge.className'), 'the role badge must render the server-resolved tier label');
  assert.ok(adminPage.includes('button.disabled=true'), 'every privileged write control must ship disabled');
  assert.ok(adminPage.includes('approve.disabled=true'), 'row write actions must stay disabled (view-only)');
  assert.ok(adminPage.includes("meta name=\"robots\" content=\"noindex\""), 'the admin console must not be indexed');
}

/* ================= 6. no client-side identity inference or write verbs ===== */
{
  const banned = ['localStorage', 'sessionStorage', 'location.search', 'URLSearchParams(', 'document.cookie', '/api/auth', '/auth/social-start', 'x-danjion-dev-auth-user'];
  const writeVerbs = ["method:'POST'", "method:'PATCH'", "method:'PUT'", "method:'DELETE'", "method: 'POST'", "method: 'PATCH'", "method: 'PUT'", "method: 'DELETE'"];
  for (const [name, src] of [['admin/index.html', adminPage], ['danjion-admin-authority.js', authoritySrc], ['danjion-admin-console.js', consoleSrc]]) {
    for (const token of banned) {
      assert.ok(!src.includes(token), `${name} must never read ${token} (identity/authority comes only from the server grant)`);
    }
    for (const verb of writeVerbs) {
      assert.ok(!src.includes(verb), `${name} must stay read-only (no ${verb})`);
    }
    assert.ok(!/innerHTML\s*=/.test(src), `${name} must build the DOM text-safe (no innerHTML assignment)`);
  }
  assert.ok(authoritySrc.includes("state: 'invalid'"), 'the resolver must carry an explicit rejection state for malformed 200s');
  assert.ok(!/state:\s*\w+\s*\?\s*'admin'\s*:\s*'operator'/.test(authoritySrc),
    'the resolver must never ternary-demote an unknown payload to a usable operator view');
}

/* ============= 6b. four independent admin principals — no convergence prose = */
{
  const staleProse = [
    ['not separate administrator ', 'identities'].join(''),
    ['whichever ', 'linked'].join(''),
    ['통합 ', '회원'].join(''),
    ['하나의 ', '관리자'].join(''),
    ['same server-side grant resolves the same ', 'authority'].join('')
  ];
  const sources = {
    'danjion-admin-authority.js': authoritySrc,
    'danjion-admin-console.js': consoleSrc,
    'admin/index.html': adminPage,
    'leaf-b460 test': await read('./leaf-b460-v3-admin-authority-contract.mjs')
  };
  for (const [name, src] of Object.entries(sources)) {
    for (const prose of staleProse) {
      assert.ok(!src.includes(prose), `${name} must not keep the superseded one-canonical-admin prose (${prose})`);
    }
  }
  assert.ok(authoritySrc.includes('SEPARATE canonical users'), 'the authority resolver must state the four-principal separation policy');
  assert.ok(authoritySrc.includes('converge'), 'the authority resolver must forbid silent principal convergence');
}

/* ================= 7. signed-in V3 entry point is authority-gated ========== */
{
  const sessionTagAt = index.indexOf('<script src="assets/danjion-session.js"></script>');
  const authorityTagAt = index.indexOf('<script src="assets/danjion-admin-authority.js"></script>');
  assert.ok(sessionTagAt > -1 && sessionTagAt < authorityTagAt,
    'the entry must load the authority resolver after the session runtime');
  assert.ok(index.includes('data-admin-entry'), 'the header must carry the admin entry point');
  assert.ok(index.includes('adminEntry.hidden=!sessionResolved||!memberMode||!adminAuthorized'),
    'the entry must stay hidden until the server grant resolves for a signed-in member');
  assert.ok(index.includes('adminAuthorized=window.DanjionAdminAuthority.hasAdminSurface(grant)'),
    'entry visibility must derive only from the authority endpoint outcome');
  assert.ok(index.includes('if(real)refreshAdminEntry()'), 'the entry must refresh right after session resolution');
  assert.ok(index.includes('syncMemberState();adminAuthorized=false}'), 'logout must immediately revoke the entry');
  assert.ok(index.includes('let adminAuthorized=false'), 'the entry must start fail-closed');
  assert.equal(index.split('danjionApiBase()').length - 1, 1,
    'the entry keeps exactly one danjionApiBase() use (the authority fetch binds it inside the asset)');
  assert.ok(index.includes('[data-auth],[data-member],'), 'the #444 router passthrough invariant must survive');
  assert.ok(index.includes('memberMode=real;sessionResolved=true;syncMemberState()'), 'the #444 session sync invariant must survive');
  assert.ok(index.includes("sessionUserName='';memberMode=false;sessionResolved=true;syncMemberState()"), 'the #444 logout sync invariant must survive');
  assert.ok(index.includes("href=\"/admin/\""), 'the entry must point at the canonical /admin/ route');
}

/* ================= 8. the /admin/ route is a deployable static surface ==== */
{
  const workflow = await read('../../.github/workflows/pages-production-release.yml');
  assert.ok(workflow.includes('cp -R frontend/.') || workflow.includes('cp -R "frontend/."') || workflow.includes('frontend/.'),
    'the Pages release copies the whole frontend tree, so frontend/admin/index.html ships at /admin/');
}

console.log('leaf-b460-v3-admin-authority-contract: PASS');
