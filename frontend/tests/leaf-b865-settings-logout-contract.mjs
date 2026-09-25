import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// #865 regression, updated by #1023: Settings must not own a weaker logout
// implementation. It must reuse the shared bounded + session-verified primitive.

const root = new URL('../', import.meta.url);
const [settings, session] = await Promise.all([
  readFile(new URL('24_설정.html', root), 'utf8'),
  readFile(new URL('assets/danjion-session.js', root), 'utf8')
]);

const handler = settings.match(
  /body\.querySelector\('#logoutConfirm'\)\?\.addEventListener\('click',([\s\S]*?)\}\);\n/
)?.[0] || '';
assert.ok(handler, 'settings logout handler must exist');

assert.match(
  handler,
  /DanjionSession\.verifiedSignOut\(fetch\)/,
  'Settings logout must reuse the canonical verified sign-out helper'
);
assert.match(
  handler,
  /if\(!outcome\.ok\)throw new Error\('SIGN_OUT_NOT_VERIFIED'\)/,
  'Settings must fail closed unless the shared helper verifies sign-out'
);
assert.doesNotMatch(
  handler,
  /\/api\/auth\/sign-out|sessionStorage\.clear\(|clearLocalAuthMarkers\(/,
  'Settings must not duplicate the sign-out transport or marker cleanup'
);
assert.match(
  handler,
  /catch\(_\)\{button\.disabled=false;button\.textContent='로그아웃'/,
  'Settings failure must restore the logout button'
);
assert.match(
  handler,
  /notify\('로그아웃하지 못했습니다\. 잠시 후 다시 시도해 주세요\.'\)/,
  'Settings failure must remain honest'
);
assert.match(
  handler,
  /location\.href='index\.html\?intro=1'/,
  'Settings verified success must return to Intro'
);
assert.equal(
  handler.match(/location\.href=/g)?.length,
  1,
  'Settings navigation must exist only on the verified success path'
);

const helper = session.match(
  /async function verifiedSignOut\(fetchImpl, options = \{\}\) \{([\s\S]*?)\n  \}\n/
)?.[0] || '';
assert.ok(helper, 'shared verifiedSignOut helper must exist');
assert.match(helper, /new AbortController\(\)/, 'shared sign-out must be abortable');
assert.match(helper, /: 10000;/, 'shared sign-out must default to a 10s bound');
assert.match(helper, /signal: controller\.signal/, 'sign-out request must use the abort signal');
assert.match(
  helper,
  /fetchSession\(impl, loc, \{ signal: controller\.signal \}\)/,
  'session readback must share the same bounded abort signal'
);
assert.match(
  helper,
  /if \(!after \|\| !after\.ok\) return \{ ok: false, stage: 'session-readback'/,
  'failed session readback must fail closed'
);
assert.match(
  helper,
  /if \(nativeSessionReady\(after\)\) return \{ ok: false, stage: 'session-still-active'/,
  'surviving session must fail closed'
);
const readbackIndex = helper.indexOf('fetchSession(impl');
const readyIndex = helper.indexOf('nativeSessionReady(after)');
const cleanupIndex = helper.indexOf('clearLocalAuthMarkers()');
assert.ok(readbackIndex >= 0 && readyIndex > readbackIndex && cleanupIndex > readyIndex,
  'marker cleanup must happen only after successful absent-session readback');
assert.match(helper, /finally \{[\s\S]*clearTimeout\(timer\)/,
  'shared timeout must always be cleared');

const exported = session.match(/global\.DanjionSession\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\s*\}\);/)?.[1] || '';
assert.match(exported, /(^|\s)verifiedSignOut,/m,
  'verifiedSignOut must be exported for Settings and account-menu consumers');

console.log('PASS leaf-b865 settings logout parity via shared verified sign-out');
console.log('SETTINGS_LOGOUT_REQUEST=BOUNDED_SHARED');
console.log('SUCCESS_PATH_SESSION_AFTER=NONE');
console.log('FAILURE_OR_TIMEOUT_BUTTON_RECOVERS=YES');
console.log('INDEFINITE_LOADING=NO');
console.log('INTRO_AFTER_SUCCESS=PUBLIC');
