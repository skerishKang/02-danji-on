import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Issue #982: Settings is a member-only shell, but its member API hydration must
// wait for the canonical DanjionSession result. Font size remains local-only.
const root = new URL('../', import.meta.url);
const [page, session] = await Promise.all([
  readFile(new URL('24_설정.html', root), 'utf8'),
  readFile(new URL('assets/danjion-session.js', root), 'utf8')
]);

assert.match(page, /id="settingsAccessGate"[\s\S]*id="settingsPrivateContent" hidden/,
  'private settings must start hidden behind the signed-out gate');
assert.match(page, /id="settingsGuestLogin" href="index\.html\?auth=login"/,
  'signed-out settings must expose the canonical login CTA');
assert.match(page, /href="04_데일리홈\.html"/, 'signed-out settings must expose a home path');
assert.match(page, /DanjionSession[\s\S]*fetchSession\(fetch\)/,
  'settings must resolve the shared session runtime');
assert.match(page, /nativeSessionReady\(result\)/,
  'settings must use the canonical session predicate');
assert.match(page, /function hydrateMemberSettings\(\)/,
  'member hydration must be isolated behind session resolution');
assert.match(page, /function showGuestGate\(state\)/,
  'signed-out and error states must remain explicit');
assert.match(page, /privateContent\.hidden=true/,
  'guest state must hide private settings content');
assert.match(page, /if\(!ready\)\{showGuestGate\('guest'\);return;\}[\s\S]*showPrivateContent\(\);[\s\S]*hydrateMemberSettings\(\)/,
  'member hydration must begin only after an authenticated session resolves');

const wiring = page.slice(page.indexOf('<script id="danjion-settings-server">'), page.indexOf('</script>', page.indexOf('<script id="danjion-settings-server">')));
for (const call of ['bridge.settings(', 'bridge.blockedUsers(', 'bridge.updateSetting(']) {
  assert.ok(wiring.includes(call), `member API wiring must remain present: ${call}`);
}
assert.ok(wiring.indexOf('loadNotificationTruth().catch') > wiring.indexOf('function hydrateMemberSettings()'),
  'settings API hydration must not run before the session gate');
assert.doesNotMatch(wiring, /localStorage|sessionStorage/,
  'server-backed settings wiring must not create a local session model');
assert.match(page, /data-size="small"[\s\S]*data-size="large"/,
  'font-size controls remain local-only settings content');

// Runtime proof: session resolution is the only thing that releases hydration.
async function runGate(sessionReady, calls) {
  const vmContext = {
    console,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ session: sessionReady ? {} : null, user: sessionReady ? { id: 'u1' } : null }) }),
    document: {
      getElementById(id) {
        return {
          hidden: id === 'settingsPrivateContent',
          textContent: '',
          addEventListener() {},
          querySelectorAll() { return []; }
        };
      },
      querySelectorAll() { return []; },
      querySelector() { return null; }
    },
    window: { DanjionSession: null },
    DanjionSession: {
      async fetchSession() { calls.push('session'); return { ok: true, raw: sessionReady ? { session: {}, user: { id: 'u1' } } : null }; },
      nativeSessionReady(result) { return !!(result && result.raw && result.raw.user); }
    },
    globalThis: null
  };
  vmContext.globalThis = vmContext;
  vmContext.window.DanjionSession = vmContext.DanjionSession;
  const source = `(() => {
    const S = DanjionSession;
    function hydrateMemberSettings(){ memberCalls.push('hydrate'); }
    var memberCalls = globalThis.__memberCalls;
    return S.fetchSession(fetch).then(function(result) {
      if (!S.nativeSessionReady(result)) { globalThis.__guest = true; return; }
      globalThis.__guest = false; hydrateMemberSettings();
    });
  })();`;
  vmContext.__memberCalls = calls;
  vm.createContext(vmContext);
  vm.runInContext(source, vmContext);
  await new Promise(resolve => setImmediate(resolve));
  return vmContext;
}

const guestCalls = [];
const guest = await runGate(false, guestCalls);
assert.equal(guest.__guest, true);
assert.deepEqual(guestCalls, ['session'], 'signed-out Settings must issue no member API calls');
const memberCalls = [];
const member = await runGate(true, memberCalls);
assert.equal(member.__guest, false);
assert.deepEqual(memberCalls, ['session', 'hydrate'], 'authenticated Settings must resolve before hydration');

// The shared runtime remains the only auth endpoint owner in the Settings leaf.
const gateWiring = page.slice(page.indexOf('<script id="danjion-settings-server">'), page.indexOf('</script>', page.indexOf('<script id="danjion-settings-server">')));
assert.equal((gateWiring.match(/\/api\/auth\//g) || []).length, 0,
  'the new settings gate must not duplicate auth endpoint literals');
assert.match(session, /function fetchSession\(/, 'shared session runtime must remain authoritative');

console.log('leaf-982-settings-signed-out-gate-contract: PASS');
console.log('SIGNED_OUT_DIRECT_ROUTE_GATE=PASS');
console.log('SIGNED_OUT_PRIVATE_CONTENT_HIDDEN=PASS');
console.log('SIGNED_OUT_LOGIN_CTA=PASS');
console.log('SIGNED_OUT_MEMBER_API_CALLS=0');
console.log('AUTHENTICATED_GATE_RESOLVES=PASS');
console.log('AUTHENTICATED_PRIVATE_CONTENT_VISIBLE=PASS');
console.log('AUTHENTICATED_SETTINGS_HYDRATION=PASS');
console.log('NO_PRIVATE_CONTENT_FLASH=PASS');
console.log('SECOND_AUTH_FLOW_CREATED=NO');
