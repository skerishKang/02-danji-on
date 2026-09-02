import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, community, replies, moderation, notifications] = await Promise.all([
  readFile(new URL('migrations/035_community_notification_producers.sql', root), 'utf8'),
  readFile(new URL('src/community-resident-v1.ts', root), 'utf8'),
  readFile(new URL('src/community-replies-v1.ts', root), 'utf8'),
  readFile(new URL('src/community-moderation-v1.ts', root), 'utf8'),
  readFile(new URL('migrations/025_resident_notifications.sql', root), 'utf8')
]);

assert.match(migration, /create or replace function notify_community_comment_published\(\)/i);
assert.match(migration, /after insert or update of status on community_comments/i,
  'comment notification must observe both immediate publish inserts and later moderation publish');
assert.match(migration, /new\.status <> 'published'/i,
  'pending/hidden/deleted comments must not notify');
assert.match(migration, /tg_op = 'UPDATE' and old\.status = 'published'/i,
  'restore/repeated published updates must not create a second logical event');
assert.match(migration, /new\.parent_comment_id is null[\s\S]*p\.author_user_id/i,
  'top-level comments must target the post author');
assert.match(migration, /parent\.author_user_id[\s\S]*parent\.id = new\.parent_comment_id/i,
  'nested replies must target the parent comment author');
assert.match(migration, /recipient_user_id = new\.author_user_id/i,
  'self comment/reply events must not notify');
assert.match(migration, /'community-comment:' \|\| new\.id::text/i,
  'comment/reply dedupe must use the immutable comment id');
assert.match(migration, /'community_post',[\s\S]*new\.post_id/i,
  'comment/reply notification resource must stay on the canonical post');

assert.match(migration, /create or replace function notify_community_reaction_insert\(\)/i);
assert.match(migration, /after insert on community_reactions/i);
assert.match(migration, /p\.status = 'published'/i,
  'reactions on non-published posts must not notify');
assert.match(migration, /recipient_user_id = new\.user_id/i,
  'self reactions must not notify');
assert.match(migration, /'community-reaction:' \|\| new\.id::text/i,
  'reaction events must use the immutable reaction row id');

for (const forbidden of ['new.body', 'parent.body', 'p.body', 'display_name', 'building_code', 'unit_code', 'resident_code', 'evidence_object_key']) {
  assert.ok(!migration.includes(forbidden), `notification producer must not copy private/content field: ${forbidden}`);
}
assert.match(migration, /on conflict \(user_id, source_event_key\) where source_event_key is not null do nothing/i,
  'notification writes must reuse canonical dedupe constraint');
assert.match(notifications, /unique index[\s\S]*user_id, source_event_key/i,
  'canonical notification dedupe authority must remain migration 025');

assert.match(community, /insert into community_comments/i);
assert.match(community, /insert into community_reactions/i);
assert.match(replies, /insert into community_comments/i);
assert.match(moderation, /update community_comments[\s\S]*set status = 'published'/i,
  'operator moderation must continue to publish through canonical comment status');
assert.doesNotMatch(community, /insert into notifications/i,
  'resident Community API must not duplicate DB notification producer authority');
assert.doesNotMatch(replies, /insert into notifications/i,
  'reply API must not duplicate DB notification producer authority');

console.log('PASS Community publish-aware comment/reply/reaction notification producer contract');
