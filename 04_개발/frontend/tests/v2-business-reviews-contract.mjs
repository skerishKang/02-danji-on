import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [client, integration, main] = await Promise.all([
  readFile(new URL('src/business-reviews-client.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2BusinessReviewsIntegration.tsx', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

assert.match(client, /\/api\/v1\/complexes\/\$\{encodeURIComponent\(COMPLEX_SLUG\)\}\/businesses\/\$\{encodeURIComponent\(businessId\)\}\/reviews/,
  'reviews must use canonical complex/business backend route');
assert.match(client, /authenticatedFetch\(/,
  'review list/create/edit/delete/reply must use authenticated product session');
assert.match(client, /isMine:\s*value\.isMine === true/,
  'client must consume server-derived self-review authority instead of inferring provider identity');
assert.match(client, /method:\s*'PATCH'/,
  'self-review edit must use canonical review resource PATCH');
assert.match(client, /method:\s*'DELETE'/,
  'self-review delete must use canonical review resource DELETE');
assert.match(client, /\/reply/,
  'owner replies must reuse canonical nested reply route');
assert.match(client, /text\.length > 2000/);
assert.doesNotMatch(client, /localStorage|sessionStorage|indexedDB/i);

assert.match(integration, /\.v2-integrated-shop-card\[data-shop-id\]/,
  'review integration must bind to canonical V2 business IDs');
assert.match(integration, /businessReviewsClient\.list\(id\)/);
assert.match(integration, /businessReviewsClient\.create\(businessId, body\)/);
assert.match(integration, /businessReviewsClient\.update\(businessId, reviewId, body\)/);
assert.match(integration, /businessReviewsClient\.remove\(businessId, reviewId\)/);
assert.match(integration, /review\.isMine && \(/,
  'edit/delete controls must render only for a backend-authorized self review');
assert.match(integration, /if \(!review\?\.isMine\) return;/,
  'event handlers must fail closed even if invoked outside the rendered ownership control');
assert.match(integration, /window\.confirm\('이 후기를 삭제할까요\?'\)/,
  'destructive review deletion must require an explicit user confirmation');
assert.match(integration, /businessReviewsClient\.upsertOwnerReply\(businessId, reviewId, body\)/);
assert.match(integration, /item\.status === 'approved' && item\.approvedBusinessId === businessId/,
  'owner reply editor must be gated by canonical approved business ownership');
assert.doesNotMatch(integration, /rating|stars?|score|building|unitCode|buildingCode|provider/i,
  'V2 review UI must not invent ratings or expose residence/provider identity');
assert.match(main, /V2BusinessReviewsIntegration/);

console.log('PASS V2 resident business reviews owner lifecycle/replies authority and privacy contract');
