import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, legacyMigration, api, legacyApi, app] = await Promise.all([
  readFile(new URL('migrations/043_business_review_comments.sql', root), 'utf8'),
  readFile(new URL('migrations/027_business_reviews.sql', root), 'utf8'),
  readFile(new URL('src/business-review-comments-v1.ts', root), 'utf8'),
  readFile(new URL('src/business-reviews-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8')
]);

assert.match(migration, /create table if not exists business_review_comments/i, 'missing business_review_comments');
assert.match(migration, /foreign key \(review_id, business_id, complex_id\)[\s\S]*business_reviews\(id, business_id, complex_id\)/i,
  'comment tenant/business/review scope must be DB-bound');
assert.match(migration, /status text not null default 'active' check \(status in \('active','hidden','deleted'\)\)/i,
  'comment lifecycle must mirror review soft-delete state');
assert.match(migration, /char_length\(body\) between 1 and 500/i, 'comment body must be DB-bounded 1..500');
assert.match(migration, /idx_business_review_comments_review_created/i, 'review-scoped list index must exist');
assert.match(migration, /idx_business_review_comments_author_created/i, 'author lookup index must exist');
assert.match(migration, /trg_business_review_comments_updated_at/i, 'updated_at trigger must exist');
assert.doesNotMatch(migration, /alter table business_reviews/i, 'migration must not alter business_reviews');
assert.doesNotMatch(migration, /alter table business_review_replies/i, 'migration must not alter owner replies');
assert.match(api, /requireVerifiedResident\(/, 'comment read/create/edit/delete must use verified-resident AuthZ');
assert.doesNotMatch(api, /requireActor\(/, 'comment lane must not use owner-actor AuthN');
assert.match(api, /r\.verification_status = 'verified'/, 'comment business relation must be verified');
assert.match(api, /b\.status = 'approved'/, 'comment business must be approved');
assert.match(api, /status = 'active'/, 'comment parent review must be active-only');
assert.match(api, /MAX_COMMENT_CHARS = 500/, 'comment bound must be frontend 500 authority');
assert.match(api, /body\.length > MAX_COMMENT_CHARS/, 'comment text must be bounded before persistence');
assert.match(api, /isMine:\s*String\(row\.author_user_id\) === residentId/,
  'self-comment UI authority must be derived server-side');
assert.match(api, /update business_review_comments[\s\S]*author_user_id = \$\{resident\.id\}::uuid[\s\S]*status = 'active'/i,
  'comment mutation must be author-bound and active-only');
assert.match(api, /set status = 'deleted'/i, 'comment deletion must use soft-delete lifecycle');
assert.doesNotMatch(api, /delete\s+from\s+business_review_comments/i,
  'comment deletion must never physically delete the canonical row');
assert.doesNotMatch(api, /insert into business_review_replies|from business_review_replies|update business_review_replies/i,
  'comment lane must never read/write owner replies');
assert.doesNotMatch(api, /building_code|unit_code|resident_code|\bemail\b|auth_user_id|evidence_object_key/i,
  'comment API must not query residence/provider PII');
assert.doesNotMatch(api, /rating|stars?|score/i, 'comment API must not introduce rating semantics');

for (const routePart of [
  String.raw`\/reviews\/([0-9a-fA-F-]+)\/comments$`,
  String.raw`\/comments\/([0-9a-fA-F-]+)$`
]) {
  assert.ok(api.includes(routePart), `missing route contract ${routePart}`);
}
assert.match(api, /request\.method === 'GET'[\s\S]*listComments/);
assert.match(api, /request\.method === 'POST'[\s\S]*createComment/);
assert.match(api, /request\.method === 'PATCH'[\s\S]*updateOwnComment/);
assert.match(api, /request\.method === 'DELETE'[\s\S]*deleteOwnComment/);

assert.match(api, /return ok\(\{[\s\S]*businessId,[\s\S]*reviewId,[\s\S]*comments:\s*rows\.map/,
  'comment list must expose business/review ids and normalized comment rows');
assert.match(api, /author:\s*\{[\s\S]*userId:[\s\S]*nickname:[\s\S]*avatarUrl:/,
  'comment rows must expose safe author presentation metadata');
assert.match(api, /createdAt:\s*row\.created_at[\s\S]*updatedAt:\s*row\.updated_at/,
  'comment rows must preserve timestamps');
assert.match(api, /return ok\(mapComment\(createdRow, resident\.id, businessId, reviewId\), requestId, 201\)/,
  'comment create must return the canonical DB-read row with HTTP 201');
assert.match(api, /return ok\(mapComment\(updatedRow, resident\.id, businessId, reviewId\), requestId\)/,
  'comment update must return the canonical DB-read row');

assert.match(app, /handleBusinessReviewCommentRequest/);
assert.match(app, /const businessReviewCommentResponse = await handleBusinessReviewCommentRequest\(request, env, id\)/);
assert.match(app, /const businessReviewResponse = await handleBusinessReviewRequest\(request, env, id\)/);
assert.ok(
  app.indexOf('const businessReviewResponse = await handleBusinessReviewRequest(request, env, id)') <
  app.indexOf('const businessReviewCommentResponse = await handleBusinessReviewCommentRequest(request, env, id)'),
  'review router must run before comment router so /reply stays owner-owned'
);

// Owner reply contract untouched: legacy review lane keeps 1..2000 + owner AuthN.
assert.match(legacyApi, /business\.owner_user_id[^\n]*actor\.id/i, 'legacy owner reply guard must remain');
assert.match(legacyApi, /business_review_replies/, 'legacy owner reply table usage must remain');
assert.match(legacyMigration, /create table if not exists business_review_replies/i, 'legacy 027 reply table must remain');
assert.doesNotMatch(legacyMigration, /business_review_comments/i, 'legacy 027 must not gain comment objects');

console.log('PASS business review comments separate persistence verified-resident 500-char contract');

