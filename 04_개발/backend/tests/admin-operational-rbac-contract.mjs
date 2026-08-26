import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const authz = readFileSync(resolve(root, 'src', 'operational-authz-v2.ts'), 'utf8');
const admin = readFileSync(resolve(root, 'src', 'admin-operational-v2.ts'), 'utf8');
const app = readFileSync(resolve(root, 'src', 'app.ts'), 'utf8');

assert.match(authz, /from padiem_operator_grants/i);
assert.match(authz, /from complex_operator_grants/i);
assert.match(authz, /operator_kind = 'resident_council'/i);
assert.match(authz, /authorization\.operational-check/i);
assert.match(authz, /insert into audit_events/i);
assert.doesNotMatch(authz, /(?:from|join)\s+complex_memberships/i, 'operational authority must never query legacy manager/admin membership');
assert.doesNotMatch(authz, /operator_kind\s*=\s*'onboarding_support'/i, 'day-to-day operational helper must not accept management-office support authority');
assert.doesNotMatch(authz, /x-danjion-role|x-danjion-verified|x-danjion-complex/i, 'client headers must not grant authority');

assert.match(admin, /business\.review/);
assert.match(admin, /council\.business\.review/);
assert.match(admin, /official-content\.manage/);
assert.match(admin, /council\.official-content\.manage/);
assert.match(admin, /benefit\.manage/);
assert.match(admin, /council\.benefit\.manage/);
assert.doesNotMatch(admin, /requireManager|(?:from|join)\s+complex_memberships/i, 'new operational route layer must not use legacy manager/admin authorization');

for (const fn of [
  'patchApplication',
  'createPost',
  'patchPost',
  'createBenefit',
  'patchBenefit',
  'handleAdminOperationalRequest'
]) {
  assert.ok(admin.includes(fn), `missing migrated admin operation: ${fn}`);
}
assert.ok(admin.includes('business-applications'), 'business application list/review routes must be intercepted');
assert.ok(admin.includes('/posts'), 'official post routes must be intercepted');
assert.ok(admin.includes('/benefits'), 'benefit routes must be intercepted');

const operationalIndex = app.indexOf('handleAdminOperationalRequest(request, env, id)');
const legacyIndex = app.indexOf('handleAdminRequest(request, env, id)');
assert.ok(operationalIndex >= 0, 'app must mount operational RBAC handler');
assert.ok(legacyIndex > operationalIndex, 'operational RBAC handler must intercept before legacy admin-v1');

console.log('Admin operational RBAC contract PASS');
