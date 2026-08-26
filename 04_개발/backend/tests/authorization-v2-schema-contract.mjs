import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const migration = (name) => readFileSync(resolve(root, 'migrations', name), 'utf8');
const source = readFileSync(resolve(root, 'src', 'authorization-v2.ts'), 'utf8');

const m009 = migration('009_household_foundation.sql');
const m010 = migration('010_household_invite_family_lifecycle.sql');
const m011 = migration('011_consent_authorization_audit.sql');
const m012 = migration('012_padiem_operator_grants.sql');
const m015 = migration('015_complex_operator_grants.sql');

assert.match(m009, /create table if not exists complex_units/i);
assert.match(m009, /create table if not exists households/i);
assert.match(m009, /create table if not exists household_memberships/i);
assert.match(m009, /foreign key \(household_id, complex_id\)/i);

assert.match(m010, /token_hash text not null unique/i);
assert.doesNotMatch(m010, /phone|email|mobile|resident_name/i, 'invite lifecycle must not introduce contact-list PII');
assert.match(m010, /foreign key \(invite_token_id, household_id, complex_id\)/i);
assert.match(m010, /foreign key \(accepted_membership_id, household_id, complex_id\)/i);

assert.match(m011, /create table if not exists consent_records/i);
assert.match(m011, /create table if not exists audit_events/i);
assert.match(m011, /decision text check \(decision in \('allowed','denied','recorded'\)\)/i);

assert.match(m012, /create table if not exists padiem_operator_grants/i);
assert.match(m012, /never infer these grants from apartment complex manager\/admin membership/i);

assert.match(m015, /create table if not exists complex_operator_grants/i);
assert.match(m015, /operator_kind in \('resident_council','onboarding_support'\)/i);
assert.match(m015, /operator_kind = 'resident_council' and scope like 'council\.%'/i);
assert.match(m015, /operator_kind = 'onboarding_support' and scope like 'onboarding\.%'/i);
assert.match(m015, /never infer resident-council or onboarding authority from legacy complex_memberships manager\/admin roles/i);
assert.doesNotMatch(m015, /email|phone|mobile|resident_name/i, 'operator grants must not duplicate resident contact PII');

assert.match(source, /requireVerifiedResident/);
assert.match(source, /requirePadiemOperator/);
assert.match(source, /requireComplexOperator/);
assert.match(source, /from household_memberships hm/i);
assert.match(source, /from padiem_operator_grants/i);
assert.match(source, /left join complex_operator_grants g/i);
assert.match(source, /scope\.startsWith\('council\.'\)/);
assert.match(source, /scope\.startsWith\('onboarding\.'\)/);
assert.match(source, /insert into audit_events/i);
assert.doesNotMatch(source, /from complex_memberships/i, 'v2 authorization must not derive authority from legacy complex_memberships');
assert.doesNotMatch(source, /x-danjion-role|x-danjion-verified|x-danjion-complex/i, 'v2 authorization must not trust client authorization headers');

console.log('Authorization v2 schema/separation contract PASS');
