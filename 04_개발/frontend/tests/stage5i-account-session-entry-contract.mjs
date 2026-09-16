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

/* --- #444: session readiness parses the Better Auth NATIVE get-session shape --- */
assert.match(html, /async function serverSessionCheck\(\)\{if\(!serverMode\)return false;[\s\S]*?\/api\/auth\/get-session[\s\S]*?return __session\.nativeSessionReady\(r\)\}/,
  '#444: session check must call /api/auth/get-session and judge readiness via nativeSessionReady');
{
  const checkFn = html.match(/async function serverSessionCheck\(\)\{[^}]*\}/);
  assert.ok(checkFn, 'serverSessionCheck body must be statically analyzable');
  assert.doesNotMatch(checkFn[0], /r\.data/,
    '#444: serverSessionCheck must not depend on the DanjiOn {data} envelope — Better Auth answers natively');
}
assert.match(session, /function nativeSessionReady\(result\)\s*\{\s*return !!\(result && result\.ok && result\.raw && typeof result\.raw === 'object' && result\.raw\.session && result\.raw\.user\);\s*\}/,
  'nativeSessionReady must require ok + native raw.session + raw.user');
assert.match(session, /createSessionFetch,[\s\S]*?nativeSessionReady,/, 'the frozen runtime must export nativeSessionReady');

/* --- executable unit contract: load the real runtime and probe native responses --- */
{
  const vm = await import('node:vm');
  const context = { URLSearchParams, console };
  context.globalThis = context;
  vm.runInNewContext(session, context, { filename: 'danjion-session.js' });
  const Session = context.DanjionSession;
  assert.equal(typeof Session.nativeSessionReady, 'function');
  const response = (status, body) => ({ status, ok: status >= 200 && status < 300, async json() { return body; } });
  const probe = async (body, status = 200) => {
    const r = await Session.createSessionFetch('https://api.example.test')(async () => response(status, body), '/api/auth/get-session');
    return Session.nativeSessionReady(r);
  };
  assert.equal(await probe({ session: { token: 's1' }, user: { id: 'u1' } }), true,
    'native authenticated {session,user} must be ready');
  assert.equal(await probe(null), false,
    'native null (unauthenticated) must not be ready');
  assert.equal(await probe({ session: { token: 's1' } }), false, 'session without user must not be ready');
  assert.equal(await probe({ user: { id: 'u1' } }), false, 'user without session must not be ready');
  assert.equal(await probe({ data: { session: { token: 's1' }, user: { id: 'u1' } } }), false,
    'a DanjiOn {data}-enveloped payload must not be mistaken for a native session');
  assert.equal(await probe({ session: { token: 's1' }, user: { id: 'u1' } }, 401), false, 'non-ok status must not be ready');
  assert.equal(await probe({ message: 'boom' }, 500), false, 'server error must not be ready');
}

/* --- email login recognizes the server session before unlocking member mode --- */
assert.match(html, /else if\(type==='login'\)\{if\(serverMode\)\{const email=event\.target\.elements\.email\.value\.trim\(\),password=event\.target\.elements\.password\.value;[\s\S]*?\/api\/auth\/sign-in\/email[\s\S]*?const real=await serverSessionCheck\(\);if\(real\)\{memberMode=true;[\s\S]*?\}else\{showToast\('이메일 또는 비밀번호를 확인해 주세요\.'\)\}\}else\{memberMode=true;sessionStorage\.setItem\('danjionMember','1'\)/,
  'server-mode login must POST /api/auth/sign-in/email and only unlock after a real session');
assert.doesNotMatch(html, /type==='login'\)\{if\(serverMode\)\{[^}]*\}else\{memberMode=true;sessionStorage\.setItem\('danjionMember','1'\);sessionStorage\.setItem\('danjionResidentVerification'/,
  'server-mode login must not mint resident verification state');

/* --- #448 round 2 / #444: social entry starts first-party with unified continue intent --- */
assert.match(html, /if\(serverMode\)\{const q=new URLSearchParams\(\{provider,callbackURL:location\.origin\+location\.pathname\}\);q\.set\('requestSignUp','1'\);[\s\S]*?location\.href=__session\.joinUrl\(__session\.danjionAuthBase\(\),'\/auth\/social-start'\)\+'\?'\+q\.toString\(\);return\}/,
  '#444/#451: server-mode social must navigate top-level through the canonical auth facade and always include requestSignUp=1');
assert.doesNotMatch(html, /if\(mode==='signup'\)q\.set\('requestSignUp'/,
  '#444: requestSignUp must no longer depend on the login/signup UI mode');
assert.doesNotMatch(html, /\/api\/auth\/sign-in\/social/,
  'frontend must never POST /api/auth/sign-in/social cross-site from Pages; the Worker start page owns the same-origin sign-in call');
assert.match(html, /providerMap=\{'카카오':'kakao','네이버':'naver','Google':'google'\}/,
  'social providers must map to the existing adapter ids only');
assert.match(html, /카카오로 계속하기[\s\S]*Google로 계속하기/,
  '#444/#586: visible Kakao and Google buttons must keep neutral continue copy');
assert.doesNotMatch(html, /<button[^>]+data-social="네이버"/,
  '#586: the development-restricted Naver provider must not be exposed as a visible button');
assert.match(html, /<span>이메일로 \$\{action\}<\/span>/,
  '#444: email login/signup copy must remain mode-specific (only social is unified)');

/* --- #430 account-first: completion never fabricates an authenticated member session --- */
assert.match(html, /else if\(button\.dataset\.finish!==undefined\)\{authModal\.close\(\);if\(serverMode\)\{const real=await serverSessionCheck\(\);if\(real\)\{memberMode=true;/,
  'finish must close the modal sentinel and unlock only after a real post-signup session is confirmed');
assert.doesNotMatch(html, /button\.dataset\.finish!==undefined\)\{memberMode=true/,
  'signup completion must not unlock member mode before a real authenticated session exists');
assert.doesNotMatch(html, /danjionResidentVerified/,
  'no entry flow may mint a resident-verified flag');

/* --- boot reconciliation replaces fake flags with the real session result --- */
assert.match(html, /async function reconcileLandingSession\(\)[\s\S]*const real=await serverSessionCheck\(\)[\s\S]*sessionStorage\.removeItem\('danjionMember'\);\s*sessionStorage\.removeItem\('danjionSignedUp'\);\s*sessionStorage\.removeItem\('danjionAuthPending'\);?[\s\S]*memberMode=real;sessionResolved=true;syncMemberState\(\);[\s\S]*if\(real\)refreshAdminEntry\(\)/,
  'boot must reconcile memberMode against the real session through the centralized reconciler and drop fake member flags without forcing Intro away');
assert.match(html, /reconcileLandingSession\(\);window\.addEventListener\('pageshow',event=>\{if\(event\.persisted\)reconcileLandingSession\(\)\}\)/,
  'landing must also reconcile the real session after BFCache restoration');

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

assert.doesNotMatch(html, /joinUrl\(__session\.danjionApiBase\(\),'\/auth\/social-start'\)/,
  'social-start must never regress to the general application API base');
