import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const workflow = await readFile(new URL('.github/workflows/qa-persona-rbac-matrix.yml', root), 'utf8');
const script = await readFile(new URL('04_개발/frontend/scripts/qa-persona-rbac-matrix.mjs', root), 'utf8');
const policy = await readFile(new URL('04_개발/backend/src/admin-scope-policy-v1.ts', root), 'utf8');

assert.match(workflow, /pull_request:/, 'persona matrix source contract must run on PRs');
assert.match(workflow, /workflow_dispatch:/, 'live persona matrix must be manual only');
assert.match(workflow, /environment:\s*qa/, 'persona matrix must use GitHub qa environment');
assert.doesNotMatch(workflow, /environment:\s*production/, 'persona matrix must never use production environment');
assert.match(workflow, /inputs\.run_live/, 'live matrix requires explicit confirmation');
assert.match(workflow, /expected_main/, 'matrix workflow must carry exact-main authority');
assert.match(workflow, /git ls-remote origin refs\/heads\/main/, 'matrix workflow must fresh-read remote main');
assert.match(workflow, /test "\$actual" = "\$expected"/, 'matrix workflow must exact-match checked-out main');
assert.match(workflow, /test "\$remote" = "\$expected"/, 'matrix workflow must exact-match remote main');

for (const required of [
  'DANJION_QA_API_URL',
  'DANJION_QA_FRONTEND_URL',
  'DANJION_QA_RESIDENT_EMAIL',
  'DANJION_QA_RESIDENT_PASSWORD',
  'DANJION_QA_OPERATIONAL_EMAIL',
  'DANJION_QA_OPERATIONAL_PASSWORD',
  'DANJION_QA_SUPER_EMAIL',
  'DANJION_QA_SUPER_PASSWORD'
]) assert.ok(workflow.includes(required), `missing persona matrix input ${required}`);
assert.ok(!workflow.includes('DANJION_QA_DATABASE_URL'), 'browser matrix must not receive direct database authority');
assert.doesNotMatch(workflow, /DANJION_PRODUCTION|padiem-danjion-api-production|https:\/\/danjion\.pages\.dev/, 'matrix must not target Production');
assert.match(workflow, /playwright install --with-deps chromium/, 'matrix workflow must install Chromium');

assert.match(script, /EXPECTED_API_HOST = 'padiem-danjion-api-qa\.padiem\.workers\.dev'/, 'matrix must pin QA Worker');
assert.match(script, /EXPECTED_FRONTEND_HOST = 'danjion-qa\.pages\.dev'/, 'matrix must pin QA Pages');
assert.match(script, /IDENTITIES_MUST_BE_DISTINCT/, 'matrix credentials must be pairwise distinct');
assert.match(script, /SHARED_ACTOR_DETECTED/, 'matrix must reject shared auth actors');
assert.match(script, /SESSION_LEAK_AFTER_LOGOUT/, 'matrix must verify logout isolation');
assert.match(script, /browser\.newContext\(\)/, 'each persona must use an isolated browser context');
assert.match(script, /credentials:\s*'same-origin'/, 'authorization checks must run through same-origin browser fetch');

for (const route of [
  '/api/auth/sign-in/email',
  '/api/auth/get-session',
  '/api/auth/sign-out',
  '/api/v1/me/profile?complexSlug=',
  '/api/v1/admin/authority',
  '/api/v1/admin/audit-events?limit=1',
  '/api/v1/admin/complexes/'
]) assert.ok(script.includes(route), `missing matrix route ${route}`);

assert.match(script, /residentLabel !== 'verified_resident'/, 'QA_RESIDENT must prove verified resident surface');
assert.match(script, /RESIDENT_AUTHORITY_EXPECTED_403/, 'QA_RESIDENT must be denied admin authority');
assert.match(script, /RESIDENT_PRIVILEGED_EXPECTED_403/, 'QA_RESIDENT must be denied privileged admin surface');
assert.match(script, /CLIENT_ELEVATION_DETECTED/, 'matrix must test client-side authority spoof rejection');
assert.match(script, /'x-danjion-role': 'admin'/, 'matrix must attempt harmless role-header spoof against privileged read');
assert.match(script, /OPERATIONAL_SURFACE_HTTP/, 'QA_OPERATIONAL must prove a bounded operational surface');
assert.match(script, /OPERATIONAL_PRIVILEGED_EXPECTED_403/, 'QA_OPERATIONAL must be denied SUPER-only surface');
assert.match(script, /SUPER_PRIVILEGED_HTTP/, 'QA_SUPER must prove privileged surface access');

function quotedValues(source, name) {
  const match = source.match(new RegExp(`${name}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\s*(?:as const)?\\)`));
  assert.ok(match, `missing ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}
assert.deepEqual(
  quotedValues(script, 'OPERATIONAL_SCOPES'),
  quotedValues(policy, 'OPERATIONAL_ADMIN_SCOPES'),
  'browser matrix OPERATIONAL scopes must exactly match canonical policy'
);

for (const field of [
  'PERSONA=', 'AUTH=', 'RESIDENT_VERIFIED=', 'AUTHORITY_LEVEL=', 'WILDCARD=',
  'BOUNDED_SCOPE_COUNT=', 'PRIVILEGED_ACCESS=', 'PRODUCTION_TARGET=', 'SECRET_OUTPUT='
]) assert.ok(script.includes(field), `missing privacy-safe matrix report field ${field}`);

for (const sensitiveOutput of [
  'console.log(persona.email', 'console.log(persona.password', 'console.log(subject',
  'console.log(sessionBody', 'console.log(profile.body', 'console.log(authority.body'
]) assert.ok(!script.includes(sensitiveOutput), `matrix must not print sensitive value: ${sensitiveOutput}`);

assert.doesNotMatch(script, /fetch\([^\n]*method:\s*['"](?:POST|PATCH|PUT|DELETE)['"][\s\S]{0,120}\/api\/v1\//,
  'matrix must not mutate product API state');
assert.match(script, /PRODUCTION_TARGET=NO/, 'matrix report must state no Production target');
assert.match(script, /SECRET_OUTPUT=NO/, 'matrix report must state no secret output');

console.log('qa-persona-rbac-matrix-contract: PASS');
