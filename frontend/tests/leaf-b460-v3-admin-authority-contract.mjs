import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Issue #460 [admin production]: the canonical V3 /admin/ surface is gated ONLY
// by GET /api/v1/admin/authority (server-side padiem_operator_grants of the
// signed-in actor's own account). The four designated administrator principals
// (Owner SUPER, Owner OPERATIONAL, Sibling SUPER, Sibling OPERATIONAL) are
// SEPARATE canonical users with separate grants — nothing here may assume or
// converge one principal into another. A wildcard SUPER answer renders the
// 최고관리자 view, a valid OPERATIONAL answer the 운영관리자 view, and every
// other answer — including malformed or empty HTTP 200 payloads — is rejected
// (least privilege is NOT an operator fallback at the entry boundary). No role
// may ever be inferred from email, login provider, browser storage, or query
// parameters. #607 permits exactly one reviewed operational mutation family:
// business-application PATCH; every other write family remains disabled.
// Run: node frontend/tests/leaf-b460-v3-admin-authority-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const CANONICAL_SLUG = 'banglim-myeongji-roadhill';
const SUPER_LABEL = '최고관리자';
const OPERATOR_LABEL = '운영관리자';

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
    'a valid bounded operator grant resolves the 운영관리자 view');
  assert.equal(A.normalizeAuthority({ level: 'admin', label: SUPER_LABEL, wildcard: false, scopes: ['business.review'] }).state, 'invalid',
    'level admin without the wildcard flag must be REJECTED, not demoted to operator');
  assert.equal(A.normalizeAuthority({ level: 'operator', label: OPERATOR_LABEL, wildcard: true, scopes: [] }).state, 'invalid',
    'wildcard true on an operator level is inconsistent and must be REJECTED');
  assert.equal(A.normalizeAuthority({ level: 'operator', wildcard: false, scopes: ['*'] }).state, 'invalid',
    'an operator grant carrying the wildcard scope must be REJECTED');
  assert.equal(A.normalizeAuthority({ level: 'admin', label: SUPER_LABEL, wildcard: true, scopes: [] }).state, 'invalid',
    'admin+wildcard without the * scope is a shape the canonical backend cannot emit and must be REJECTED');
  assert.equal(A.normalizeAuthority({ level: 'operator', label: OPERATOR_LABEL, wildcard: false, scopes: [] }).state, 'invalid',
    'empty operator scopes are a shape the canonical backend cannot emit (it resolves level none) and must be REJECTED');
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
    'a valid operator 200 must open the 운영관리자 surface');
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

/* ================= 4. console sections + bounded write stay server-decided == */
{
  const ctx = loadAdminContext({ hostname: 'danjion.pages.dev', search: '' });
  const { DanjionAdminConsole: C, DanjionAdminAuthority: A } = ctx;
  assert.equal(C.COMPLEX_SLUG, CANONICAL_SLUG, 'the console must pin the canonical top-level complex slug');

  const operatorViews = C.consoleSections({ state: 'operator', wildcard: false, scopes: ['business.review'] });
  assert.deepEqual(Array.from(operatorViews.operational, (s) => String(s.id)), ['applications', 'reports', 'reviewHistory'],
    'a bounded grant must expose only the operational sections mapped to its own server scopes');
  assert.equal(operatorViews.held.length, 0, 'the legacy resident-verification policy-hold placeholder is retired by #735');
  assert.equal(operatorViews.privileged.length, 0, 'a bounded grant must never render the privileged area');
  const verificationViews = C.consoleSections({ state: 'operator', wildcard: false, scopes: ['resident.verification.manage'] });
  assert.deepEqual(Array.from(verificationViews.operational, (s) => String(s.id)), ['unitMaster', 'householdReviews', 'verifications'],
    'the bounded resident-verification management scope exposes unit-master, household-review, and household-code sections');
  const messagingViews = C.consoleSections({ state: 'operator', wildcard: false, scopes: ['household.message.manage'] });
  assert.deepEqual(Array.from(messagingViews.operational, (s) => String(s.id)), ['householdMessages'],
    'the household messaging capability exposes only the send-disabled household targeting section');
  const superViews = C.consoleSections(A.normalizeAuthority({ level: 'admin', wildcard: true, scopes: ['*'] }));
  assert.ok(superViews.operational.some((s) => String(s.id) === 'unitMaster'),
    'the wildcard grant includes the unit-master section');
  assert.ok(superViews.operational.some((s) => String(s.id) === 'householdMessages'),
    'the wildcard grant includes the send-disabled household message preview section');
  assert.ok(superViews.operational.some((s) => String(s.id) === 'householdReviews'),
    'the wildcard grant includes the active household-membership review section');
  assert.ok(superViews.operational.some((s) => String(s.id) === 'verifications'),
    'the wildcard grant includes the active household-code operations section');
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

  const verification = await C.loadSection(
    route(200, { data: { households: [{ householdId: 'h1', buildingCode: '102', unitCode: '1802', codeStatus: 'active' }] } }),
    'https://api.test',
    byId('verifications')
  );
  assert.equal(verification.state, 'ready', 'household-code administration is an active server-decided section');
  assert.equal(verification.rows.length, 1);
  assert.ok(calls.at(-1).includes('/resident-verification/household-codes'),
    'resident-verification admin section must use the bounded household-code route');
  const scopeDenied = await C.loadSection(route(403, { error: { code: 'PADIEM_GRANT_REQUIRED' } }), 'https://api.test', byId('reports'));
  assert.equal(scopeDenied.state, 'scope-denied', 'per-section access is decided by the server grant scope');
  const posts = await C.loadSection(route(200, { data: [{ id: 3, status: 'draft' }] }), 'https://api.test', byId('posts'));
  assert.equal(posts.state, 'ready');
  assert.equal(posts.rows.length, 1);
  assert.ok(calls.at(-1).includes(`/api/v1/admin/complexes/${CANONICAL_SLUG}/posts?status=all`),
    'admin posts must read the operational list so draft/archived rows remain manageable');
  const signedOut = await C.loadSection(route(401, {}), 'https://api.test', byId('posts'));
  assert.equal(signedOut.state, 'signed-out');
  const benefits = await C.loadSection(route(200, { data: [{ id: 4, status: 'draft' }] }), 'https://api.test', byId('benefits'));
  assert.equal(benefits.state, 'ready');
  assert.equal(benefits.rows.length, 1);
  assert.ok(calls.at(-1).includes(`/api/v1/admin/complexes/${CANONICAL_SLUG}/benefits?status=all`),
    'admin benefits must read the operational list so draft/suspended/expired rows remain manageable');
  const broken = await C.loadSection(route(500, { error: { code: 'DB_READ_FAILED' } }), 'https://api.test', byId('benefits'));
  assert.equal(broken.state, 'error', '5xx sections must render a neutral error, never stale rows');
  assert.equal(broken.status, 500, 'safe HTTP status must be preserved for actionable diagnostics');
  assert.equal(broken.code, 'DB_READ_FAILED', 'safe backend error code must be preserved for diagnostics');

  assert.equal(C.extractRows({ unexpected: 'shape' }).length, 0, 'unknown payload shapes extract zero rows');
  assert.equal(C.rowTitle({ business_name: '방림정육점' }), '방림정육점', 'snake_case rows must render');
  assert.equal(C.rowStatus({ status: 'pending' }), 'pending');
  assert.ok(C.rowMeta({ applicantName: '주민', created_at: '2026-09-14T00:00:00Z' }).includes('주민'));

  const reviewCalls = [];
  const reviewFetch = async (url, init) => {
    reviewCalls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { id: 'd0a1c4a1-0000-4000-8000-000000000011', status: 'approved' } })
    };
  };
  const reviewed = await C.reviewBusinessApplication(
    reviewFetch,
    'https://api.test',
    'd0a1c4a1-0000-4000-8000-000000000011',
    'approved',
    '승인 메모'
  );
  assert.equal(reviewed.state, 'updated', 'the reviewed application mutation must classify a successful PATCH');
  assert.equal(reviewCalls.length, 1);
  assert.ok(reviewCalls[0].url.endsWith('/api/v1/admin/business-applications/d0a1c4a1-0000-4000-8000-000000000011'));
  assert.equal(reviewCalls[0].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(reviewCalls[0].init.body), { status: 'approved', reviewNote: '승인 메모' });

  const invalidBefore = reviewCalls.length;
  const invalid = await C.reviewBusinessApplication(
    reviewFetch,
    'https://api.test',
    'not-a-uuid',
    'approved',
    ''
  );
  assert.equal(invalid.state, 'invalid-request', 'invalid application IDs must fail before network mutation');
  assert.equal(reviewCalls.length, invalidBefore);

  const conflict = await C.reviewBusinessApplication(
    async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'RELATION_NOT_RESOLVED' } })
    }),
    'https://api.test',
    'd0a1c4a1-0000-4000-8000-000000000011',
    'approved',
    ''
  );
  assert.equal(conflict.state, 'conflict', 'server approval preconditions must remain authoritative');
  assert.equal(conflict.code, 'RELATION_NOT_RESOLVED');

  const postCalls = [];
  const postFetch = async (url, init) => {
    postCalls.push({ url, init });
    return {
      ok: true,
      status: init.method === 'POST' ? 201 : 200,
      json: async () => ({ data: { id: 'd0a1c4a1-0000-4000-8000-000000000012', status: 'draft' } })
    };
  };
  const created = await C.createOfficialPost(postFetch, 'https://api.test', {
    sourceName: '단지온 운영자',
    category: '생활소식',
    title: '엘리베이터 점검 안내',
    body: '점검 일정을 안내드립니다.',
    status: 'draft',
    displayMode: 'highlight'
  });
  assert.equal(created.state, 'updated');
  assert.equal(postCalls[0].init.method, 'POST');
  assert.ok(postCalls[0].url.endsWith(`/api/v1/admin/complexes/${CANONICAL_SLUG}/posts`));
  assert.deepEqual(JSON.parse(postCalls[0].init.body), {
    sourceName: '단지온 운영자',
    category: '생활소식',
    title: '엘리베이터 점검 안내',
    body: '점검 일정을 안내드립니다.',
    status: 'draft'
  });

  const updated = await C.updateOfficialPost(
    postFetch,
    'https://api.test',
    'd0a1c4a1-0000-4000-8000-000000000012',
    {
      sourceName: '단지온 운영자',
      category: '생활소식',
      title: '엘리베이터 점검 안내',
      body: '수정된 점검 일정을 안내드립니다.',
      status: 'published'
    }
  );
  assert.equal(updated.state, 'updated');
  assert.equal(postCalls[1].init.method, 'PATCH');
  assert.ok(postCalls[1].url.endsWith('/api/v1/admin/posts/d0a1c4a1-0000-4000-8000-000000000012'));
  assert.equal(JSON.parse(postCalls[1].init.body).status, 'published');

  const beforeInvalidPost = postCalls.length;
  const invalidPost = await C.createOfficialPost(postFetch, 'https://api.test', {
    sourceName: '단지온 운영자',
    category: '',
    title: '',
    body: '',
    status: 'draft'
  });
  assert.equal(invalidPost.state, 'invalid-request');
  assert.equal(postCalls.length, beforeInvalidPost, 'invalid post form must fail before network mutation');

  const businessCalls = [];
  const businessList = await C.loadBenefitBusinesses(async (url, init) => {
    businessCalls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'd0a1c4a1-0000-4000-8000-000000000041', name: '온케어 홈서비스' }] })
    };
  }, 'https://api.test');
  assert.equal(businessList.state, 'ready');
  assert.equal(businessList.rows.length, 1);
  assert.ok(businessCalls[0].url.endsWith(`/api/v1/complexes/${CANONICAL_SLUG}/businesses?limit=50`),
    'benefit creation must source eligible business identities from the canonical public business list');

  const benefitCalls = [];
  const benefitFetch = async (url, init) => {
    benefitCalls.push({ url, init });
    return {
      ok: true,
      status: init.method === 'POST' ? 201 : 200,
      json: async () => ({ data: { id: 'd0a1c4a1-0000-4000-8000-000000000042', status: 'draft' } })
    };
  };
  const benefitCreated = await C.createResidentBenefit(benefitFetch, 'https://api.test', {
    businessId: 'd0a1c4a1-0000-4000-8000-000000000041',
    title: '주민 전용 방문 혜택',
    description: '방문 서비스 주민 혜택',
    conditions: '예약 시 단지온 확인',
    startsAt: null,
    endsAt: null,
    status: 'draft'
  });
  assert.equal(benefitCreated.state, 'updated');
  assert.equal(benefitCalls[0].init.method, 'POST');
  assert.ok(benefitCalls[0].url.endsWith(`/api/v1/admin/complexes/${CANONICAL_SLUG}/benefits`));
  assert.deepEqual(JSON.parse(benefitCalls[0].init.body), {
    businessId: 'd0a1c4a1-0000-4000-8000-000000000041',
    title: '주민 전용 방문 혜택',
    description: '방문 서비스 주민 혜택',
    conditions: '예약 시 단지온 확인',
    startsAt: null,
    endsAt: null,
    status: 'draft'
  });

  const benefitUpdated = await C.updateResidentBenefit(
    benefitFetch,
    'https://api.test',
    'd0a1c4a1-0000-4000-8000-000000000042',
    {
      title: '주민 전용 방문 혜택',
      description: '수정된 주민 혜택',
      conditions: '',
      startsAt: null,
      endsAt: null,
      status: 'active'
    }
  );
  assert.equal(benefitUpdated.state, 'updated');
  assert.equal(benefitCalls[1].init.method, 'PATCH');
  assert.ok(benefitCalls[1].url.endsWith('/api/v1/admin/benefits/d0a1c4a1-0000-4000-8000-000000000042'));
  assert.equal(JSON.parse(benefitCalls[1].init.body).status, 'active');
  assert.ok(!('businessId' in JSON.parse(benefitCalls[1].init.body)),
    'editing a benefit must not allow client-side business identity mutation');

  const invalidBenefitBefore = benefitCalls.length;
  const invalidBenefit = await C.createResidentBenefit(benefitFetch, 'https://api.test', {
    businessId: 'not-a-uuid',
    title: '',
    status: 'draft'
  });
  assert.equal(invalidBenefit.state, 'invalid-request');
  assert.equal(benefitCalls.length, invalidBenefitBefore, 'invalid benefit form must fail before network mutation');
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
  assert.ok(adminPage.includes("'현재 권한: '+grant.label"), 'the main content must prominently repeat the server-resolved role');
  assert.ok(adminPage.includes("운영 범위: '+grant.scopes.join"), 'operational administrators must see their bounded scope summary');
  assert.ok(adminPage.includes('세대 코드 생성 · 재발급'), 'resident verification must render the active household-code management composer');
  assert.ok(adminPage.includes('ONE-TIME DISPLAY'), 'plaintext household codes must be presented only as an explicit one-time result');
  assert.ok(adminPage.includes("outcome.state==='network-error'"), 'network/CORS failures must be distinguishable from server failures');
  assert.ok(adminPage.includes("'목록 조회 실패 ('+safeStatus+safeCode"), 'safe HTTP status/code diagnostics must be visible');
  assert.ok(adminPage.includes('button.disabled=true'), 'privileged write controls must stay disabled');
  assert.ok(adminPage.includes('applicationReviewControls(row,panel,section,apiBase)'),
    'business applications must render the bounded #607 review controls');
  assert.ok(adminPage.includes("['approved','승인','primary'"),
    'the canonical admin page must expose the approved transition');
  assert.ok(adminPage.includes("['changes_requested','수정요청'"),
    'the canonical admin page must expose the changes-requested transition');
  assert.ok(adminPage.includes("['rejected','거절','danger'"),
    'the canonical admin page must expose the rejected transition');
  assert.ok(adminPage.includes("postComposer(panel,section,apiBase)"),
    'official-news section must expose the bounded create surface');
  assert.ok(adminPage.includes("postEditControls(row,panel,section,apiBase)"),
    'official-news rows must expose bounded edit/status controls');
  assert.ok(adminPage.includes("createOfficialPost(fetch,apiBase,postPayload(fields))"),
    'page must delegate post creation to the reviewed console bridge');
  assert.ok(adminPage.includes("updateOfficialPost(fetch,apiBase,row.id,postPayload(fields))"),
    'page must delegate post edits to the reviewed console bridge');
  assert.ok(adminPage.includes("benefitComposer(panel,section,apiBase)"),
    'resident-benefit section must expose the bounded create surface');
  assert.ok(adminPage.includes("benefitEditControls(row,panel,section,apiBase)"),
    'resident-benefit rows must expose bounded edit/status controls');
  assert.ok(adminPage.includes("loadBenefitBusinesses(fetch,apiBase)"),
    'benefit creation must use a server-derived business selector rather than manual UUID entry');
  assert.ok(adminPage.includes("createResidentBenefit(fetch,apiBase,benefitPayload(fields,businessSelect.value))"),
    'page must delegate benefit creation to the reviewed console bridge');
  assert.ok(adminPage.includes("updateResidentBenefit(fetch,apiBase,row.id,benefitPayload(fields,null))"),
    'page must delegate benefit edits to the reviewed console bridge');
  assert.ok(adminPage.includes("meta name=\"robots\" content=\"noindex\""), 'the admin console must not be indexed');
}

/* ================= 6. no client-side identity inference; write scope is exact */
{
  const banned = ['localStorage', 'sessionStorage', 'location.search', 'URLSearchParams(', 'document.cookie', '/api/auth', '/auth/social-start', 'x-danjion-dev-auth-user'];
  for (const [name, src] of [['admin/index.html', adminPage], ['danjion-admin-authority.js', authoritySrc], ['danjion-admin-console.js', consoleSrc]]) {
    for (const token of banned) {
      assert.ok(!src.includes(token), `${name} must never read ${token} (identity/authority comes only from the server grant)`);
    }
    assert.ok(!/innerHTML\s*=/.test(src), `${name} must build the DOM text-safe (no innerHTML assignment)`);
  }

  for (const src of [adminPage, authoritySrc]) {
    assert.ok(!/method\s*:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/.test(src),
      'page/authority layers must not directly own mutation transports');
  }
  assert.equal((consoleSrc.match(/method\s*:\s*'PATCH'/g) || []).length, 6,
    'the console bridge may own only application-review, resident-news review, official-news, benefit, household-membership review, and unit-master PATCH transports');
  assert.equal((consoleSrc.match(/method\s*:\s*'POST'/g) || []).length, 5,
    'the console bridge may own only official-news, benefit, household-code create, household-message dry-run preview, and unit-master create POST transports');
  assert.equal((consoleSrc.match(/method\s*:\s*'DELETE'/g) || []).length, 1,
    'the console bridge may own only household-code revoke DELETE transport');
  assert.ok(consoleSrc.includes(" + '/unit-master'"),
    'unit-master create must use the admin complex unit-master family');
  assert.ok(consoleSrc.includes("'/api/v1/admin/complex-units/'"),
    'unit-master edit must use the admin complex-units PATCH family');
  assert.ok(consoleSrc.includes("'/api/v1/admin/business-applications/'"),
    'business-application review must remain an explicitly activated mutation family');
  assert.ok(consoleSrc.includes("'/resident-news/submissions/'") && consoleSrc.includes('reviewResidentNewsSubmission'),
    'resident-news review must remain a dedicated operator PATCH family, separate from business review');
  assert.ok(consoleSrc.includes("'/api/v1/admin/complexes/'") && consoleSrc.includes(" + '/posts'"),
    'official-news create must use the admin complex posts family');
  assert.ok(consoleSrc.includes("'/api/v1/admin/posts/'"),
    'official-news edit must use the admin post PATCH family');
  assert.ok(consoleSrc.includes(" + '/benefits'"),
    'resident-benefit create must use the admin complex benefits family');
  assert.ok(consoleSrc.includes("'/api/v1/admin/benefits/'"),
    'resident-benefit edit must use the admin benefit PATCH family');
  assert.ok(consoleSrc.includes("'/api/v1/admin/household-memberships/'"),
    'household membership review must use the dedicated bounded admin PATCH family');
  assert.ok(consoleSrc.includes("'/household-messages/preview'"),
    'household message POST must remain a non-dispatch dry-run preview route');
  assert.ok(!consoleSrc.includes("'/household-messages/send'"),
    'household message dispatch must remain absent until a separate activation gate');
  assert.ok(!/method\s*:\s*['"]PUT['"]/.test(consoleSrc),
    'no PUT operational mutation may be activated');

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
  assert.ok(index.includes('.public-actions .admin-entry[hidden]{display:none!important}'),
    'the Intro CSS must never override the hidden admin entry for signed-out or ungranted users');
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
