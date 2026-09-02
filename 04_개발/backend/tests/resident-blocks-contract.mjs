import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, api, messages, profile, app] = await Promise.all([
  readFile(new URL('migrations/024_resident_messages.sql', root), 'utf8'),
  readFile(new URL('src/resident-blocks-v1.ts', root), 'utf8'),
  readFile(new URL('src/resident-messages-v1.ts', root), 'utf8'),
  readFile(new URL('src/resident-profile-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8')
]);

assert.match(migration, /create table if not exists blocks\b/i, 'canonical blocks table must already exist');
assert.match(migration, /primary key \(blocker_user_id, blocked_user_id\)/i, 'block relation must be unique');
assert.match(migration, /blocker_user_id <> blocked_user_id/i, 'self-block must be DB-rejected');
assert.doesNotMatch(api, /create table|insert into resident_blocks/i, 'block API must not create a parallel persistence model');

assert.match(api, /requireVerifiedResident\(/, 'block management must require a verified resident actor');
assert.match(api, /targetVerifiedInComplex\(/, 'new block target must be verified in the actor complex');
assert.match(api, /on conflict \(blocker_user_id, blocked_user_id\)/i, 'block create must be idempotent');
assert.match(api, /delete from blocks/i, 'unblock must remove the canonical block row');
assert.match(api, /\/api\/v1\/me\/blocks/, 'block management route must be present');
assert.doesNotMatch(api, /building_code|unit_code|resident_code|\bemail\b|auth_user_id|evidence_object_key/i,
  'block API must not query residence/provider PII');

assert.match(messages, /from blocks/i, 'messaging must continue using the same block table');
assert.match(profile, /from blocks/i, 'profile visibility must continue using the same block table');
assert.match(app, /handleResidentBlockRequest/);
assert.match(app, /const residentBlockResponse = await handleResidentBlockRequest\(request, env, id\)/);

console.log('PASS resident block management reuses canonical messaging/profile safety relation');
