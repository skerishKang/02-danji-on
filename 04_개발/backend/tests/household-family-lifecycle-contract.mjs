import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const read = (...parts) => readFileSync(resolve(root, ...parts), 'utf8');

const app = read('src', 'app.ts');
const master = read('src', 'household-master-v2.ts');
const claim = read('src', 'household-claim-v2.ts');
const family = read('src', 'household-family-v2.ts');
const m009 = read('migrations', '009_household_foundation.sql');
const m010 = read('migrations', '010_household_invite_family_lifecycle.sql');
const m011 = read('migrations', '011_consent_authorization_audit.sql');
const m016 = read('migrations', '016_household_membership_lifecycle_uniqueness.sql');

assert.match(master, /household\\\/units|household\/units/);
assert.match(master, /requireActor/);
assert.match(master, /complex_units/);
assert.doesNotMatch(master, /household_id|invite_token|email|phone|auth_provider/i, 'unit master must not expose household/invite/PII');

assert.match(claim, /household\\\/claim|household\/claim/);
assert.match(claim, /SHA-256/);
assert.match(claim, /purpose = 'primary_claim'/);
assert.match(claim, /membership_role, status, verified_at/);
assert.match(claim, /'primary', 'verified'/);
assert.match(claim, /for update of t/i);
assert.doesNotMatch(claim, /token_hash.*metadata|metadata.*token_hash/i, 'claim audit must not persist invite secret material');

assert.match(family, /household\.family_invite\.create/);
assert.match(family, /household\.family_invite\.redeem/);
assert.match(family, /household\.family_invite\.revoke/);
assert.match(family, /household\.member\.leave/);
assert.match(family, /household\.member\.revoke/);
assert.match(family, /membership_role = 'primary'/);
assert.match(family, /hm\.status = 'verified'/);
assert.match(family, /purpose = 'family'/);
assert.match(family, /token_hash = \$\{tokenHash\}/);
assert.match(family, /'member', 'pending'/, 'family acceptance must create pending member only');
assert.match(family, /residentVerified: false/);
assert.match(family, /verificationRequired: true/);
assert.match(family, /PRIMARY_TRANSFER_REQUIRED/);
assert.match(family, /set status = 'revoked', revoked_at = now\(\), verified_at = null/);
assert.doesNotMatch(family, /email|phone|auth_provider|evidence_object_key/i, 'family lifecycle response/query must not disclose PII or verification evidence');
assert.doesNotMatch(family, /relationship|spouse|parent|child/i, 'relationship labels are deliberately not required');

assert.match(m009, /household_memberships/);
assert.match(m010, /household_invite_tokens/);
assert.match(m010, /family_invites/);
assert.match(m010, /token_hash text not null unique/);
assert.match(m011, /audit_events/);
assert.match(m016, /drop constraint if exists household_memberships_complex_id_user_id_key/i);
assert.match(m016, /where status in \('pending','verified'\)/i);
assert.match(m016, /uq_household_membership_active_complex_user/);
assert.match(m016, /uq_household_membership_active_household_user/);

const masterIndex = app.indexOf('handleHouseholdUnitMasterRequest(request, env, id)');
const claimIndex = app.indexOf('handleHouseholdPrimaryClaimRequest(request, env, id)');
const familyIndex = app.indexOf('handleHouseholdFamilyRequest(request, env, id)');
const residentVerificationIndex = app.indexOf('handleResidentVerificationRequest(request, env, id)');
assert.ok(masterIndex >= 0 && claimIndex > masterIndex && familyIndex > claimIndex, 'household routes must be mounted in deterministic order');
assert.ok(residentVerificationIndex > familyIndex, 'household association must be handled before separate resident-verification route');

console.log('Household family lifecycle contract PASS');
