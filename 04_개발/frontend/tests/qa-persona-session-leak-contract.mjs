import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const workflow = await readFile(new URL('.github/workflows/qa-persona-session-leak.yml', root), 'utf8');
const script = await readFile(new URL('04_개발/frontend/scripts/qa-persona-session-leak.mjs', root), 'utf8');
const matrixScript = await readFile(new URL('04_개발/frontend/scripts/qa-persona-rbac-matrix.mjs', root), 'utf8');

// --- workflow safety contract ---
assert.match(workflow, /pull_request:/, 'session leak source contract must run on PRs');
assert.match(workflow, /workflow_dispatch:/, 'live session leak run must be manual only');
assert.match(workflow, /environment:\s*qa/, 'session leak must use GitHub qa environment');
assert.doesNotMatch(workflow, /environment:\s*production/, 'session leak must never use production environment');
assert.match(workflow, /inputs\.run_live/, 'live session leak requires explicit confirmation');
assert.match(workflow, /expected_main/, 'session leak workflow must carry exact-main authority');
assert.match(workflow, /git ls-remote origin refs\/heads\/main/, 'session leak workflow must fresh-read remote main');
assert.match(workflow, /test "\$actual" = "\$expected"/, 'session leak workflow must exact-match checked-out main');
assert.match(workflow, /test "\$remote" = "\$expected"/, 'session leak workflow must exact-match remote main');

for (const required of [
  'DANJION_QA_API_URL',
  'DANJION_QA_FRONTEND_URL',
  'DANJION_QA_RESIDENT_EMAIL',
  'DANJION_QA_RESIDENT_PASSWORD',
  'DANJION_QA_OPERATIONAL_EMAIL',
  'DANJION_QA_OPERATIONAL_PASSWORD',
  'DANJION_QA_SUPER_EMAIL',
  'DANJION_QA_SUPER_PASSWORD'
]) assert.ok(workflow.includes(required), `missing session leak input ${required}`);
assert.ok(!workflow.includes('DANJION_QA_DATABASE_URL'), 'session leak must not receive direct database authority');
assert.doesNotMatch(workflow, /DANJION_PRODUCTION|padiem-danjion-api-production|https:\/\/danjion\.pages\.dev/, 'session leak must not target Production');
assert.match(workflow, /playwright install --with-deps chromium/, 'session leak workflow must install Chromium');

// --- script safety contract ---
assert.match(script, /EXPECTED_API_HOST = 'padiem-danjion-api-qa\.padiem\.workers\.dev'/, 'session leak must pin QA Worker');
assert.match(script, /EXPECTED_FRONTEND_HOST = 'danjion-qa\.pages\.dev'/, 'session leak must pin QA Pages');
assert.match(script, /IDENTITIES_MUST_BE_DISTINCT/, 'session leak credentials must be pairwise distinct');
assert.match(script, /browser\.newContext\(\)/, 'each persona must use an isolated browser context');
assert.match(script, /credentials:\s*'same-origin'/, 'session checks must run through same-origin browser fetch');

for (const route of [
  '/api/auth/sign-in/email',
  '/api/auth/get-session',
  '/api/auth/sign-out',
  '/api/v1/admin/authority',
  '/api/v1/me/profile?complexSlug='
]) assert.ok(script.includes(route), `missing session leak route ${route}`);

// --- coverage: the three leak classes this verification exists for ---
assert.match(script, /SESSION_NOT_CLEARED/, 'must verify session record cleared after logout');
assert.match(script, /AUTHORITY_ALLOWED_AFTER_LOGOUT/, 'must verify admin API denied after logout');
assert.match(script, /PROFILE_ALLOWED_AFTER_LOGOUT/, 'must verify resident API denied after logout');
assert.match(script, /SWITCH_CROSS_CONTAMINATION/, 'must detect cross-persona contamination on account switch');
assert.match(script, /SWITCH_RESIDUAL_SESSION/, 'must verify no residual session between account switches');
assert.match(script, /SWITCH_SUBJECT_MISMATCH/, 'switch chain subjects must match isolated-context baselines');
assert.match(script, /AMBIENT_AUTHORITY|AMBIENT_PROFILE/, 'must verify a fresh ambient context holds no session');

// --- parity with canonical matrix conventions ---
assert.ok(!script.includes('DANJION_QA_DATABASE_URL'), 'session leak script must not reference database authority');
for (const route of ['/api/v1/admin/audit-events?limit=1', '/api/v1/admin/complexes/']) {
  assert.ok(!script.includes(route), `session leak must not touch product-mutating or privileged-write surfaces: ${route}`);
}
assert.match(script, /PRODUCTION_TARGET=NO/, 'session leak report must state no Production target');
assert.match(script, /SECRET_OUTPUT=NO/, 'session leak report must state no secret output');

for (const sensitiveOutput of [
  'console.log(persona.email', 'console.log(persona.password', 'console.log(subject',
  'console.log(sessionBody', 'console.log(profile.body', 'console.log(authority.body'
]) assert.ok(!script.includes(sensitiveOutput), `session leak must not print sensitive value: ${sensitiveOutput}`);

assert.doesNotMatch(script, /fetch\([^\n]*method:\s*['"](?:POST|PATCH|PUT|DELETE)['"][\s\S]{0,120}\/api\/v1\//,
  'session leak must not mutate product API state');

// sign-in / sign-out are the only allowed POSTs and must target auth endpoints only
for (const postMatch of script.matchAll(/request\.post\(`\$\{frontendBase\}([^`]+)`/g)) {
  assert.match(postMatch[1], /^\/api\/auth\/(sign-in\/email|sign-out)$/, `unexpected POST target ${postMatch[1]}`);
}

// QA_RESIDENT baseline must remain a denial surface (never 200 on admin authority)
assert.doesNotMatch(script, /'QA_RESIDENT'[^)]*\?\s*200/, 'QA_RESIDENT baseline must not expect admin authority success');

console.log('qa-persona-session-leak-contract: PASS');
