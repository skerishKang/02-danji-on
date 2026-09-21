import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/*
 * QA acceptance persona provisioning (#868 verification preparation).
 *
 * The full persona lane (qa-persona-provision.yml) ends by converging a VERIFIED
 * household fixture. #868 temporary-resident acceptance needs a signed-in member
 * with NO verified household membership and forbids household/membership
 * creation, so the acceptance lane must be a separate, narrower unit.
 *
 * This contract pins that separation as source truth:
 *   1. the lite workflow never invokes the household fixture and never asks for a
 *      fixture disposition;
 *   2. the lite script pins the three acceptance identities and converges ONLY
 *      padiem_operator_grants;
 *   3. no household / membership / complex-operator mutation statement exists;
 *   4. QA isolation and exact-main authority guards are retained.
 */

const root = new URL('../../../', import.meta.url);
const workflow = await readFile(new URL('.github/workflows/qa-persona-provision-lite.yml', root), 'utf8');
const script = await readFile(new URL('04_개발/backend/scripts/qa-persona-provision-lite.mjs', root), 'utf8');
const policy = await readFile(new URL('04_개발/backend/src/admin-scope-policy-v1.ts', root), 'utf8');
const fullWorkflow = await readFile(new URL('.github/workflows/qa-persona-provision.yml', root), 'utf8');

// --- 1. workflow shape -------------------------------------------------------
assert.match(workflow, /pull_request:/, 'lite persona source contract must run on PRs');
assert.match(workflow, /workflow_dispatch:/, 'lite persona mutation must be manual only');
assert.match(workflow, /environment:\s*qa/, 'lite persona mutation must use the GitHub qa environment');
assert.doesNotMatch(workflow, /environment:\s*production/, 'lite persona workflow must never use production environment');
assert.match(workflow, /inputs\.confirm_qa_personas_lite/, 'lite persona mutation requires explicit confirmation');
assert.match(workflow, /expected_main/, 'lite persona workflow must carry exact-main authority');
assert.match(workflow, /git ls-remote origin refs\/heads\/main/, 'lite persona workflow must fresh-read remote main');
assert.match(workflow, /test "\$actual" = "\$expected"/, 'must exact-match checked-out main');
assert.match(workflow, /test "\$remote" = "\$expected"/, 'must exact-match remote main');
assert.match(workflow, /padiem-danjion-api-qa\.padiem\.workers\.dev/, 'must pin the dedicated QA Worker');
assert.match(workflow, /danjion-qa\.pages\.dev/, 'must pin the dedicated QA Pages');
assert.doesNotMatch(workflow, /padiem-danjion-api-production|https:\/\/danjion\.pages\.dev/, 'must never target production hosts');
assert.doesNotMatch(workflow, /DANJION_PRODUCTION_DB_URL:\s*\$\{\{/m, 'must never bind production DB authority');

const applyJob = workflow.slice(workflow.indexOf('  apply-personas-lite:'));
assert.ok(applyJob, 'lite workflow must define an apply job');
assert.ok(applyJob.includes("if: ${{ github.event_name == 'workflow_dispatch' && inputs.confirm_qa_personas_lite }}"),
  'lite apply job must require manual dispatch + explicit confirmation');
const sourceContractJob = workflow.slice(0, workflow.indexOf('  apply-personas-lite:'));
assert.ok(!sourceContractJob.includes('run: node 04_개발/backend/scripts/qa-persona-provision-lite.mjs'),
  'PR source-contract job must never run the mutation script');
assert.ok(applyJob.includes('run: node 04_개발/backend/scripts/qa-persona-provision-lite.mjs'),
  'the mutation script may only run inside the guarded apply job');
assert.equal((workflow.match(/scripts\/qa-persona-provision-lite\.mjs/g) || []).length, 2,
  'the mutation script may appear only as a path filter and as the guarded apply step');

// --- 2. the household fixture must not be reachable from this lane -----------
assert.doesNotMatch(workflow, /qa-household-fixture/, 'lite lane must never invoke the household fixture');
assert.doesNotMatch(workflow, /QA_FIXTURE_DISPOSITION/, 'lite lane must never request a household fixture disposition');
assert.doesNotMatch(workflow, /HOUSEHOLD_ASSOCIATED_RESIDENT_VERIFIED/, 'lite lane must never converge a verified household');
assert.match(workflow, /Household fixture: `NOT RUN`/, 'lite lane must record that no household fixture ran');
assert.match(workflow, /Household \/ membership mutation: `NO`/, 'lite lane must record that no membership was created');

// The full lane keeps its fixture; this contract only pins that it is a different unit.
assert.match(fullWorkflow, /qa-household-fixture\.mjs/, 'full persona lane must keep its own fixture behaviour');

// --- 3. script identity pinning ---------------------------------------------
assert.match(script, /const QA_API_HOST = 'padiem-danjion-api-qa\.padiem\.workers\.dev'/, 'script must pin the QA Worker host');
assert.match(script, /const QA_FRONTEND_HOST = 'danjion-qa\.pages\.dev'/, 'script must pin the QA Pages host');
assert.match(script, /email: 'skerish_super_test@naver\.com'/, 'QA_SUPER identity must be pinned');
assert.match(script, /email: 'skerish_manage_test@naver\.com'/, 'QA_OPERATOR identity must be pinned');
assert.match(script, /email: 'skerish_people_test@naver\.com'/, 'QA_RESIDENT identity must be pinned');
assert.match(script, /passwordEnv: 'DANJION_QA_SUPER_PASSWORD'/);
assert.match(script, /passwordEnv: 'DANJION_QA_OPERATIONAL_PASSWORD'/);
assert.match(script, /passwordEnv: 'DANJION_QA_RESIDENT_PASSWORD'/);

// Desired authority per persona (#868 acceptance).
const superBlock = script.slice(script.indexOf("name: 'QA_SUPER'"), script.indexOf("name: 'QA_OPERATOR'"));
assert.match(superBlock, /desiredScopes: Object\.freeze\(\['\*'\]\)/, 'QA_SUPER must converge exactly the wildcard scope');
const operatorBlock = script.slice(script.indexOf("name: 'QA_OPERATOR'"), script.indexOf("name: 'QA_RESIDENT'"));
assert.match(operatorBlock, /desiredScopes: OPERATIONAL_ADMIN_SCOPES/, 'QA_OPERATOR must converge the bounded operator bundle');
assert.match(
  script,
  /name: 'QA_RESIDENT',[\s\S]{0,400}?desiredScopes: Object\.freeze\(\[\]\)/,
  'QA_RESIDENT must carry no PADIEM grant'
);

// The pinned operator bundle must stay equal to the canonical admin scope policy.
const policyScopes = [...(policy.match(/OPERATIONAL_ADMIN_SCOPES[\s\S]*?\] as const/) || [''])[0]
  .matchAll(/'([a-z_.]+)'/g)].map((match) => match[1]);
const scriptScopes = [...script.slice(script.indexOf('const OPERATIONAL_ADMIN_SCOPES'), script.indexOf('const ACCOUNTS'))
  .matchAll(/'([a-z_.]+)'/g)].map((match) => match[1]);
assert.deepEqual(scriptScopes, policyScopes,
  'lite script operator bundle must match admin-scope-policy-v1 OPERATIONAL_ADMIN_SCOPES exactly');

// --- 4. no household / membership mutation, ever -----------------------------
for (const forbidden of [
  /insert\s+into\s+household/i,
  /insert\s+into\s+households/i,
  /insert\s+into\s+household_memberships/i,
  /insert\s+into\s+complex_memberships/i,
  /insert\s+into\s+complex_operator_grants/i,
  /update\s+household_memberships/i,
  /update\s+complex_memberships/i,
  /delete\s+from\s+household/i
]) {
  assert.doesNotMatch(script, forbidden, `lite script must never mutate household/membership state: ${forbidden}`);
}
assert.match(script, /select count\(\*\) from household_memberships/, 'resident precondition must be measured read-only');
assert.match(script, /VERIFIED_HOUSEHOLD_MEMBERSHIP=/, 'verified-membership precondition must be reported');
assert.match(script, /HOUSEHOLD_FIXTURE=NOT_RUN/, 'script must report that no household fixture ran');

// --- 5. account acquisition semantics ---------------------------------------
assert.match(script, /signup\.status === 422/, 'an already-existing account must be a normal path');
assert.match(script, /QA_PERSONA_LITE_SIGNIN_PASSWORD_MISMATCH/, 'sign-in refusal must be reported as a password mismatch');
assert.match(script, /QA_PERSONA_LITE_SIGNUP_HTTP_\$\{signup\.status\}/, 'signup failures must carry their own status');
assert.match(script, /function safeBody\(/, 'signup failure must keep the provider error code without echoing credentials');
assert.doesNotMatch(script, /PASSWORD\)/, 'script must never log a password expression');

// --- 6. QA isolation and fail-closed guards ---------------------------------
assert.match(script, /if \(required\('APP_ENV'\) !== 'qa'\) throw/);
assert.match(script, /if \(process\.env\.DATABASE_URL\) throw/);
assert.match(script, /if \(process\.env\.DANJION_PRODUCTION_DB_URL\) throw/);
assert.match(script, /export function exactHttpsOrigin\(/, 'lite script must export the guarded origin helper');
assert.match(script, /export async function fetchPersonaMe\(/, 'lite script must export the QA auth-bridge probe');
assert.match(script, /const frontendOrigin = exactHttpsOrigin\(required\('DANJION_QA_FRONTEND_URL'\), 'FRONTEND', QA_FRONTEND_HOST\)/);
assert.match(script, /PRODUCTION_TARGET=NO/);
assert.match(script, /SECRET_OUTPUT=NO/);
assert.match(script, /padiem_operator_grants/, 'grants must converge in padiem_operator_grants only');

// --- 7. bounded QA-only auth repair for a pinned identity -------------------
assert.match(workflow, /repair_stale_accounts:/, 'repair must be an explicit manual-dispatch input');
assert.match(workflow, /QA_PERSONA_LITE_REPAIR: \$\{\{ inputs\.repair_stale_accounts \}\}/,
  'repair must be wired from the explicit dispatch input only');
assert.match(script, /process\.env\.QA_PERSONA_LITE_REPAIR/, 'repair must be opt-in through the environment');
assert.match(script, /QA_PERSONA_LITE_REPAIR_TARGET_NOT_PINNED/, 'repair must refuse any identity that is not pinned');
assert.match(script, /if \(!signIn\.ok && \(signIn\.status === 401 \|\| signIn\.status === 400\) && repair\)/,
  'repair may only run after a password-credential refusal, and only when enabled');

const deleteStatements = [...script.matchAll(/`([^`]*\bdelete\b[^`]*)`/g)].map((match) => match[1]).filter(Boolean);
assert.equal(deleteStatements.length, 1, 'exactly one delete statement may exist in the acceptance lane');
assert.match(deleteStatements[0], /delete from danjion_auth\."user" where lower\(email\) = \$\{target\}/,
  'the only delete must target the pinned email in danjion_auth."user"');
for (const forbidden of [
  /delete\s+from\s+app_users/i,
  /delete\s+from\s+padiem_operator_grants/i,
  /delete\s+from\s+household/i,
  /delete\s+from\s+complex_memberships/i,
  /delete\s+from\s+complex_operator_grants/i
]) {
  assert.doesNotMatch(script, forbidden, `repair must never delete from another table: ${forbidden}`);
}
assert.match(script, /readAuthStructure/, 'the lane must read the auth row structure');
assert.match(script, /AUTH_STRUCTURE=/, 'the lane must report the auth row structure');
assert.match(script, /password_rows/, 'structure report must show whether a password credential exists');
assert.match(script, /credential_rows/, 'structure report must show the credential account row');
assert.match(script, /AUTH_REPAIR=\$\{account\.name\} RECREATED/, 'repair must be announced, not silent');
assert.doesNotMatch(script, /a\.password\s+as\s+password/i, 'the lane must never select a password hash');

console.log('qa-persona-provision-lite-contract: PASS');
