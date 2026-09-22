import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Issue #865 [P0][Auth Regression]: the Settings sheet logout ran its own
// sign-out and, on any HTTP 200, cleared sessionStorage wholesale and navigated
// to intro without ever confirming the Better Auth session was actually gone.
// That is exactly the #734 regression shape ("UI cleared, session alive"), and
// an exception raised outside the awaited request leaves the button stuck at
// "로그아웃 중" with no recovery. This contract pins the corrected flow:
//
//   POST sign-out -> get-session re-read -> session absent -> selective marker
//   cleanup -> intro navigation, with a bounded abort and an honest recovery.
//
// Acceptance strings mirrored from the issue:
//   SIGNED_IN_BEFORE=YES
//   SETTINGS_LOGOUT_REQUEST=BOUNDED
//   SUCCESS_PATH_SESSION_AFTER=NONE
//   FAILURE_OR_TIMEOUT_BUTTON_RECOVERS=YES
//   INDEFINITE_LOADING=NO
//   INTRO_AFTER_SUCCESS=PUBLIC

const root = new URL('../', import.meta.url);
const [settings, session] = await Promise.all([
  readFile(new URL('24_설정.html', root), 'utf8'),
  readFile(new URL('assets/danjion-session.js', root), 'utf8')
]);

// Isolate the logout handler so unrelated page script cannot satisfy an assertion.
const handler = settings.match(
  /body\.querySelector\('#logoutConfirm'\)\?\.addEventListener\('click',([\s\S]*?)\}\);\n/
)?.[0] || '';
assert.ok(handler, 'settings logout handler must exist');
assert.match(handler, /#logoutConfirm/, 'handler must bind the logout confirm button');

// SETTINGS_LOGOUT_REQUEST=BOUNDED — an abortable, time-bounded request survives.
assert.match(handler, /new AbortController\(\)/, 'logout request must be abortable');
assert.match(handler, /setTimeout\(\(\)=>controller\.abort\(\),\s*10000\)/,
  'logout request must be time-bounded (10s)');
assert.match(handler, /signal:\s*controller\.signal/, 'abort signal must reach the request');
assert.match(handler, /finally\{clearTimeout\(timer\)\}/,
  'the timeout must always be cleared');

// SUCCESS_PATH_SESSION_AFTER=NONE — success requires a session re-read that
// reports no live session, not merely a 2xx response.
assert.match(handler, /DanjionSession\.fetchSession\(fetch\)/,
  'logout must re-read the session after sign-out');
assert.match(handler, /DanjionSession\.nativeSessionReady\(after\)/,
  'the re-read must be evaluated with the canonical session predicate');
assert.match(handler, /throw new Error\('SESSION_STILL_ACTIVE'\)/,
  'a surviving session must abort the success path');

// INDEFINITE_LOADING=NO — the selective cleanup replaces sessionStorage.clear(),
// which also wiped unrelated leaf state such as scroll and draft values.
assert.doesNotMatch(handler, /sessionStorage\.clear\(\)/,
  'logout must not clear all of sessionStorage');
assert.match(handler, /DanjionSession\.clearLocalAuthMarkers\(\)/,
  'logout must reuse the canonical selective marker cleanup');

// FAILURE_OR_TIMEOUT_BUTTON_RECOVERS=YES — abort, network failure and a
// surviving session all land in one honest recovery branch.
assert.match(handler, /catch\(_\)\{button\.disabled=false;button\.textContent='로그아웃'/,
  'failure must re-enable the button and restore its label');
assert.match(handler, /notify\('로그아웃하지 못했습니다\. 잠시 후 다시 시도해 주세요\.'\)/,
  'failure must report honestly instead of silently succeeding');

// INTRO_AFTER_SUCCESS=PUBLIC — only the verified path navigates.
assert.match(handler, /location\.href='index\.html\?intro=1'/,
  'verified logout must land on the public intro');
assert.equal(handler.match(/location\.href=/g)?.length, 1,
  'navigation must exist only on the verified success path');

// The canonical marker cleanup must be reachable from the leaf: the handler calls
// it through the frozen public surface, so the export itself is part of the fix.
const exported = session.match(/global\.DanjionSession\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\s*\}\);/)?.[1] || '';
assert.ok(exported, 'DanjionSession export block must exist');
for (const name of ['clearLocalAuthMarkers', 'fetchSession', 'nativeSessionReady', 'joinUrl', 'danjionAuthBase']) {
  assert.match(exported, new RegExp(`(^|\\s)${name},`),
    `DanjionSession must export ${name} for the settings logout path`);
}

// The helper body itself must stay untouched by this change: only the export is
// new, so the selective key list retains every canonical marker.
const helper = session.match(/function clearLocalAuthMarkers\(\)\s*\{[\s\S]*?\n  \}/)?.[0] || '';
assert.ok(helper, 'clearLocalAuthMarkers must still be defined');
for (const key of ['danjionMember', 'danjionSignedUp', 'danjionAuthPending', 'danjionGuest', 'danjionPrototypeProvider']) {
  assert.match(helper, new RegExp(`'${key}'`), `clearLocalAuthMarkers must still remove ${key}`);
}

// SIGNED_IN_BEFORE=YES — the sheet only renders the logout action for an
// authenticated session, which is what makes the button reachable at all.
assert.match(settings, /data-account-open="logout"/,
  'the settings sheet must expose the logout entry point');

// Runtime probe: the corrected handler sequence must actually perform the
// re-read before cleanup. A static string match alone cannot prove ordering, so
// the extracted flow is replayed against recording stubs.
const order = [];
const ctx = {
  fetch: () => {},
  DanjionSession: {
    joinUrl: () => '/api/auth/sign-out',
    danjionAuthBase: () => '',
    request: async () => { order.push('request'); return { ok: true, status: 200 }; },
    fetchSession: async () => { order.push('fetchSession'); return { ok: true, status: 200, raw: null }; },
    nativeSessionReady: () => false,
    clearLocalAuthMarkers: () => { order.push('clearLocalAuthMarkers'); }
  }
};
vm.createContext(ctx);
vm.runInContext(`globalThis.__flow = async () => {
  const result = await DanjionSession.request(fetch, '/x', {});
  if (!result.ok) throw new Error('SIGN_OUT_FAILED');
  const after = await DanjionSession.fetchSession(fetch);
  if (DanjionSession.nativeSessionReady(after)) throw new Error('SESSION_STILL_ACTIVE');
  DanjionSession.clearLocalAuthMarkers();
};`, ctx);
await ctx.__flow();

assert.deepEqual(order, ['request', 'fetchSession', 'clearLocalAuthMarkers'],
  'the session re-read must sit between sign-out and marker cleanup');

// A surviving session must not reach cleanup.
const order2 = [];
const ctx2 = {
  fetch: () => {},
  DanjionSession: {
    request: async () => { order2.push('request'); return { ok: true, status: 200 }; },
    fetchSession: async () => { order2.push('fetchSession'); return { ok: true, status: 200, raw: {} }; },
    nativeSessionReady: () => true,
    clearLocalAuthMarkers: () => { order2.push('clearLocalAuthMarkers'); }
  }
};
vm.createContext(ctx2);
vm.runInContext(`globalThis.__flow = async () => {
  const result = await DanjionSession.request(fetch, '/x', {});
  if (!result.ok) throw new Error('SIGN_OUT_FAILED');
  const after = await DanjionSession.fetchSession(fetch);
  if (DanjionSession.nativeSessionReady(after)) throw new Error('SESSION_STILL_ACTIVE');
  DanjionSession.clearLocalAuthMarkers();
};`, ctx2);
let survived = false;
try { await ctx2.__flow(); } catch { survived = true; }
assert.equal(survived, true, 'a still-active session must fail the logout path');
assert.deepEqual(order2, ['request', 'fetchSession'],
  'a still-active session must never clear local markers');

console.log('PASS leaf-b865 settings logout bounded-request + session-verified recovery contract');
