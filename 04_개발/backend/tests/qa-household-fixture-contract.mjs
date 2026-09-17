import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const workflow = await readFile(new URL('.github/workflows/qa-household-fixture.yml', root), 'utf8');
const script = await readFile(new URL('04_개발/backend/scripts/qa-household-fixture.mjs', root), 'utf8');

assert.match(workflow, /pull_request:/, 'fixture source contract must run on PRs');
assert.match(workflow, /workflow_dispatch:/, 'fixture mutation must be manual only');
assert.match(workflow, /environment:\s*qa/, 'fixture mutation must use GitHub qa environment');
assert.doesNotMatch(workflow, /environment:\s*production/, 'fixture must never use production environment');
assert.match(workflow, /inputs\.confirm_qa_fixture/, 'fixture mutation requires explicit confirmation');
assert.match(workflow, /expected_main/, 'fixture workflow must carry exact-main authority');
assert.match(workflow, /git ls-remote origin refs\/heads\/main/, 'fixture must fresh-read remote main');
assert.match(workflow, /test "\$actual" = "\$expected"/, 'fixture must exact-match checked-out main');
assert.match(workflow, /test "\$remote" = "\$expected"/, 'fixture must exact-match remote main');

for (const required of [
  'DANJION_QA_API_URL',
  'DANJION_QA_FRONTEND_URL',
  'DANJION_QA_DATABASE_URL',
  'DANJION_QA_EMAIL',
  'DANJION_QA_PASSWORD',
  'QA_FIXTURE_DISPOSITION'
]) assert.ok(workflow.includes(required), `missing QA fixture input ${required}`);

for (const forbidden of [
  'DANJION_PRODUCTION_DB_URL',
  '--env production',
  'danjion.pages.dev',
  'padiem-danjion-api-production'
]) assert.ok(!workflow.includes(forbidden), `fixture workflow carries production authority: ${forbidden}`);
assert.doesNotMatch(workflow, /^\s+DATABASE_URL:\s*\$\{\{\s*secrets\./m, 'fixture workflow must not bind a generic DATABASE_URL secret');

assert.match(script, /APP_ENV.*qa/, 'fixture script must fail closed unless APP_ENV=qa');
assert.match(script, /QA_API_HOST = 'padiem-danjion-api-qa\.padiem\.workers\.dev'/, 'fixture must pin dedicated QA Worker');
assert.match(script, /QA_FRONTEND_HOST = 'danjion-qa\.pages\.dev'/, 'fixture must pin dedicated QA Pages');
assert.match(script, /DANJION_QA_DATABASE_URL/, 'fixture must use dedicated QA DB variable');
assert.match(script, /GENERIC_DATABASE_URL_FORBIDDEN/, 'fixture must reject generic DATABASE_URL authority');
assert.doesNotMatch(script, /DANJION_PRODUCTION_DB_URL/, 'fixture must never reference production DB variable');
assert.match(script, /\/api\/auth\/sign-in\/email/, 'fixture must use real QA Better Auth sign-in');
assert.match(script, /\/api\/auth\/get-session/, 'fixture must resolve the real authenticated QA subject');
assert.match(script, /\/api\/auth\/token/, 'fixture must obtain service JWT without printing it');
assert.match(script, /\/api\/v1\/me/, 'fixture must use normal auth bridge before DB linking');
assert.match(script, /where auth_user_id = \$\{subject\}/, 'fixture must link only the authenticated subject');

for (const table of [
  'complexes',
  'complex_units',
  'households',
  'complex_memberships',
  'household_memberships'
]) assert.ok(script.includes(table), `fixture must converge synthetic state through ${table}`);

assert.match(script, /HOUSEHOLD_ASSOCIATED_RESIDENT_PENDING/, 'fixture must support pending disposition');
assert.match(script, /HOUSEHOLD_ASSOCIATED_RESIDENT_VERIFIED/, 'fixture must support verified disposition');
assert.match(script, /residentStatus = verified \? 'verified' : 'pending'/, 'resident verification state must be explicit');
assert.match(script, /householdStatus = verified \? 'verified' : 'pending'/, 'household association status must be explicit');
assert.match(script, /on conflict \(slug\)/, 'synthetic complex convergence must be idempotent');
assert.match(script, /on conflict \(complex_id, building_code, unit_code\)/, 'synthetic unit convergence must be idempotent');
assert.match(script, /on conflict \(complex_unit_id\)/, 'synthetic household convergence must be idempotent');
assert.match(script, /on conflict \(complex_id, user_id\)/, 'legacy resident membership convergence must be idempotent');

assert.match(script, /resident_verifications/, 'fixture must explicitly verify no resident evidence object exists');
assert.match(script, /VERIFICATION_EVIDENCE_FORBIDDEN/, 'fixture must fail closed on resident evidence object');
assert.match(script, /padiem_operator_grants/, 'fixture must verify no PADIEM grant exists');
assert.match(script, /complex_operator_grants/, 'fixture must verify no complex operator grant exists');
assert.match(script, /OPERATOR_GRANT_FORBIDDEN/, 'fixture must fail closed on operator authority');

for (const sensitiveOutput of [
  'console.log(subject',
  'console.log(userId',
  'console.log(email',
  'console.log(password',
  'console.log(jwt',
  'console.log(cookie',
  'console.log(databaseUrl',
  'console.log(complexId',
  'console.log(unitId',
  'console.log(householdId'
]) assert.ok(!script.includes(sensitiveOutput), `fixture must not print sensitive value: ${sensitiveOutput}`);

for (const forbiddenSeed of ['900_', '901_', '902_']) {
  assert.ok(!script.toLowerCase().includes(forbiddenSeed), `fixture must not reuse dev seed material: ${forbiddenSeed}`);
}
assert.match(script, /banglim-myeongji-roadhill/, 'fixture must target canonical pilot complex');

for (const safeOutput of [
  'HOUSEHOLD_ASSOCIATED=true',
  'MY_MEMBERSHIP_STATUS=',
  'RESIDENT_VERIFIED=',
  'VERIFICATION_EVIDENCE_PRESENT=false',
  'OPERATOR_GRANT_PRESENT=false',
  'PRODUCTION_TARGET=NO',
  'SECRET_OUTPUT=NO'
]) assert.ok(script.includes(safeOutput), `missing privacy-safe fixture disposition output: ${safeOutput}`);

console.log('qa-household-fixture-contract: PASS');
