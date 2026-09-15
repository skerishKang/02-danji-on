import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const [sessionSource, myInfo, index] = await Promise.all([
  read('../assets/danjion-session.js'),
  read('../19_내정보_메인.html'),
  read('../index.html')
]);

assert.match(sessionSource, /function fetchLinkedAccounts\(fetchImpl, loc\)/);
assert.match(sessionSource, /'\/api\/auth\/list-accounts'/);
assert.match(sessionSource, /function accountAuthKind\(accountResult\)/);
assert.match(sessionSource, /providerId/);
assert.match(sessionSource, /credentialOnly/);
assert.match(sessionSource, /socialLabel/);
assert.match(sessionSource, /function sendVerificationEmail\(fetchImpl, email, loc\)/);
assert.match(sessionSource, /'\/api\/auth\/send-verification-email'/);
assert.match(sessionSource, /authKind\.credentialOnly && !emailVerified/);
assert.doesNotMatch(sessionSource, /연결 이메일/,
  'global account UI must not present provider-returned contact email as account identity');
assert.match(sessionSource, /네이버/);

assert.match(myInfo, /id="mi-email-row"/);
assert.match(myInfo, /id="mi-email-state"/);
assert.match(myInfo, /id="mi-email-resend"/);
assert.match(myInfo, /function renderEmailState\(user,authKind\)/);
assert.match(myInfo, /authKind\.socialLabel\|\|'소셜'/);
assert.doesNotMatch(myInfo, /연결 이메일/,
  'primary My Info card must not render a social account contact email');
assert.match(myInfo, /EMAIL_VERIFICATION_NOT_APPLICABLE/);
assert.doesNotMatch(myInfo, /if\(user&&user\.emailVerified===false\)/,
  'emailVerified presentation must never suppress resident/admin server reads');
assert.match(myInfo, /\.profile-hero\{min-height:360px!important/,
  'desktop profile hero must leave enough room for account state plus stats');

assert.match(index, /\[단지온\] 이메일 주소를 확인해 주세요/);
assert.match(index, /이메일 확인하기/);

const ctx = { URL, URLSearchParams };
ctx.globalThis=ctx;ctx.window=ctx;
vm.runInNewContext(sessionSource,ctx);

const S=ctx.DanjionSession;
assert.equal(typeof S.fetchLinkedAccounts,'function');
assert.equal(typeof S.accountAuthKind,'function');
assert.equal(S.accountAuthKind({ok:true,raw:[{providerId:'credential'}]}).credentialOnly,true);
assert.equal(S.accountAuthKind({ok:true,raw:[{providerId:'credential'}]}).hasSocial,false);
const naver=S.accountAuthKind({ok:true,raw:[{providerId:'naver'}]});
assert.equal(naver.hasSocial,true);
assert.equal(naver.credentialOnly,false);
assert.equal(naver.socialLabel,'네이버');
const google=S.accountAuthKind({ok:true,raw:[{providerId:'google'}]});
assert.equal(google.hasSocial,true);
assert.equal(google.socialLabel,'Google');
const mixed=S.accountAuthKind({ok:true,raw:[{providerId:'credential'},{providerId:'naver'}]});
assert.equal(mixed.hasSocial,true);
assert.equal(mixed.credentialOnly,false);
assert.deepEqual(Array.from(mixed.providers),['credential','naver']);

console.log('leaf-email-verification-account-state-contract: PASS');
