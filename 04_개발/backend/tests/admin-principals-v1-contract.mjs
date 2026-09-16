import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const src = readFileSync(resolve(root, 'src', 'admin-principals-v1.ts'), 'utf8');
const app = readFileSync(resolve(root, 'src', 'app.ts'), 'utf8');

assert.match(src, /requirePadiemPrivilegedScope/);
assert.match(src, /'platform\.authz\.manage'/);
assert.match(src, /OPERATIONAL_ADMIN_SCOPES/);
for (const scope of ['business.review', 'official-content.manage', 'benefit.manage', 'resident_news.review']) {
  assert.ok(src.includes(`'${scope}'`), `missing fixed OPERATIONAL scope ${scope}`);
}
assert.match(src, /role === 'admin' \? \['\*'\]/, 'SUPER role must map only to wildcard scope');
assert.match(src, /SELF_LOCKOUT_BLOCKED/, 'self-demotion/self-revocation must fail closed');
assert.match(src, /metadata ->> 'source' = 'admin_identity_allowlist'/);
assert.match(src, /metadata ->> 'principalId'/);
assert.match(src, /set status = 'revoked'/, 'runtime grants must be revoked during role/status synchronization');
assert.match(src, /insert into padiem_operator_grants/, 'active role synchronization must materialize runtime grants');
assert.match(src, /admin\.principal\.create/);
assert.match(src, /admin\.principal\.update/);
assert.match(src, /insert into audit_events/, 'principal mutations must be audited');
assert.match(src, /normalized_email/);
assert.doesNotMatch(src, /provider_account_id\s*=/, 'V1 must not let the client edit provider account identity');
assert.doesNotMatch(src, /complex_memberships/i, 'PADIEM principal management must not use legacy apartment roles');
assert.doesNotMatch(src, /resident/i, 'principal-management API must not query or expose resident-domain data');

assert.ok(app.includes("import { handleAdminPrincipalRequest } from './admin-principals-v1';"));
const mounted = app.indexOf('handleAdminPrincipalRequest(request, env, id)');
const terminal = app.indexOf('handleAdminRequest(request, env, id)');
assert.ok(mounted >= 0 && terminal > mounted, 'principal manager must mount before terminal /admin/ fallback');

console.log('Admin principal management contract PASS');
