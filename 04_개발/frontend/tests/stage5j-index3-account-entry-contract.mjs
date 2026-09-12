import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../../frontend/index.html', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

/* --- #424 account-first: auth entry never presents phone OTP as a signup requirement --- */
assert.doesNotMatch(html, /이메일 가입 시 휴대전화번호로 인증합니다/,
  'auth entry must not claim phone OTP is required for email signup');
assert.doesNotMatch(html, /휴대전화번호는 가입 인증에/,
  'auth entry must not describe phone use for signup verification');
assert.match(html, /이메일로 먼저 계정을 만들고, 주민 확인은 가입 후 별도로 진행합니다/,
  'auth entry must state the account-first order with resident verification as a separate step');

/* --- signup form collects the Better Auth account credential only (no phone) --- */
assert.match(html, /<label>이름<input class="control" name="name" maxlength="24"/,
  'email signup form must collect the account/display name');
assert.match(html, /<label>비밀번호<input class="control" name="password" type="password" minlength="8"/,
  'email signup form must collect the account password up front');
assert.doesNotMatch(html, /name="phone"/,
  'no signup form may collect a phone credential as an account prerequisite');
assert.match(html, /<button class="primary" type="submit">계정 만들기<\/button>/,
  'signup submit must offer account creation, never a phone OTP challenge');
assert.match(html, /이 단계에서는 로그인 계정만 만듭니다/,
  'signup copy must separate account creation from resident authority');

/* --- A: account creation uses the standard Better Auth email signup path --- */
assert.match(html, /'\/api\/auth\/sign-up\/email'\),\{method:'POST',body:JSON\.stringify\(\{email,name,password\}\)\}\);/,
  'email submit must POST the standard Better Auth sign-up email endpoint with email+name+password');
assert.doesNotMatch(html, /\/auth\/verification\/start/,
  'index3 must not gate signup behind phone verification start');
assert.doesNotMatch(html, /\/auth\/verification\/verify/,
  'index3 must not require a phone OTP verify step for account creation');
assert.doesNotMatch(html, /verificationReceiptRef/,
  'index3 must not require a verification receipt for account creation');
assert.doesNotMatch(html, /signupSessionRef/,
  'index3 must not carry a phone signup session through account creation');
assert.doesNotMatch(html, /challengeId/,
  'index3 must not carry a phone OTP challenge through account creation');
assert.match(html, /if\(!r\.ok\)\{showToast\(r\.error&&r\.error\.message\?r\.error\.message:'계정을 만들지 못했습니다/,
  'failed account creation must stay on the form with the server error (retry allowed, never a signup block)');
assert.match(html, /signupPending=\{email,name\};showToast\('가입 이메일로 인증 메일을 보냈습니다\.'\);render\('terms'\)/,
  'created accounts must stash only the account identity and continue to terms (email verification policy preserved)');
assert.doesNotMatch(html, /signupUnavailable|blockEmailSignup|block-email-signup|emailSignupDisabled/,
  'index3 must not import #426 signup-blocking behavior');
assert.doesNotMatch(html, /function emailVerify\(\)/,
  'the phone OTP verify view must not exist');
assert.doesNotMatch(html, /data-form="verify"|data-form="password"|data-resend/,
  'no OTP verify/password/resend surfaces may remain in the signup flow');

/* --- B: terms and resident steps keep their order with explicit authority separation --- */
assert.match(html, /function terms\(\)\{setHead\('가입 · 2',/,
  'terms must follow account creation as step 2');
assert.match(html, /function residentCode\(\)\{setHead\('가입 · 3',/,
  'resident code must follow terms as the separate resident-verification step');
assert.match(html, /이 단계는 로그인 계정 만들기가 아니라 주민 확인 요청입니다/,
  'resident code copy must state it is a resident-verification request, not account creation');
assert.match(html, /function address\(\)\{setHead\('가입 · 4',/,
  'address selection must follow the resident code step');
assert.match(html, /function nickname\(\)\{setHead\('가입 · 5',/,
  'nickname must close the flow as step 5');

/* --- C: completion claims the account only; resident authority stays separate --- */
assert.match(html, /<h3>계정을 만들었어요<\/h3>/,
  'completion must claim the created account, never complex registration');
assert.doesNotMatch(html, /단지 등록이 끝났어요/,
  'completion must not claim resident/complex registration is done');
assert.match(html, /가입 이메일의 인증 메일을 확인하면 로그인할 수 있습니다/,
  'completion must preserve the email-verification policy (login after mailbox verification)');
assert.match(html, /주민 전용 기능은 주민 확인이 끝난 뒤에 이용할 수 있습니다/,
  'completion must keep resident-only features behind the separate resident verification');

/* --- D: nickname stores the neighbor display name locally; no receipt-gated endpoint --- */
assert.match(html, /else if\(type==='nickname'\)\{const nickname=event\.target\.elements\.nickname\.value\.trim\(\);/,
  'nickname submit must read the display name without a server gate');
assert.doesNotMatch(html, /type==='nickname'\)\{[\s\S]{0,300}__session/,
  'nickname submit must not call any server endpoint (account already exists)');
assert.doesNotMatch(html, /'\/auth\/signup'/,
  'the receipt-gated /auth/signup completion path must not exist');
assert.match(html, /sessionStorage\.setItem\('danjionNickname',nickname\)/,
  'nickname submit must persist the neighbor display name locally');
assert.match(html, /signupPending=null;render\('complete'\)\}else if\(type==='login'\)/,
  'nickname submit must clear pending state and render completion in both modes');

/* --- E: finish enters the app as a resident-unverified member (never blocked, never verified) --- */
assert.match(html, /else if\(button\.dataset\.finish!==undefined\)\{memberMode=true;sessionStorage\.setItem\('danjionMember','1'\);sessionStorage\.setItem\('danjionResidentVerification','pending'\);sessionStorage\.removeItem\('danjionGuest'\);syncMemberState\(\);openChair\(\)\}/,
  'finish must enter the app as a resident-unverified member without re-gating on OTP');
assert.doesNotMatch(html, /danjionResidentVerified/,
  'no entry flow may mint a resident-verified flag');

/* --- F: password recovery uses the real Better Auth reset route --- */
assert.match(html, /'\/api\/auth\/forget-password'\),\{method:'POST',body:JSON\.stringify\(\{email,redirectTo:/,
  'recovery must POST the Better Auth forget-password endpoint with a redirectTo callback');
assert.match(html, /showToast\(r\.ok\?'가입 이메일로 비밀번호 재설정 안내를 보냈습니다\.':'비밀번호 재설정 이메일을 보내지 못했습니다\./,
  'recovery must report the real server outcome instead of a hardcoded success');

/* --- demo (no apiBase) paths: email demo stashes the pending account and continues --- */
assert.match(html, /\}else\{signupPending=\{email,name\};render\('terms'\)\}\}/,
  'demo email submit must stash the pending account and render terms');
assert.match(html, /else\{showToast\('가입 이메일로 인증번호를 보냈습니다\.'\)\}\}/,
  'demo recovery must keep the prototype toast');

/* --- pending signup state is cleared when the modal closes --- */
assert.match(html, /function closeLayer\(\)\{layer\.hidden=true;document\.body\.style\.overflow='';history=\[\];signupPending=null\}/,
  'closing the modal must drop the pending signup state');

/* --- contract runs in the authoritative manifest --- */
const manifest = JSON.parse(await readFile(new URL('../../test-runner.manifest.json', import.meta.url), 'utf8'));
const runIds = manifest.scopes.frontend.run.map((s) => s.npm || s.id);
assert.ok(runIds.includes('test:stage5j-index3-account-entry'),
  'stage5j contract must run in the manifest frontend suite');

console.log('stage5j index3 account-first entry wiring contract: PASS');
