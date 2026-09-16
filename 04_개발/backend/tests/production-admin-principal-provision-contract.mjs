import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../../.github/workflows/production-admin-principal-provision.yml', import.meta.url), 'utf8');
const script = await readFile(new URL('../scripts/production-admin-principal-provision.mjs', import.meta.url), 'utf8');

assert.match(workflow, /workflow_dispatch:/, 'provisioning must be manual dispatch only');
assert.doesNotMatch(workflow, /^\s*(push|pull_request|schedule):/m, 'provisioning must not auto-run');
assert.match(workflow, /environment:\s*production/, 'provisioning must use the production environment');
assert.match(workflow, /expected_main:/, 'provisioning must require exact main authority');
assert.match(workflow, /Exact main authority guard/, 'workflow must exact-main guard');
assert.match(workflow, /mode:[\s\S]*preflight[\s\S]*apply/, 'workflow must expose preflight/apply modes');
assert.match(workflow, /confirm_production:/, 'apply must require explicit boolean authorization');
assert.match(workflow, /PROVISION FOUR ADMIN PRINCIPALS/, 'apply must require the exact confirmation phrase');
assert.match(workflow, /if: inputs\.mode == 'apply'/, 'mutation step must be apply-only');

for (const name of [
  'DANJION_ADMIN_SUPER_1_EMAIL',
  'DANJION_ADMIN_SUPER_2_EMAIL',
  'DANJION_ADMIN_OPERATIONAL_1_EMAIL',
  'DANJION_ADMIN_OPERATIONAL_2_EMAIL'
]) {
  assert.match(workflow, new RegExp(`${name}: \\${\\{\\{ secrets\\.${name} \\}\\}`),
    `${name} must come from a GitHub secret`);
}
assert.doesNotMatch(
  workflow,
  /inputs\.(DANJION_ADMIN_|super_1_email|super_2_email|operational_1_email|operational_2_email)/i,
  'administrator identities must never be workflow inputs'
);
assert.doesNotMatch(workflow, /wrangler\s+(deploy|secret)|pages\s+deploy/i,
  'principal provisioning must not deploy or mutate Worker/Page secrets');
assert.match(workflow, /GRANT_MUTATION=0/, 'workflow must explicitly preserve zero direct grant mutation');
assert.match(workflow, /ACCOUNT_LINK_MUTATION=0/, 'workflow must explicitly preserve zero account-link mutation');

assert.match(script, /ADMIN_PROVISION_MODE \|\| 'preflight'/, 'script must default to preflight');
assert.match(script, /new Set\(principals\.map\(\(principal\) => principal\.email\)\)\.size !== 4/,
  'all four administrator identities must be pairwise distinct');
assert.match(script, /before\.allowlist_total !== 0[\s\S]*before\.bootstrap_active_grant_rows !== 0/,
  'apply must require completely empty initial administrator state');
assert.match(script, /not exists \([\s\S]*from padiem_admin_identity_allowlist/,
  'atomic apply must guard against any existing principal row');
assert.match(script, /not exists \([\s\S]*from padiem_operator_grants[\s\S]*admin_identity_allowlist/,
  'atomic apply must guard against bootstrap-origin runtime grants');
assert.match(script, /insert into padiem_admin_identity_allowlist/,
  'apply must insert only the approved allowlist principals');
assert.match(script, /provider_account_id,[\s\S]*'google',[\s\S]*null,/,
  'initial provisioning must not invent provider account IDs');
assert.match(script, /'admin'[\s\S]*array\['\*'\]::text\[\]/,
  'SUPER principal scope must be exact wildcard');
for (const scope of ['benefit.manage','business.review','official-content.manage','resident_news.review']) {
  assert.match(script, new RegExp(scope.replace('.', '\\.')),
    `OPERATIONAL preset must include ${scope}`);
}
assert.match(script, /insert into audit_events[\s\S]*'system'[\s\S]*ADMIN_INITIAL_PRINCIPALS_PROVISIONED/,
  'successful initial provisioning must emit a minimal system audit');
assert.doesNotMatch(script, /insert into padiem_operator_grants/i,
  'initial provisioning must never directly mint runtime grants');
assert.doesNotMatch(script, /update\s+padiem_operator_grants|delete\s+from\s+padiem_operator_grants/i,
  'initial provisioning must never mutate existing runtime grants');
assert.match(script, /insertedCount !== 4[\s\S]*superCount !== 2[\s\S]*operationalCount !== 2[\s\S]*auditCount !== 1/,
  'apply must fail unless the atomic result is exactly 4 principals, 2+2, and one audit');
assert.match(script, /after\.bootstrap_active_grant_rows !== 0/,
  'postread must prove provisioning itself created no runtime grants');
assert.doesNotMatch(script, /console\.(?:log|error)\([^\n]*(?:principal\.email|normalized_email|DANJION_ADMIN_)/i,
  'administrator identity values must never be printed');

console.log('production admin principal provisioning contract: PASS');
