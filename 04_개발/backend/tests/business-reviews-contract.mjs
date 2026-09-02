import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, api, app] = await Promise.all([
  readFile(new URL('migrations/027_business_reviews.sql', root), 'utf8'),
  readFile(new URL('src/business-reviews-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8')
]);

for (const table of ['business_reviews', 'business_review_replies']) {
  assert.match(migration, new RegExp(`create table if not exists ${table}\\b`, 'i'), `missing ${table}`);
}
assert.match(migration, /foreign key \(business_id, complex_id\)[\s\S]*business_complex_relations\(business_id, complex_id\)/i,
  'review tenant/business scope must be DB-bound');
assert.match(migration, /foreign key \(review_id, business_id, complex_id\)[\s\S]*business_reviews\(id, business_id, complex_id\)/i,
  'reply must target the same review/business/complex tuple');
assert.match(migration, /status text not null default 'active' check \(status in \('active','hidden','deleted'\)\)/i,
  'review lifecycle must retain canonical soft-delete state');
assert.match(migration, /char_length\(body\) between 1 and 2000/i, 'review/reply body must be DB-bounded');
assert.match(migration, /enforce_business_review_reply_owner/i, 'reply owner must be DB-checked');
assert.match(migration, /b\.owner_user_id = new\.owner_user_id/i, 'reply trigger must compare canonical owner id');
assert.doesNotMatch(migration, /rating|stars?|score/i, 'v1 reviews are text-only with no rating policy');

assert.match(api, /requireVerifiedResident\(/, 'review read/create/edit/delete must use verified-resident AuthZ');
assert.match(api, /requireActor\(/, 'owner reply must use canonical actor AuthN');
assert.match(api, /r\.verification_status = 'verified'/, 'business relation must be verified');
assert.match(api, /b\.status = 'approved'/, 'reviewable business must be approved');
assert.match(api, /business\.owner_user_id[^\n]*actor\.id/i, 'reply must require canonical business owner');
assert.match(api, /body\.length > MAX_TEXT_CHARS/, 'review/reply text must be bounded before persistence');
assert.match(api, /isMine:\s*String\(row\.author_user_id\) === resident\.id/,
  'self-review UI authority must be derived server-side from the canonical resident actor');
assert.match(api, /update business_reviews[\s\S]*author_user_id = \$\{resident\.id\}::uuid[\s\S]*status = 'active'/i,
  'review mutation must be author-bound and active-only');
assert.match(api, /set status = 'deleted'/i,
  'resident deletion must use the existing soft-delete lifecycle instead of physical deletion');
assert.doesNotMatch(api, /delete\s+from\s+business_reviews/i,
  'resident review deletion must never physically delete the canonical row');
assert.doesNotMatch(api, /building_code|unit_code|resident_code|\bemail\b|auth_user_id|evidence_object_key/i,
  'review API must not query residence/provider PII');
assert.doesNotMatch(api, /rating|stars?|score/i, 'review API must not introduce rating semantics');

for (const routePart of [
  String.raw`\/businesses\/([0-9a-fA-F-]+)\/reviews$`,
  String.raw`\/reviews\/([0-9a-fA-F-]+)$`,
  String.raw`\/reviews\/([0-9a-fA-F-]+)\/reply$`
]) {
  assert.ok(api.includes(routePart), `missing route contract ${routePart}`);
}
assert.match(api, /request\.method === 'PATCH'[\s\S]*updateOwnReview/);
assert.match(api, /request\.method === 'DELETE'[\s\S]*deleteOwnReview/);
assert.match(app, /handleBusinessReviewRequest/);
assert.match(app, /const businessReviewResponse = await handleBusinessReviewRequest\(request, env, id\)/);

console.log('PASS business review/reply persistence owner lifecycle AuthZ and privacy contract');
