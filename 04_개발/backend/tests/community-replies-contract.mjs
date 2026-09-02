import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, api, residentApi, app] = await Promise.all([
  readFile(new URL('migrations/028_community_comment_replies.sql', root), 'utf8'),
  readFile(new URL('src/community-replies-v1.ts', root), 'utf8'),
  readFile(new URL('src/community-resident-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8')
]);

assert.match(migration, /add column if not exists parent_comment_id uuid/i, 'reply parent id must extend community_comments');
assert.match(migration, /foreign key \(parent_comment_id, post_id, complex_id\)[\s\S]*references community_comments\(id, post_id, complex_id\)/i,
  'reply parent FK must stay in the same post and complex');
assert.match(migration, /parent_comment_id <> id/i, 'self-parent relation must be rejected');
assert.doesNotMatch(migration, /create table if not exists community_repl/i,
  'replies must reuse community_comments rather than introduce a parallel moderation model');

assert.match(api, /requireVerifiedResident\(/, 'reply access must use canonical verified-resident authorization');
assert.match(api, /COMMUNITY_PUBLISH_MODE/, 'replies must inherit canonical Community publish mode');
assert.match(api, /parent_comment_id/, 'reply create/list must use the parent relation');
assert.match(api, /insert into community_comments/i, 'reply writes must stay in community_comments');
assert.match(api, /body\.length > MAX_COMMENT_CHARS/, 'reply body must retain the 300-character comment bound');
assert.match(api, /\/comments\\\/\(\[0-9a-fA-F-\]\+\)\\\/replies\$|comments.*replies/s,
  'nested reply route must be present');
assert.doesNotMatch(api, /building_code|unit_code|resident_code|\bemail\b|auth_user_id|evidence_object_key/i,
  'reply API must not query residence/provider PII');

assert.match(residentApi, /c\.parent_comment_id is null/i,
  'ordinary comment list must return only top-level comments so nested replies are not duplicated');

assert.match(app, /handleCommunityReplyRequest/);
const replyMount = app.indexOf('const communityReplyResponse = await handleCommunityReplyRequest(request, env, id)');
const communityMount = app.indexOf('const communityResidentResponse = await handleCommunityResidentRequest(request, env, id)');
assert.ok(replyMount >= 0 && communityMount >= 0 && replyMount < communityMount,
  'reply router must run before the generic Community router');

console.log('PASS Community nested reply persistence/AuthZ/moderation reuse contract');
