import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const runtime = read('src/account-lifecycle-v1.ts');
const auth = read('src/auth-v1.ts');
const app = read('src/app.ts');
const payload = read('src/payload-policy.ts');
const migration = read('migrations/017_account_lifecycle.sql');
const consentMigration = read('migrations/011_consent_authorization_audit.sql');
const householdMigration = read('migrations/009_household_foundation.sql');
const familyMigration = read('migrations/010_household_invite_family_lifecycle.sql');
const padiemMigration = read('migrations/012_padiem_operator_grants.sql');
const complexOperatorMigration = read('migrations/015_complex_operator_grants.sql');

const checks = [
  ['account lifecycle route is registered', app.includes('handleAccountLifecycleRequest')],
  ['consent endpoint exists', runtime.includes("path === '/api/v1/me/consents'")],
  ['account close endpoint exists', runtime.includes("path === '/api/v1/me/account/close'")],
  ['consent history is append only', runtime.includes('insert into consent_records') && !runtime.includes('update consent_records') && !runtime.includes('delete from consent_records')],
  ['consent current state uses latest event', runtime.includes('distinct on (consent_type)') && runtime.includes('recorded_at desc')],
  ['consent types stay bounded', runtime.includes("'terms'") && runtime.includes("'privacy'") && runtime.includes("'resident_rules'") && runtime.includes("'community_rules'") && runtime.includes("'marketing'")],
  ['consent action is audited', runtime.includes("'account.consent.record'") && runtime.includes("'CONSENT_ACCEPTED'") && runtime.includes("'CONSENT_WITHDRAWN'")],
  ['account closure requires explicit confirmation', runtime.includes('CLOSE_DANJION_ACCOUNT') && runtime.includes('ACCOUNT_CLOSE_CONFIRMATION_REQUIRED')],
  ['account closure revokes household authorization', runtime.includes('update household_memberships') && runtime.includes("status in ('pending', 'verified')") && runtime.includes("status = 'revoked'")],
  ['account closure revokes PADIEM grants', runtime.includes('update padiem_operator_grants') && runtime.includes("product_account_closed")],
  ['account closure revokes complex operator grants', runtime.includes('update complex_operator_grants') && runtime.includes("product_account_closed")],
  ['account closure revokes family invite capability', runtime.includes('update household_invite_tokens') && runtime.includes('update family_invites')],
  ['account closure anonymizes product presentation', runtime.includes("display_name = '탈퇴한 사용자'") && runtime.includes('avatar_url = null')],
  ['account closure is audited', runtime.includes("'account.close'") && runtime.includes("'PRODUCT_ACCOUNT_CLOSED'")],
  ['account closure does not delete historical data', !runtime.includes('delete from app_users') && !runtime.includes('delete from audit_events') && !runtime.includes('delete from consent_records')],
  ['provider account deletion is explicitly not claimed', runtime.includes('authProviderAccountDeleted: false')],
  ['runtime does not mutate Better Auth schema', !runtime.includes('danjion_auth') && !runtime.includes('neon_auth')],
  ['closed account is a first-class product state', migration.includes("account_status") && migration.includes("'active','closed'")],
  ['closed account requires closed timestamp', migration.includes('chk_app_users_closed_at') && migration.includes('closed_at is not null')],
  ['auth reads product account state', auth.includes('account_status') && auth.includes('accountStatus')],
  ['auth rejects closed product accounts', auth.includes('AUTH_ACCOUNT_CLOSED') && auth.includes("actor === 'closed'")],
  ['external auth token never silently re-bootstraps a closed account', auth.includes('actorBySubject(sql, subject)') && auth.includes("record.accountStatus === 'closed'") && auth.includes("return 'closed'")],
  ['payload policy bounds lifecycle fields', payload.includes('consentType: 80') && payload.includes('policyVersion: 80') && payload.includes('confirm: 80')],
  ['consent persistence foundation remains available', consentMigration.includes('create table if not exists consent_records')],
  ['household revocation target exists', householdMigration.includes('create table if not exists household_memberships')],
  ['family invite revocation target exists', familyMigration.includes('create table if not exists household_invite_tokens') && familyMigration.includes('create table if not exists family_invites')],
  ['PADIEM revocation target exists', padiemMigration.includes('create table if not exists padiem_operator_grants')],
  ['complex operator revocation target exists', complexOperatorMigration.includes('create table if not exists complex_operator_grants')],
  ['no family relationship labels are introduced', !runtime.includes('spouse') && !runtime.includes('parent') && !runtime.includes('child')],
  ['no resident PII is returned by lifecycle runtime', !runtime.includes('email') && !runtime.includes('phone') && !runtime.includes('building_code') && !runtime.includes('unit_code') && !runtime.includes('evidence_object_key')]
];

const failed = checks.filter(([, pass]) => !pass);
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`\n${failed.length} account lifecycle contract check(s) failed.`);
  process.exit(1);
}
console.log(`\n${checks.length} account lifecycle contract checks passed.`);
