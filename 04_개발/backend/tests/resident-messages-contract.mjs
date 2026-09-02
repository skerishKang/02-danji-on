import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, api, app] = await Promise.all([
  readFile(new URL('migrations/024_resident_messages.sql', root), 'utf8'),
  readFile(new URL('src/resident-messages-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8')
]);

for (const table of ['conversations', 'conversation_members', 'messages', 'blocks']) {
  assert.match(migration, new RegExp(`create table if not exists ${table}\\b`, 'i'), `missing ${table} table`);
}

assert.match(migration, /resident_pair_key/i, 'resident 1:1 conversations need a deterministic pair key');
assert.match(migration, /unique index[^;]*resident_pair/is, 'resident pair must be unique per complex');
assert.match(migration, /primary key \(conversation_id, user_id\)/i, 'conversation membership must be unique');
assert.match(migration, /foreign key \(conversation_id, sender_user_id\)[\s\S]*conversation_members\(conversation_id, user_id\)/i,
  'message sender must be a conversation member');
assert.match(migration, /char_length\(body\) between 1 and 2000/i, 'message body must be DB-bounded');
assert.match(migration, /blocker_user_id <> blocked_user_id/i, 'self-block must be rejected');

assert.match(api, /requireVerifiedResident\(/, 'message start/access must use Household v2 verified-resident authorization');
assert.match(api, /verifiedTargetInComplex\(/, 'recipient must remain verified in the same complex');
assert.match(api, /u\.account_status = 'active'/, 'closed recipient accounts must be unavailable');
assert.match(api, /from blocks/i, 'message safety must check blocks');
assert.match(api, /MESSAGE_BLOCKED/, 'blocked relationships must fail closed');
assert.match(api, /on conflict \(complex_id, resident_pair_key\) where type = 'resident'/i,
  'duplicate resident conversation starts must converge on one thread');
assert.match(api, /otherResidentId\(/, 'resident conversation send must resolve exactly one other participant');
assert.match(api, /body\.length > MAX_MESSAGE_CHARS/, 'message body must be bounded before insert');
assert.doesNotMatch(api, /building_code|unit_code|\bemail\b|auth_user_id/i,
  'message API must not read or expose residence/provider PII');

for (const route of [
  '/api/v1/me/conversations',
  '/api/v1/conversations',
  String.raw`\/messages$/`,
  String.raw`\/read$/`
]) {
  assert.ok(api.includes(route), `missing route contract ${route}`);
}

assert.match(app, /handleResidentMessageRequest/);
assert.match(app, /const residentMessageResponse = await handleResidentMessageRequest\(request, env, id\)/);

console.log('PASS resident message persistence/API/security contract');
