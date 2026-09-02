import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [api, migration, app] = await Promise.all([
  readFile(new URL('src/resident-activity-v1.ts', root), 'utf8'),
  readFile(new URL('migrations/031_resident_activity_indexes.sql', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8')
]);

assert.match(api, /\/api\/v1\/me\/activity/);
assert.match(api, /requireVerifiedResident\(/, 'activity must require current verified resident');
assert.match(api, /community_posts[\s\S]*community_comments[\s\S]*community_reactions[\s\S]*business_reviews/,
  'activity must derive from canonical domain tables');
assert.doesNotMatch(api, /insert into|update\s+community_|delete from/i,
  'activity API must remain a read model and not duplicate domain persistence');
assert.match(api, /FILTERS = new Set\(\['all', 'posts', 'comments', 'reactions', 'reviews'\]\)/,
  'activity filters must remain bounded');
assert.match(api, /MAX_LIMIT = 50/, 'activity page size must remain bounded');
assert.match(api, /case when p\.status in \('pending_review','published'\) then p\.title else null end as title/,
  'hidden/deleted authored Community titles must not leak through activity');
assert.match(api, /body_preview[\s\S]*status in \('pending_review','published'\)/,
  'Community body previews must be limited to visible/self-reviewable states');
assert.match(api, /case when br\.status = 'active' then left\(br\.body, 280\) else null end/,
  'hidden/deleted review body must not leak through activity');
assert.match(api, /case when p\.status = 'published' then p\.title else null end/,
  'reaction activity must not expose hidden target title');
assert.match(api, /\(occurred_at, activity_type, id::text\) </,
  'cursor pagination must use deterministic tuple ordering');
assert.match(api, /base64UrlEncode/);
assert.match(api, /parseCursor/);
assert.doesNotMatch(api, /building_code|unit_code|resident_code|auth_user_id|evidence_object_key|\bemail\b/i,
  'activity API must not project residence/provider PII');

assert.match(migration, /idx_community_comments_activity_author/);
assert.match(migration, /author_user_id, complex_id, created_at desc, id desc/);
assert.match(migration, /idx_community_reactions_activity_user/);
assert.match(migration, /user_id, complex_id, created_at desc, id desc/);
assert.doesNotMatch(migration, /create table/i, 'activity migration must add indexes only');

assert.match(app, /handleResidentActivityRequest/);

console.log('PASS resident activity derived-read-model pagination/privacy/index contract');
