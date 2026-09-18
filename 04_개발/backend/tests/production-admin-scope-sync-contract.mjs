import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow=await readFile(new URL('../../../.github/workflows/production-admin-scope-sync.yml',import.meta.url),'utf8');
const script=await readFile(new URL('../scripts/production-admin-scope-sync.mjs',import.meta.url),'utf8');

assert.match(workflow,/workflow_dispatch:/);
assert.doesNotMatch(workflow,/^\s*(push|pull_request|schedule):/m);
assert.match(workflow,/environment:\s*production/);
assert.match(workflow,/SYNC FOUR ADMIN PRINCIPALS TO CURRENT SCOPE/);
assert.match(workflow,/test:production-admin-scope-sync/);
assert.doesNotMatch(workflow,/wrangler\s+(deploy|secret)|pages\s+deploy/i);

assert.match(script,/resident\.verification\.manage/);
assert.match(script,/legacy_super_users/);
assert.match(script,/legacy_operator_users/);
assert.match(script,/current_super_users/);
assert.match(script,/current_operator_users/);
assert.match(script,/insert into padiem_operator_grants/);
assert.match(script,/scopeSync','resident-verification-manage-v1'/);
assert.match(script,/update padiem_admin_identity_allowlist p/);
assert.match(script,/authority_level='operator'/);
assert.doesNotMatch(script,/update\s+padiem_operator_grants/i,'existing grant rows must not be rewritten');
assert.doesNotMatch(script,/delete\s+from\s+padiem_operator_grants/i);
assert.doesNotMatch(script,/console\.(?:log|error)\([^\n]*(email|provider_account_id|user_id|principalId)/i);
assert.match(script,/added_grant_rows!==4/);
assert.match(script,/updated_allowlist_rows!==2/);
assert.match(script,/ADMIN_CURRENT_SCOPE_SYNCED/);

console.log('production admin scope sync contract: PASS');
