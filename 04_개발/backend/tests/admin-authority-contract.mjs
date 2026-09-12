/**
 * #411 static contract: centralized PADIEM authority-level surface.
 * Guards the boundaries that the runtime test cannot see:
 * no legacy user_roles authority, no email/header-based decisions,
 * privileged scope registry, and app.ts dispatch ownership before the
 * terminal admin-v1 gate. Council/operational semantics must stay untouched.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const read = (...parts) => readFileSync(resolve(root, ...parts), 'utf8');

const authority = read('src', 'padiem-authority-v1.ts');
const handler = read('src', 'admin-authority-v1.ts');
const app = read('src', 'app.ts');
const authz = read('src', 'authorization-v2.ts');
const operational = read('src', 'operational-authz-v2.ts');

// Centralized contract derives authority from padiem_operator_grants only, fail-closed.
assert.match(authority, /from padiem_operator_grants/i);
assert.match(authority, /status = 'active'/);
assert.match(authority, /\(expires_at is null or expires_at > now\(\)\)/);
assert.match(authority, /authorization\.padiem-authority-check/);
assert.match(authority, /insert into audit_events/i);

// Legacy role tables must never back the new authority surface.
for (const [name, source] of [['padiem-authority-v1', authority], ['admin-authority-v1', handler]]) {
  assert.doesNotMatch(source, /user_roles/i, `${name} must not use legacy user_roles authority`);
  assert.doesNotMatch(source, /complex_memberships/i, `${name} must not use legacy manager membership`);
  assert.doesNotMatch(source, /x-danjion-role|x-danjion-verified|x-danjion-complex/i, `${name} must not trust client authority headers`);
}

// No owner emails or account identifiers in request-path code.
assert.doesNotMatch(authority, /skerish|muphobia|charliekant|padiemipu|@naver\.com|@gmail\.com|email/i);
assert.doesNotMatch(handler, /skerish|muphobia|charliekant|padiemipu|@naver\.com|@gmail\.com|email/i);

// Privileged scope registry: every owner-only scope named in #411 exists.
for (const scope of [
  'platform.users.read',
  'platform.users.manage',
  'platform.authz.manage',
  'platform.audit.read',
  'platform.audit.export',
  'platform.sensitive.read',
  'platform.system.manage'
]) {
  assert.ok(authority.includes(`'${scope}'`), `missing privileged scope: ${scope}`);
}

// Read-only endpoint contract fixed with #412.
assert.match(handler, /request\.method !== 'GET'/);
assert.match(handler, /\/api\/v1\/admin\/authority/);
assert.match(handler, /requireActor/);
assert.match(handler, /ADMIN_AUTHORITY_REQUIRED/);
assert.match(handler, /AUTHORITY_DB_ERROR/);
assert.match(authority, /최고관리자/);
assert.match(authority, /일반관리자/);
for (const key of ['level', 'label', 'scopes', 'wildcard']) {
  assert.ok(new RegExp(`${key}:`).test(authority), `response data must expose ${key}`);
}

// The authority handler must intercept before the terminal admin-v1 gate.
const authorityIndex = app.indexOf('handleAdminAuthorityRequest(request, env, id)');
const legacyIndex = app.indexOf('handleAdminRequest(request, env, id)');
assert.ok(authorityIndex >= 0, 'app must mount the admin authority handler');
assert.ok(legacyIndex > authorityIndex, 'admin authority handler must intercept before legacy admin-v1');

// Existing PADIEM/operational/council semantics preserved.
assert.match(authz, /from padiem_operator_grants/i);
assert.match(authz, /scope = '\*'|scope = '\$\{scope\}' or scope = '\*'/);
assert.match(operational, /operator_kind = 'resident_council'/i);
assert.match(operational, /authorization\.operational-check/);

console.log('Padiem authority backend contract PASS');
