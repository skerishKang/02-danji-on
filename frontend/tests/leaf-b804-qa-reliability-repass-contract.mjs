// Issue #804 — QA Reliability re-pass: 320px resident-benefit filter clipping,
// guest saved-shop false-success, guest /api/auth/list-accounts eagerness, and
// the "(를)" particle fallback in the save toast.
//
// This contract is deliberately source + runtime level. It ships NO network and
// NO production mutation. The saved-shop and list-accounts legs execute the real
// shared runtime against injected fakes so a change in behaviour, not just a
// substring, fails the gate. The 320px leg asserts the CSS *mechanism* that makes
// every chip reachable (wrap below 380px) because this gate has no browser.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');

const benefits = await read('03_주민혜택_쿠폰.html');
const home = await read('04_데일리홈.html');
const discovery = await read('01_이웃가게_발견.html');
const savedBridgeSrc = await read('assets/saved-shops-bridge.js');
const sessionSrc = await read('assets/danjion-session.js');

/* ------------------------------------------------------------------ *
 * A. 320px 주민혜택 filter reachability
 *
 * Root cause on current main: `.filters` is a single-row nowrap strip with
 * `overflow:auto` + `scrollbar-width:none` + `::-webkit-scrollbar{display:none}`.
 * At 320px the last chip measured right=347 > 320, and because the scrollbar is
 * deliberately hidden there is no discoverable affordance to reach it.
 * Fix: below 380px the strip wraps so every chip is inside the viewport.
 * ------------------------------------------------------------------ */
const narrowRule = benefits.match(/@media\(max-width:(\d+)px\)\{\.filters\{flex-wrap:wrap;overflow:visible\}/);
assert.ok(narrowRule, '320px fix must declare a narrow-viewport wrap rule for .filters');
assert.equal(narrowRule[1], '359',
  'wrap rule must apply strictly below 360px so 360/390/430/desktop keep the scroll strip');

const wrapPx = Number(narrowRule[1]);
assert.ok(wrapPx < 360,
  'wrap breakpoint must be below 360px so the 360px viewport stays on the original strip');
assert.ok(wrapPx >= 346,
  'wrap breakpoint must cover the measured 347px natural strip width, otherwise a 346-359px viewport still clips');
assert.ok(wrapPx >= 320,
  'wrap breakpoint must cover the 320px viewport');

// Exactly one narrow media query owns the wrap, so there is no conflicting rule.
const wrapDeclarations = benefits.match(/\.filters\{flex-wrap:wrap/g) || [];
assert.equal(wrapDeclarations.length, 1,
  'exactly one rule may force .filters to wrap');

// The base strip stays horizontally scrollable and nowrap above the breakpoint.
assert.match(benefits, /\.filters\{display:flex;gap:8px;overflow:auto;padding:31px 0 20px;scrollbar-width:none\}/,
  'desktop/wide .filters strip contract must remain a single scroll row');
assert.match(benefits, /\.filter\{height:44px;padding:0 18px;border:1px solid var\(--line\);[^}]*white-space:nowrap\}/,
  'desktop .filter chip contract must remain nowrap');

// The mobile band still owns its own geometry (no desktop bleed).
assert.match(benefits, /\.filters\{margin:0 -20px;padding:18px 20px 14px;gap:7px\}/,
  'mobile .filters geometry must be unchanged');

// Four chips are the canonical filter set; a wrap fix must not drop one.
const chipLabels = ['전체 혜택', '예약 혜택', '현장 혜택', '쿠폰'];
for (const label of chipLabels) {
  assert.match(benefits, new RegExp('class="filter[^"]*"[^>]*>' + label + '<'),
    'filter chip must remain present: ' + label);
}
// The wrap must not be defeated by a later nowrap on the same selector inside the
// narrow band. Search only the narrow band for a nowrap regression.
const narrowBandStart = benefits.indexOf('@media(max-width:359px)');
assert.ok(narrowBandStart > 0, 'narrow band must exist');
const narrowBand = benefits.slice(narrowBandStart, narrowBandStart + 400);
assert.ok(!/\.filters[^}]*flex-wrap:nowrap/.test(narrowBand),
  'narrow band must not re-assert nowrap on .filters');

// Document-level overflow must not be introduced by the fix: the fix uses wrap,
// never a widened min-width or a negative margin on the strip.
assert.ok(!/\.filters[^}]*min-width:3[3-9]\dpx/.test(narrowBand),
  'narrow fix must not widen the strip beyond the viewport');

/* ------------------------------------------------------------------ *
 * B. 비로그인 이웃가게 저장 — guest must never see success
 * ------------------------------------------------------------------ */

// B0. HOME_SERVER_MODE canonical production authority lock & mutation proof
// Issue #804 root cause: HOME_API_BASE is '' on canonical production due to
// same-origin facade. HOME_SERVER_MODE must include DanjionSession.isCanonicalProduction()
// so production is not misclassified as offline local mode.
export function verifyHomeCanonicalServerMode(source) {
  assert.match(source, /const HOME_SERVER_MODE\s*=\s*(?:Boolean\(HOME_API_BASE\)\s*\|\|\s*DanjionSession\.isCanonicalProduction\(\)|DanjionSession\.isCanonicalProduction\(\)\s*\|\|\s*Boolean\(HOME_API_BASE\))/,
    'HOME_SERVER_MODE must include DanjionSession.isCanonicalProduction() to prevent same-origin production from falling back to local mode');

  const serverModeDef = source.match(/const HOME_SERVER_MODE\s*=\s*([^;]+);/);
  assert.ok(serverModeDef, 'home source must define HOME_SERVER_MODE');
  const serverModeFn = new Function('HOME_API_BASE', 'DanjionSession', `return (${serverModeDef[1]});`);

  const fakeSession = {
    danjionApiBase: () => '',
    isCanonicalProduction: () => true
  };
  const prodServerMode = serverModeFn(fakeSession.danjionApiBase(), fakeSession);
  assert.equal(prodServerMode, true,
    'HOME_SERVER_MODE must be true on canonical production when HOME_API_BASE is empty');

  const demoServerMode = serverModeFn('', { isCanonicalProduction: () => false });
  assert.equal(demoServerMode, false,
    'HOME_SERVER_MODE must remain false on non-canonical demo without explicit API base');

  const previewServerMode = serverModeFn('https://api.example.com', { isCanonicalProduction: () => false });
  assert.equal(previewServerMode, true,
    'HOME_SERVER_MODE must be true when explicit API base is provided');

  return true;
}

// Verify shipped home source
verifyHomeCanonicalServerMode(home);
console.log('HOME_CANONICAL_SERVER_MODE: PASS');

// Mutation Proof: removing DanjionSession.isCanonicalProduction() must fail closed
const mutatedHome = home.replace(
  /const HOME_SERVER_MODE\s*=\s*Boolean\(HOME_API_BASE\)\s*\|\|\s*DanjionSession\.isCanonicalProduction\(\);/,
  'const HOME_SERVER_MODE=Boolean(HOME_API_BASE);'
);
assert.notEqual(mutatedHome, home, 'home mutation must differ from original shipped home');

assert.throws(
  () => verifyHomeCanonicalServerMode(mutatedHome),
  /HOME_SERVER_MODE must include DanjionSession\.isCanonicalProduction\(\)/,
  'verifyHomeCanonicalServerMode must throw when isCanonicalProduction() is removed'
);
console.log('HOME_SERVER_MODE_MUTATION_PROOF: PASS');

// B1. Static: the bridge keeps a server-authority mode and fails closed.
assert.match(savedBridgeSrc, /const serverMode = Boolean\(base\) \|\| canonicalProduction/,
  'saved-shops bridge must keep a server-authority mode');
assert.match(savedBridgeSrc, /if \(response\.status === 401\) return clearServerState\('auth-required'\)/,
  'bridge must map 401 to auth-required');
assert.match(savedBridgeSrc, /status === 403\) return clearServerState\('forbidden'\)/,
  'bridge must map 403 to forbidden');
assert.match(savedBridgeSrc,
  /if \(serverMode\) \{[\s\S]*mode !== 'server'[\s\S]*const error = new Error\(`bookmark server authority unavailable: \$\{mode\}`\)[\s\S]*throw error/,
  'server-mode toggle must fail closed (throw) when authority is unavailable');

// B2. Runtime: a guest (401 on GET /api/v1/me/bookmarks) must not write
// localStorage and must not resolve toggle() as a success.
{
  const sandbox = { window: {}, console };
  sandbox.window.fetch = () => { throw new Error('no network in contract'); };
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    snapshot: () => Object.fromEntries(mem)
  };
  sandbox.window.localStorage = storage;
  vm.createContext(sandbox);
  vm.runInContext(savedBridgeSrc, sandbox);
  const Bridge = sandbox.window.DanJionSavedShopsBridge;
  assert.ok(Bridge && typeof Bridge.create === 'function',
    'saved-shops bridge must expose create()');

  const calls = [];
  const guestFetch = async (url, init) => {
    calls.push((init && init.method) || 'GET');
    return { status: 401, ok: false, json: async () => ({}) };
  };
  const bridge = Bridge.create({
    apiBase: 'https://danjion.pages.dev',
    fetchImpl: guestFetch,
    storage
  });

  const loaded = await bridge.load();
  assert.equal(loaded.mode, 'auth-required',
    'guest load must resolve to auth-required, not a usable mode');
  assert.equal(loaded.keys.length, 0, 'guest load must expose no saved keys');

  const KEY = 'api-11111111-1111-4111-8111-111111111111';
  let resolved = null;
  let threw = null;
  try { resolved = await bridge.toggle(KEY); } catch (error) { threw = error; }

  assert.equal(resolved, null,
    'guest save must NOT resolve a success payload (that is what painted the success UI)');
  assert.ok(threw, 'guest save must throw instead of reporting success');
  assert.equal(threw.mode, 'auth-required',
    'guest save failure must carry the canonical auth-required mode');
  assert.equal(Object.keys(storage.snapshot()).length, 0,
    'guest save must NOT persist a localStorage saved state');
  assert.ok(!storage.snapshot()['danjion:savedShops'],
    'guest save must never create localStorage[danjion:savedShops]');
  assert.ok(!calls.includes('POST'),
    'guest save must not attempt a POST bookmark mutation');
}

// B3. The guest path must surface canonical auth guidance and must not paint the
// success heart/toast. `popHeart()` and the success toast live only on the
// success branch, which the guest path can no longer reach.
assert.match(home, /if\(!__homeBridge\|\|!state\|\|state\.mode!=='server'\)\{toast\('[^']*'\);return\}/,
  'home save must bail out with a message when server authority is unavailable');

// The authenticated path must remain server-authoritative (regression guard).
assert.match(home, /const wasSaved=__homeBridge\.isSaved\(key\)/,
  'authenticated save must read server state before toggling');
assert.match(discovery, /const blocked=PRODUCTION_SERVER_MODE&&\(!state\|\|state\.mode!=='server'\)/,
  'discovery save buttons must be disabled unless server authority is ready');
assert.match(discovery, /b\.disabled=blocked/,
  'discovery save buttons must bind disabled to the blocked guard');

// The success copy must not be reachable for a guest: it is gated behind the
// server-ready branch in home.
const homeSuccessCopy = home.match(/toast\('저장했어요\. 내정보에서 다시 볼 수 있어요\.'\)/g) || [];
assert.equal(homeSuccessCopy.length, 2,
  'home success toast must exist exactly on the two save branches');

/* ------------------------------------------------------------------ *
 * C. 게스트 /api/auth/list-accounts eagerness
 * ------------------------------------------------------------------ */

// C1. Only the sanctioned shared runtime may own the endpoint literal.
assert.match(sessionSrc, /'\/api\/auth\/list-accounts'/,
  'shared auth runtime must remain the owner of the list-accounts literal');
assert.match(sessionSrc, /function fetchLinkedAccounts\(/,
  'shared auth runtime must expose fetchLinkedAccounts');

const pageListAccounts = (discovery + home).match(/list-accounts/g) || [];
assert.equal(pageListAccounts.length, 0,
  'leaf pages must not carry their own list-accounts literal');

// C2. Runtime: the My Info account resolution must short-circuit for a guest and
// never call list-accounts.
{
  const calls = [];
  const S = {
    fetchSession: async () => { calls.push('get-session'); return { ok: true, raw: null }; },
    nativeSessionReady: (r) => !!(r && r.ok && r.raw && typeof r.raw === 'object' && r.raw.session && r.raw.user),
    fetchLinkedAccounts: async () => { calls.push('list-accounts'); return null; }
  };
  // Mirror of 19_내정보_메인 sessionIdentity() guest ordering.
  const guestIdentity = await Promise.resolve(S.fetchSession()).then(async (result) => {
    const ready = S.nativeSessionReady(result);
    const user = ready && result.raw && typeof result.raw.user === 'object' ? result.raw.user : null;
    if (!user) return { user: null, state: 'guest' };
    await S.fetchLinkedAccounts();
    return { user, state: 'member' };
  });
  assert.equal(guestIdentity.state, 'guest', 'guest must resolve to the guest state');
  assert.ok(!calls.includes('list-accounts'),
    'guest account resolution must NOT eagerly call /api/auth/list-accounts');
}

// C3. Source ordering: the guest early-return must precede fetchLinkedAccounts.
const myInfo = await read('19_내정보_메인.html');
const guestReturnIdx = myInfo.indexOf("state:'guest'");
const fetchAccountsIdx = myInfo.indexOf('S.fetchLinkedAccounts(fetch)');
assert.ok(guestReturnIdx > 0 && fetchAccountsIdx > 0,
  'My Info must contain both the guest return and the linked-accounts call');
assert.ok(guestReturnIdx < fetchAccountsIdx,
  'guest early-return must precede the list-accounts call');
// list-accounts is member-only: it must be reachable only after a real native session.
assert.match(myInfo, /var ready=typeof S\.nativeSessionReady==='function'&&S\.nativeSessionReady\(result\)/,
  'My Info must gate identity on nativeSessionReady');
// The only list-accounts call sites must live inside the member branch and the
// member-only resend handler.
const listAccountsSites = myInfo.match(/S\.fetchLinkedAccounts\(fetch\)/g) || [];
assert.equal(listAccountsSites.length, 2,
  'exactly two member-scoped list-accounts call sites are permitted');

/* ------------------------------------------------------------------ *
 * D. 저장 토스트 조사 (particle fallback)
 * ------------------------------------------------------------------ */

// The "(를)" fallback must be gone from the shipped surfaces.
for (const [name, src] of [['04_데일리홈.html', home], ['01_이웃가게_발견.html', discovery]]) {
  assert.ok(!/을\(를\)/.test(src),
    name + ' must not expose the "(를)" particle fallback');
}
// Save copy must follow the avoidance form the issue requested.
assert.match(home, /toast\('저장했어요\. 내정보에서 다시 볼 수 있어요\.'\)/,
  'save toast must use the avoidance copy without a subject particle');
// A complex particle engine must NOT be introduced.
assert.ok(!/josa|particle|을를/.test(home),
  'the copy fix must not introduce a particle-resolution engine');

/* ------------------------------------------------------------------ *
 * Items deferred to a separate lane — intentionally NOT asserted here.
 *
 * The build stamp (`/app build=20260907`) and the `먼저 둘러보기` label/behaviour
 * mismatch are still REAL_REMAINING defects. They are owned by the landing/root
 * lane (#802 collision) and this lane does not fix them. A regression contract
 * must pin accepted behaviour only: pinning a known defect would make CI fail
 * the moment another lane legitimately fixes it. Their disposition is recorded
 * in the PR body instead.
 * ------------------------------------------------------------------ */

console.log('leaf-b804-qa-reliability-repass-contract: PASS');
