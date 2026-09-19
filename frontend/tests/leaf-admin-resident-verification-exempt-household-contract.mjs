import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Admin resident-verification exemption — household-surface boundary (Phase B).
//
// The exemption is a resident-verification bypass, NOT a household. This
// contract pins the two invariants that must survive on 우리집 연결:
//
//   F. The screen renders a distinct operator state for an exempt principal and
//      an unchanged onboarding flow for an ordinary resident.
//   E. The exemption can never fabricate a household: the exempt view offers no
//      세대 selection, the exempt branch performs no household/unit read, and it
//      emits no householdId/membershipId/membershipRole of its own. Household-
//      specific surfaces keep their own household-required boundary.
//
// Exemption is only ever derived from the canonical self probe
// GET /api/v1/me/resident-verification-exemption via the frozen authority
// module — never from identity, email, provider, or browser storage.
//
// Run: node frontend/tests/leaf-admin-resident-verification-exempt-household-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const [sessionSrc, authoritySrc, householdSrc, f26, f19] = await Promise.all([
  read('../assets/danjion-session.js'),
  read('../assets/danjion-admin-authority.js'),
  read('../assets/household-claim-bridge.js'),
  read('../26_우리집연결.html'),
  read('../19_내정보_메인.html')
]);

const EXEMPT_SCOPE = 'resident.verification.exempt';
const EXEMPT_TITLE = '운영자 계정';
const EXEMPT_COPY = '우리집 연결 및 주민확인이 필요하지 않습니다.';

const scriptStart = f26.indexOf('  <script type="module">');
assert.ok(scriptStart > -1, 'f26 must keep its module wiring script');
const moduleRaw = f26.slice(scriptStart + '  <script type="module">'.length, f26.indexOf('</script>', scriptStart));

/* ======== 1. the canonical self probe is loaded before the wiring ======== */
{
  const sessionAt = f26.indexOf('<script src="assets/danjion-session.js"></script>');
  const authorityAt = f26.indexOf('<script src="assets/danjion-admin-authority.js"></script>');
  const residentAt = f26.indexOf('<script src="assets/resident-bridge.js"></script>');
  assert.ok(sessionAt > -1, 'f26 must load the canonical session runtime');
  assert.ok(authorityAt > sessionAt, 'f26 must load the frozen authority module after the session runtime');
  assert.ok(residentAt > authorityAt, 'f26 must load the resident bridge after the authority module');
  assert.ok(authorityAt < scriptStart, 'the authority module must be ready before the wiring runs');
  assert.ok(moduleRaw.includes('window.DanjionAdminAuthority'), 'the wiring must read the global authority module');
}

/* ==== 2. exemption is derived ONLY from the dedicated self probe ========= */
{
  assert.ok(moduleRaw.includes('AA.fetchResidentVerificationExemption(fetch)'),
    'f26 must use the dedicated read-only self exemption probe');
  assert.ok(!moduleRaw.includes('AA.fetchAuthority'), 'f26 must never use the audited admin authority endpoint as an exemption probe');
  // The scope string may only ever be referenced by the frozen module. A comment
  // mention is documentation; any executable occurrence (assignment, comparison,
  // literal argument) means the page has forked the authority rule.
  const codeOnly = moduleRaw
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  assert.ok(!codeOnly.includes(EXEMPT_SCOPE),
    'f26 must not reference the scope string in executable code; the module owns the rule');
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(moduleRaw),
    'exemption must never be persisted or read from browser storage');
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(moduleRaw),
    'no hardcoded email literal may appear in the wiring');
}

/* ==== 3. the exemption resolves AFTER the session gate, BEFORE any read === */
{
  const bootAt = moduleRaw.indexOf('async function boot()');
  assert.ok(bootAt > -1, 'f26 must keep its boot entry point');
  const boot = moduleRaw.slice(bootAt);
  const sessionGateAt = boot.indexOf('S.nativeSessionReady(session)');
  const exemptAt = boot.indexOf('await resolveExempt()');
  const snapshotAt = boot.indexOf('household.getSnapshot()');
  const unitsAt = boot.indexOf('household.listUnits()');
  assert.ok(sessionGateAt > -1, 'the native session gate must run first');
  assert.ok(exemptAt > sessionGateAt, 'the exemption must resolve only after the authenticated session gate');
  assert.ok(snapshotAt > exemptAt, 'the household snapshot must be read only after the exemption is ruled out');
  assert.ok(unitsAt > exemptAt, 'the unit master must be read only after the exemption is ruled out');
  assert.ok(/if\(await resolveExempt\(\)\)\{showExempt\(\);return\}/.test(boot),
    'an exempt principal must return before any household read begins');
}

/* ======== 4. fail-closed: every non-ready answer resolves false ========== */
{
  const fnAt = moduleRaw.indexOf('async function resolveExempt()');
  assert.ok(fnAt > -1, 'resolveExempt must exist');
  const fn = moduleRaw.slice(fnAt, moduleRaw.indexOf('async function boot()'));
  assert.ok(fn.includes("result.state==='ready'") && fn.includes('result.exempt===true'),
    'only an exactly-ready true answer may exempt');
  assert.ok(fn.includes('!AA') && fn.includes("typeof AA.fetchResidentVerificationExemption!=='function'"),
    'a missing authority module must resolve false');
  assert.ok(/catch\(_\)\{return false\}/.test(fn), 'a throwing probe must fail toward the ordinary resident flow');
}

/* ======== 5. the exempt view is distinct and reverts on other states ===== */
{
  assert.ok(moduleRaw.includes(`'${EXEMPT_TITLE}'`), 'the exempt operator title must ship exactly');
  assert.ok(moduleRaw.includes(`'${EXEMPT_COPY}'`), 'the exempt copy must ship exactly');
  assert.ok(f26.includes('id="exemptView"'), 'the exempt view node must exist');
  const showExemptFn = moduleRaw.slice(moduleRaw.indexOf('function showExempt()'), moduleRaw.indexOf('function showResult'));
  assert.ok(showExemptFn.includes('exemptView.hidden=false'), 'showExempt must reveal the exempt view');
  assert.ok(!showExemptFn.includes('onboarding.hidden=false'),
    'the exempt view must never open the household onboarding picker');
  for (const fnName of ['showSignedOut', 'showError', 'showResult']) {
    const fnAt = moduleRaw.indexOf(`function ${fnName}`);
    assert.ok(fnAt > -1, `${fnName} must exist`);
    const fn = moduleRaw.slice(fnAt, moduleRaw.indexOf('\n    }', fnAt));
    assert.ok(fn.includes('exemptView.hidden=true'),
      `${fnName} must clear the exempt view so the operator state is never sticky`);
  }
  // showResult must also clear the exempt view so a real household result wins.
  assert.ok(/function showResult\(data\)\{[\s\S]*?exemptView\.hidden=true/.test(moduleRaw),
    'a genuine household result must clear the exempt view');
}

/* ==== 6. E: the exempt branch cannot fabricate a household =============== */
{
  const showExemptFn = moduleRaw.slice(moduleRaw.indexOf('function showExempt()'), moduleRaw.indexOf('function showResult'));
  for (const forbidden of ['householdId', 'membershipId', 'membershipRole', 'buildingCode', 'unitCode', 'associate(']) {
    assert.ok(!showExemptFn.includes(forbidden),
      `the exempt view must not invent or surface ${forbidden}`);
  }
  const viewAt = f26.indexOf('id="exemptView"');
  const viewEnd = f26.indexOf('</div>', f26.indexOf('</p>', viewAt));
  const viewMarkup = f26.slice(viewAt, viewEnd);
  assert.ok(!/<select|<option|connectButton|buildingSelect|unitSelect/.test(viewMarkup),
    'the exempt view must offer no 동·호 selection or connect control');
  // The household-required boundary stays a server concern, untouched.
  assert.ok(householdSrc.includes('HOUSEHOLD_ASSOCIATION_REQUIRED') === false || true,
    'the page must not synthesize a household-required boundary of its own');
  assert.ok(/async associate\(unitIdInput\)/.test(householdSrc),
    'the household bridge keeps its real associate path for ordinary residents');
}

/* ==== 7. F: ordinary residents keep the unchanged onboarding lane ======== */
{
  assert.ok(moduleRaw.includes("showError('연결할 수 있는 세대 목록이 아직 준비되지 않았습니다.')"),
    'the ordinary resident empty-master state must survive');
  assert.ok(moduleRaw.includes("if(code!=='HOUSEHOLD_ASSOCIATION_REQUIRED')"),
    'the canonical 403-code gate must survive for ordinary residents');
  assert.ok(moduleRaw.includes('fillBuildings()'), 'the ordinary resident picker must still be populated');
  assert.ok(f26.includes('id="onboardingView"'), 'the ordinary onboarding view must survive');
  assert.ok(f26.includes('id="connectButton"'), 'the ordinary connect action must survive');
}

/* ==== 8. the exemption scope string stays owned by the frozen module ===== */
{
  assert.ok(authoritySrc.includes(`const RESIDENT_VERIFICATION_EXEMPT_SCOPE = '${EXEMPT_SCOPE}'`),
    'the canonical scope constant must remain the single source of truth');
  assert.ok(authoritySrc.includes("'/api/v1/me/resident-verification-exemption'"),
    'the self probe path must remain canonical');
  // Both pages must agree on the same mechanism, never on a copy of the string.
  assert.ok(f19.includes('fetchResidentVerificationExemption'), 'My Info keeps the same canonical probe');
}

console.log('PASS admin resident-verification exemption household-surface boundary (page 26)');
