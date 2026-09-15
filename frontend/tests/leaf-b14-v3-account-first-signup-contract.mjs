import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const index = await read('../index.html');

/* account-first: no phone OTP signup gate */
for (const banned of [
  '/auth/verification/start',
  '/auth/verification/verify',
  'verificationReceiptRef',
  'signupSessionRef',
  'challengeId',
  'emailVerify',
  'data-form="verify"',
  'data-form="password"',
  'data-resend',
  'name="phone"',
]) {
  assert.ok(!index.includes(banned), `production V3 signup must not contain "${banned}"`);
}
assert.doesNotMatch(index, /'\/auth\/signup'/,
  'production V3 must not use the receipt-gated /auth/signup completion path');

/* #430 required consent precedes account creation */
assert.match(index, /signupPending=\{email,name,password,accountCreated:false\};render\('terms'\)/,
  'email credentials must be staged and terms shown before account creation');
assert.match(index, /button\.dataset\.termsNext!==undefined[\s\S]*'\/api\/auth\/sign-up\/email'/,
  'Better Auth account creation must happen only from the accepted-terms action');
assert.match(index, /필수 2개 동의하고 계정 만들기/,
  'terms CTA must explicitly create the account after required consent');
assert.match(index, /서비스 알림 수신[\s\S]*<small>선택<\/small>/,
  'service notification consent must remain optional');
assert.match(index, /혜택·이벤트 알림[\s\S]*<small>선택<\/small>/,
  'benefit marketing consent must remain optional');

/* two-track post-signup resident verification */
assert.match(index, /function residentChoice\(\)/,
  'post-account resident choice view must exist');
assert.match(index, /data-resident-later>주민코드가 없어요 · 나중에 인증/,
  'no-code path must be a first-class action');
assert.match(index, /data-resident-now>주민코드가 있어요 · 지금 인증/,
  'has-code path must be a first-class action');
assert.match(index, /button\.dataset\.residentNow!==undefined\)\{render\('residentCode'\)\}/,
  'has-code path must enter resident verification');
assert.match(index, /button\.dataset\.residentLater!==undefined\)\{sessionStorage\.setItem\('danjionResidentVerification','pending'\);signupPending=null;render\('complete'\)\}/,
  'no-code path must complete signup while remaining resident-unverified');

/* resident authority stays separate + demo verification hold */
assert.doesNotMatch(index, /danjionResidentVerified/,
  'signup must never mint a resident-verified flag');
assert.match(index, /주민코드 없이 계정 생성은 완료되었습니다/,
  'completion must explicitly support account-only signup');
assert.match(index, /주민 확인은 나중에 계정 화면에서 진행할 수 있으며/,
  'completion must preserve later resident verification');
assert.match(index, /가입 완료','계정이 만들어졌습니다/,
  'demo signup completion must finish without an email-verification gate');
assert.match(index, /이메일 인증 없이 바로 로그인할 수 있습니다/,
  'demo signup must state the temporary no-verification behavior');
assert.match(index, /data-finish>단지온 시작하기/,
  'completion CTA must continue directly instead of asking for verification mail');
assert.doesNotMatch(index, /로그인을 하려면 이메일 인증이 필요합니다/,
  'demo flow must not present email verification as required');
assert.doesNotMatch(index, /인증메일을 확인하겠습니다/,
  'demo flow must not strand users on a verification-mail CTA');

/* no #426 signup-blocking behavior */
assert.doesNotMatch(index, /signupUnavailable|blockEmailSignup|block-email-signup|emailSignupDisabled/,
  'email signup must not be disabled because phone verification is unavailable');

/* OAuth/login/recovery routes stay intact */
assert.match(index, /'\/auth\/social-start'/, '#448r2: social entry must start first-party via the Worker /auth/social-start route');
assert.doesNotMatch(index, /\/api\/auth\/sign-in\/social/, '#448r2: no cross-site social POST may remain in the production entry');
assert.match(index, /'\/api\/auth\/sign-in\/email'/);
assert.match(index, /'\/api\/auth\/forget-password'\)/);

console.log('leaf-b14-v3-account-first-signup-contract: PASS');
