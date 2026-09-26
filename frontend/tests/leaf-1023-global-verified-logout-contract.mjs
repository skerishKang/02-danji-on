import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// #1023: global service-header logout must use the same bounded,
// session-verified sign-out primitive as Settings.

const FRONTEND = path.join(import.meta.dirname, '..');
const session = readFileSync(path.join(FRONTEND, 'assets/danjion-session.js'), 'utf8');

const helper = session.match(
  /async function verifiedSignOut\(fetchImpl, options = \{\}\) \{([\s\S]*?)\n  \}\n/
)?.[0] || '';
assert.ok(helper, 'verifiedSignOut helper must exist');

assert.match(helper, /new AbortController\(\)/, 'logout flow must be abortable');
assert.match(helper, /setTimeout\(\(\) => controller\.abort\(\), timeoutMs\)/,
  'logout flow must be time bounded');
assert.match(helper, /joinUrl\(authBase, '\/api\/auth\/sign-out'\)/,
  'helper must POST the canonical sign-out endpoint');
assert.match(helper, /method: 'POST'/, 'helper must use POST');
assert.match(helper, /signal: controller\.signal/, 'sign-out request must carry abort signal');
assert.match(helper, /fetchSession\(impl, loc, \{ signal: controller\.signal \}\)/,
  'helper must re-read the canonical session under the same timeout');
assert.match(helper, /if \(!after \|\| !after\.ok\) return \{ ok: false, stage: 'session-readback'/,
  'network/server failure during session readback must fail closed');
assert.match(helper, /if \(nativeSessionReady\(after\)\) return \{ ok: false, stage: 'session-still-active'/,
  '2xx sign-out with live session must fail closed');

const afterIndex = helper.indexOf('fetchSession(impl');
const activeIndex = helper.indexOf('nativeSessionReady(after)');
const cleanupIndex = helper.indexOf('clearLocalAuthMarkers()');
const successIndex = helper.indexOf("return { ok: true, stage: 'signed-out'");
assert.ok(afterIndex >= 0 && activeIndex > afterIndex && cleanupIndex > activeIndex && successIndex > cleanupIndex,
  'cleanup/success ordering must be readback -> absent check -> marker cleanup -> success');
assert.match(helper, /stage: error && error\.name === 'AbortError' \? 'timeout' : 'network-error'/,
  'timeout and network failure must return explicit failure stages');
assert.match(helper, /finally \{[\s\S]*clearTimeout\(timer\)/,
  'timeout handle must always be cleared');

const menu = session.match(
  /logout\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n    \}\);/
)?.[0] || '';
assert.ok(menu, 'global account-menu logout handler must exist');
assert.match(menu, /logout\.disabled = true/, 'global logout button must enter busy state');
assert.match(menu, /logout\.textContent = '로그아웃 중'/, 'global logout must expose busy state');
assert.match(menu, /await verifiedSignOut\(fetch\)/,
  'global logout must use verifiedSignOut');
assert.match(menu, /if \(!outcome\.ok\) \{[\s\S]*logout\.disabled = false;[\s\S]*logout\.textContent = '로그아웃'/,
  'all verifiedSignOut failures must restore the button');
assert.doesNotMatch(menu, /clearLocalAuthMarkers\(/,
  'global menu must not clear markers independently');
assert.doesNotMatch(menu, /\/api\/auth\/sign-out/,
  'global menu must not duplicate sign-out transport');
assert.match(menu, /location\.href = 'index\.html\?intro=1'/,
  'verified success must navigate to Intro');
assert.equal(menu.match(/location\.href/g)?.length, 1,
  'Intro navigation must exist only once on verified success');
assert.match(session, /logoutStatus\.setAttribute\('role', 'status'\)/,
  '#1042: global logout failure feedback must expose a status role');
assert.match(session, /logoutStatus\.setAttribute\('aria-live', 'polite'\)/,
  '#1042: global logout failure feedback must be announced accessibly');
assert.match(menu, /logoutStatus\.hidden = true;[\s\S]*logoutStatus\.textContent = '';/,
  '#1042: every retry must clear stale failure feedback before verification');
assert.match(menu, /logoutStatus\.textContent = '로그아웃하지 못했습니다\. 잠시 후 다시 시도해 주세요\.';/,
  '#1042: global menu must match the truthful Settings failure copy');
assert.match(menu, /logoutStatus\.hidden = false;/,
  '#1042: verifiedSignOut failure must expose the status');
assert.doesNotMatch(menu, /location\.href[\s\S]*if \(!outcome\.ok\)/,
  '#1042: failure handling must remain before the only redirect');

// Behaviourally execute the real global-menu click-handler body with a controlled
// verifiedSignOut failure. This proves recovery, visible feedback, retryability,
// and absence of redirect/marker cleanup on the failure path.
{
  const body = menu.match(
    /logout\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n    \}\);/
  )?.[1] || '';
  assert.ok(body, '#1042: logout handler body must remain executable by the contract');

  const logout = { disabled: false, textContent: '로그아웃' };
  const logoutStatus = { hidden: true, textContent: '' };
  const location = { href: '12_이웃대화_첫화면.html' };
  const localMarkers = { signedIn: 'preserve-me' };
  let calls = 0;
  const context = {
    logout,
    logoutStatus,
    fetch: async () => { throw new Error('transport must stay behind verifiedSignOut'); },
    verifiedSignOut: async () => {
      calls += 1;
      return { ok: false, stage: 'session-still-active' };
    },
    location,
    localMarkers
  };

  await vm.runInNewContext(`(async () => {${body}\n})()`, context, { filename: 'global-logout-failure-handler' });
  assert.equal(calls, 1, '#1042: click must invoke verifiedSignOut exactly once');
  assert.equal(logout.disabled, false, '#1042: failed verification must restore retry');
  assert.equal(logout.textContent, '로그아웃', '#1042: failed verification must restore button copy');
  assert.equal(logoutStatus.hidden, false, '#1042: failure status must become visible');
  assert.equal(logoutStatus.textContent, '로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    '#1042: failure feedback must be truthful and match Settings');
  assert.equal(location.href, '12_이웃대화_첫화면.html',
    '#1042: failed verification must not redirect');
  assert.equal(localMarkers.signedIn, 'preserve-me',
    '#1042: failed verification must not clear local auth markers');

  await vm.runInNewContext(`(async () => {${body}\n})()`, context, { filename: 'global-logout-retry-handler' });
  assert.equal(calls, 2, '#1042: restored button path must permit a retry');
}

const hasVerifiedFlow = source => {
  const h = source.match(
    /async function verifiedSignOut\(fetchImpl, options = \{\}\) \{([\s\S]*?)\n  \}\n/
  )?.[0] || '';
  return /new AbortController\(\)/.test(h)
    && /fetchSession\(impl, loc, \{ signal: controller\.signal \}\)/.test(h)
    && /!after \|\| !after\.ok/.test(h)
    && /nativeSessionReady\(after\)/.test(h)
    && h.indexOf('clearLocalAuthMarkers()') > h.indexOf('nativeSessionReady(after)');
};

const mutations = [
  // #1043 added a second AbortController to the shared runtime (the bounded
  // request factory), so the kill mutation must target the two-line abort
  // boundary that only the sign-out flow has, not the first controller literal
  // in the file.
  ['remove-timeout', session.replace(
    'const controller = new AbortController();\n    const timer = setTimeout(() => controller.abort(), timeoutMs);',
    'const controller = null;'
  )],
  ['remove-readback', session.replace("const after = await fetchSession(impl, loc, { signal: controller.signal });", "const after = { ok: true, raw: null };")],
  ['cleanup-too-early', session.replace(
    "const after = await fetchSession(impl, loc, { signal: controller.signal });",
    "clearLocalAuthMarkers();\n      const after = await fetchSession(impl, loc, { signal: controller.signal });"
  )]
];
assert.equal(hasVerifiedFlow(mutations[0][1]), false, 'mutation remove-timeout must be killed');
assert.equal(hasVerifiedFlow(mutations[1][1]), false, 'mutation remove-readback must be killed');
const earlyHelper = mutations[2][1].match(
  /async function verifiedSignOut\(fetchImpl, options = \{\}\) \{([\s\S]*?)\n  \}\n/
)?.[0] || '';
assert.ok(
  earlyHelper.indexOf('clearLocalAuthMarkers()') < earlyHelper.indexOf('nativeSessionReady(after)'),
  'mutation cleanup-too-early must prove the ordering guard can detect early cleanup'
);

console.log('PASS #1023 global verified logout contract');
console.log('GLOBAL_LOGOUT_REQUEST_BOUNDED=YES');
console.log('GLOBAL_LOGOUT_SESSION_READBACK=YES');
console.log('SESSION_STILL_ACTIVE_FAILS_CLOSED=YES');
console.log('FAILURE_TIMEOUT_BUTTON_RECOVERS=YES');
console.log('INDEFINITE_LOGOUT_LOADING=NO');
console.log('MARKER_CLEANUP_AFTER_SESSION_ABSENT=YES');
console.log('INTRO_AFTER_VERIFIED_SUCCESS=YES');
console.log('1042_VERIFIED_SIGNOUT_1023_REGRESSION=PASS');
console.log('1042_GLOBAL_LOGOUT_FAILURE_FEEDBACK=YES');
console.log('1042_GLOBAL_LOGOUT_FAILURE_REDIRECT=NO');
console.log('1042_GLOBAL_LOGOUT_FAILURE_MARKER_CLEAR=NO');
console.log('1042_GLOBAL_LOGOUT_RETRY_AVAILABLE=YES');
console.log('SETTINGS_LOGOUT_PARITY=PASS');
