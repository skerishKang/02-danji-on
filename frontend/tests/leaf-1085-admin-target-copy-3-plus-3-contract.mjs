// #1085: the SUPER-only `사용자 · 권한 관리` screen must describe the CURRENT
// owner-authorized administrator composition (TOTAL=6: SUPER 3 + OPERATIONAL
// 3, of which real-operation accounts are 2+2 and QA test principals are 1+1),
// not the historical #464 four-principal (2+2) provisioning milestone.
//
// Stale source copy replaced:
//   `목표 구성은 최고관리자 2계정 + 운영관리자 2계정`        (intro)
//   `활성 최고관리자 N / 목표 2` / `활성 운영관리자 N / 목표 2` (summary)
//   `사전 등록된 관리자 4계정…`                              (privileged entry card)
//
// This is a presentation/copy fix ONLY. Principals, grants, roles, wildcards,
// scopes and runtime linkage are untouched; the tests below perform no
// mutation (the behavioural part only evaluates the pure consoleSections /
// normalizeAuthority predicates). Historical context: #464 (2+2 provisioning,
// CLOSED) and #694 (QA test principals, CLOSED — the 2 test accounts are part
// of the current 6).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const adminPage = await read('../admin/index.html');
const consoleSrc = await read('../assets/danjion-admin-console.js');
const authoritySrc = await read('../assets/danjion-admin-authority.js');

// ===========================================================================
// A. the stale 2+2 target copy must be gone entirely.
// ===========================================================================
assert.ok(
  !adminPage.includes('목표 구성은 최고관리자 2계정 + 운영관리자 2계정'),
  'A: the historical four-principal target sentence must be removed',
);
assert.ok(!adminPage.includes('2계정'), 'A: no "2계정" target phrasing may remain anywhere in the admin console');
assert.ok(
  !adminPage.includes('사전 등록된 관리자 4계정'),
  'A: the privileged entry card must not restate the historical 4-account total',
);

// ===========================================================================
// B. the principal summary must use the current composition goal (3), not the
// hard-coded 2.
// ===========================================================================
assert.ok(!adminPage.includes('/ 목표 2'), 'B: no "/ 목표 2" summary goal may remain');
assert.ok(
  adminPage.includes("el('span','활성 최고관리자 '+superCount+' / 구성 3')"),
  'B: the SUPER summary must read 활성 최고관리자 N / 구성 3',
);
assert.ok(
  adminPage.includes("el('span','활성 운영관리자 '+operatorCount+' / 구성 3')"),
  'B: the OPERATIONAL summary must read 활성 운영관리자 N / 구성 3',
);

// ===========================================================================
// C+D. the new copy must state the 3+3 total composition AND the exact
// real-operation (2+2) / test (1+1) split, with consistent arithmetic, and no
// account identifiers.
// ===========================================================================
const compositionSentence = '현재 관리자 구성은 최고관리자 3명 + 운영관리자 3명입니다.';
const splitSentence = '실운영 계정은 최고관리자 2명 · 운영관리자 2명, 테스트 계정은 최고관리자 1명 · 운영관리자 1명입니다.';
assert.ok(adminPage.includes(compositionSentence), 'C: the total 3+3 composition must be stated');
assert.ok(adminPage.includes(splitSentence), 'D: the real-operation 2+2 / test 1+1 split must be stated');

{
  // Light-weight arithmetic proof straight from the shipped sentences:
  const num = (re) => {
    const m = re.exec(adminPage);
    assert.ok(m, 'expected sentence fragment ' + re);
    return Number(m[1]);
  };
  const superTotal = num(/현재 관리자 구성은 최고관리자 (\d+)명 \+ 운영관리자/);
  const operatorTotal = num(/최고관리자 \d+명 \+ 운영관리자 (\d+)명입니다/);
  const superReal = num(/실운영 계정은 최고관리자 (\d+)명/);
  const operatorReal = num(/운영관리자 (\d+)명, 테스트 계정은/);
  const superTest = num(/테스트 계정은 최고관리자 (\d+)명/);
  const operatorTest = num(/테스트 계정은 최고관리자 \d+명 · 운영관리자 (\d+)명입니다/);
  assert.equal(superReal + superTest, superTotal, 'D: SUPER real+test must equal the stated SUPER total');
  assert.equal(operatorReal + operatorTest, operatorTotal, 'D: OPERATIONAL real+test must equal the stated OPERATIONAL total');
  assert.equal(superTotal, 3, 'D: the stated SUPER total must be 3');
  assert.equal(operatorTotal, 3, 'D: the stated OPERATIONAL total must be 3');
  assert.equal(superReal, 2, 'D: real-operation SUPER accounts must be 2');
  assert.equal(operatorReal, 2, 'D: real-operation OPERATIONAL accounts must be 2');
  assert.equal(superTest, 1, 'D: QA test SUPER accounts must be 1');
  assert.equal(operatorTest, 1, 'D: QA test OPERATIONAL accounts must be 1');

  // No account identifiers may be introduced to explain the counts.
  const copyStart = adminPage.indexOf(compositionSentence);
  const copyEnd = adminPage.indexOf(splitSentence) + splitSentence.length;
  const copyText = adminPage.slice(copyStart, copyEnd);
  assert.ok(!copyText.includes('@'), 'C: the composition copy must not expose any account identifier');
  // The test split must be presented as current composition, never as removal.
  assert.ok(!/제거|삭제|정리 대상|제외/.test(copyText), 'D: the QA test accounts must not be framed as removal targets');
}

// ===========================================================================
// E+F. role visibility contract, evaluated behaviourally against the real
// console module: OPERATIONAL sees no privileged section at all, SUPER keeps
// the privileged area with the `users` capability.
// ===========================================================================
{
  const ctx = { location: { hostname: 'danjion.pages.dev', search: '' }, URL, URLSearchParams, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(authoritySrc, ctx);
  vm.runInContext(consoleSrc, ctx);
  const A = ctx.DanjionAdminAuthority;
  const C = ctx.DanjionAdminConsole;
  assert.ok(A && C, 'the real authority and console modules must load');

  const operator = A.normalizeAuthority({ level: 'operator', wildcard: false, scopes: ['news'] });
  assert.equal(operator.state, 'operator', 'E: a valid OPERATIONAL grant must normalize');
  assert.equal(C.consoleSections(operator).privileged.length, 0,
    'E: OPERATIONAL must receive no privileged section — the composition copy stays SUPER-only');

  const superAuth = A.normalizeAuthority({ level: 'admin', wildcard: true, scopes: ['*'] });
  assert.equal(superAuth.state, 'admin', 'F: a valid SUPER grant must normalize');
  const privileged = C.consoleSections(superAuth).privileged;
  assert.ok(privileged.length > 0, 'F: SUPER must still receive the privileged section');
  assert.ok(privileged.some((capability) => capability.id === 'users'),
    'F: the 사용자 · 권한 관리 capability must remain available to SUPER');
  assert.ok(
    adminPage.includes("el('button','사용자 · 권한 관리')") &&
    adminPage.includes('()=>renderPrincipalManager(panel,apiBase)'),
    'F: the SUPER principal manager entry must stay wired',
  );
}

// ===========================================================================
// G. principal create/update API wiring untouched.
// ===========================================================================
assert.ok(adminPage.includes('principalApi.list(fetch,apiBase)'), 'G: roster refresh must still go through the bridge');
assert.ok(adminPage.includes('principalApi.create(fetch,apiBase'), 'G: creation must still be delegated to the bridge');
assert.ok(adminPage.includes('principalApi.update(fetch,apiBase,row.id'), 'G: authority sync must still be delegated to the bridge');
assert.ok(!/innerHTML\s*=/.test(adminPage), 'G: principal management must remain text-safe');

console.log('1085_CASE_STALE_2_PLUS_2_REMOVED=PASS');
console.log('1085_CASE_SUMMARY_COMPOSITION_3=PASS');
console.log('1085_CASE_TOTAL_3_PLUS_3_COPY=PASS');
console.log('1085_CASE_REAL_2_PLUS_2_TEST_1_PLUS_1=PASS');
console.log('1085_CASE_OPERATIONAL_NO_PRIVILEGED=PASS');
console.log('1085_CASE_SUPER_MANAGER_REACHABLE=PASS');
console.log('1085_CASE_API_WIRING_UNTOUCHED=PASS');

console.log('leaf-1085-admin-target-copy-3-plus-3-contract: PASS');
