import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Issue #809 (sibling-user UX, restored from the 2026-11-03 COM1 cleanup patch):
// a signed-out visitor who starts the 25A 신청제보 form and hits an auth-required
// response used to lose the form and stay on the landing page after login. The
// leaf now records the intended return path before opening the login modal and
// the landing page consumes it once a real server session exists.
//
// Safety boundary: the stored return target is same-origin only. It must start
// with a single '/' and must never be protocol-relative ('//host'), so a tampered
// sessionStorage value cannot turn the login flow into an open redirect.

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(path.join(here, '..', name), 'utf8');

const index = read('index.html');
const application = read('25A_신청제보.html');
const household = read('26_우리집연결.html');

// 1) landing page: helper exists, is one-shot, and blocks open redirects.
assert.match(index, /function consumePostAuthReturn\(\)\{/, 'landing must define the post-auth return helper');
assert.match(
  index,
  /sessionStorage\.getItem\('danjion:postAuthReturn'\)[\s\S]{0,80}sessionStorage\.removeItem\('danjion:postAuthReturn'\)/,
  'the return target must be consumed exactly once'
);
assert.match(
  index,
  /returnTo\.charAt\(0\)!=='\/'\|\|returnTo\.charAt\(1\)==='\/'/,
  'the return target must be same-origin only (no protocol-relative //host)'
);
assert.match(index, /location\.replace\(returnTo\)/, 'the landing must navigate back to the stored target');

// 2) landing page: both real-session entry points honor the return target
//    before their default redirects, and after the signup intent takes priority.
assert.match(
  index,
  /if\(sessionStorage\.getItem\('danjionAuthPending'\)==='1'\)\{[\s\S]*?\}\s*if\(consumePostAuthReturn\(\)\)return;/,
  'reconcileLandingSession must consume the return target after the signup intent'
);
assert.match(
  index,
  /if\(!consumePostAuthReturn\(\)\)location\.replace\('04_데일리홈\.html'\)/,
  'email login must return to the application form instead of the daily home'
);

// 3) application form: auth-required responses preserve the current form URL
//    and open the canonical landing login entry.
assert.match(
  application,
  /function goToLoginForApplication\(\)\{try\{sessionStorage\.setItem\('danjion:postAuthReturn',location\.pathname\+location\.search\)\}/,
  '25A must store its own path and query before asking for login'
);
assert.match(
  application,
  /location\.href='index\.html\?auth=login'/,
  '25A must reuse the canonical landing login intent'
);
assert.match(
  application,
  /if\(result\.reason==='auth-required'\)\{[\s\S]{0,500}goToLoginForApplication/,
  'report submission must route an auth-required result into the login return flow'
);
assert.match(
  application,
  /if\(upload\.reason==='auth-required'\)\{[\s\S]{0,500}goToLoginForApplication/,
  'photo upload must route an auth-required result into the login return flow'
);

// 4) submission authority stays unchanged: the canonical bridge is still the
//    only submit path and the duplicate-submit guards remain.
assert.match(application, /bridge\.createRecommendation\(/, 'report submission must still go through the canonical bridge');
assert.match(application, /if\(__reportSubmitting\) return;/, 'report duplicate-submit guard must stay unchanged');

// 5) household onboarding copy names the real next step (login -> confirm 동·호).
assert.match(household, /HOUSEHOLD ONBOARDING · 우리집 연결 준비/, 'the onboarding kicker must name the household connection step');
assert.match(household, /로그인 후 살고 있는 동·호를 확인해 우리집 연결을 준비합니다\./, 'the intro must explain the login-then-connect order');
assert.match(household, /<b>01<\/b><span>로그인 상태에서 우리집 연결을 시작합니다\.<\/span>/, 'step 01 must describe the logged-in start');
assert.match(household, /<b>02<\/b><span>살고 있는 동·호를 확인해 우리집 연결을 준비합니다\.<\/span>/, 'step 02 must describe the household confirmation');

console.log('leaf-post-auth-return-contract: PASS');
