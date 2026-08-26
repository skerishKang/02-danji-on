import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [api, app, schema, operational] = await Promise.all([
  readFile(new URL('src/community-moderation-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('migrations/013_community_core.sql', root), 'utf8'),
  readFile(new URL('src/operational-authz-v2.ts', root), 'utf8')
]);

assert.match(api, /requireOperationalAuthority\(/,
  'Community moderation must use the current PADIEM-or-council operational authority boundary');
assert.ok(api.includes("'community.moderate'"), 'PADIEM moderation scope must be explicit');
assert.ok(api.includes("'council.community.moderate'"), 'resident-council moderation scope must be explicit');
assert.doesNotMatch(api, /requirePadiemOperator\(/, 'Community moderation must not remain PADIEM-only after governance reconciliation');
assert.doesNotMatch(api, /complex_memberships/, 'legacy apartment manager/admin role must never grant moderation authority');
assert.doesNotMatch(api, /onboarding_support/, 'management-office onboarding support must not grant moderation authority');
assert.match(operational, /operator_kind = 'resident_council'/);
assert.match(operational, /PADIEM or resident-council authorization required/);
assert.doesNotMatch(operational, /complex_memberships/);

assert.match(api, /\/api\\\/v1\\\/operator\\\/complexes\\\/\(/, 'operator routes must live in operator namespace');
assert.match(api, /community\\\/moderation/);
assert.match(api, /community\\\/posts\\\/\(\[0-9a-fA-F-\]\+\)\\\/moderate/);
assert.match(api, /community\\\/comments\\\/\(\[0-9a-fA-F-\]\+\)\\\/moderate/);
assert.match(api, /community\\\/reports\\\/\(\[0-9a-fA-F-\]\+\)\\\/resolve/);

assert.match(api, /community_moderation_events/g, 'moderation transitions must emit immutable moderation events');
assert.match(api, /actor_kind, operator_user_id, action, reason_code, note/);
assert.match(api, /with target as \(\s*update community_posts/is, 'post state transition must be atomic with event creation');
assert.match(api, /with target as \(\s*update community_comments/is, 'comment state transition must be atomic with event creation');
assert.match(api, /with target as \(\s*update community_reports/is, 'report resolution must be atomic with event creation');
assert.match(api, /from target\s+returning id/is, 'event insert must depend on successful target transition');

for (const action of ['published', 'hidden', 'restored', 'deleted', 'report_resolved', 'report_dismissed']) {
  assert.ok(api.includes(`'${action}'`) || schema.includes(`'${action}'`), `missing moderation action ${action}`);
}

assert.match(api, /set status = 'published'/);
assert.match(api, /set status = 'hidden'/);
assert.match(api, /set status = 'deleted'/);
assert.match(api, /status in \('submitted', 'reviewing'\)/);
assert.match(api, /resolved_by_user_id = \$\{operatorId\}::uuid/);
assert.doesNotMatch(api, /set\s+(title|body)\s*=/i, 'operator moderation must never rewrite resident content');
assert.doesNotMatch(api, /select[^;]*(email|phone|unit_code|building_code|auth_user_id)/is,
  'moderation queue must not project resident PII or provider identity');
assert.doesNotMatch(api, /complex_posts/, 'resident moderation must stay separate from official complex_posts');
assert.match(api, /display_name as author_nickname/i);
assert.match(api, /display_name as reporter_nickname/i);
assert.match(api, /complex_id = \$\{complexId\}::uuid/g, 'all target transitions must remain tenant-scoped');
assert.match(api, /authorityKind/, 'moderation response must preserve which explicit authority class acted');

assert.match(app, /handleCommunityModerationRequest/);
assert.match(app, /const communityModerationResponse = await handleCommunityModerationRequest\(request, env, id\)/);

console.log('PASS Community C4 governance-reconciled moderation contract');
