import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const api = await readFile(new URL('../src/community-resident-v1.ts', import.meta.url), 'utf8');

function assertPatchEngagementState(source) {
  const patch = source.slice(source.indexOf("if (request.method === 'PATCH')"), source.indexOf("if (request.method === 'DELETE')"));
  assert.ok(patch, 'Community post PATCH branch must exist');
  assert.match(patch, /update community_posts/i, 'PATCH must update the post row');
  assert.match(patch, /returning id, kind, category[\s\S]*reaction_count[\s\S]*comment_count[\s\S]*viewer_liked/i,
    'PATCH must return engagement projections from the post row');
  assert.match(patch, /\(select count\(\*\) from community_reactions r[\s\S]*?::int as reaction_count/i,
    'PATCH reaction count must come from existing reaction rows');
  assert.doesNotMatch(patch, /0\s*::\s*int as reaction_count/i,
    'PATCH reaction count must not be a response-only zero');
  assert.match(patch, /from community_comments c[\s\S]*c\.status = 'published'/i,
    'PATCH comment count must come from existing published comment rows');
  assert.match(patch, /from community_reactions vr[\s\S]*vr\.user_id = \$\{resident\.id\}::uuid[\s\S]*reaction_type = 'like'/i,
    'PATCH viewer-liked state must be computed for the authenticated resident');
  assert.doesNotMatch(patch, /row\.(reaction_count|comment_count|viewer_liked)\s*=/i,
    'PATCH must not overwrite engagement state with response-only zero values');
}

assertPatchEngagementState(api);

const mutation = api.replace(
  'returning id, kind, category, title, body, status, published_at, created_at, updated_at,\n                 (select count(*) from community_reactions',
  'returning id, kind, category, title, body, status, published_at, created_at, updated_at,\n                 0::int as reaction_count,\n                 (select count(*) from community_reactions'
);
assert.notEqual(mutation, api, 'engagement projection mutation must change the source');
assert.throws(() => assertPatchEngagementState(mutation), /response-only zero/);

console.log('PASS Issue #1010 post PATCH engagement state contract');
