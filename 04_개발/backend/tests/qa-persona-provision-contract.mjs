import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const workflow = await readFile(new URL('.github/workflows/qa-persona-provision.yml', root), 'utf8');
const script = await readFile(new URL('04_개발/backend/scripts/qa-persona-provision.mjs', root), 'utf8');
const fixture = await readFile(new URL('04_개발/backend/scripts/qa-household-fixture.mjs', root), 'utf8');
const policy = await readFile(new URL('04_개발/backend/src/admin-scope-policy-v1.ts', root), 'utf8');

assert.match(workflow, /pull_request:/, 'persona source contract must run on PRs');
assert.match(workflow, /workflow_dispatch:/, 'persona mutation must be manual only');
assert.match(workflow, /environment:\s*qa/, 'persona mutation must use GitHub qa environment');
assert.doesNotMatch(workflow, /environment:\s*production/, 'persona workflow must never use production environment');
assert.match(workflow, /inputs\.confirm_qa_personas/, 'persona mutation requires explicit confirmation');
assert.match(workflow, /expected_main/, 'persona workflow must carry exact-main authority');
assert.match(workflow, /git ls-remote origin refs\/heads\/main/, 'persona workflow must fresh-read remote main');
assert.match(workflow, /test "\$actual" = "\$expected"/, 'persona workflow must exact-match checked-out main');
assert.match(workflow, /test "\$remote" = "\$expected"/, 'persona workflow must exact-match remote main');

for (const required of [
  'DANJION_QA_API_URL',
  'DANJION_QA_FRONTEND_URL',
  'DANJION_QA_DATABASE_URL',
  'DANJION_QA_RESIDENT_EMAIL',
  'DANJION_QA_RESIDENT_PASSWORD',
  'DANJION_QA_OPERATIONAL_EMAIL',
  'DANJION_QA_OPERATIONAL_PASSWORD',
  'DANJION_QA_SUPER_EMAIL',
  'DANJION_QA_SUPER_PASSWORD'
]) assert.ok(workflow.includes(required), `missing QA persona input ${required}`);

assert.doesNotMatch(workflow, /DANJION_PRODUCTION_DB_URL:\s*\$\{\{/m, 'workflow must never bind production DB authority');
assert.doesNotMatch(workflow, /environment:\s*production/, 'workflow must never use Production environment');
assert.doesNotMatch(workflow, /padiem-danjion-api-production|https:\/\/danjion\.pages\.dev/, 'workflow must never target Production hosts');
assert.match(workflow, /QA_FIXTURE_DISPOSITION:\s*HOUSEHOLD_ASSOCIATED_RESIDENT_VERIFIED/, 'resident persona must reuse verified household fixture');
assert.match(workflow, /qa-household-fixture\.mjs\s*>\s*"\$fixture_report"/, 'legacy fixture output must be captured rather than exposed');
assert.match(workflow, /PERSONA=QA_RESIDENT/, 'workflow must emit privacy-safe resident persona report');
const fixtureChecks = workflow.match(/          if grep -Fxq[\s\S]*?(?=          echo 'PERSONA=QA_RESIDENT')/);
assert.ok(fixtureChecks, 'fixture checks must emit named outcomes');
const expectedFixtureChecks = [
  ['RESIDENT_VERIFIED', 'true'],
  ['OPERATOR_GRANT_PRESENT', 'false'],
  ['PRODUCTION_TARGET', 'NO'],
  ['SECRET_OUTPUT', 'NO']
].map(([name, value]) => [
  `          if grep -Fxq '${name}=${value}' "$fixture_report"; then`,
  `            echo '${name}: PASS'`,
  '          else',
  `            echo '${name}: FAIL'`,
  '            exit 1',
  '          fi'
].join('\n')).join('\n') + '\n';
assert.equal(fixtureChecks[0], expectedFixtureChecks, 'each quiet exact check must print only its name and outcome, then stop on failure');

assert.match(script, /APP_ENV.*qa/, 'persona script must fail closed unless APP_ENV=qa');
assert.match(script, /QA_API_HOST = 'padiem-danjion-api-qa\.padiem\.workers\.dev'/, 'persona script must pin dedicated QA Worker');
assert.match(script, /QA_FRONTEND_HOST = 'danjion-qa\.pages\.dev'/, 'persona script must pin dedicated QA Pages');
assert.match(script, /const apiOrigin = exactHttpsOrigin\(required\('DANJION_QA_API_URL'/,
  'persona script must retain the validated QA Worker origin');
assert.match(script, /resolvePersona\(frontendOrigin, apiOrigin, sql, persona\)/,
  'persona resolution must receive both validated Pages and Worker origins');
assert.match(script, /new URL\('\/api\/v1\/me', apiOrigin\)/,
  'JWT-backed /api/v1/me must target the validated QA Worker origin');
assert.match(script, /DANJION_QA_DATABASE_URL/, 'persona script must use dedicated QA DB variable');
assert.match(script, /GENERIC_DATABASE_URL_FORBIDDEN/, 'persona script must reject generic DATABASE_URL authority');
assert.match(script, /PRODUCTION_DATABASE_VARIABLE_FORBIDDEN/, 'persona script must reject production DB variable authority');
assert.match(script, /IDENTITIES_MUST_BE_DISTINCT/, 'persona credentials must be pairwise distinct');
assert.match(script, /AUTH_SUBJECTS_MUST_BE_DISTINCT/, 'resolved auth subjects must be pairwise distinct');
assert.match(script, /APP_USERS_MUST_BE_DISTINCT/, 'resolved app users must be pairwise distinct');

for (const route of ['/api/auth/sign-up/email', '/api/auth/sign-in/email', '/api/auth/get-session', '/api/auth/token', '/api/v1/me']) {
  assert.ok(script.includes(route), `persona provisioning must use real auth/app path ${route}`);
}
assert.match(script, /where auth_user_id = \$\{subject\}/, 'persona script must link only the authenticated subject');
assert.match(script, /from padiem_operator_grants/, 'persona script must read PADIEM grants');
assert.match(script, /insert into padiem_operator_grants/, 'persona script must materialize QA-only PADIEM grants');
assert.match(script, /status = 'revoked'/, 'persona convergence must revoke noncanonical active grants');
assert.match(script, /qa_persona_provision/, 'persona grants must carry QA provenance metadata');
assert.doesNotMatch(script, /insert into padiem_admin_identity_allowlist|update padiem_admin_identity_allowlist/i,
  'QA runtime persona convergence must not mutate admin onboarding allowlist');
assert.match(script, /RESIDENT_CONTAMINATION/, 'operator/super personas must fail closed on resident contamination');
assert.match(script, /RESIDENT_COMPLEX_OPERATOR_GRANT_FORBIDDEN/, 'resident persona must fail closed on complex operator authority');

function quotedValues(source, name) {
  const match = source.match(new RegExp(`${name}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\s*(?:as const)?\\)`));
  assert.ok(match, `missing ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}
const policyScopes = quotedValues(policy, 'OPERATIONAL_ADMIN_SCOPES');
const personaScopes = quotedValues(script, 'OPERATIONAL_SCOPES');
assert.deepEqual(personaScopes, policyScopes, 'QA_OPERATIONAL scopes must exactly match canonical admin scope policy');
assert.equal(personaScopes.length, 9, 'canonical OPERATIONAL bundle must contain exactly 9 scopes');
assert.match(script, /name:\s*'QA_SUPER'[\s\S]{0,220}desiredScopes:\s*\['\*'\]/, 'QA_SUPER persistent grant must be wildcard only');
assert.match(script, /name:\s*'QA_RESIDENT'[\s\S]{0,220}desiredScopes:\s*\[\]/, 'QA_RESIDENT must have no PADIEM grant');

assert.match(fixture, /HOUSEHOLD_ASSOCIATED_RESIDENT_VERIFIED/, 'reused household fixture must support verified resident disposition');
assert.match(fixture, /OPERATOR_GRANT_FORBIDDEN/, 'reused household fixture must reject operator contamination');

for (const sensitiveOutput of [
  'console.log(email', 'console.log(password', 'console.log(subject', 'console.log(userId',
  'console.log(cookie', 'console.log(jwt', 'console.log(databaseUrl'
]) assert.ok(!script.includes(sensitiveOutput), `persona script must not print sensitive value: ${sensitiveOutput}`);

for (const allowedPrefix of [
  'PERSONA=', 'AUTH=', 'RESIDENT_VERIFIED=', 'AUTHORITY_LEVEL=', 'WILDCARD=',
  'BOUNDED_SCOPE_COUNT=', 'PRODUCTION_TARGET=', 'SECRET_OUTPUT='
]) assert.ok(script.includes(allowedPrefix), `missing privacy-safe persona field ${allowedPrefix}`);

for (const forbiddenSeed of ['900_', '901_', '902_']) {
  assert.ok(!script.toLowerCase().includes(forbiddenSeed), `persona script must not reuse dev seed material: ${forbiddenSeed}`);
}

console.log('qa-persona-provision-contract: PASS');
