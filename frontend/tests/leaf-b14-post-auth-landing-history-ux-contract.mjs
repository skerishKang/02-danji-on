import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Issue #444 [post-auth UX]: signed-in landing controls, one-time login toast,
// real same-origin sign-out, and auth-modal browser-Back history integration.
// Run: node frontend/tests/leaf-b14-post-auth-landing-history-ux-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const index = await read('../index.html');
const helper = await read('../assets/auth-modal-history.js');

/* ================= 1. runtime: auth-modal history state machine ================= */
const loadHelper = () => {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(helper, ctx);
  return ctx.DanjionAuthModalHistory;
};

const makeEnv = () => {
  const calls = [];
  const steps = [];
  const history = {
    pushState(state, _title, url) { calls.push({ op: 'push', state, url }); },
    back() { calls.push({ op: 'back' }); }
  };
  const location = { href: 'https://danjion.pages.dev/index.html' };
  const modal = loadHelper().create({
    history,
    location,
    onStep: (name) => steps.push(name),
    onClose: () => steps.push('closed')
  });
  return { modal, calls, steps };
};

{
  // open pushes exactly one sentinel on the same URL; the first Back closes the modal.
  const { modal, calls, steps } = makeEnv();
  modal.open('entry');
  assert.deepEqual(steps, ['entry'], 'open must render the entry step');
  assert.equal(calls.length, 1, 'open must push exactly one history entry');
  assert.equal(calls[0].op, 'push');
  assert.equal(calls[0].url, 'https://danjion.pages.dev/index.html', 'sentinel must keep the current URL (same-document push)');
  assert.equal(calls[0].state.danjionAuthModal, true, 'sentinel state must carry the modal marker');
  assert.equal(calls[0].state.step, 'entry');
  assert.ok(modal.isOpen() && modal.hasSentinel() && modal.depth() === 0);
  modal.back();
  assert.deepEqual(steps, ['entry', 'closed'], 'Back on the first step must close the modal');
  assert.equal(calls[1].op, 'back', 'closing with an active sentinel must remove it with a single back');
  assert.equal(calls.length, 2, 'closing must never loop history.back()');
  assert.ok(!modal.isOpen() && !modal.hasSentinel());
}
{
  // internal steps never touch window.history; Back unwinds steps first, then closes.
  const { modal, calls, steps } = makeEnv();
  modal.open('entry');
  modal.step('emailSignup');
  modal.step('terms');
  assert.deepEqual(calls.map((c) => c.op), ['push'], 'step transitions must not push browser history');
  assert.equal(modal.depth(), 2);
  modal.back();
  assert.deepEqual(steps, ['entry', 'emailSignup', 'terms', 'emailSignup'], 'Back must unwind one modal step');
  assert.equal(calls.length, 1, 'modal Back-button unwinding keeps the existing sentinel');
  modal.back();
  assert.equal(steps.at(-1), 'entry');
  modal.back();
  assert.equal(steps.at(-1), 'closed', 'Back at the first step closes instead of leaving the page');
  assert.deepEqual(calls.map((c) => c.op), ['push', 'back'], 'close removes the sentinel exactly once');
}
{
  // browser Back (popstate) unwinds the modal and re-arms a fresh sentinel.
  const { modal, calls, steps } = makeEnv();
  modal.open('entry');
  modal.step('terms');
  modal.popState(null); // browser consumed the sentinel entry
  assert.deepEqual(steps, ['entry', 'terms', 'entry'], 'browser Back must return to the previous modal step');
  assert.deepEqual(calls.map((c) => c.op), ['push', 'push'], 'unwinding must re-arm exactly one sentinel');
  assert.ok(modal.isOpen() && modal.hasSentinel());
  modal.popState(null);
  assert.equal(steps.at(-1), 'closed', 'browser Back on the first step closes the modal');
  assert.deepEqual(calls.map((c) => c.op), ['push', 'push'], 'closing via unwind must not add a second back (sentinel already consumed)');
  assert.ok(!modal.isOpen() && !modal.hasSentinel());
}
{
  // forward restoration keeps the trap armed; closed-modal popstate is inert (normal Back).
  const { modal, calls, steps } = makeEnv();
  modal.open('entry');
  modal.popState({ danjionAuthModal: true, step: 'entry' });
  assert.deepEqual(steps, ['entry'], 'restoring the sentinel state must not re-render or unwind');
  assert.ok(modal.hasSentinel());
  modal.close();
  assert.deepEqual(calls.map((c) => c.op), ['push', 'back'], 'X/backdrop close removes the sentinel with one back');
  const before = calls.length;
  modal.popState(null);
  assert.equal(calls.length, before, 'popstate while closed must be inert');
  assert.equal(steps.length, 2, 'inert popstate must not touch the modal');
}
{
  // reopening resets the stack; step/back while closed are no-ops.
  const { modal, calls, steps } = makeEnv();
  modal.step('terms');
  modal.back();
  assert.deepEqual(calls, [], 'closed modal must never touch history');
  assert.deepEqual(steps, [], 'closed modal must not render steps');
  modal.open('entry');
  modal.step('terms');
  modal.open('entry');
  assert.equal(modal.depth(), 0, 'reopen must reset the step stack');
  assert.equal(calls.length, 1, 'reopen on a removed sentinel pushes exactly one entry');
}

/* ================= 2. landing: signed-in controls replace guest auth actions ================= */
assert.ok(index.includes('<button class="login" data-auth="login" data-guest-only>로그인</button>'),
  'header login must be a guest-only control');
assert.ok(index.includes('<button class="signup" data-auth="signup" data-guest-only>가입하기</button>'),
  'header signup must be a guest-only control');
assert.ok(index.includes('<button class="member-profile" data-member="profile" hidden>내정보</button>')
  && index.includes('<button class="member-logout" data-member="logout" hidden>로그아웃</button>'),
  'header must carry hidden signed-in 내정보/로그아웃 controls');
assert.ok(index.includes("let memberMode=serverMode?false:(sessionStorage.getItem('danjionMember')==='1'||sessionStorage.getItem('danjionSignedUp')==='1'),sessionResolved=!serverMode"),
  'production server mode must not bootstrap member state from stale sessionStorage markers');
assert.ok(index.includes("document.querySelectorAll('[data-guest-only]').forEach(el=>el.hidden=!sessionResolved||memberMode)"),
  'guest controls must stay hidden until the production session verdict is resolved');
assert.ok(index.includes("document.querySelectorAll('[data-member]').forEach(el=>el.hidden=!sessionResolved||!memberMode)"),
  'member controls must stay hidden until the production session verdict is resolved');
assert.ok(index.includes('data-home-cta data-auth="signup"'),
  'hero CTA must be the auth-aware home CTA');
assert.ok(index.includes(`homeCta.textContent=memberMode?'단지온 홈으로':'가입하고 시작하기 →'`),
  'hero CTA must read 단지온 홈으로 when signed in and 가입하고 시작하기 → when signed out');
assert.match(index, /if\(memberMode\)\{location\.href='04_데일리홈\.html';return\}\s*\n\s*mode=button\.dataset\.auth;openLayer\(\);authModal\.open\('entry'\)/,
  'signed-in CTA taps must route to the daily home; signed-out taps keep the auth modal');
assert.ok(index.includes(`el.textContent=memberMode?'단지온 홈으로':'단지온 시작하기 →'`),
  'greeting/chair CTAs must switch to 단지온 홈으로 when signed in');
assert.ok(index.includes(`profile.textContent=sessionUserName?sessionUserName+'님 · 내정보':'내정보'`),
  '내정보 must surface the session user name captured from get-session');
assert.ok(index.includes("typeof __session.visibleAccountIdentity==='function'?__session.visibleAccountIdentity(user,null).slice(0,24):''"),
  'landing member identity must use the shared role-label-safe session identity helper');
assert.ok(index.includes('captureSessionUser(r);return __session.nativeSessionReady(r)'),
  'serverSessionCheck must capture the user while keeping the nativeSessionReady verdict');
assert.ok(index.includes(`if(button.dataset.member==='logout')danjionSignOut();else location.href='19_내정보_메인.html'`),
  '내정보 routes to the member home; 로그아웃 runs sign-out');
assert.ok(index.includes(`if(el.matches('[data-auth],[data-member],`),
  'the landing router must pass member controls through to the inline handlers');
assert.ok(index.includes(`if(sessionStorage.getItem('danjionMember')!=='1')sessionStorage.setItem('danjionGuest','1')`),
  'signed-in home entries must not be flagged as guest visits');

/* ================= 3. real same-origin Better Auth sign-out ================= */
assert.ok(index.includes(`__session.joinUrl(__session.danjionAuthBase(),'/api/auth/sign-out')`),
  'sign-out must go through the same-origin auth facade base');
assert.ok(!index.includes(`danjionApiBase(),'/api/auth/sign-out'`),
  'sign-out must never bind the Worker API base directly');
assert.ok(!index.includes('padiem-danjion-api-production'),
  'the landing entry must not hardcode the Worker origin');
assert.match(index, /const r=await __session\.request\(fetch,__session\.joinUrl\(__session\.danjionAuthBase\(\),'\/api\/auth\/sign-out'\),\{method:'POST',body:JSON\.stringify\(\{\}\)\}\);if\(!r\.ok\)\{showToast\('로그아웃에 실패했습니다[^)]*\);\s*return\}\}finishDanjionLogout\(\)/,
  'a failed sign-out must keep the signed-in state; only success clears it');
assert.ok(index.includes(`danjionAuthBase(),'/api/auth/sign-out'),{method:'POST',body:JSON.stringify({})}`),
  'sign-out must be a POST carrying the Better Auth empty JSON object body');
assert.ok(index.includes(`['danjionMember','danjionSignedUp','danjionAuthPending','danjionGuest','danjionPrototypeProvider'].forEach(key=>sessionStorage.removeItem(key));sessionUserName='';memberMode=false;sessionResolved=true;syncMemberState()`),
  'logout must clear member markers, resolve the guest state, and resync the landing');
assert.ok(index.includes(`showToast('로그아웃되었습니다.')`), 'logout success must be announced');

/* ================= 4. one-time login-success toast after the OAuth round trip ================= */
assert.ok(index.includes(`q.set('requestSignUp','1');sessionStorage.setItem('danjionAuthPending','1');location.href=__session.joinUrl(__session.danjionAuthBase(),'/auth/social-start')`),
  'social start must arm the one-time pending marker before leaving the page');
assert.match(index, /if\(sessionStorage\.getItem\('danjionAuthPending'\)==='1'\)\{\s*sessionStorage\.removeItem\('danjionAuthPending'\);\s*showToast\('로그인되었습니다\.'\);?\s*\}/,
  'the confirmed session must consume the marker once and toast 로그인되었습니다.');
assert.match(index, /sessionStorage\.removeItem\('danjionMember'\);\s*sessionStorage\.removeItem\('danjionSignedUp'\);\s*sessionStorage\.removeItem\('danjionAuthPending'\)/,
  'a rejected session check must drop the stale pending marker too');
assert.match(index, /memberMode=real;sessionResolved=true;syncMemberState\(\)/,
  'the startup auth UI must become visible only after the server session verdict resolves');
assert.ok(index.includes(`sessionStorage.removeItem('danjionAuthPending');syncMemberState();showToast('로그인되었습니다.');location.replace('04_데일리홈.html')`),
  'direct email login must announce success and enter the authenticated Daily Home instead of the chair intro');

/* ================= 5. modal history wiring + window.history shadowing fix ================= */
assert.ok(index.includes('<script src="assets/auth-modal-history.js"></script>'),
  'the landing must load the modal history helper before the inline script');
assert.ok(index.indexOf('assets/auth-modal-history.js') < index.indexOf('const authModal=window.DanjionAuthModalHistory.create'),
  'helper must load before the inline script instantiates it');
assert.ok(index.includes('window.DanjionAuthModalHistory.create({history:window.history,location,'),
  'the modal trap must bind the real window.history (no shadowed local array)');
assert.ok(index.includes("window.addEventListener('popstate',event=>authModal.popState(event.state))"),
  'browser Back must flow through the modal history trap');
assert.ok(index.includes("document.querySelector('.modal-close').addEventListener('click',()=>authModal.close())"),
  'X must close through the modal history helper');
assert.ok(index.includes('if(event.target===layer)authModal.close()'),
  'backdrop click must close through the modal history helper');
assert.ok(index.includes('backButton.addEventListener(\'click\',()=>authModal.back())'),
  'the in-modal Back button and browser Back must share one transition path');
assert.ok(index.includes('function openChair(){authModal.close();'),
  'entering the chair gate must remove the modal sentinel');
assert.ok(index.includes('button.dataset.finish!==undefined){authModal.close();'),
  'the signup finish action must remove the modal sentinel');
assert.doesNotMatch(index, /let [^;\n]*\bhistory=\[\]/,
  'the landing script must not shadow window.history with a local history array (#444 bug fix)');
assert.ok(index.includes('if(history.length>1) history.back();'),
  'the router backFallback must keep its window.history semantics (now unshadowed)');

/* ================= 6. preserved #444 auth-cutover invariants ================= */
assert.equal(index.match(/danjionApiBase\(\)/g).length, 1,
  'the serverMode gate must stay the only danjionApiBase() use in the entry');
assert.match(index, /serverMode=!!__session&&__session\.danjionApiBase\(\)!==''/);
assert.ok(index.includes(`__session.joinUrl(__session.danjionAuthBase(),'/api/auth/sign-in/email')`));
assert.ok(index.includes(`__session.joinUrl(__session.danjionAuthBase(),'/api/auth/sign-up/email')`));
assert.ok(index.includes(`__session.joinUrl(__session.danjionAuthBase(),'/api/auth/forget-password')`));
assert.match(index, /return __session\.nativeSessionReady\(r\)/);
assert.match(index, /q\.set\('requestSignUp','1'\)/);
assert.match(index, /const q=new URLSearchParams\(\{provider,callbackURL:location\.origin\+location\.pathname\}\)/);

/* ================= 7. the helper asset stays out of the auth bridge boundary ================= */
assert.ok(!helper.includes('/api/auth') && !helper.includes('/auth/social-start'),
  'auth-modal-history.js must never carry Better Auth endpoint traffic');
assert.ok(!helper.includes('danjionApiBase'),
  'auth-modal-history.js must not resolve any API base');

console.log('leaf-b14-post-auth-landing-history-ux-contract: PASS');
