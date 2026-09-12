import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../../frontend/index.html', import.meta.url), 'utf8');
const session = await readFile(new URL('../../../frontend/assets/danjion-session.js', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

/* --- canonical runtime is loaded before the page script consumes it --- */
const sessionTag = html.indexOf('<script src="assets/danjion-session.js"></script>');
const mainScript = html.indexOf('const layer=document.querySelector(\'.modal-layer\')');
assert.ok(sessionTag > -1, 'danjion-session runtime script tag must be present');
assert.ok(mainScript > -1, 'auth entry runtime script must be present');
assert.ok(sessionTag < mainScript, 'danjion-session runtime must load before the auth entry script');
assert.match(session, /global\.DanjionSession = Object\.freeze/, 'runtime must expose the frozen DanjionSession global');

/* --- server mode is derived from the canonical apiBase, never a fake flag --- */
assert.match(html, /const __session=window\.DanjionSession,serverMode=!!__session&&__session\.danjionApiBase\(\)!==''/,
  'serverMode must come from DanjionSession.danjionApiBase()');
assert.doesNotMatch(html, /serverMode\s*=\s*true/, 'serverMode must not be hardcoded');

/* --- session readiness probe uses the real Better Auth get-session route --- */
assert.match(html, /async function serverSessionCheck\(\)\{if\(!serverMode\)return false;[\s\S]*?\/api\/auth\/get-session[\s\S]*?return !!\(r\.ok&&r\.data\)\}/,
  'session check must call /api/auth/get-session and require a real payload');

/* --- email login recognizes the server session before unlocking member mode --- */
assert.match(html, /else if\(type==='login'\)\{if\(serverMode\)\{const email=event\.target\.elements\.email\.value\.trim\(\),password=event\.target\.elements\.password\.value;[\s\S]*?\/api\/auth\/sign-in\/email[\s\S]*?const real=await serverSessionCheck\(\);if\(real\)\{memberMode=true;[\s\S]*?\}else\{showToast\('이메일 또는 비밀번호를 확인해 주세요\.'\)\}\}else\{memberMode=true;sessionStorage\.setItem\('danjionMember','1'\)/,
  'server-mode login must POST /api/auth/sign-in/email and only unlock after a real session');
assert.doesNotMatch(html, /type==='login'\)\{if\(serverMode\)\{[^}]*\}else\{memberMode=true;sessionStorage\.setItem\('danjionMember','1'\);sessionStorage\.setItem\('danjionResidentVerification'/,
  'server-mode login must not mint resident verification state');

/* --- social entry uses the existing Better Auth social adapter only --- */
assert.match(html, /if\(serverMode\)\{const body=\{provider,callbackURL:location\.origin\+location\.pathname,newUserCallbackURL:location\.origin\+location\.pathname\};if\(mode==='signup'\)body\.requestSignUp=true;[\s\S]*?\/api\/auth\/sign-in\/social[\s\S]*?const redirectUrl=r\.ok&&\(r\.data\?\.url\|\|r\.data\?\.redirect\);if\(redirectUrl\)\{location\.href=redirectUrl;return\}showToast\('소셜 인증을 시작하지 못했습니다/,
  'server-mode social must start the existing OAuth adapter and fail closed when no redirect is returned');
assert.match(html, /providerMap=\{'카카오':'kakao','네이버':'naver','Google':'google'\}/,
  'social providers must map to the existing adapter ids only');

/* --- #424 account-first: the account already exists when finish is reached --- */
assert.match(html, /else if\(button\.dataset\.finish!==undefined\)\{memberMode=true;sessionStorage\.setItem\('danjionMember','1'\);sessionStorage\.setItem\('danjionResidentVerification','pending'\);sessionStorage\.removeItem\('danjionGuest'\);syncMemberState\(\);openChair\(\)\}/,
  'finish must enter the app as a resident-unverified member in both modes (account was created at step 1; no OTP re-gate, no signup block)');
assert.doesNotMatch(html, /danjionResidentVerified/,
  'no entry flow may mint a resident-verified flag');

/* --- boot reconciliation replaces fake flags with the real session result --- */
assert.match(html, /if\(serverMode\)\{serverSessionCheck\(\)\.then\(\(real\)=>\{[\s\S]*?sessionStorage\.removeItem\('danjionMember'\);sessionStorage\.removeItem\('danjionSignedUp'\)\}memberMode=real;syncMemberState\(\)\}\)/,
  'boot must reconcile memberMode against the real session and drop fake member flags');

/* --- demo mode keeps the historical prototype flow untouched --- */
assert.match(html, /\}else\{showToast\(button\.dataset\.social\+' 인증은 백엔드 OAuth 연결 후 실제 동작합니다/,
  'demo-mode social prototype toast flow must remain');

/* --- no dev identity header and no new gallery/hot-file coupling --- */
assert.doesNotMatch(html, /x-danjion-dev-auth-user/, 'must not manufacture a dev identity');
const manifest = JSON.parse(await readFile(new URL('../../test-runner.manifest.json', import.meta.url), 'utf8'));
const runIds = manifest.scopes.frontend.run.map((s) => s.npm || s.id);
assert.ok(runIds.includes('test:stage5i-account-session-entry'),
  'stage5i contract must run in the manifest frontend suite');

console.log('stage5i account/session entry reconciliation contract: PASS');
