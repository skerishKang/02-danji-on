import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const [sessionSource, myInfo, settings] = await Promise.all([
  read('../assets/danjion-session.js'),
  read('../19_내정보_메인.html'),
  read('../24_설정.html')
]);

assert.match(sessionSource, /function fetchLinkedAccounts\(fetchImpl, loc\)/);
assert.match(sessionSource, /'\/api\/auth\/list-accounts'/);
assert.match(sessionSource, /function accountAuthKind\(accountResult\)/);
assert.match(sessionSource, /providerId/);
assert.match(sessionSource, /credentialOnly/);
assert.match(sessionSource, /socialLabel/);

assert.doesNotMatch(sessionSource, /연결 이메일/,
  'social provider contact email must never be presented as account identity');
assert.match(sessionSource, /authKind\.credentialOnly\s*\? '이메일 로그인'/,
  'credential accounts must be described as an email login, not an email-verification state');
assert.doesNotMatch(sessionSource, /labelSub\.classList\.add\('is-warning'\)/,
  'demo account header must not warn about deferred email verification');

assert.match(myInfo, /id="mi-email-row"/);
assert.match(myInfo, /function renderEmailState\(user,authKind\)/);
assert.match(myInfo, /state\.textContent=credentialOnly\?'이메일 로그인 계정':'로그인 계정'/);
assert.match(myInfo, /if\(resend\)resend\.hidden=true/,
  'verification resend must stay hidden while the feature is deferred');
assert.doesNotMatch(myInfo, /state\.textContent=credentialOnly\?\(verified\?'이메일 확인 완료':'이메일 인증 필요'\)/);

assert.match(settings, /<b>로그인 보안<\/b><span>현재 로그인 방식으로 안전하게 이용합니다\.<\/span>/);
assert.doesNotMatch(settings, /data-account-open="email"/,
  'demo Settings must not expose unfinished email-management entry');
assert.doesNotMatch(settings, /data-account-open="security"/,
  'demo Settings must not advertise social-account linking controls');

const ctx = { URL, URLSearchParams };
ctx.globalThis=ctx;ctx.window=ctx;
vm.runInNewContext(sessionSource,ctx);
const S=ctx.DanjionSession;
assert.equal(S.accountAuthKind({ok:true,raw:[{providerId:'credential'}]}).credentialOnly,true);
assert.equal(S.accountAuthKind({ok:true,raw:[{providerId:'naver'}]}).socialLabel,'네이버');
assert.equal(S.accountAuthKind({ok:true,raw:[{providerId:'google'}]}).socialLabel,'Google');

console.log('leaf-email-verification-account-state-contract: PASS demo auth simplification');
