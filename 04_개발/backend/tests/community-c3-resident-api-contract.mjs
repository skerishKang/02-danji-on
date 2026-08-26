import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [api, app] = await Promise.all([
  readFile(new URL('src/community-resident-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8')
]);

assert.match(api, /requireVerifiedResident\(/, 'resident API must use Household v2 verified-resident authorization');
assert.match(api, /community_posts/);
assert.match(api, /community_comments/);
assert.match(api, /community_reactions/);
assert.match(api, /community_reports/);
assert.match(api, /display_name\s+as\s+author_nickname/i, 'API should project nickname-only author identity');
assert.doesNotMatch(api, /select[^;]*(email|phone|unit_code|building_code|auth_user_id)/is, 'community response queries must not select resident PII or provider identity');
assert.doesNotMatch(api, /complex_posts/, 'resident Community must stay separate from official complex_posts');

for (const route of [
  '/community\\/posts',
  '/community\\/posts\\/([0-9a-fA-F-]+)',
  '/community\\/posts\\/([0-9a-fA-F-]+)\\/comments',
  '/community\\/comments\\/([0-9a-fA-F-]+)',
  '/community\\/posts\\/([0-9a-fA-F-]+)\\/reactions',
  '/community\\/reports'
]) {
  assert.ok(api.includes(route), `missing route contract ${route}`);
}

assert.match(api, /author_user_id\s*=\s*\$\{resident\.id\}::uuid/, 'mutations must enforce ownership server-side');
assert.match(api, /complex_id\s*=\s*\$\{resident\.complexId\}::uuid/g, 'mutations and reads must stay complex-scoped');
assert.match(api, /on conflict \(post_id, user_id, reaction_type\) do nothing/i, 'reactions must be idempotent');
assert.match(api, /COMMUNITY_PUBLISH_MODE/);
assert.match(api, /env\.COMMUNITY_PUBLISH_MODE === 'immediate'/, 'publish policy must remain server-controlled');
assert.match(api, /return env\.COMMUNITY_PUBLISH_MODE === 'immediate' \? 'immediate' : 'review'/, 'safe default must remain review');
assert.match(api, /status = 'deleted'/, 'resident delete should be soft-delete');
assert.match(api, /code === '23505'/, 'repeat open report must collapse safely');
assert.match(api, /status = 'published'/, 'resident feed must only expose published content');

assert.match(app, /handleCommunityResidentRequest/);
assert.match(app, /const communityResidentResponse = await handleCommunityResidentRequest\(request, env, id\)/);

console.log('PASS Community C3 resident API contract');
