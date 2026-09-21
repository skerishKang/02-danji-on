import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

/*
 * #868 — Temporary Resident Access mode (frontend surfaces).
 *
 * While the authoritative Unit Master / household-code issuance is not ready,
 * the server admits SIGNED-IN ordinary members to the general resident surfaces
 * and answers the self exemption probe with the ADDITIVE
 * `{ exempt: true, temporary: true }`.
 *
 * The three audited surfaces must therefore:
 *   1. surface the additive `temporary` key WITHOUT breaking the existing
 *      `exempt` boolean contract (an absent key always means "not temporary")
 *   2. never present a temporary admission as "주민인증 완료" — the state is
 *      "임시 주민 이용 중" (My Info) and a plain notice (Home / 우리집연결)
 *   3. never render the OPERATOR copy for a temporary admission, and never
 *      fabricate a household/unit for it
 *
 * Run: node frontend/tests/leaf-868-temporary-resident-access-contract.mjs
 */

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const [sessionSrc, authoritySrc, residentSrc, f04, f19, f26] = await Promise.all([
  read('../assets/danjion-session.js'),
  read('../assets/danjion-admin-authority.js'),
  read('../assets/resident-bridge.js'),
  read('../04_데일리홈.html'),
  read('../19_내정보_메인.html'),
  read('../26_우리집연결.html')
]);

const TEMP_STATE_COPY = '임시 주민 이용 중';
const TEMP_NOTICE_TITLE = '임시 주민 이용 안내';
const TEMP_NOTICE_BODY = '현재 로그인 회원은 임시로 주민 기능을 이용할 수 있습니다.';
const TEMP_NOTICE_DETAIL = '세대정보와 인증코드 발급이 준비되면 정식 주민인증을 진행합니다.';
const EXEMPT_COPY = '운영자 계정 · 주민인증 불필요';
const EXEMPT_TITLE = '운영자 계정';
const EXEMPT_NOTICE_COPY = '우리집 연결 및 주민확인이 필요하지 않습니다.';
const VERIFIED_CLAIM = '주민인증 완료';

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, headers: { get: () => null } };
}

/* ============ 1. the additive flag never breaks the `exempt` contract ====== */
{
  function loadAuthority() {
    const ctx = {
      location: { hostname: 'danjion.pages.dev', search: '', origin: 'https://danjion.pages.dev' },
      URL,
      URLSearchParams,
      console
    };
    vm.createContext(ctx);
    vm.runInContext(sessionSrc, ctx);
    vm.runInContext(authoritySrc, ctx);
    return ctx.DanjionAdminAuthority;
  }

  const probe = (answer) => {
    const A = loadAuthority();
    return A.fetchResidentVerificationExemption(
      async () => answer(),
      { apiBase: 'https://api.example' }
    );
  };

  const temporary = await probe(() => response(200, { data: { exempt: true, temporary: true } }));
  assert.equal(temporary.state, 'ready', 'the temporary answer is a ready answer');
  assert.equal(temporary.exempt, true, 'the existing exempt boolean keeps its meaning');
  assert.equal(temporary.temporary, true, 'the additive temporary key must be surfaced');

  const operator = await probe(() => response(200, { data: { exempt: true } }));
  assert.equal(operator.state, 'ready');
  assert.equal(operator.exempt, true);
  assert.equal(operator.temporary, undefined, 'an absent temporary key must mean NOT temporary');

  const ordinary = await probe(() => response(200, { data: { exempt: false } }));
  assert.equal(ordinary.state, 'ready');
  assert.equal(ordinary.exempt, false);
  assert.equal(ordinary.temporary, undefined);

  // Only the literal boolean true may mark a temporary admission.
  for (const value of ['true', 1, 'yes', null, {}]) {
    const loose = await probe(() => response(200, { data: { exempt: true, temporary: value } }));
    assert.equal(loose.temporary, undefined,
      `only the literal true marks a temporary admission; ${JSON.stringify(value)} must not`);
  }

  // Cross-realm objects: compare fields, never the prototype identity.
  const malformed = await probe(() => response(200, { data: { exempt: 'yes', temporary: true } }));
  assert.equal(malformed.state, 'invalid', 'a malformed exempt payload stays invalid');
  assert.equal(malformed.exempt, false, 'the temporary key never rescues a malformed exempt payload');

  const signedOut = await probe(() => response(401, { error: { code: 'AUTH_REQUIRED' } }));
  assert.equal(signedOut.state, 'signed-out', 'signed-out must never resolve an exemption');
  assert.equal(signedOut.exempt, false);
  assert.equal(signedOut.temporary, undefined);

  const denied = await probe(() => response(503, { error: { code: 'RESIDENT_VERIFICATION_EXEMPTION_DB_ERROR' } }));
  assert.equal(denied.state, 'error', 'a failing probe must fail toward the ordinary resident flow');
  assert.equal(denied.exempt, false);
  assert.equal(denied.temporary, undefined);
}

/* ============ 2. My Info renders the temporary state, never "완료" ========= */
const wiringStart = f19.indexOf('<script id="danjion-myinfo-server-wiring">');
assert.ok(wiringStart > -1, 'f19 must keep the myinfo server wiring script');
const myInfoWiring = f19
  .slice(wiringStart, f19.indexOf('</script>', wiringStart))
  .replace(/^\s*<script[^>]*>\s*/, '');

function makeMyInfoHarness(exemptionAnswer) {
  const calls = [];
  const nodes = new Map();
  const doc = {
    readyState: 'loading',
    addEventListener() {},
    getElementById(id) {
      if (!nodes.has(id)) {
        nodes.set(id, {
          textContent: '', hidden: true, className: '', value: '', disabled: false, attributes: {},
          focus() {}, addEventListener() {},
          setAttribute(name, value) { this.attributes[name] = String(value); },
          removeAttribute(name) { delete this.attributes[name]; }
        });
      }
      return nodes.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, classList: { add() {} }, dataset: {}, append() {}, appendChild() {}, addEventListener() {}, setAttribute() {} }; },
    head: { appendChild() {} }
  };
  const ctx = {
    URL,
    URLSearchParams,
    console,
    document: doc,
    location: { hostname: 'danjion.pages.dev', pathname: '/19_내정보_메인.html', search: '', origin: 'https://danjion.pages.dev' },
    fetch: async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/api/v1/me/resident-verification-exemption')) return exemptionAnswer();
      if (u.includes('/api/auth/get-session')) {
        return response(200, { session: { id: 'sess-1' }, user: { name: '이웃주민', email: 'signed-in@example.invalid', emailVerified: true, createdAt: '2026-01-15T00:00:00Z' } });
      }
      if (u.includes('/api/v1/me/profile')) return response(200, { data: { nickname: '이웃별명', publicBio: '소개', joinedMonth: '2026-08' } });
      if (u.includes('/api/v1/me/summary')) return response(200, { data: { postCount: 1, commentCount: 2, receivedReactionCount: 3, savedBusinessCount: 4, unreadMessageCount: 0, household: { status: 'exempt' } } });
      return response(404, { error: { code: 'NOT_FOUND' } });
    }
  };
  vm.createContext(ctx);
  vm.runInContext(sessionSrc, ctx);
  vm.runInContext(residentSrc, ctx);
  vm.runInContext(authoritySrc, ctx);
  vm.runInContext(myInfoWiring, ctx);
  const drain = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
  return { calls, nodes, drain };
}

{
  const h = makeMyInfoHarness(() => response(200, { data: { exempt: true, temporary: true } }));
  await h.drain();
  assert.equal(h.nodes.get('mi-resident-state').textContent, TEMP_STATE_COPY,
    'My Info must show the temporary state, not the operator state');
  assert.ok(h.nodes.get('mi-resident-row').className.includes('is-temporary'),
    'the temporary state must carry its own kind');
  assert.ok(!h.nodes.get('mi-resident-row').className.includes('is-exempt'),
    'a temporary admission must never render as an exempt operator');
  assert.notEqual(h.nodes.get('mi-resident-state').textContent, VERIFIED_CLAIM,
    'a temporary admission must never claim resident verification completed');
  assert.notEqual(h.nodes.get('mi-resident-state').textContent, EXEMPT_COPY,
    'a temporary admission must never claim the operator exemption');
  assert.equal(h.nodes.get('mi-resident-cta').hidden, true, 'the household CTA must stay hidden');
  assert.equal(h.nodes.get('mi-profile-edit').hidden, false, 'self-profile editing stays available');
  assert.ok(!h.calls.some((u) => u.includes('/api/v1/me/summary')),
    'the temporary branch must stay off resident summary/household surfaces');
}

{
  const h = makeMyInfoHarness(() => response(200, { data: { exempt: true } }));
  await h.drain();
  assert.equal(h.nodes.get('mi-resident-state').textContent, EXEMPT_COPY,
    'the canonical operator exemption copy must be unchanged');
  assert.ok(h.nodes.get('mi-resident-row').className.includes('is-exempt'),
    'the canonical operator exemption kind must be unchanged');
  assert.ok(!h.nodes.get('mi-resident-row').className.includes('is-temporary'),
    'the canonical operator exemption is not temporary');
}

{
  // The truthful verified state must still exist for real verified residents.
  assert.ok(myInfoWiring.includes(`'${VERIFIED_CLAIM}'`),
    'the verified resident copy must survive — the temporary state is additive, not a replacement');
  const exemptFn = myInfoWiring.slice(
    myInfoWiring.indexOf('function loadExemptIdentity'),
    myInfoWiring.indexOf('function resolveResidentExemption')
  );
  assert.ok(exemptFn.includes('residentExemption.temporary===true'),
    'the exempt branch must consult the temporary flag');
  assert.ok(exemptFn.includes(`'${TEMP_STATE_COPY}'`), 'the temporary state copy must ship exactly');
  assert.ok(!exemptFn.includes(VERIFIED_CLAIM), 'the temporary branch must never render the verified copy');
  assert.ok(/if\(exempt\)\{loadExemptIdentity\(identity\.user\);return;\}/.test(myInfoWiring),
    'the authenticated exempt/temporary branch must still return before ordinary resident fetches');
}

/* ============ 3. 우리집연결 shows a temporary notice, not the operator one === */
{
  assert.ok(f26.includes('id="tempView"'), 'f26 must carry a dedicated temporary notice view');
  const tempViewMarkup = /id="tempView"[\s\S]*?<\/div>\s*<div class="privacy">/.exec(f26);
  assert.ok(tempViewMarkup, 'the temporary notice view must be locatable');
  const markup = tempViewMarkup[0];
  assert.ok(markup.includes(TEMP_NOTICE_TITLE), 'the temporary notice kicker must ship exactly');
  assert.ok(markup.includes('현재는 임시 주민 이용 기간입니다.'), 'the temporary notice headline must ship exactly');
  assert.ok(markup.includes('정식 주민인증을 다시 진행해 주세요'), 'the temporary notice must state the cutover');
  assert.ok(!markup.includes(VERIFIED_CLAIM), 'the temporary notice must never claim verification completed');
  assert.ok(!markup.includes(EXEMPT_NOTICE_COPY), 'the temporary notice must never reuse the operator copy');
  assert.ok(!/<select|<option|connectButton|buildingSelect|unitSelect/.test(markup),
    'a temporary admission has no household: the notice must offer no 동·호 selection');

  // The canonical operator view stays exactly as it was.
  assert.ok(f26.includes(`'${EXEMPT_TITLE}'`), 'the operator title must still ship exactly');
  assert.ok(f26.includes(`'${EXEMPT_NOTICE_COPY}'`), 'the operator copy must still ship exactly');

  const showExemptFn = f26.slice(f26.indexOf('function showExempt()'), f26.indexOf('function showResult'));
  assert.ok(showExemptFn.includes('exemption.temporary===true'),
    'showExempt must dispatch a temporary admission away from the operator copy');
  assert.ok(showExemptFn.includes('showTemporary()'), 'the temporary admission must reach its own view');
  assert.ok(showExemptFn.includes('exemptView.hidden=false'),
    'the canonical operator view must still be revealed for a real exemption');
  assert.ok(!showExemptFn.includes('onboarding.hidden=false'),
    'neither branch may open the household onboarding picker');

  const showTemporaryFn = f26.slice(f26.indexOf('function showTemporary()'));
  assert.ok(showTemporaryFn.slice(0, 600).includes('tempView.hidden=false'),
    'showTemporary must reveal the temporary notice');
  assert.ok(showTemporaryFn.slice(0, 600).includes('exemptView.hidden=true'),
    'the temporary notice must clear the operator view so neither state is sticky');
  assert.ok(showTemporaryFn.slice(0, 600).includes('onboarding.hidden=true'),
    'the temporary notice must not open the household onboarding picker');

  const resolveExemptFn = f26.slice(f26.indexOf('async function resolveExempt()'), f26.indexOf('async function boot()'));
  assert.ok(resolveExemptFn.includes('temporary:ready&&result.temporary===true'),
    'resolveExempt must record the additive temporary flag');
  assert.ok(/if\(await resolveExempt\(\)\)\{showExempt\(\);return\}/.test(f26),
    'the exemption must still return before any household read');

  for (const fnName of ['showSignedOut', 'showError', 'showResult']) {
    const at = f26.indexOf(`function ${fnName}`);
    assert.ok(at > -1, `${fnName} must exist`);
    assert.ok(f26.slice(at, at + 400).includes('tempView.hidden=true'),
      `${fnName} must clear the temporary notice so it is never sticky`);
  }
  assert.ok(!/exempt/i.test(await read('../assets/household-claim-bridge.js')),
    'the household-claim bridge must know nothing about temporary access');
}

/* ============ 4. Home reveals one bounded notice, only on a server answer === */
const noticeWiringStart = f04.indexOf('<script id="temp-resident-access-notice-wiring-20260921">');
assert.ok(noticeWiringStart > -1, 'f04 must carry the temporary notice wiring script');
const noticeWiring = f04
  .slice(noticeWiringStart, f04.indexOf('</script>', noticeWiringStart))
  .replace(/^\s*<script[^>]*>\s*/, '');

{
  assert.ok(f04.includes('id="tempResidentNotice"'), 'the home notice node must exist');
  assert.ok(/id="tempResidentNotice"[^>]*\shidden/.test(f04),
    'the home notice must default to hidden (no fabricated state before a server answer)');
  assert.ok(f04.includes(TEMP_NOTICE_TITLE) && f04.includes(TEMP_NOTICE_BODY) && f04.includes(TEMP_NOTICE_DETAIL),
    'the representative notice copy must ship exactly');
  assert.ok(f04.indexOf('assets/danjion-session.js') < f04.indexOf('assets/danjion-admin-authority.js'),
    'the authority module must load after the session runtime');
  assert.ok(f04.indexOf('assets/danjion-admin-authority.js') < noticeWiringStart,
    'the frozen authority module must be ready before the notice wiring runs');

  for (const banned of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'innerHTML']) {
    assert.ok(!noticeWiring.includes(banned), `the notice wiring must never use ${banned}`);
  }
  assert.ok(noticeWiring.includes('AA.fetchResidentVerificationExemption(fetch.bind(globalThis))'),
    'the home notice must resolve through the frozen self probe');
  assert.ok(!noticeWiring.includes('AA.fetchAuthority'),
    'the home notice must never use the audited admin authority endpoint');
  assert.ok(/if\(result\.exempt===true&&result\.temporary===true\)box\.hidden=false;/.test(noticeWiring),
    'only an exactly-temporary server answer may reveal the notice');
  assert.ok(/if\(!result\|\|result\.state!=='ready'\)return;/.test(noticeWiring),
    'every non-ready answer (signed-out, error, unbound, invalid) must keep the notice hidden');
  assert.ok(!noticeWiring.includes(VERIFIED_CLAIM), 'the home notice must never claim verification completed');
}

function makeHomeHarness(probeAnswer) {
  const calls = [];
  const nodes = new Map();
  const doc = {
    readyState: 'loading',
    addEventListener() {},
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { textContent: '', hidden: true, className: '', value: '', disabled: false, focus() {}, addEventListener() {}, setAttribute() {}, removeAttribute() {} });
      return nodes.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, classList: { add() {} }, dataset: {}, append() {}, appendChild() {}, addEventListener() {}, setAttribute() {} }; },
    head: { appendChild() {} }
  };
  const ctx = {
    URL,
    URLSearchParams,
    console,
    document: doc,
    location: { hostname: 'danjion.pages.dev', pathname: '/04_데일리홈.html', search: '', origin: 'https://danjion.pages.dev' },
    fetch: async (url) => {
      calls.push(String(url));
      return probeAnswer();
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(sessionSrc, ctx);
  vm.runInContext(authoritySrc, ctx);
  vm.runInContext(noticeWiring, ctx);
  const drain = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
  return { calls, nodes, drain };
}

{
  const h = makeHomeHarness(() => response(200, { data: { exempt: true, temporary: true } }));
  await h.drain();
  assert.ok(h.calls.some((u) => u.includes('/api/v1/me/resident-verification-exemption')),
    'the notice must be driven by the canonical self probe');
  assert.equal(h.nodes.get('tempResidentNotice').hidden, false,
    'a temporary admission must reveal the home notice');
}

for (const [label, answer] of [
  ['canonical operator exemption', () => response(200, { data: { exempt: true } })],
  ['ordinary resident', () => response(200, { data: { exempt: false } })],
  ['signed-out', () => response(401, { error: { code: 'AUTH_REQUIRED' } })],
  ['probe failure', () => response(503, { error: { code: 'RESIDENT_VERIFICATION_EXEMPTION_DB_ERROR' } })]
]) {
  const h = makeHomeHarness(answer);
  await h.drain();
  assert.equal(h.nodes.get('tempResidentNotice').hidden, true,
    `the home notice must stay hidden for ${label}`);
}

console.log('TEMPORARY_PROBE_ADDITIVE_KEY=PASS');
console.log('MYINFO_TEMPORARY_STATE=PASS');
console.log('HOUSEHOLD_TEMPORARY_NOTICE=PASS');
console.log('HOME_TEMPORARY_NOTICE=PASS');
console.log('PASS #868 temporary resident access frontend contract');
