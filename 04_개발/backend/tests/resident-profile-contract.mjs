import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, api, app] = await Promise.all([
  readFile(new URL('migrations/026_resident_public_profiles.sql', root), 'utf8'),
  readFile(new URL('src/resident-profile-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8')
]);

assert.match(migration, /create table if not exists resident_public_profiles\b/i, 'missing public profile extension table');
assert.match(migration, /user_id uuid primary key references app_users\(id\)/i, 'profile extension must be 1:1 with app_users');
assert.match(migration, /char_length\(public_bio\) <= 300/i, 'public bio must be DB bounded');
assert.match(migration, /set_updated_at\(\)/i, 'profile extension needs updated-at trigger');

assert.match(api, /requireVerifiedResident\(/, 'viewer must pass canonical verified-resident authorization');
assert.match(api, /hm\.complex_id = \$\{complexId\}::uuid/i, 'target must be verified in the viewer complex');
assert.match(api, /u\.account_status = 'active'/i, 'closed target accounts must not have a public resident profile');
assert.match(api, /from blocks/i, 'profile safety must respect block relationships');
assert.match(api, /PROFILE_NOT_FOUND/, 'blocked and unavailable profiles should fail closed');
assert.match(api, /PROFILE_LABEL = 'verified_resident'/, 'resident label must be generic');
assert.match(api, /to_char\(u\.created_at at time zone 'UTC', 'YYYY-MM'\)/i, 'joined month must not expose full timestamps');
assert.match(api, /new Set\(\['nickname', 'avatarUrl', 'publicBio'\]\)/, 'own update must use a narrow allowlist');
assert.match(api, /url\.protocol !== 'https:'/, 'avatar URL must be HTTPS');
assert.match(api, /MAX_NICKNAME_CHARS = 40/, 'nickname must be bounded');
assert.match(api, /MAX_BIO_CHARS = 300/, 'bio must be bounded');
assert.doesNotMatch(api, /building_code|unit_code|resident_verifications|evidence_object_key|auth_user_id/i,
  'profile runtime must not read residence/provider proof fields');

for (const route of [
  '/api/v1/me/profile',
  String.raw`\/api\/v1\/profiles\/([0-9a-fA-F-]+)$`
]) {
  assert.ok(api.includes(route), `missing route contract ${route}`);
}

assert.match(app, /handleResidentProfileRequest/);
assert.match(app, /const residentProfileResponse = await handleResidentProfileRequest\(request, env, id\)/);

console.log('PASS safe resident public profile schema/API/privacy contract');
