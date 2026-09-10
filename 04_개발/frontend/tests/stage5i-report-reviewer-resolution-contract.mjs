import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// KILO3 #315: Report R-B reviewer resolution UI on the existing admin surface.
// A. reviewer queue reads the canonical admin shop-recommendations lane
// B. mutations send { status, reviewNote } only — never operator-set resolved fields
// C. approval authority = resolved_category_id + resolved_relation_type ONLY (fail closed)
// D. raw report context is inspectable; legacy category/relation are history only
// E. nearby is never silently mapped to local anywhere in the reviewer lane
// F. mock parity mirrors the merged backend fail-closed behavior

const root = new URL('../', import.meta.url);
const [adminApi, adminApp, mockStore, packageJson] = await Promise.all([
  readFile(new URL('src/admin-api.ts', root), 'utf8'),
  readFile(new URL('src/AdminApp.tsx', root), 'utf8'),
  readFile(new URL('src/mock-recommendation-store.ts', root), 'utf8'),
  readFile(new URL('package.json', root), 'utf8')
]);

// A. canonical admin queue + review endpoints on the existing admin auth surface
assert.match(adminApi, /authenticatedFetch\([\s\S]*'admin'\)/,
  'admin API lane must keep using the authenticated admin fetch');
assert.match(adminApi, /\/api\/v1\/admin\/complexes\/\$\{COMPLEX_SLUG\}\/shop-recommendations\?status=\$\{encodeURIComponent\(status\)\}/,
  'reviewer queue must read the canonical admin shop-recommendations route');
assert.match(adminApi, /\/api\/v1\/admin\/shop-recommendations\/\$\{id\}/,
  'reviewer mutation must use the canonical admin review route');

// B. mutation body is exactly { status, reviewNote } — no resolved-field writes
assert.match(adminApi, /method: 'PATCH',\s*body: JSON\.stringify\(\{ status, reviewNote \}\)/,
  'review mutation must send only status + reviewNote');
assert.doesNotMatch(adminApi, /(PUT|POST|PATCH)[\s\S]{0,120}resolved/i,
  'no HTTP mutation may carry resolved authority fields from the UI');

// C. approval gate is canonical-only
const gateBody = adminApi.match(/export function recommendationApprovalBlockReason\([\s\S]*?\n\}/);
assert.ok(gateBody, 'canonical approval gate helper must exist');
assert.match(gateBody[0], /!recommendation\.resolvedCategoryId/, 'gate must require resolved category');
assert.match(gateBody[0], /!recommendation\.resolvedRelationType/, 'gate must require resolved relation');
assert.doesNotMatch(gateBody[0], /categoryName|relationType\b/,
  'legacy category_name / relation_type must not gate approval');
assert.match(adminApp, /approvalBlock/, 'reviewer UI must compute the canonical block reason');
assert.match(adminApp, /className="approve"[\s\S]{0,120}disabled=\{busyId === recommendation\.id \|\| !!approvalBlock\}/,
  'approve button must be disabled while canonical authority is unresolved');
assert.match(adminApp, /status === 'approved' && recommendationApprovalBlockReason\(recommendation\)/,
  'approve handler must hard-guard unresolved authority');
assert.match(adminApp, /result\.categoryUnresolved/,
  'UI must surface the backend fail-closed categoryUnresolved outcome');

// D. raw context inspectable; legacy fields are history only
assert.match(adminApp, /recommendation\.reportedRelationRaw/, 'raw relation must be shown');
assert.match(adminApp, /recommendation\.relationDetail/, 'relation detail must be shown');
assert.match(adminApp, /recommendation\.reportPrice/, 'report price must be shown');
assert.match(adminApp, /recommendation\.reportHours/, 'report hours must be shown');
assert.match(adminApp, /recommendation\.reporterNickname/, 'reporter nickname must be shown');
assert.match(adminApp, /resolvedCategoryId \? '확정' : '미확정'/, 'explicit resolution state must be shown');
assert.match(adminApp, /과거 기록\(참고용\)/, 'legacy fields must be labeled history only');
assert.equal(
  (adminApp.match(/recommendation\.categoryName/g) || []).length, 1,
  'legacy categoryName may appear only on the history-only line'
);
assert.equal(
  (adminApp.match(/recommendation\.relationType/g) || []).length, 1,
  'legacy relationType may appear only on the history-only line'
);

// E. no silent nearby -> local coercion in the reviewer lane
for (const [name, source] of [['admin-api', adminApi], ['AdminApp', adminApp], ['mock store', mockStore]]) {
  assert.doesNotMatch(source, /nearby[\s\S]{0,80}local/, `${name} must never map nearby to local`);
}

// F. mock parity: fail-closed approval fallback identical to backend
assert.match(mockStore, /!current\.resolvedCategoryId \|\| !current\.resolvedRelationType/,
  'mock approval must gate on canonical resolved fields only');
assert.match(mockStore, /status: 'changes_requested'[\s\S]*categoryUnresolved: 'REPORT_RB_UNRESOLVED'/,
  'mock must fall back to changes_requested with the unresolved marker');
assert.doesNotMatch(mockStore, /categoryName \|\| current\.relationType|current\.categoryName/,
  'mock gate must ignore legacy fields');

// G. wiring: focused test runs in the standard verification chain
assert.match(packageJson, /"test:stage5i-report-reviewer-resolution": "node tests\/stage5i-report-reviewer-resolution-contract\.mjs"/,
  'contract test must be registered as a script');
assert.match(packageJson, /typecheck[\s\S]*test:stage5i-report-reviewer-resolution/,
  'contract test must run inside the typecheck verification chain');

console.log('PASS KILO3 stage5i report reviewer resolution UI contract');
