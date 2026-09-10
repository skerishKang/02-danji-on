import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../../frontend/index3.html', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

/* --- phone credential collected on the email signup form --- */
assert.match(html, /name="phone" type="tel" inputmode="numeric"/,
  'email signup form must collect the phone credential used for account verification');
assert.match(html, /01\[016789\]\\d\{7,8\}/,
  'phone gate must require the canonical Korean mobile form before calling the server');

/* --- A: verification start is wired to the product endpoint in server mode --- */
assert.match(html, /const phone=event\.target\.elements\.phone\?event\.target\.elements\.phone\.value\.replace\(.{1,4}D\/g,''\):'';/,
  'email submit must read the email and phone fields');
assert.match(html, /'\/auth\/verification\/start'\),\{method:'POST',body:JSON\.stringify\(\{email,phone:mobile\}\)\}\);/,
  'email submit must POST the canonical /auth/verification/start payload');
assert.match(html, /if\(!\(r\.ok&&r\.data&&r\.data\.signupSessionRef&&r\.data\.challengeId\)\)\{showToast\(/,
  'verification start must fail closed unless the server returns a real signup session and challenge');
assert.match(html, /signupPending=\{email,phone:mobile,signupSessionRef:r\.data\.signupSessionRef,challengeId:r\.data\.challengeId\};render\('emailVerify'\)/,
  'verified start must stash the signup session before the verify step');

/* --- B: code verification is wired to the product endpoint in server mode --- */
assert.match(html, /'\/auth\/verification\/verify'\),\{method:'POST',body:JSON\.stringify\(\{signupSessionRef:signupPending\.signupSessionRef,challengeId:signupPending\.challengeId,code:value\}\)\}\)/,
  'verify submit must POST the canonical /auth/verification/verify payload');
assert.match(html, /if\(!\(r\.ok&&r\.data&&r\.data\.verificationReceiptRef\)\)\{showToast\(/,
  'verify must fail closed unless the server returns a one-time receipt');
assert.match(html, /signupPending\.verificationReceiptRef=r\.data\.verificationReceiptRef;render\('password'\)/,
  'verified code must stash the receipt before collecting the password');
assert.doesNotMatch(html, /type==='verify'\)\{[\s\S]{0,400}memberMode=true/,
  'verify must not mint member state locally');

/* --- C: signup completion goes through the receipt-gated product endpoint --- */
assert.match(html, /'\/auth\/signup'\),\{method:'POST',body:JSON\.stringify\(\{email:signupPending\.email,phone:signupPending\.phone,name,password:signupPending\.password,signupSessionRef:signupPending\.signupSessionRef,verificationReceiptRef:signupPending\.verificationReceiptRef\}\)\}\)/,
  'nickname submit must POST the canonical /auth/signup receipt payload');
assert.match(html, /if\(!\(r\.ok&&r\.data&&r\.data\.accepted\)\)\{showToast\(/,
  'signup must fail closed unless the server accepts the receipt-gated signup');
assert.match(html, /signupPending=null;render\('complete'\);return\}render\('complete'\)/,
  'accepted signup must clear pending state and only then render completion');
assert.doesNotMatch(html, /type==='nickname'\)\{if\(serverMode\)\{[\s\S]{0,600}sessionStorage\.setItem\('danjionMember/,
  'server-mode signup must not mint member state or fake resident verification');

/* --- F: password recovery uses the real Better Auth reset route --- */
assert.match(html, /'\/api\/auth\/forget-password'\),\{method:'POST',body:JSON\.stringify\(\{email,redirectTo:/,
  'recovery must POST the Better Auth forget-password endpoint with a redirectTo callback');
assert.match(html, /showToast\(r\.ok\?'가입 이메일로 비밀번호 재설정 안내를 보냈습니다\.':'비밀번호 재설정 이메일을 보내지 못했습니다\./,
  'recovery must report the real server outcome instead of a hardcoded success');

/* --- resend re-issues through the server with the existing signup session --- */
assert.match(html, /JSON\.stringify\(\{email:signupPending\.email,phone:signupPending\.phone,signupSessionRef:signupPending\.signupSessionRef\}\)\}/,
  'resend must re-call verification start with the stashed signup session ref');
assert.match(html, /signupPending\.challengeId=r\.data\.challengeId;showToast\('인증번호를 다시 보냈습니다\.'\)/,
  'resend must rotate the server-issued challenge id, not fabricate delivery');

/* --- account auth never manufactures resident or Better Auth direct signup --- */
assert.doesNotMatch(html, /\/api\/auth\/sign-up\/email/,
  'index3 must never call the blocked direct Better Auth email signup');
assert.doesNotMatch(html, /dataset\.finish!==undefined\)\{if\(serverMode\)\{showToast\('실제 가입은 서버 계정 가입 절차에서 완료됩니다\.'\);memberMode=true/,
  'server-mode account auth must not mint resident verification state');

/* --- demo (no apiBase) paths stay exactly as before --- */
assert.match(html, /\}else\{render\('emailVerify'\)\}\}/,
  'demo email submit must keep rendering the verify step');
assert.match(html, /render\('password'\)\}else\{render\('password'\)\}\}/,
  'demo verify submit must keep rendering the password step');
assert.match(html, /render\('complete'\);return\}render\('complete'\)\}/,
  'demo nickname submit must keep rendering completion');
assert.match(html, /else\{showToast\('가입 이메일로 인증번호를 보냈습니다\.'\)\}\}/,
  'demo recovery must keep the prototype toast');
assert.match(html, /else\{showToast\('인증번호를 다시 보냈습니다\.'\)\}/,
  'demo resend must keep the prototype toast');

/* --- pending signup state is cleared when the modal closes --- */
assert.match(html, /function closeLayer\(\)\{layer\.hidden=true;document\.body\.style\.overflow='';history=\[\];signupPending=null\}/,
  'closing the modal must drop the pending signup session and receipt');

/* --- contract runs in the typecheck chain --- */
assert.ok(pkg.scripts.typecheck.includes('npm run test:stage5j-index3-account-entry'),
  'stage5j contract must run in the typecheck chain');

console.log('stage5j index3 account entry wiring contract: PASS');
