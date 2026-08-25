import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const migrationsDir = resolve(here, '../migrations');
const read = (name) => readFileSync(resolve(migrationsDir, name), 'utf8');

const m009 = read('009_household_foundation.sql');
const m010 = read('010_household_invite_family_lifecycle.sql');
const m011 = read('011_consent_authorization_audit.sql');
const m012 = read('012_padiem_operator_grants.sql');

assert.match(m009, /create table if not exists complex_units/i);
assert.match(m009, /create table if not exists households/i);
assert.match(m009, /create table if not exists household_memberships/i);
assert.doesNotMatch(m009, /do\s+\$\$/i, 'migration runner must not depend on DO $$ blocks');
assert.match(m009, /drop trigger if exists trg_complex_units_updated_at/i);

assert.match(m010, /create table if not exists household_invite_tokens/i);
assert.match(m010, /create table if not exists family_invites/i);
assert.match(m010, /on delete set null \(accepted_membership_id\)/i);
assert.doesNotMatch(m010, /phone|mobile|resident_name/i);

assert.match(m011, /create table if not exists consent_records/i);
assert.match(m011, /create table if not exists audit_events/i);
assert.match(m012, /create table if not exists padiem_operator_grants/i);

console.log('Authorization v2 migration ordering/runner contract PASS');
