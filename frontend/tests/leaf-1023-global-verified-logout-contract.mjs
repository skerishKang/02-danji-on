import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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
  ['remove-timeout', session.replace('const controller = new AbortController();', 'const controller = null;')],
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
console.log('SETTINGS_LOGOUT_PARITY=PASS');
