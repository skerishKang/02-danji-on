import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Admin resident-verification exemption (Phase A, frontend-only): the four
// designated administrator principals are exempted from resident verification
// ONLY through the explicit bounded scope `resident.verification.exempt` on
// their own server-side self exemption answer. My Info must use the dedicated
// GET /api/v1/me/resident-verification-exemption probe, never the audited
// administrator authority endpoint. The
// wildcard '*' alone NEVER exempts; identity, email, provider, or browser
// storage are never exemption inputs. When exempt, My Info must resolve the
// authority FIRST and then avoid resident-only traffic: no summary or household
// snapshot. The explicitly exempt principal may load only its own server-backed
// profile so nickname/publicBio can be edited. The view keeps the exact copy
// '운영자 계정 · 주민인증 불필요' and never claims verified-resident state.
// Ordinary residents (no grant → 403, invalid 200, demo lane) keep the full
// #488 flow unchanged.
// Run: node frontend/tests/leaf-admin-resident-verification-exempt-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const EXEMPT_SCOPE = 'resident.verification.exempt';
const EXEMPT_COPY = '운영자 계정 · 주민인증 불필요';

const sessionSrc = await read('../assets/danjion-session.js');
const authoritySrc = await read('../assets/danjion-admin-authority.js');
const residentSrc = await read('../assets/resident-bridge.js');
const f19 = await read('../19_내정보_메인.html');

const wiringStart = f19.indexOf('<script id="danjion-myinfo-server-wiring">');
assert.ok(wiringStart > -1, 'f19 must keep the myinfo server wiring script');
const wiringRaw = f19.slice(wiringStart, f19.indexOf('</script>', wiringStart));
const wiring = wiringRaw.replace(/^\s*<script[^>]*>\s*/, '');

/* ============ 1. the exemption scope is a named exported constant ========== */
{
  const ctx = { location: { hostname: 'danjion.pages.dev', search: '' }, URL, URLSearchParams, console };
  vm.createContext(ctx);
  vm.runInContext(sessionSrc, ctx);
  vm.runInContext(authoritySrc, ctx);
  const { DanjionAdminAuthority: A } = ctx;
  assert.equal(A.RESIDENT_VERIFICATION_EXEMPT_SCOPE, EXEMPT_SCOPE,
    'the exemption must key on the exact canonical scope string');
  assert.equal(typeof A.hasResidentVerificationExemption, 'function', 'the scope helper must be exported');
  assert.equal(A.RESIDENT_VERIFICATION_EXEMPTION_PATH, '/api/v1/me/resident-verification-exemption', 'the self-only probe path is canonical');
  assert.equal(typeof A.fetchResidentVerificationExemption, 'function', 'the read-only self exemption fetch helper must be exported');
  assert.ok(Object.isFrozen(A), 'the authority module must stay frozen');
}

/* ====== 2. a valid bounded OPERATIONAL authority + explicit scope exempts === */
/* ====== 3. the wildcard '*' alone NEVER exempts; SUPER + explicit does ==== */
{
  const ctx = { location: { hostname: 'danjion.pages.dev', search: '' }, URL, URLSearchParams, console };
  vm.createContext(ctx);
  vm.runInContext(sessionSrc, ctx);
  vm.runInContext(authoritySrc, ctx);
  const { DanjionAdminAuthority: A } = ctx;
  const exemptOperator = A.normalizeAuthority({ level: 'operator', wildcard: false, scopes: [EXEMPT_SCOPE] });
  assert.equal(exemptOperator.state, 'operator', 'an exempt-only operator grant stays a valid authority shape');
  assert.equal(A.hasResidentVerificationExemption(exemptOperator), true, 'explicit scope on a valid operator grant exempts');
  const bareSuper = A.normalizeAuthority({ level: 'admin', wildcard: true, scopes: ['*'] });
  assert.equal(A.hasResidentVerificationExemption(bareSuper), false, 'wildcard alone must NEVER exempt');
  const superExempt = A.normalizeAuthority({ level: 'admin', wildcard: true, scopes: ['*', EXEMPT_SCOPE] });
  assert.equal(superExempt.state, 'admin', 'an extra explicit scope must not break the SUPER shape');
  assert.equal(A.hasResidentVerificationExemption(superExempt), true, 'SUPER carrying the explicit scope exempts');
  const boundedPeer = A.normalizeAuthority({ level: 'operator', wildcard: false, scopes: ['business_application.review', EXEMPT_SCOPE] });
  assert.equal(A.hasResidentVerificationExemption(boundedPeer), true, 'mixed bounded scopes still match exactly');
}

/* ==== 4. every non-authoritative or inconsistent payload never exempts ==== */
{
  const ctx = { location: { hostname: 'danjion.pages.dev', search: '' }, URL, URLSearchParams, console };
  vm.createContext(ctx);
  vm.runInContext(sessionSrc, ctx);
  vm.runInContext(authoritySrc, ctx);
  const { DanjionAdminAuthority: A } = ctx;
  for (const state of ['invalid', 'denied', 'signed-out', 'unbound', 'error', 'none']) {
    assert.equal(A.hasResidentVerificationExemption({ state, wildcard: false, scopes: [EXEMPT_SCOPE] }), false,
      `state ${state} must never exempt even when a scopes array is supplied`);
  }
  assert.equal(A.hasResidentVerificationExemption(A.normalizeAuthority({ level: 'operator', wildcard: false, scopes: [] })), false, 'empty operator is invalid and must not exempt');
  assert.equal(A.hasResidentVerificationExemption(A.normalizeAuthority(null)), false, 'a malformed 200 must not exempt');
  assert.equal(A.hasResidentVerificationExemption(null), false, 'null must not exempt');
  assert.equal(A.hasResidentVerificationExemption(undefined), false, 'undefined must not exempt');
  assert.equal(A.hasResidentVerificationExemption({ state: 'operator', wildcard: true, scopes: [EXEMPT_SCOPE] }), false,
    'wildcard flag inconsistent with operator state must not exempt');
  assert.equal(A.hasResidentVerificationExemption({ state: 'admin', wildcard: false, scopes: [EXEMPT_SCOPE] }), false,
    'admin flag inconsistent with the wildcard requirement must not exempt');
  assert.equal(A.hasResidentVerificationExemption({ state: 'operator', wildcard: false, scopes: EXEMPT_SCOPE }), false,
    'a non-array scopes payload must not exempt');
  assert.equal(A.hasResidentVerificationExemption({ state: 'operator', wildcard: false, scopes: [`${EXEMPT_SCOPE}x`] }), false,
    'prefix lookalikes must not exempt');
  assert.equal(A.hasResidentVerificationExemption({ state: 'operator', wildcard: false, scopes: ['resident.verification.*'] }), false,
    'a domain-level wildcard must not exempt; only the exact scope does');
}

/* ============ 5. f19 loads the authority resolver before the wiring ======= */
{
  const sessionAt = f19.indexOf('<script src="assets/danjion-session.js"></script>');
  const bridgeAt = f19.indexOf('<script src="assets/resident-bridge.js"></script>');
  const authorityAt = f19.indexOf('<script src="assets/danjion-admin-authority.js"></script>');
  assert.ok(sessionAt > -1 && bridgeAt > sessionAt && authorityAt > bridgeAt && authorityAt < wiringStart,
    'f19 must load session → resident-bridge → admin-authority before the myinfo wiring');
}

/* ==== 6. session resolves FIRST; authority/resident calls require a member === */
{
  assert.ok(/sessionIdentity\(\)\.then\(function\(identity\)\{/.test(wiring),
    'the wiring must resolve native session identity before any authority/resident hydration');
  assert.ok(/if\(!identity\|\|!identity\.user\)\{[\s\S]*showGuestGate[\s\S]*return;[\s\S]*showPrivateContent\(\);[\s\S]*resolveResidentExemption\(\)\.then/.test(wiring),
    'signed-out users must return at the guest gate before authority or resident reads begin');
  assert.ok(/if\(exempt\)\{loadExemptIdentity\(identity\.user\);return;\}/.test(wiring),
    'the authenticated exempt branch must return before ordinary resident fetches start');
  const gateAt = wiring.indexOf('sessionIdentity().then(function(identity)');
  const authorityAt = wiring.indexOf('return resolveResidentExemption().then', gateAt);
  assert.ok(gateAt > -1 && gateAt > wiring.indexOf('function loadResidentData'),
    'session identity must be the myinfo hydration entry point');
  assert.ok(authorityAt > gateAt,
    'resident-verification exemption must be evaluated only after authenticated session gating');
  assert.ok(wiring.includes('AA.fetchResidentVerificationExemption(fetch)'), 'My Info must use the dedicated read-only self exemption probe');
  assert.ok(!wiring.includes('AA.fetchAuthority(fetch)'), 'My Info must never use the audited admin authority endpoint as an exemption probe');
  const profileAt = wiring.indexOf('bridge.profile()');
  const summaryAt = wiring.indexOf('bridge.summary()');
  const snapshotAt = wiring.indexOf('.getSnapshot()');
  assert.ok(profileAt > wiring.indexOf('function loadProfile') && profileAt < wiring.indexOf('function loadResidentData'),
    'bridge.profile() must have one shared self-profile call site before resident loading');
  assert.ok(summaryAt > wiring.indexOf('function loadResidentData') && summaryAt < wiring.indexOf('function renderResidentState'),
    'bridge.summary() may only be called inside loadResidentData');
  assert.ok(snapshotAt > wiring.indexOf('function loadResidentState'), 'the household snapshot is only read inside loadResidentState');
  assert.equal((wiring.match(/bridge\.profile\(\)/g) || []).length, 1, 'exactly one bridge.profile() call site');
  assert.equal((wiring.match(/bridge\.summary\(\)/g) || []).length, 1, 'exactly one bridge.summary() call site');
  assert.equal((wiring.match(/\.getSnapshot\(\)/g) || []).length, 1, 'exactly one getSnapshot() call site');
}

/* ============ 7. the exempt branch renders the exact copy only ============ */
{
  assert.ok(wiring.includes(`'${EXEMPT_COPY}'`), 'the exempt copy must ship exactly');
  assert.ok(new RegExp(`renderResidentState\\('${EXEMPT_COPY}',\\{kind:'exempt',edit:true\\}\\)`).test(wiring),
    'the exempt state must render with kind exempt and the self-profile edit action');
  const exemptFn = wiring.slice(wiring.indexOf('function loadExemptIdentity'), wiring.indexOf('function resolveResidentExemption'));
  assert.ok(!exemptFn.includes('주민인증 완료'), 'the exempt branch must never render the verified copy');
  assert.ok(!exemptFn.includes('주민인증이 필요합니다'), 'the exempt branch must never toast the required copy');
  assert.ok(!exemptFn.includes('cta:true') && exemptFn.includes('edit:true'), 'the exempt branch must hide resident CTA and surface only self-profile edit');
  assert.ok(exemptFn.includes('loadProfile()') && !exemptFn.includes('loadResidentData()') && !exemptFn.includes('loadResidentState()'),
    'the exempt branch may load only its own profile, never resident summary or household state');
}

/* ==== 8. account identity comes only from Better Auth get-session fields === */
{
  const identityFn = wiring.slice(wiring.indexOf('function sessionIdentity'), wiring.indexOf('function bindEmailResend'));
  const exemptFn = wiring.slice(wiring.indexOf('function loadExemptIdentity'), wiring.indexOf('function resolveResidentExemption'));
  assert.ok(identityFn.includes('S.fetchSession'), 'account identity must come from the sanctioned session runtime');
  assert.ok(!identityFn.includes('/api/'), 'the My Info account-state branch must carry no endpoint literal of its own');
  assert.ok(identityFn.includes('S.nativeSessionReady'), 'the session answer must pass the canonical native-shape gate');
  assert.ok(identityFn.includes('S.visibleAccountIdentity') && identityFn.includes('user.createdAt'), 'visible identity must use the shared role-label-safe helper while createdAt stays session-sourced');
  assert.ok(identityFn.includes('renderEmailState(user,authKind)'), 'the signed-in session may present provider-aware account email state');
  assert.ok(!identityFn.includes('user.id'), 'the auth user id must never be rendered');
  assert.ok(!exemptFn.includes('bridge.summary') && !exemptFn.includes('getSnapshot'), 'the exempt branch must stay off resident summary and household surfaces');
  for (const endpoint of ['/auth/social-start', '/api/auth/get-session', '/api/auth/sign-in/social',
    '/api/auth/sign-in/email', '/api/auth/sign-up/email', '/api/auth/forget-password']) {
    assert.ok(!f19.includes(endpoint), `leaf-b14 Stage 2: f19 must not carry auth endpoint traffic (${endpoint})`);
  }
  assert.match(sessionSrc, /function fetchSession\(fetchImpl, loc\)[\s\S]{0,160}danjionAuthBase\(loc\)[\s\S]{0,120}'\/api\/auth\/get-session'/,
    'fetchSession must bind get-session to the auth base resolver exactly like the account strip');
  assert.match(sessionSrc, /function sendVerificationEmail\(fetchImpl, email, loc\)[\s\S]{0,420}'\/api\/auth\/send-verification-email'/,
    'verification resend must also stay in the sanctioned auth runtime');
  assert.ok(/Object\.freeze\(\{[\s\S]*?fetchSession,[\s\S]*?visibleAccountIdentity,[\s\S]*?sendVerificationEmail,/.test(sessionSrc),
    'session, role-label-safe identity, and verification helpers must be exported from DanjionSession');
  const endpoints = new Set((wiring.match(/\/api\/[a-z0-9/_.-]+/gi) || []).filter((e) => identityFn.includes(e) || exemptFn.includes(e)));
  assert.deepEqual(Array.from(endpoints), [], 'account/exempt branches reach the network only through shared helpers');
}

/* ========= 9. the ordinary resident flow is unchanged (B488 invariants) ==== */
{
  assert.ok(wiring.includes("'주민인증 완료'") && wiring.includes("'우리집 연결됨 · 운영팀 확인 대기'") && wiring.includes("'우리집 연결 필요'"),
    'the three server-sourced household/resident states must survive');
  assert.ok(wiring.includes("result.error&&result.error.code==='HOUSEHOLD_ASSOCIATION_REQUIRED'"), 'the 403-code gate must survive');
  assert.ok(wiring.includes('bridge.updateProfile({nickname:nick.value,publicBio:bio.value})'), 'the server-backed profile edit must survive');
  assert.ok(wiring.includes("renderResidentState('—',{kind:'unknown'})"), 'the fail-closed em-dash state must survive');
  assert.ok(f19.includes('id="mi-resident-cta" href="26_우리집연결.html" hidden'), 'the CTA must keep its real target and hidden default');
}

/* =========== 10. no hardcoded account identifiers anywhere in the gate ===== */
{
  const exemptFn = wiring.slice(wiring.indexOf('function loadExemptIdentity'), wiring.indexOf('function resolveResidentExemption'));
  const decisionFn = wiring.slice(wiring.indexOf('function resolveResidentExemption'), wiring.indexOf('sessionIdentity().then(function(identity)'));
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(wiring), 'no hardcoded email literal may appear in the wiring');
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(exemptFn), 'no user id literal may appear in the exempt branch');
  assert.ok(!exemptFn.includes('name===') && !exemptFn.includes('.includes(name'), 'identity strings must never drive the exemption');
  assert.ok(!authoritySrc.includes('@'), 'the authority module must carry no address literal');
  assert.ok(!/\buser\b|\bemail\b|\bname\b|createdAt|localStorage|sessionStorage|document\.cookie/.test(decisionFn),
    'the exemption decision may read nothing but the resolved authority');
}

/* =========== runtime harness: exempt principal, self-profile call only ===== */
function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, headers: { get: () => null } };
}

function makeHarness(authorityAnswer) {
  const calls = [];
  const nodes = new Map();
  const doc = {
    readyState: 'loading',
    addEventListener() {},
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { textContent: '', hidden: true, className: '', value: '', disabled: false, focus() {}, addEventListener() {} });
      return nodes.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, classList: { add() {} }, dataset: {}, append() {}, appendChild() {}, addEventListener() {}, setAttribute() {} }; },
    head: { appendChild() {} },
  };
  const ctx = {
    URL,
    URLSearchParams,
    console,
    document: doc,
    location: { hostname: 'danjion.pages.dev', pathname: '/19_내정보_메인.html', search: '', origin: 'https://danjion.pages.dev' },
    fetch: async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/api/v1/me/resident-verification-exemption')) return authorityAnswer();
      if (u.includes('/api/auth/get-session')) return response(200, { session: { id: 'sess-1' }, user: { name: '최고관리자', email: 'signed-in@example.invalid', emailVerified: true, createdAt: '2026-01-15T00:00:00Z' } });
      if (u.includes('/api/v1/me/profile')) return response(200, { data: { nickname: '관리자별명', publicBio: '운영자 소개', joinedMonth: '2026-08' } });
      if (u.includes('/api/v1/me/summary')) return response(200, { data: { postCount: 1, commentCount: 2, receivedReactionCount: 3, savedBusinessCount: 4, unreadMessageCount: 0, household: { status: 'verified' } } });
      return response(404, { error: { code: 'NOT_FOUND' } });
    },
  };
  vm.createContext(ctx);
  vm.runInContext(sessionSrc, ctx);
  vm.runInContext(residentSrc, ctx);
  vm.runInContext(authoritySrc, ctx);
  vm.runInContext(wiring, ctx);
  const drain = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
  return { calls, nodes, drain };
}

const operatorExempt = () => response(200, { data: { exempt: true } });
const bareSuper = () => response(200, { data: { exempt: false } });
const deniedGrant = () => response(200, { data: { exempt: false } });
const malformed200 = () => response(200, { data: { exempt: 'yes' } });
const lookalikeScope = () => response(503, { error: { code: 'RESIDENT_VERIFICATION_EXEMPTION_DB_ERROR' } });

/* ===== runtime A. exempt operator: self profile only, no resident traffic === */
{
  const h = makeHarness(operatorExempt);
  await h.drain();
  assert.ok(h.calls.some((u) => u.includes('/api/v1/me/resident-verification-exemption')), 'authority must be resolved first');
  assert.equal(h.calls.filter((u) => u.includes('/api/v1/me/profile')).length, 1, 'the exempt branch may load its own profile exactly once');
  assert.ok(!h.calls.some((u) => u.includes('/api/v1/me/summary')), 'the exempt branch must not load resident summary');
  assert.ok(h.calls.some((u) => u.includes('/api/auth/get-session')), 'identity must come from get-session');
  assert.equal(h.nodes.get('mi-resident-state').textContent, EXEMPT_COPY, 'exact exempt copy');
  assert.equal(h.nodes.get('mi-resident-row').hidden, false, 'state row visible');
  assert.ok(h.nodes.get('mi-resident-row').className.includes('is-exempt'), 'state row must carry the exempt kind');
  assert.equal(h.nodes.get('mi-resident-cta').hidden, true, 'the resident CTA must stay hidden');
  assert.equal(h.nodes.get('mi-profile-edit').hidden, false, 'the self-profile edit entry must be visible');
  assert.equal(h.nodes.get('mi-nickname').textContent, '관리자별명님', 'server-backed self-profile nickname must replace the session fallback');
  assert.equal(h.nodes.get('mi-joined').textContent, '2026년 8월 가입', 'joined month renders from the server-backed self profile');
  assert.equal(h.nodes.get('mi-household').textContent, '—', 'the household badge must never claim completion');
  assert.equal(h.nodes.get('mi-stat-posts').textContent, '—', 'non-resident activity stats stay em-dash');
}

/* ====== runtime B. server says false: ordinary resident flow =============== */
/* ====== runtime C. ordinary resident false: full flow ====================== */
/* ====== runtime D. malformed 200: fail toward resident ===================== */
/* ====== runtime E. server failure: fail toward resident ==================== */
for (const [label, answer, authorityHits] of [
  ['wildcard SUPER', bareSuper, 1],
  ['ungranted resident', deniedGrant, 1],
  ['malformed 200', malformed200, 1],
  ['lookalike scope', lookalikeScope, 1],
]) {
  const h = makeHarness(answer);
  await h.drain();
  assert.equal(h.calls.filter((u) => u.includes('/api/v1/me/resident-verification-exemption')).length, authorityHits, `${label}: self exemption resolved exactly once`);
  assert.ok(h.calls.some((u) => u.includes('/api/v1/me/profile')), `${label}: ordinary flow must still call bridge.profile()`);
  assert.ok(h.calls.some((u) => u.includes('/api/v1/me/summary')), `${label}: ordinary flow must still call bridge.summary()`);
  assert.notEqual(h.nodes.get('mi-resident-state').textContent, EXEMPT_COPY, `${label}: the exempt copy must never render`);
  assert.equal(h.calls.filter((u) => u.includes('/api/auth/get-session')).length, 1, `${label}: account state must resolve exactly once before the resident path`);
}

console.log('leaf-admin-resident-verification-exempt-contract: PASS');
