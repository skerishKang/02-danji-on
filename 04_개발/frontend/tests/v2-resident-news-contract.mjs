import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [client, portal, publicClient, publicPortal, main] = await Promise.all([
  readFile(new URL('src/resident-news-client.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2ResidentNewsPortal.tsx', root), 'utf8'),
  readFile(new URL('src/public-complex-news-client.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2ComplexNewsPortal.tsx', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

assert.match(client, /import \{ authenticatedFetch \} from '\.\/auth-fetch'/,
  'resident news must use the canonical authenticated product fetch');
assert.match(client, /authenticatedFetch\([\s\S]*'resident'\)/,
  'resident news requests must use the resident auth surface');
assert.match(client, /\/api\/v1\/complexes\/\$\{encodeURIComponent\(COMPLEX_SLUG\)\}\/resident-news/,
  'resident feed/detail/submission must use the merged complex-scoped backend authority');
assert.match(client, /\/api\/v1\/me\/resident-news\/submissions\?complexSlug=/,
  'own submission status must use the canonical resident endpoint');
assert.doesNotMatch(client, /publicComplexNewsClient|credentials:\s*['"]omit['"]/,
  'resident news must not reuse the unauthenticated public official-news client');
assert.doesNotMatch(client, /\/operator\/|resident_news\.review|council\.resident_news\.review/,
  'resident client must not gain operator-review authority');
assert.doesNotMatch(client, /localStorage|sessionStorage|indexedDB/i,
  'resident news authority must not be browser persistence');

assert.match(portal, /#v2-ending \.v2-section-inner/,
  'resident news must augment the approved V2 shell without redesign');
assert.match(portal, /residentNewsClient\.listPosts\(\)/);
assert.match(portal, /residentNewsClient\.getPost\(postId\)/);
assert.match(portal, /residentNewsClient\.submit\(\{ title, body \}\)/);
assert.match(portal, /residentNewsClient\.listOwnSubmissions\(\)/);
assert.match(portal, /data-v2-resident-news-list/);
assert.match(portal, /data-v2-resident-news-detail/);
assert.match(portal, /data-v2-resident-news-form/);
assert.match(portal, /data-v2-resident-news-submissions/);
assert.doesNotMatch(portal, /type=['"]file['"]|attachment|objectKey|buildingCode|unitCode|provider/i,
  'resident-news V2 slice must not introduce attachments or private residence/provider fields');

assert.match(publicClient, /credentials: 'omit'/,
  'public official news must remain independently guest-readable');
assert.doesNotMatch(publicClient, /resident-news|authenticatedFetch/,
  'public official-news client must remain separate from resident news');
assert.match(publicPortal, /단지 공식소식/,
  'public official-news product meaning must remain intact');
assert.match(main, /V2ComplexNewsPortal/);
assert.match(main, /V2ResidentNewsPortal/,
  'V2 bootstrap must mount both public official news and resident-only news surfaces');

console.log('PASS V2 resident-news authenticated list/detail/submission/status and public-boundary contract');
