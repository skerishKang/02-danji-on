// Issue #804 R-3 — guest account-strip auth fan-out.
//
// initAccountStrip() must resolve the native session FIRST and return the
// guest UI immediately. /api/auth/list-accounts and /api/v1/admin/authority
// are member-only and must never fire for a guest (previously all three
// fired via one Promise.all before the guest check, producing guest 401s).
//
// Zero network, zero production mutation: the real shared runtime executes in
// a vm sandbox against injected fetch/DOM fakes and real fetch-call URL
// counts are asserted, not substrings alone.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sessionSrc = await readFile(new URL('../assets/danjion-session.js', import.meta.url), 'utf8');

/* ------------------------------------------------------------------ *
 * S1. Source ordering: single get-session read, guest early-return, and
 * only then the member-only linked-accounts + authority fan-out.
 * ------------------------------------------------------------------ */
const stripBlock = sessionSrc.match(/async function initAccountStrip\(options = \{\}\) \{([\s\S]*?)\n  function loadServiceFooterRuntime/);
assert.ok(stripBlock, 'initAccountStrip block must remain detectable');
const strip = stripBlock[1];
assert.doesNotMatch(strip, /const \[session, accounts, authority\] = await Promise\.all/,
  'guest-era triple fan-out (session+accounts+authority in one Promise.all) must be gone');
const iSession = strip.indexOf("'/api/auth/get-session'");
const iGuestCheck = strip.indexOf('if (!nativeSessionReady(session))');
const iGuestState = strip.indexOf("state: 'guest'");
const iAccounts = strip.indexOf('fetchLinkedAccounts(fetch, loc)');
const iAuthority = strip.indexOf('fetchAccountAuthority(fetch, loc)');
assert.ok(iSession > 0 && iGuestCheck > 0 && iGuestState > 0 && iAccounts > 0 && iAuthority > 0,
  'strip must contain the session read, the guest gate, and the member-only calls');
assert.ok(iSession < iGuestCheck, 'get-session must precede the guest gate');
assert.ok(iGuestCheck < iGuestState, 'guest gate must precede the guest return');
assert.ok(iGuestState < iAccounts && iGuestState < iAuthority,
  'member-only list-accounts/authority calls must come after the guest early-return');

/* ------------------------------------------------------------------ *
 * Runtime harness: real initAccountStrip against fetch/DOM fakes.
 * ------------------------------------------------------------------ */
function makeElement(tag) {
  const el = {
    tagName: String(tag || '').toUpperCase(),
    children: [],
    attributes: {},
    classList: {
      _set: new Set(),
      add(...c) { c.forEach((x) => this._set.add(x)); },
      remove(...c) { c.forEach((x) => this._set.delete(x)); },
      contains(c) { return this._set.has(c); }
    },
    className: '',
    textContent: '',
    href: '',
    title: '',
    hidden: false,
    type: '',
    disabled: false,
    setAttribute(k, v) { el.attributes[k] = String(v); },
    getAttribute(k) { return Object.hasOwn(el.attributes, k) ? el.attributes[k] : null; },
    append(...kids) { el.children.push(...kids); return el; },
    appendChild(kid) { el.children.push(kid); return kid; },
    addEventListener() {},
    contains(target) { return el.children.includes(target); }
  };
  return el;
}

function makeDocument(host) {
  return {
    readyState: 'complete',
    head: { children: [], appendChild(kid) { this.children.push(kid); return kid; } },
    body: { children: [], append(kid) { this.children.push(kid); return kid; } },
    querySelector(sel) {
      if (sel === '.danjion-account-menu') return null;
      if (sel === '.identity' || sel === '[data-account-host]') return host;
      return null;
    },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    createElement(tag) { return makeElement(tag); },
    addEventListener() {}
  };
}

function makeFetch(calls, routes) {
  return async (url) => {
    const href = String(url || '');
    calls.push(href);
    for (const [needle, reply] of routes) {
      if (href.includes(needle)) {
        return {
          ok: reply.status >= 200 && reply.status < 300,
          status: reply.status,
          headers: { get: () => null },
          json: async () => reply.payload
        };
      }
    }
    throw new Error('unexpected fetch: ' + href);
  };
}

// Sterile globals at module load so the auto-boot path is a no-op
// (fetch undefined -> init returns null before any traffic).
const ctx = {
  location: { hostname: 'danjion.pages.dev', pathname: '/04_데일리홈.html', search: '', origin: 'https://danjion.pages.dev' },
  URL,
  URLSearchParams,
  console,
  document: {
    readyState: 'complete',
    querySelector: () => null,
    addEventListener: () => {},
    getElementById: () => null,
    head: { appendChild: () => {} },
    createElement: (tag) => makeElement(tag)
  },
  fetch: undefined
};
vm.createContext(ctx);
vm.runInContext(sessionSrc, ctx);
const S = ctx.DanjionSession;
assert.ok(S && typeof S.initAccountStrip === 'function',
  'DanjionSession must export initAccountStrip');

const serviceLoc = () => ({ hostname: 'danjion.pages.dev', pathname: '/04_데일리홈.html', search: '', origin: 'https://danjion.pages.dev' });
const count = (calls, needle) => calls.filter((u) => u.includes(needle)).length;

/* ------------------------------------------------------------------ *
 * CASE 1. Guest signed-out: exactly one get-session, zero member-only
 * traffic, existing guest entry UI unchanged.
 * ------------------------------------------------------------------ */
{
  const calls = [];
  ctx.fetch = makeFetch(calls, [
    ['/api/auth/get-session', { status: 200, payload: { session: null, user: null } }]
  ]);
  const host = makeElement('div');
  ctx.document = makeDocument(host);
  const result = await S.initAccountStrip({ location: serviceLoc() });
  assert.equal(result && result.state, 'guest', 'signed-out strip must resolve guest state');
  assert.equal(count(calls, '/api/auth/get-session'), 1,
    'guest must still confirm via exactly one get-session');
  assert.equal(count(calls, '/api/auth/list-accounts'), 0,
    'guest must NOT call /api/auth/list-accounts');
  assert.equal(count(calls, '/api/v1/admin/authority'), 0,
    'guest must NOT call /api/v1/admin/authority');
  assert.ok(host.classList.contains('danjion-guest-auth-host'),
    'guest must reuse the header slot as the guest auth host');
  const entry = host.children.find((k) => k && k.className === 'danjion-guest-auth-entry');
  assert.ok(entry, 'guest must render the login/signup entry');
  assert.equal(entry.href, 'index.html?auth=login',
    'guest entry must keep the canonical landing auth intent');
  assert.equal(entry.textContent, '로그인 · 가입',
    'guest entry copy must be unchanged');
  assert.ok(!host.children.some((k) => k && (k.className === 'danjion-account-trigger' || k.className === 'danjion-account-menu')),
    'guest must not render member account UI');
}

/* ------------------------------------------------------------------ *
 * CASE 2. Member: session + linked-accounts + authority all resolve and
 * the account trigger/menu render (no member UI regression).
 * ------------------------------------------------------------------ */
{
  const calls = [];
  ctx.fetch = makeFetch(calls, [
    ['/api/auth/get-session', { status: 200, payload: { session: { id: 's1' }, user: { email: 'member@example.com', name: '홍길동', emailVerified: true } } }],
    ['/api/auth/list-accounts', { status: 200, payload: [{ providerId: 'credential' }] }],
    ['/api/v1/admin/authority', { status: 403, payload: { error: 'forbidden' } }]
  ]);
  const host = makeElement('div');
  ctx.document = makeDocument(host);
  const result = await S.initAccountStrip({ location: serviceLoc() });
  assert.equal(count(calls, '/api/auth/get-session'), 1,
    'member must resolve exactly one get-session');
  assert.equal(count(calls, '/api/auth/list-accounts'), 1,
    'member must still resolve linked accounts');
  assert.equal(count(calls, '/api/v1/admin/authority'), 1,
    'member must still resolve authority');
  assert.equal(result && result.email, 'member@example.com',
    'member must resolve the identity email');
  assert.ok(host.classList.contains('danjion-account-host'),
    'member must render the account host');
  assert.ok(host.children.some((k) => k && k.className === 'danjion-account-trigger'),
    'member account trigger must render (no UI regression)');
  assert.ok(host.children.some((k) => k && k.className === 'danjion-account-menu'),
    'member account menu must render (no UI regression)');
  assert.ok(!host.children.some((k) => k && k.className === 'danjion-guest-auth-entry'),
    'member must not render the guest entry');
}

/* ------------------------------------------------------------------ *
 * CASE 3. Ineligible surfaces (landing / app / admin) stay untouched:
 * zero auth traffic.
 * ------------------------------------------------------------------ */
for (const pathname of ['/index.html', '/app.html', '/admin/index.html']) {
  const calls = [];
  ctx.fetch = makeFetch(calls, []);
  ctx.document = makeDocument(makeElement('div'));
  const result = await S.initAccountStrip({
    location: { hostname: 'danjion.pages.dev', pathname, search: '', origin: 'https://danjion.pages.dev' }
  });
  assert.equal(result, null, 'ineligible ' + pathname + ' must stay untouched');
  assert.equal(calls.length, 0, 'ineligible ' + pathname + ' must emit zero auth traffic');
}

console.log('leaf-b804-guest-account-strip-fanout-contract: PASS');
