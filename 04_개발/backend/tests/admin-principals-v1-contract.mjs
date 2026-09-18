import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const src = readFileSync(resolve(root, 'src', 'admin-principals-v1.ts'), 'utf8');
const policy = readFileSync(resolve(root, 'src', 'admin-scope-policy-v1.ts'), 'utf8');
const app = readFileSync(resolve(root, 'src', 'app.ts'), 'utf8');

assert.match(src, /requirePadiemPrivilegedScope/);
assert.match(src, /'platform\.authz\.manage'/);
assert.match(src, /OPERATIONAL_ADMIN_SCOPES/);
for (const scope of [
  'benefit.manage',
  'business.review',
  'community.moderate',
  'inquiry.respond',
  'official-content.manage',
  'resident.verification.exempt',
  'resident.verification.manage',
  'resident_news.review',
  'safety.report.review'
]) {
  assert.ok(policy.includes(`'${scope}'`), `missing fixed OPERATIONAL scope ${scope}`);
}
assert.match(policy, /principalScopesForRole[\s\S]*role === 'admin' \? \['\*'\]/,
  'SUPER allowlist row must remain schema-compatible wildcard only');
assert.match(policy, /SUPER_ADMIN_RUNTIME_SCOPES[\s\S]*'\*'[\s\S]*\.\.\.OPERATIONAL_ADMIN_SCOPES/,
  'SUPER runtime must preserve wildcard plus the full operational bundle');
assert.match(policy, /runtimeScopesForRole/,
  'principal synchronization must use a separate runtime scope policy');
assert.match(src, /principalScopesForRole\(role\)/,
  'principal rows must use the allowlist storage policy');
assert.match(src, /runtimeScopesForRole\(role\)/,
  'runtime synchronization must use the full runtime authority policy');
assert.match(src, /jsonb_array_elements_text\(\$\{runtimeScopesJson\}::jsonb\)/,
  'role updates must rematerialize the full runtime bundle, not allowlist storage scopes');
assert.match(src, /SELF_LOCKOUT_BLOCKED/, 'self-demotion/self-revocation must fail closed');
assert.match(src, /metadata ->> 'source' = 'admin_identity_allowlist'/);
assert.match(src, /metadata ->> 'principalId'/);
assert.match(src, /set status = 'revoked'/, 'runtime grants must be revoked during role/status synchronization');
assert.match(src, /insert into padiem_operator_grants/, 'active role synchronization must materialize runtime grants');
assert.match(src, /admin\.principal\.create/);
assert.match(src, /admin\.principal\.update/);
assert.match(src, /insert into audit_events/, 'principal mutations must be audited');
assert.match(src, /normalized_email/);

assert.match(src, /where p\.provider in \('google','credential'\)/,
  'principal listing must include adopted Google and credential principals');
assert.match(src, /select id, provider, normalized_email, authority_level, status/,
  'principal update lookup must retain the server-side provider');
assert.match(src, /provider:\s*String\(current\.provider\)/,
  'runtime grant synchronization metadata must preserve the adopted provider');
assert.match(src, /where p\.provider = \$\{String\(current\.provider\)\}/,
  'duplicate checks must stay provider-scoped for adopted credential rows');
assert.doesNotMatch(src, /provider_account_id\s*=/, 'V1 must not let the client edit provider account identity');
assert.doesNotMatch(src, /complex_memberships/i, 'PADIEM principal management must not use legacy apartment roles');
assert.doesNotMatch(src, /(?:resident_profiles|resident_verifications|household_units|complex_memberships)/i,
  'principal-management API must not query resident/household/legacy apartment authority data');

assert.match(src, /hasUnexpectedKeys\(payload, \['email', 'role', 'reason'\]\)/,
  'create must reject arbitrary authority/provider fields');
assert.match(src, /hasUnexpectedKeys\(payload, \['role', 'status', 'reason'\]\)/,
  'update must reject email/provider/account/scope reassignment fields');
for (const forbiddenPayloadField of ['payload.scopes', 'payload.provider', 'payload.provider_account_id', 'payload.providerAccountId']) {
  assert.ok(!src.includes(forbiddenPayloadField), `server must not consume client field ${forbiddenPayloadField}`);
}
assert.match(src, /ADMIN_PRINCIPAL_EXISTS/, 'duplicate active principals must map to an explicit conflict');
assert.match(src, /String\(\(error as \{ code\?: unknown \}\)\.code \?\? ''\) === '23505'/,
  'unique-index races must normalize to ADMIN_PRINCIPAL_EXISTS instead of generic 503');
assert.match(src, /from updated u\s+where u\.id = \$\{principalId\}::uuid[\s\S]*?g\.metadata ->> 'principalId'/,
  'runtime revocation must depend on a successful allowlist update');
assert.match(src, /cross join updated u\s+cross join revoke_barrier rb\s+where u\.status = 'active'/,
  'grant rematerialization must depend on updated principal state and completed revocation');
assert.match(src, /count\(distinct g\.user_id\)\s+filter \([\s\S]*?g\.status = 'active'/,
  'runtimeUserCount must count only active unexpired principal-linked grants');
assert.match(src, /count\(distinct user_id\)::int from inserted_grants/,
  'update response must report actually materialized principal-linked runtime users');
assert.match(src, /array_agg\(distinct scope order by scope\) from inserted_grants/,
  'update response must report actual inserted runtime scopes, not desired scopes');
assert.match(src, /select 1[\s\S]*?normalized_email = \$\{String\(current\.normalized_email\)\}[\s\S]*?p\.id <> \$\{principalId\}::uuid/,
  'reactivating a historical principal must fail fast when another active principal owns the same email');

assert.ok(app.includes("import { handleAdminPrincipalRequest } from './admin-principals-v1';"));
const mounted = app.indexOf('handleAdminPrincipalRequest(request, env, id)');
const terminal = app.indexOf('handleAdminRequest(request, env, id)');
assert.ok(mounted >= 0 && terminal > mounted, 'principal manager must mount before terminal /admin/ fallback');

console.log('Admin principal management contract PASS');
