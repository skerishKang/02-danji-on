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

assert.match(api, /requireVerifiedResident\(/, 'ordinary viewers must pass canonical verified-resident authorization');
assert.match(api, /if \(resident\.residentVerificationExempt\) \{[\s\S]*resident\.residentVerificationExemptionSource === 'scope'[\s\S]*OPERATOR_PROFILE_LABEL[\s\S]*ACCOUNT_PROFILE_LABEL[\s\S]*return \{ id: resident\.id, complexId: null, profileLabel \};/,
  '#920 exempt self must use the account-safe path and reserve operator label for the canonical scope source');
assert.doesNotMatch(api, /residentVerificationExempt[\s\S]{0,160}profileLabel: OPERATOR_PROFILE_LABEL/,
  'temporary/#823 resident admission must never be unconditionally labelled operator');
assert.match(api, /if \(resident\.status !== 403\) return resident;/,
  'the own-profile exemption must still never pre-empt a non-403 gate outcome for ordinary residents');
assert.match(api, /RESIDENT_VERIFICATION_EXEMPT_SCOPE = 'resident\.verification\.exempt'/,
  'operator self-profile bypass must require the explicit resident-verification exemption scope');
assert.match(api, /authority\.scopes\.includes\(RESIDENT_VERIFICATION_EXEMPT_SCOPE\)/,
  'operator self-profile bypass must inspect the actor own explicit scopes');
assert.doesNotMatch(api, /authority\.wildcard[^\n]*OPERATOR_PROFILE_LABEL/,
  'wildcard authority alone must never become the profile-edit exemption');
assert.match(api, /return viewer\.complexId\s*\?\s*loadPublicProfile\(/,
  'loadOwnProfile must only reach the household-scoped public profile when complexId is present');
assert.match(api, /loadOwnAccountProfile\(sql, viewer\.id\)/,
  'pre-verification self profile and exempt operators use the self-only account profile loader');
assert.match(api, /async function viewerForOwnProfile[\s\S]*?if \(resident\.status !== 403\)[\s\S]*?RESIDENT_VERIFICATION_EXEMPT_SCOPE/,
  'canonical scope fallback remains only after the verified-resident gate refuses');
assert.match(api, /ACCOUNT_PROFILE_LABEL = 'account'/,
  'an authenticated account must have a non-resident self-profile state before household verification');
assert.match(api, /return \{ id: actor\.id, complexId: null, profileLabel: ACCOUNT_PROFILE_LABEL \}/,
  'ordinary authenticated accounts may edit only their own account profile before household association');
assert.match(api, /async function getProfile[\s\S]*viewerForComplex\(/,
  'public profile lookup must continue to require verified-resident context');
assert.match(api, /path === '\/api\/v1\/me\/profile'/,
  'exemption must remain limited to the self-profile route');
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

assert.match(api, /public_activity_count/i, 'profile must derive a public activity count');
assert.match(api, /from community_posts cp[\s\S]*cp\.status = 'published'[\s\S]*cp\.visibility = 'verified_residents'/i,
  'public count must include only published resident-visible posts');
assert.match(api, /from community_comments cc[\s\S]*cc\.status = 'published'[\s\S]*parent_post\.status = 'published'[\s\S]*parent_post\.visibility = 'verified_residents'/i,
  'public count must include only published comments/replies on published resident-visible posts');
assert.match(api, /from business_reviews br[\s\S]*br\.status = 'active'[\s\S]*b\.status = 'approved'[\s\S]*bcr\.verification_status = 'verified'/i,
  'public count must include only active reviews on approved verified-complex businesses');
assert.match(api, /publicActivityCount:/,
  'profile response must expose the server-derived count');
assert.doesNotMatch(api, /community_reactions/i,
  'public profile count must not expose or count reactions');
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

console.log('PASS safe resident public profile schema/API/public-activity/privacy contract');
