import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const read = (...parts) => readFileSync(resolve(root, ...parts), 'utf8');

const migration = read('migrations', '049_padiem_admin_identity_allowlist.sql');
const ledger = JSON.parse(read('migration-safety-ledger.json'));
const bootstrap = read('src', 'admin-bootstrap-v1.ts');
const authority = read('src', 'padiem-authority-v1.ts');
const app = read('src', 'app.ts');

// Migration is schema-only: administrator principals are never seeded by source.
assert.match(migration, /create table if not exists padiem_admin_identity_allowlist/i);
assert.doesNotMatch(migration, /insert\s+into\s+padiem_admin_identity_allowlist/i);
assert.match(migration, /provider text not null check \(provider in \('google','credential'\)\)/i);
assert.match(migration, /authority_level text not null check \(authority_level in \('operator','admin'\)\)/i);
assert.match(migration, /authority_level = 'admin' and scopes = array\['\*'\]::text\[\]/i);
assert.match(migration, /authority_level = 'operator' and array_position\(scopes, '\*'\) is null/i);
assert.match(migration, /where status = 'active'/i);
assert.match(migration, /normalized_email = lower\(btrim\(normalized_email\)\)/i);

// Release ledger must classify 049 as ordinary production-safe schema, not seed data.
assert.deepEqual(ledger.migrations['049_padiem_admin_identity_allowlist.sql'], {
  class: 'schema',
  marker: { kind: 'table', schema: 'public', name: 'padiem_admin_identity_allowlist' }
});

// Request path has no hardcoded principal and cannot accept client-selected authority.
for (const forbidden of [
  /skerish/i,
  /muphobia/i,
  /charliekant/i,
  /padiemipu/i,
  /@naver\.com/i,
  /@gmail\.com/i,
  /request\.json\(/i,
  /request\.text\(/i,
  /x-danjion-role/i,
  /x-danjion-scope/i
]) {
  assert.doesNotMatch(bootstrap, forbidden, '#592 bootstrap must not trust embedded/client principal authority');
}

// Eligibility comes only from server-side Better Auth + pre-registration state.
assert.match(bootstrap, /join danjion_auth\."user" u/i);
assert.match(bootstrap, /join padiem_admin_identity_allowlist p/i);
assert.match(bootstrap, /p\.provider = 'google'/);
assert.match(bootstrap, /p\.normalized_email = lower\(btrim\(u\.email\)\)/);
assert.match(bootstrap, /p\.status = 'active'/);
assert.match(bootstrap, /p\.expires_at is null or p\.expires_at > now\(\)/);
assert.match(bootstrap, /u\.email_verified = true/);
assert.match(bootstrap, /from danjion_auth\.account a/i);
assert.match(bootstrap, /lower\(a\.provider_id\) = 'google'/);
assert.match(bootstrap, /p\.provider_account_id is null[\s\S]*p\.provider_account_id = a\.account_id/);

// Allowlist is onboarding approval only; persistent authorization stays in the
// existing grant ledger and gets canonical authority readback.
assert.match(bootstrap, /insert into padiem_operator_grants/i);
assert.match(bootstrap, /on conflict do nothing/i);
assert.match(bootstrap, /resolvePadiemAuthority\(sql, actor\.id\)/);
assert.match(authority, /from padiem_operator_grants/i);
assert.doesNotMatch(authority, /padiem_admin_identity_allowlist/i,
  'runtime admin authority must never consult onboarding allowlist directly');

// Audited, bounded endpoint semantics.
assert.match(bootstrap, /'authorization\.admin-bootstrap'/);
assert.match(bootstrap, /'admin\.bootstrap'/);
assert.match(bootstrap, /ADMIN_BOOTSTRAP_NOT_ALLOWED/);
assert.match(bootstrap, /ADMIN_BOOTSTRAP_PRINCIPAL_INVALID/);
assert.match(bootstrap, /ADMIN_BOOTSTRAP_GRANT_FAILED/);
assert.match(bootstrap, /ADMIN_BOOTSTRAP_UNAVAILABLE/);
assert.match(bootstrap, /url\.pathname !== BOOTSTRAP_PATH \|\| request\.method !== 'POST'/);

// Handler must be mounted before the terminal generic /api/v1/admin/* handler.
assert.match(app, /import \{ handleAdminBootstrapRequest \} from '\.\/admin-bootstrap-v1';/);
const bootstrapIndex = app.indexOf('handleAdminBootstrapRequest(request, env, id)');
const legacyIndex = app.indexOf('handleAdminRequest(request, env, id)');
assert.ok(bootstrapIndex >= 0, 'app must mount admin bootstrap handler');
assert.ok(legacyIndex > bootstrapIndex, 'admin bootstrap must intercept before generic admin fallback');

console.log('Admin bootstrap static contract PASS');
