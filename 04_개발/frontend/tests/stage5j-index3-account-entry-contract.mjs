import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../../frontend/index.html', import.meta.url), 'utf8');

/* account credential form stays phone-free */
assert.match(html, /<label>이름<input class="control" name="name" maxlength="24"/);
assert.match(html, /<label>비밀번호<input class="control" name="password" type="password" minlength="8"/);
assert.doesNotMatch(html, /name="phone"/);
assert.match(html, /약관 확인하기/);

/* #430: terms before account creation */
assert.match(html, /signupPending=\{email,name,password,accountCreated:false\};render\('terms'\)/,
  'email form must stage credentials and go to terms before creating an account');
assert.match(html, /button\.dataset\.termsNext!==undefined[\s\S]*'\/api\/auth\/sign-up\/email'/,
  'accepted terms must trigger Better Auth email signup');
assert.match(html, /필수 2개 동의하고 계정 만들기/,
  'required terms CTA must describe account creation');
assert.match(html, /서비스 알림 수신[\s\S]*<small>선택<\/small>/);
assert.match(html, /혜택·이벤트 알림[\s\S]*<small>선택<\/small>/);

/* #430: two-track resident verification after account creation */
assert.match(html, /function residentChoice\(\)\{/);
assert.match(html, /주민코드가 없어요 · 나중에 인증/);
assert.match(html, /주민코드가 있어요 · 지금 인증/);
assert.match(html, /button\.dataset\.residentNow!==undefined\)\{render\('residentCode'\)\}/);
assert.match(html, /button\.dataset\.residentLater!==undefined\)\{sessionStorage\.setItem\('danjionResidentVerification','pending'\);signupPending=null;render\('complete'\)\}/);

/* resident code is optional for signup completion */
assert.match(html, /주민코드 없이 계정 생성은 완료되었습니다/);
assert.match(html, /주민 확인은 나중에 계정 화면에서 진행할 수 있으며/);
assert.doesNotMatch(html, /danjionResidentVerified/);

/* resident path remains separate and explicit */
assert.match(html, /function residentCode\(\)\{setHead\('주민 확인 · 1'/);
assert.match(html, /function address\(\)\{setHead\('주민 확인 · 2'/);
assert.match(html, /function nickname\(\)\{setHead\('주민 확인 · 3'/);

/* Better Auth and account safety invariants */
assert.match(html, /'\/api\/auth\/sign-up\/email'/);
assert.doesNotMatch(html, /\/auth\/verification\/start|\/auth\/verification\/verify|verificationReceiptRef|signupSessionRef|challengeId/);
assert.doesNotMatch(html, /signupUnavailable|blockEmailSignup|emailSignupDisabled/);
assert.match(html, /'\/auth\/social-start'/, '#448r2: social entry must start first-party via the Worker /auth/social-start route');
assert.doesNotMatch(html, /\/api\/auth\/sign-in\/social/, '#448r2: no cross-site social POST may remain in index.html');
assert.match(html, /'\/api\/auth\/sign-in\/email'/);
assert.match(html, /'\/api\/auth\/forget-password'\)/);

console.log('stage5j index3 two-track signup contract: PASS');
