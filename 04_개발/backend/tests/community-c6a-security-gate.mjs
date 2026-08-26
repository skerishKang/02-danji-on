import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [residentApi, moderationApi, authz, authzTest, core, schema] = await Promise.all([
  readFile(new URL('src/community-resident-v1.ts', root), 'utf8'),
  readFile(new URL('src/community-moderation-v1.ts', root), 'utf8'),
  readFile(new URL('src/authorization-v2.ts', root), 'utf8'),
  readFile(new URL('tests/authorization-v2.test.mjs', root), 'utf8'),
  readFile(new URL('src/core-v1.ts', root), 'utf8'),
  readFile(new URL('migrations/013_community_core.sql', root), 'utf8')
]);

// Principal gate: A/B verified residents, C cross-complex, D unverified,
// O explicit PADIEM operator, M apartment role without operator grant.
for (const principal of ['sub-A', 'sub-B', 'sub-C', 'sub-D', 'sub-O', 'sub-M']) {
  assert.ok(authzTest.includes(`'${principal}'`), `missing synthetic principal ${principal}`);
}
assert.match(authzTest, /wrongComplex/);
assert.match(authzTest, /RESIDENT_VERIFICATION_REQUIRED/);
assert.match(authzTest, /managerWithoutGrant/);
assert.match(authzTest, /OPERATOR_FORBIDDEN/);
assert.match(authzTest, /x-danjion-role/);
assert.match(authzTest, /x-danjion-verified/);
assert.match(authzTest, /x-danjion-complex/);

// Resident authorization must be derived from Household v2 server state.
assert.match(authz, /from household_memberships hm/i);
assert.match(authz, /hm\.status = 'verified'/i);
assert.match(authz, /c\.slug = \$\{complexSlug\}/);
assert.match(residentApi, /requireVerifiedResident\(request, env, sql, requestId, complexSlug\)/);

// Every resident Community query/mutation remains tenant-scoped.
assert.match(residentApi, /complex_id = \$\{resident\.complexId\}::uuid/g);
assert.match(residentApi, /author_user_id = \$\{resident\.id\}::uuid/g,
  'resident mutations must enforce owner identity in SQL');
assert.match(residentApi, /p\.status = 'published'/,
  'resident feed must expose only published content');
assert.match(residentApi, /on conflict \(post_id, user_id, reaction_type\) do nothing/i,
  'reaction add must be idempotent');
assert.match(residentApi, /code === '23505'/,
  'repeat open reports must collapse safely');
assert.doesNotMatch(residentApi, /complex_posts/,
  'resident Community must not share the official public post table');
assert.doesNotMatch(residentApi, /select[^;]*(email|phone|unit_code|building_code|auth_user_id)/is,
  'resident Community projection must not select resident PII/provider identity');

// Operator authority is separate from apartment management authority.
assert.match(moderationApi,
  /requirePadiemOperator\(request, env, sql, requestId, 'community\.moderate'\)/);
assert.doesNotMatch(moderationApi, /complex_memberships/,
  'apartment manager/admin state must not grant PADIEM moderation authority');
assert.match(authz, /from padiem_operator_grants/i);
assert.match(authz, /scope = \$\{scope\} or scope = '\*'/i);

// Moderation changes state only, never resident content, and audit is atomic.
assert.doesNotMatch(moderationApi, /set\s+(title|body)\s*=/i,
  'operator must never rewrite resident post/comment content');
assert.match(moderationApi, /with target as \(\s*update community_posts/is);
assert.match(moderationApi, /with target as \(\s*update community_comments/is);
assert.match(moderationApi, /with target as \(\s*update community_reports/is);
assert.match(moderationApi, /insert into community_moderation_events/g);
assert.match(moderationApi, /from target\s+returning id/is,
  'moderation event must depend on a successful target transition');
assert.match(moderationApi, /complex_id = \$\{complexId\}::uuid/g,
  'operator transitions must remain complex-scoped');
assert.doesNotMatch(moderationApi, /select[^;]*(email|phone|unit_code|building_code|auth_user_id)/is,
  'moderation queue must not project resident PII/provider identity');

// Schema-level tenant and integrity barriers.
assert.match(schema, /foreign key \(post_id, complex_id\)\s+references community_posts\(id, complex_id\)/i);
assert.match(schema, /foreign key \(comment_id, complex_id\)\s+references community_comments\(id, complex_id\)/i);
assert.match(schema, /unique \(post_id, user_id, reaction_type\)/i);
assert.match(schema, /check \(\(post_id is not null\)::integer \+ \(comment_id is not null\)::integer = 1\)/i);
assert.match(schema, /uq_community_open_post_report_per_user/i);
assert.match(schema, /uq_community_open_comment_report_per_user/i);

// Legacy/public API remains official-content-only. A public /posts route must not leak resident Community rows.
assert.match(core, /from complex_posts p/i);
assert.doesNotMatch(core, /from community_posts/i);
assert.doesNotMatch(core, /from community_comments/i);
assert.doesNotMatch(core, /from community_reports/i);

console.log('PASS Community C6A backend security gate: A/B/C/D/O/M, tenancy, ownership, privacy, moderation audit');
