import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Admin resident-verification exemption (Phase A, frontend-only): the four
// designated administrator principals are exempted from resident verification
// ONLY through the explicit bounded scope `resident.verification.exempt` on
// their own valid PADIEM authority answer (GET /api/v1/admin/authority). The
// wildcard '*' alone NEVER exempts; identity, email, provider, or browser
// storage are never exemption inputs. When exempt, My Info must resolve the
// authority FIRST and then perform ZERO resident traffic: no bridge.profile(),
// no bridge.summary(), no household getSnapshot(). The exempt view renders
// only Better Auth get-session identity (user.name / user.createdAt) with the
// exact copy '운영자 계정 · 주민인증 불필요' and never the resident-state copy.
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
  assert.equal(typeof A.hasResidentVerificationExemption, 'function', 'the helper must be exported');
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

/* ==== 6. the wiring resolves authority FIRST and gates every resident call = */
{
  assert.ok(/Promise\.all\(\[sessionIdentity\(\),resolveResidentExemption\(\)\]\)\.then\(function\(values\)\{/.test(wiring),
    'the wiring must resolve session identity and exemption before loading any resident data');
  assert.ok(/if\(exempt\)\{loadExemptIdentity\(user\);return;\}/.test(wiring),
    'the exempt branch must return before any resident fetch is started');
  const gateAt = wiring.indexOf('Promise.all([sessionIdentity(),resolveResidentExemption()])');
  assert.ok(gateAt > -1 && gateAt > wiring.indexOf('function loadResidentData'), 'the combined session/authority gate is the wiring entry point');
  const profileAt = wiring.indexOf('bridge.profile()');
  const summaryAt = wiring.indexOf('bridge.summary()');
  const snapshotAt = wiring.indexOf('.getSnapshot()');
  assert.ok(profileAt > wiring.indexOf('function loadResidentData') && profileAt < wiring.indexOf('function renderResidentState'),
    'bridge.profile() may only be called inside loadResidentData');
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
  assert.ok(new RegExp(`renderResidentState\\('${EXEMPT_COPY}',\\{kind:'exempt'\\}\\)`).test(wiring),
    'the exempt state must render with kind exempt and no cta/edit flags');
  const exemptFn = wiring.slice(wiring.indexOf('function loadExemptIdentity'), wiring.indexOf('function resolveResidentExemption'));
  assert.ok(!exemptFn.includes('주민인증 완료'), 'the exempt branch must never render the verified copy');
  assert.ok(!exemptFn.includes('주민인증이 필요합니다'), 'the exempt branch must never toast the required copy');
  assert.ok(!exemptFn.includes('cta:true') && !exemptFn.includes('edit:true'), 'the exempt branch must not surface the CTA or edit entry');
}

/* ==== 8. account identity comes only from Better Auth get-session fields === */
{
  const identityFn = wiring.slice(wiring.indexOf('function sessionIdentity'), wiring.indexOf('function bindEmailResend'));
  const exemptFn = wiring.slice(wiring.indexOf('function loadExemptIdentity'), wiring.indexOf('function resolveResidentExemption'));
  assert.ok(identityFn.includes('S.fetchSession'), 'account identity must come from the sanctioned session runtime');
  assert.ok(!identityFn.includes('/api/'), 'the My Info account-state branch must carry no endpoint literal of its own');
  assert.ok(identityFn.includes('S.nativeSessionReady'), 'the session answer must pass the canonical native-shape gate');
  assert.ok(identityFn.includes('user.name') && identityFn.includes('user.createdAt'), 'name and createdAt may be presented from the signed-in session');
  assert.ok(identityFn.includes('renderEmailState(user)'), 'the signed-in session may present its own email-verification state');
  assert.ok(!identityFn.includes('user.id'), 'the auth user id must never be rendered');
  assert.ok(!exemptFn.includes('bridge.') && !exemptFn.includes('getSnapshot'), 'the exempt branch must stay off every resident surface');
  for (const endpoint of ['/auth/social-start', '/api/auth/get-session', '/api/auth/sign-in/social',
    '/api/auth/sign-in/email', '/api/auth/sign-up/email', '/api/auth/forget-password']) {
    assert.ok(!f19.includes(endpoint), `leaf-b14 Stage 2: f19 must not carry auth endpoint traffic (${endpoint})`);
  }
  assert.match(sessionSrc, /function fetchSession\(fetchImpl, loc\)[\s\S]{0,160}danjionAuthBase\(loc\)[\s\S]{0,120}'\/api\/auth\/get-session'/,
    'fetchSession must bind get-session to the auth base resolver exactly like the account strip');
  assert.match(sessionSrc, /function sendVerificationEmail\(fetchImpl, email, loc\)[\s\S]{0,420}'\/api\/auth\/send-verification-email'/,
    'verification resend must also stay in the sanctioned auth runtime');
  assert.ok(/Object\.freeze\(\{[\s\S]*?fetchSession,[\s\S]*?sendVerificationEmail,/.test(sessionSrc),
    'session and verification helpers must be exported from DanjionSession');
  const endpoints = new Set((wiring.match(/\/api\/[a-z0-9/_.-]+/gi) || []).filter((e) => identityFn.includes(e) || exemptFn.includes(e)));
  assert.deepEqual(Array.from(endpoints), [], 'account/exempt branches reach the network only through shared helpers');
}

/* ========= 9. the ordinary resident flow is unchanged (B488 invariants) ==== */
{
  assert.ok(wiring.includes("'주민인증 완료'") && wiring.includes("'주민인증 심사 대기 중'") && wiring.includes("'주민인증 필요'"),
    'the three server-sourced resident states must survive');
  assert.ok(wiring.includes("result.error&&result.error.code==='HOUSEHOLD_ASSOCIATION_REQUIRED'"), 'the 403-code gate must survive');
  assert.ok(wiring.includes('bridge.updateProfile({nickname:nick.value,publicBio:bio.value})'), 'the server-backed profile edit must survive');
  assert.ok(wiring.includes("renderResidentState('—',{kind:'unknown'})"), 'the fail-closed em-dash state must survive');
  assert.ok(f19.includes('id="mi-resident-cta" href="26_우리집연결.html" hidden'), 'the CTA must keep its real target and hidden default');
}

/* =========== 10. no hardcoded account identifiers anywhere in the gate ===== */
{
  const exemptFn = wiring.slice(wiring.indexOf('function loadExemptIdentity'), wiring.indexOf('resolveResidentExemption().then'));
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(wiring), 'no email literal may appear in the wiring');
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(exemptFn), 'no user id literal may appear in the exempt branch');
  assert.ok(!exemptFn.includes('name===') && !exemptFn.includes('.includes(name'), 'identity strings must never drive the exemption');
  assert.ok(!authoritySrc.includes('@'), 'the authority module must carry no address literal');
  assert.ok(!/\buser\b|\bemail\b|\bname\b|createdAt|localStorage|sessionStorage|document\.cookie/.test(wiring.slice(wiring.indexOf('function resolveResidentExemption'), wiring.indexOf('resolveResidentExemption().then'))),
    'the exemption decision may read nothing but the resolved authority');
}

/* ================= runtime harness: exempt principal, zero resident calls == */
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
      if (u.includes('/api/v1/admin/authority')) return authorityAnswer();
      if (u.includes('/api/auth/get-session')) return response(200, { session: { id: 'sess-1' }, user: { name: '관리자표시', createdAt: '2026-01-15T00:00:00Z' } });
      if (u.includes('/api/v1/me/profile')) return response(200, { data: { nickname: '주민', joinedMonth: '2026-08' } });
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

const operatorExempt = () => response(200, { data: { level: 'operator', label: '일반관리자', wildcard: false, scopes: [EXEMPT_SCOPE] } });
const bareSuper = () => response(200, { data: { level: 'admin', label: '최고관리자', wildcard: true, scopes: ['*'] } });
const deniedGrant = () => response(403, { error: { code: 'ADMIN_AUTHORITY_REQUIRED' } });
const malformed200 = () => response(200, { data: { level: 'operator', wildcard: false, scopes: ['*'] } });
const lookalikeScope = () => response(200, { data: { level: 'operator', wildcard: false, scopes: [`${EXEMPT_SCOPE}x`] } });

/* ============ runtime A. exempt operator: zero resident traffic, copy ====== */
{
  const h = makeHarness(operatorExempt);
  await h.drain();
  assert.ok(h.calls.some((u) => u.includes('/api/v1/admin/authority')), 'authority must be resolved first');
  assert.ok(!h.calls.some((u) => u.includes('/api/v1/me/')), 'the exempt branch must emit ZERO resident-surface traffic');
  assert.ok(h.calls.some((u) => u.includes('/api/auth/get-session')), 'identity must come from get-session');
  assert.equal(h.nodes.get('mi-resident-state').textContent, EXEMPT_COPY, 'exact exempt copy');
  assert.equal(h.nodes.get('mi-resident-row').hidden, false, 'state row visible');
  assert.ok(h.nodes.get('mi-resident-row').className.includes('is-exempt'), 'state row must carry the exempt kind');
  assert.equal(h.nodes.get('mi-resident-cta').hidden, true, 'the resident CTA must stay hidden');
  assert.equal(h.nodes.get('mi-profile-edit').hidden, true, 'the profile edit entry must stay hidden');
  assert.equal(h.nodes.get('mi-nickname').textContent, '관리자표시님', 'name renders from get-session only');
  assert.equal(h.nodes.get('mi-joined').textContent, '2026년 1월 가입', 'joined month renders from createdAt');
  assert.equal(h.nodes.get('mi-household').textContent, '—', 'the household badge must never claim completion');
  assert.equal(h.nodes.get('mi-stat-posts').textContent, '—', 'non-resident activity stats stay em-dash');
}

/* ====== runtime B. wildcard SUPER without the explicit scope: full flow ==== */
/* ====== runtime C. ordinary resident (403): full flow ====== */
/* ====== runtime D. malformed 200: full flow, fail toward resident ========== */
/* ====== runtime E. lookalike scope: full flow ============================== */
for (const [label, answer, authorityHits] of [
  ['wildcard SUPER', bareSuper, 1],
  ['ungranted resident', deniedGrant, 1],
  ['malformed 200', malformed200, 1],
  ['lookalike scope', lookalikeScope, 1],
]) {
  const h = makeHarness(answer);
  await h.drain();
  assert.equal(h.calls.filter((u) => u.includes('/api/v1/admin/authority')).length, authorityHits, `${label}: authority resolved exactly once`);
  assert.ok(h.calls.some((u) => u.includes('/api/v1/me/profile')), `${label}: ordinary flow must still call bridge.profile()`);
  assert.ok(h.calls.some((u) => u.includes('/api/v1/me/summary')), `${label}: ordinary flow must still call bridge.summary()`);
  assert.notEqual(h.nodes.get('mi-resident-state').textContent, EXEMPT_COPY, `${label}: the exempt copy must never render`);
  assert.ok(!h.calls.some((u) => u.includes('/api/auth/get-session')), `${label}: the wiring must not fetch get-session on the resident path`);
}

console.log('leaf-admin-resident-verification-exempt-contract: PASS');
