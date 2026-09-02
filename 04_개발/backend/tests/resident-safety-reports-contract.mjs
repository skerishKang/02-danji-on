import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, runtime, community, app] = await Promise.all([
  readFile(new URL('migrations/034_resident_safety_reports.sql', root), 'utf8'),
  readFile(new URL('src/resident-safety-reports-v1.ts', root), 'utf8'),
  readFile(new URL('src/community-resident-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8')
]);

assert.match(migration, /create table if not exists resident_safety_reports/i);
assert.match(migration, /resident_user_id uuid/);
assert.match(migration, /message_id uuid/);
assert.match(migration, /review_id uuid/);
assert.match(migration, /\(resident_user_id is not null\)::integer[\s\S]*\+ \(message_id is not null\)::integer[\s\S]*\+ \(review_id is not null\)::integer = 1/,
  'non-community report row must target exactly one object');
assert.match(migration, /reason in \('abuse','threat','privacy','defamation_risk','spam','other'\)/);
assert.match(migration, /char_length\(detail\) <= 1000/);
assert.match(migration, /status in \('submitted','reviewing','resolved','dismissed'\)/);
assert.match(migration, /household_memberships/,
  'DB trigger must validate reporter Household-v2 membership');
assert.match(migration, /hm\.complex_id = new\.complex_id/,
  'DB trigger must bind reporter to report complex');
assert.match(migration, /new\.resident_user_id = new\.reporter_user_id/,
  'self resident report must be DB rejected');
assert.match(migration, /conversation_members cm[\s\S]*cm\.user_id = new\.reporter_user_id/,
  'message report must require reporter conversation membership');
assert.match(migration, /m\.sender_user_id <> new\.reporter_user_id/,
  'resident cannot report own message');
assert.match(migration, /r\.author_user_id <> new\.reporter_user_id/,
  'resident cannot report own review');
assert.match(migration, /uq_resident_safety_open_resident_report/);
assert.match(migration, /uq_resident_safety_open_message_report/);
assert.match(migration, /uq_resident_safety_open_review_report/);
assert.doesNotMatch(migration, /message_body|review_body|target_snapshot|content_snapshot/i,
  'report persistence must not snapshot target content');

assert.match(runtime, /path === '\/api\/v1\/me\/reports'/);
assert.match(runtime, /requireVerifiedResident\(/,
  'resident report submission must use canonical verified-resident authorization');
assert.match(runtime, /insert into community_reports/,
  'post/comment reports must reuse the existing community report store');
assert.match(runtime, /insert into resident_safety_reports/,
  'resident/message/review reports must use the non-community safety store');
assert.match(runtime, /code === '23505'/,
  'duplicate open reports must converge idempotently');
assert.match(runtime, /PADIEM_REVIEW_SCOPE = 'safety\.report\.review'/,
  'private safety review needs an explicit operational scope');
assert.match(runtime, /COUNCIL_REVIEW_SCOPE = 'council\.safety\.report\.review'/,
  'council safety authority must be explicit, never inferred from community moderation');
assert.match(runtime, /left\(m\.body, \$\{PREVIEW_CHARS\}\)/,
  'operator queue may read only a bounded live message preview');
assert.match(runtime, /left\(br\.body, \$\{PREVIEW_CHARS\}\)/,
  'operator queue may read only a bounded live review preview');
assert.match(runtime, /'safety\.report\.resolve'/,
  'operator resolution must create audit evidence');
assert.doesNotMatch(runtime, /building_code|unit_code|resident_verifications|evidence_object_key/i,
  'safety report runtime must not read exact residence/provider evidence');

assert.match(community, /insert into community_reports/,
  'existing community report authority must remain intact');
assert.doesNotMatch(migration, /post_id|comment_id/,
  'migration 034 must not duplicate community post/comment targets');

assert.match(app, /handleResidentSafetyReportRequest/);
assert.match(app, /const residentSafetyReportResponse = await handleResidentSafetyReportRequest\(request, env, id\)/);

console.log('PASS resident safety reports reuse/privacy/AuthZ contract');
