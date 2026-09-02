import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [client, portal, main] = await Promise.all([
  readFile(new URL('src/public-complex-news-client.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2ComplexNewsPortal.tsx', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

assert.match(client, /\/api\/v1\/complexes\/\$\{encodeURIComponent\(COMPLEX_SLUG\)\}\/posts/,
  'public news must use canonical complex_posts list/detail routes');
assert.match(client, /credentials: 'omit'/,
  'public official news must not require a resident session');
assert.doesNotMatch(client, /authenticatedFetch\(/,
  'public official news must not be coupled to resident authentication');
assert.doesNotMatch(client, /localStorage|sessionStorage|indexedDB/i,
  'public news authority must not be browser persistence');

assert.match(portal, /#v2-ending \.v2-section-inner/,
  'public news entry must augment the approved V2 shell instead of rewriting it');
assert.match(portal, /publicComplexNewsClient\.listPosts\(\)/);
assert.match(portal, /publicComplexNewsClient\.getPost\(postId\)/,
  'detail must reload the canonical post by stable ID');
assert.match(portal, /data-v2-complex-news-list/);
assert.match(portal, /data-v2-complex-news-detail/);
assert.doesNotMatch(portal, /attachment|objectKey|building|unitCode|buildingCode|provider/i,
  'this slice must not expose attachment/private residence/provider fields');
assert.match(main, /V2ComplexNewsPortal/);

console.log('PASS V2 public complex news list/detail authority and privacy contract');
