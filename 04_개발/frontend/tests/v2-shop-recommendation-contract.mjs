import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [types, adapter, v2] = await Promise.all([
  readFile(new URL('src/types.ts', root), 'utf8'),
  readFile(new URL('src/api/adapter.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2IntegratedApp.tsx', root), 'utf8')
]);

assert.match(types, /ShopRecommendationRelationType = Exclude<RelationType, 'resident'>/,
  'recommendation relation must exclude direct resident owner relation');
assert.match(types, /createShopRecommendation\(input: ShopRecommendationInput\)/,
  'DataAdapter must expose canonical recommendation submission');

assert.match(adapter, /\/api\/v1\/me\/shop-recommendations/,
  'API adapter must use canonical recommendation endpoint');
assert.match(adapter, /complexSlug: COMPLEX_SLUG, \.\.\.input/,
  'recommendation API request must include current complex');

assert.match(v2, /const isOwnerRegistration = registration\.relationType === 'resident'/,
  'V2 must explicitly distinguish owner registration');
assert.match(v2, /if \(isOwnerRegistration\)[\s\S]*createBusinessApplication[\s\S]*else \{[\s\S]*createShopRecommendation/,
  'owner and non-owner submissions must use separate APIs');
assert.match(v2, /registration\.relationType as ShopRecommendationRelationType/,
  'non-owner lane must use recommendation-only relation type');
assert.match(v2, /value !== 'resident' && uploadedObjectKey[\s\S]*storageAdapter\.delete\(uploadedObjectKey\)/,
  'switching away from owner mode must retire an already uploaded owner image');
assert.match(v2, /registration\.relationType !== 'resident'[\s\S]*사진이나 운영서류 없이 접수/,
  'recommendation mode must reject owner image upload');
assert.match(v2, /추천자는 가게 운영자나 소유자로 등록되지 않습니다/,
  'V2 must explain the ownership boundary to the resident');
assert.match(v2, /이웃가게 추천 접수/,
  'recommendation submit action must be labeled separately from owner registration');

console.log('PASS V2 owner-application and non-owner recommendation lane separation contract');
