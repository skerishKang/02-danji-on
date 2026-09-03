import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, api, app, core] = await Promise.all([
  readFile(new URL('migrations/036_resident_news.sql', root), 'utf8'),
  readFile(new URL('src/resident-news-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('src/core-v1.ts', root), 'utf8')
]);

for (const table of ['resident_news_submissions', 'resident_news_posts', 'resident_news_review_events']) {
  assert.match(migration, new RegExp(`create table if not exists ${table}\\b`, 'i'), `missing ${table}`);
}
assert.match(migration, /foreign key \(source_submission_id, complex_id\)[\s\S]*resident_news_submissions\(id, complex_id\)/i,
  'publication must stay bound to the original submission and complex');
assert.match(migration, /unique \(source_submission_id\)/i,
  'one submission may create at most one publication');
assert.match(migration, /notify_resident_news_publish/i,
  'published resident news must create durable in-app notifications');
assert.match(migration, /hm\.status = 'verified'/i,
  'notification fanout must use current Household-v2 verified memberships');
assert.match(migration, /'resident-news:' \|\| new\.id::text/i,
  'notification source key must be stable by published post');
assert.doesNotMatch(migration, /new\.body|body\s*\)\s*values[\s\S]*notifications/i,
  'resident-news body must not be copied into notification persistence');

assert.match(api, /requireVerifiedResident\(/,
  'resident-news reads/submissions must require canonical verified resident AuthZ');
assert.match(api, /requireOperationalAuthority\([\s\S]*'resident_news\.review'[\s\S]*'council\.resident_news\.review'/,
  'review queue/mutation must use explicit operational authority scopes');
assert.match(api, /from resident_news_posts[\s\S]*status = 'published'/i,
  'resident feed must read only published resident-news rows');
assert.match(api, /insert into resident_news_submissions/i,
  'resident submission must persist separately from publication');
assert.match(api, /insert into resident_news_posts/i,
  'approval must create a separate publication record');
assert.match(api, /insert into resident_news_review_events/i,
  'operator review mutations must create dedicated audit events');
assert.match(api, /on conflict \(source_submission_id\) do nothing/i,
  'approval retry must not duplicate a published resident-news row');
assert.doesNotMatch(api, /complex_posts/i,
  'resident news must never reuse the public official-news store');
assert.doesNotMatch(api, /building_code|unit_code|resident_code|evidence_object_key|auth_user_id|\bemail\b/i,
  'resident-news API must not expose residence/provider/proof identity');

for (const route of [
  String.raw`\/resident-news$`,
  String.raw`\/resident-news\/submissions$`,
  '/api/v1/me/resident-news/submissions',
  String.raw`\/operator\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/resident-news\/submissions`
]) {
  assert.ok(api.includes(route), `missing resident-news route contract ${route}`);
}

assert.match(app, /handleResidentNewsRequest/,
  'resident-news runtime must be mounted before public core fallback');
assert.match(core, /from complex_posts p/,
  'existing public official-news authority remains intact');
assert.doesNotMatch(core, /resident_news_posts/i,
  'public core must not gain resident-news access');

console.log('PASS resident-news submission/review/publication AuthZ, privacy and public-store isolation contract');
