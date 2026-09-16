import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(
  new URL('../../../.github/workflows/production-existing-admin-principal-adoption.yml', import.meta.url),
  'utf8'
);
const script = await readFile(
  new URL('../scripts/production-admin-principal-adopt-existing.mjs', import.meta.url),
  'utf8'
);

assert.match(workflow, /workflow_dispatch:/, 'adoption must be manual dispatch only');
assert.doesNotMatch(workflow, /^\s*(push|pull_request|schedule):/m, 'adoption must never auto-run');
assert.match(workflow, /environment:\s*production/, 'adoption must use Production environment');
assert.match(workflow, /expected_main:/, 'adoption must require exact-main authority');
assert.match(workflow, /Exact main authority guard/, 'adoption must exact-main guard');
assert.match(workflow, /mode:[\s\S]*preflight[\s\S]*apply[\s\S]*rollback/,
  'workflow must expose preflight/apply/rollback modes');
assert.match(workflow, /ADOPT EXISTING FOUR ADMIN PRINCIPALS/,
  'apply must require exact explicit confirmation');
assert.match(workflow, /ROLL BACK FOUR ADMIN PRINCIPAL ADOPTION/,
  'rollback must require a separate exact confirmation');
assert.match(workflow, /DANJION_PRODUCTION_DB_URL:\s*\$\{\{ secrets\.DANJION_PRODUCTION_DB_URL \}\}/,
  'workflow may consume only the existing Production DB binding');
assert.doesNotMatch(workflow, /DANJION_ADMIN_(SUPER|OPERATIONAL)|email.*input|inputs\..*email/i,
  'existing-principal adoption must not require administrator email inputs/secrets');
assert.doesNotMatch(workflow, /wrangler\s+(deploy|secret)|pages\s+deploy/i,
  'adoption workflow must not deploy or mutate Worker/Page secrets');
for (const marker of [
  'WORKER_DEPLOY=0',
  'PAGES_DEPLOY=0',
  'SECRET_MUTATION=0',
  'ACCOUNT_LINK_MUTATION=0',
  'GRANT_SCOPE_STATUS_MUTATION=0'
]) {
  assert.ok(workflow.includes(marker), `missing disposition marker ${marker}`);
}

for (const forbiddenIdentity of [
  'skerish@',
  'padiemipu@',
  'charliekant@',
  'muphobia2@'
]) {
  assert.ok(!script.toLowerCase().includes(forbiddenIdentity),
    'adoption source must never hardcode an administrator identity');
}

assert.match(script, /cardinality\(scopes\) = 9[\s\S]*resident\.verification\.exempt/,
  'SUPER candidates must be discovered from the exact canonical 9-scope runtime shape');
assert.match(script, /cardinality\(scopes\) = 8[\s\S]*array_position\(scopes, '\*'\) is null/,
  'OPERATIONAL candidates must be discovered from the exact canonical 8-scope runtime shape');
assert.match(script, /left join app_users au on au\.id = c\.user_id/,
  'candidate authority must resolve through the canonical app actor');
assert.match(script, /left join danjion_auth\."user" u on u\.id = au\.auth_user_id/,
  'candidate actor must resolve to Better Auth identity server-side');
assert.match(script, /email_verified = true/,
  'adoption must require verified Better Auth email');
assert.match(script, /account_status = 'active'/,
  'adoption must require active product accounts');
assert.match(script, /lower\(a\.provider_id\) = 'google'/,
  'adoption must require an attached Google identity');
assert.match(script, /google_account_count = 1/,
  'adoption must require one unambiguous Google account per candidate');
for (const aggregate of [
  'valid_normalized_email_users',
  'email_verified_true_users',
  'email_verified_false_users',
  'one_google_account_users',
  'zero_google_account_users',
  'multiple_google_account_users',
  'verified_with_one_google_users',
  'unverified_with_one_google_users',
  'verified_without_one_google_users',
  'ready_identity_users',
  'ready_super_users',
  'ready_operational_users',
  'distinct_google_account_ids'
]) {
  assert.ok(script.includes(`) as ${aggregate}`) || script.includes(`as ${aggregate}`),
    `missing privacy-safe readiness aggregate ${aggregate}`);
}
assert.match(script, /one_google_account_users[\s\S]*google_account_count = 1[\s\S]*google_account_id is not null/,
  'Google-account readiness must be counted independently from email verification');
assert.match(script, /email_verified_false_users[\s\S]*email_verified = false/,
  'diagnostic must explicitly count unverified active candidate identities');
assert.match(script, /ready_super_users[\s\S]*authority_role = 'admin'/,
  'readiness diagnostic may disclose only aggregate SUPER readiness');
assert.match(script, /ready_operational_users[\s\S]*authority_role = 'operator'/,
  'readiness diagnostic may disclose only aggregate OPERATIONAL readiness');
assert.match(script, /count\(distinct normalized_email\)[\s\S]*= 4/,
  'apply must require four distinct server-derived normalized identities');
assert.match(script, /active_grant_rows:\s*34|active_grant_rows = 34|count\(\*\) from active_grants\) = 34/,
  'adoption must freeze the verified 34-row runtime authority state');
assert.match(script, /super_users:\s*2[\s\S]*operational_users:\s*2[\s\S]*other_users:\s*0/,
  'preflight contract must freeze the 2 SUPER + 2 OPERATIONAL + 0 other shape');

assert.match(script, /metadata \?\| array\['source','principalId','provider','adoptionMarker'\]/,
  'apply must fail on reserved metadata key collisions');
assert.match(script, /insert into padiem_admin_identity_allowlist/,
  'apply must create the four allowlist principal rows');
assert.match(script, /provider_account_id[\s\S]*i\.google_account_id/,
  'adopted principal must be pinned to the unique existing Google account');
assert.match(script, /when i\.authority_role = 'admin' then array\['\*'\]::text\[\]/,
  'SUPER allowlist storage must remain migration-049 compatible');
assert.match(script, /else array\['benefit\.manage','business\.review','community\.moderate','inquiry\.respond','official-content\.manage','resident\.verification\.exempt','resident_news\.review','safety\.report\.review'\]::text\[\]/,
  'OPERATIONAL allowlist storage must preserve all eight bounded scopes');

const grantUpdate = script.match(/update padiem_operator_grants g[\s\S]*?returning g\.id, g\.user_id, g\.scope/);
assert.ok(grantUpdate, 'apply must attach existing grants through one bounded metadata update');
assert.match(grantUpdate[0], /set metadata = g\.metadata \|\| jsonb_build_object/,
  'adoption may add only principal-tracking metadata to existing grants');
assert.doesNotMatch(grantUpdate[0], /set\s+(?:status|scope|expires_at|granted_at|granted_by_user_id)\b/i,
  'adoption must not mutate grant authority/status/lifetime/provenance');
assert.doesNotMatch(script, /insert into padiem_operator_grants/i,
  'adoption must never mint new runtime grants');
assert.doesNotMatch(script, /delete from padiem_operator_grants/i,
  'adoption rollback must never delete runtime grants');

assert.match(script, /linked_grants\) = 34/,
  'atomic apply must require all 34 existing grants to be attached');
assert.match(script, /inserted_principals\) = 4/,
  'atomic apply must require exactly four principal inserts');
assert.match(script, /else \(1 \/ 0\)/,
  'unexpected mutation counts must raise inside the SQL statement so it rolls back atomically');
assert.match(script, /ADMIN_EXISTING_PRINCIPALS_ADOPTED/,
  'successful adoption must write a bounded system audit');

const rollbackUpdate = script.match(/unlinked_grants as materialized \([\s\S]*?returning g\.id/);
assert.ok(rollbackUpdate, 'rollback must have a bounded metadata-only unlink');
assert.match(rollbackUpdate[0], /metadata - 'source'[\s\S]*- 'principalId'[\s\S]*- 'provider'[\s\S]*- 'adoptionMarker'/,
  'rollback must remove only adoption-reserved metadata keys');
assert.match(script, /delete from padiem_admin_identity_allowlist p/,
  'rollback may delete only the adoption-created principal rows');
assert.match(script, /ADMIN_EXISTING_PRINCIPALS_ADOPTION_ROLLED_BACK/,
  'successful rollback must be audited');

assert.doesNotMatch(script, /console\.(?:log|error)\([^\n]*(?:normalized_email|google_account_id|auth_user_id|user_id)/i,
  'identity/account values must never be printed');
assert.doesNotMatch(script, /fields:\s*\[[^\]]*(?:normalized_email|google_account_id|auth_user_id|user_id)/i,
  'diagnostic output must remain aggregate-only and must not whitelist identity fields');
assert.doesNotMatch(script, /access_token|refresh_token|id_token|session\.token|ip_address|user_agent/i,
  'adoption must not touch auth tokens or session metadata');

console.log('production existing admin principal adoption contract: PASS');
