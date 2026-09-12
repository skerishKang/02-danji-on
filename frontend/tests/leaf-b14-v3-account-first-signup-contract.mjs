import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #424 [V3 production UI parity]: top-level frontend/index.html is the
// canonical production signup surface. The backend is account-first, so the V3
// UI must create the Better Auth account with email+name+password and must not
// gate account creation behind phone OTP. Resident verification stays a
// separate step with no resident permissions granted at signup.
// Run: node frontend/tests/leaf-b14-v3-account-first-signup-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const index = await read('../index.html');

/* --- production V3 has no mandatory phone-OTP signup gate --- */
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
assert.doesNotMatch(index, /이메일 가입 시 휴대전화번호로 인증합니다/,
  'production V3 must not present phone OTP as an email-signup requirement');
assert.doesNotMatch(index, /'\/auth\/signup'/,
  'production V3 must not use the receipt-gated /auth/signup completion path');

/* --- production V3 account creation uses the standard Better Auth email path --- */
assert.match(index, /'\/api\/auth\/sign-up\/email'\),\{method:'POST',body:JSON\.stringify\(\{email,name,password\}\)\}\);/,
  'production V3 must create the account via POST /api/auth/sign-up/email with email+name+password');
assert.match(index, /<button class="primary" type="submit">계정 만들기<\/button>/,
  'production V3 signup must offer direct account creation');

/* --- account creation copy explicitly separates account vs resident authority --- */
assert.match(index, /이메일로 먼저 계정을 만들고, 주민 확인은 가입 후 별도로 진행합니다/,
  'production V3 entry must state the account-first order');
assert.match(index, /이 단계에서는 로그인 계정만 만듭니다/,
  'production V3 signup must claim the account only');
assert.match(index, /가입 이메일의 인증 메일을 확인하면 로그인할 수 있습니다/,
  'production V3 must preserve the email-verification policy in completion copy');
assert.match(index, /주민 전용 기능은 주민 확인이 끝난 뒤에 이용할 수 있습니다/,
  'production V3 must keep resident-only features behind the separate resident verification');
assert.doesNotMatch(index, /단지 등록이 끝났어요/,
  'production V3 completion must not claim resident registration is done');

/* --- no #426 signup-blocking behavior is imported --- */
assert.doesNotMatch(index, /signupUnavailable|blockEmailSignup|block-email-signup|emailSignupDisabled/,
  'production V3 must not disable email signup when phone verification is unavailable');

/* --- #425 OAuth provisioning guards stay intact (social adapter untouched) --- */
assert.match(index, /'\/api\/auth\/sign-in\/social'/,
  'production V3 must keep the existing Better Auth social adapter path');
assert.match(index, /providerMap=\{'카카오':'kakao','네이버':'naver','Google':'google'\}/,
  'production V3 must keep the existing social provider mapping');

/* --- login and recovery keep their Better Auth routes (untouched lanes) --- */
assert.match(index, /'\/api\/auth\/sign-in\/email'/,
  'production V3 must keep email login on the Better Auth sign-in route');
assert.match(index, /'\/api\/auth\/forget-password'\)/,
  'production V3 must keep password recovery on the Better Auth reset route');

/* --- bounded scope: the parity fix lives in the canonical signup page only --- */
const daily = await read('../04_데일리홈.html');
assert.ok(!daily.includes('/api/auth/sign-up/email'),
  '04_데일리홈.html must stay outside the #424 V3 signup scope');

console.log('leaf-b14-v3-account-first-signup-contract: PASS');
