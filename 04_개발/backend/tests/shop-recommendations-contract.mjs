import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, api, ownerFlow, app] = await Promise.all([
  readFile(new URL('migrations/029_shop_recommendations.sql', root), 'utf8'),
  readFile(new URL('src/shop-recommendations-v1.ts', root), 'utf8'),
  readFile(new URL('src/admin-operational-v2.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8')
]);

assert.match(migration, /create table if not exists shop_recommendations/i);
assert.match(migration, /resident_family','neighbor','local/i, 'non-owner recommendation relations must be bounded');
assert.doesNotMatch(migration, /relation_type in \([^)]*'resident'/i, 'self-owned resident relation must not use recommendation lane');
assert.match(migration, /approved_business_id uuid references businesses\(id\).*deferrable initially deferred/i);

assert.match(api, /requireVerifiedResident\(/, 'resident recommendation must require verified resident');
assert.match(api, /requireOperationalAuthority\(/, 'operator review must reuse operational RBAC');
assert.match(api, /'business\.review'.*'council\.business\.review'/s, 'operator review must reuse business-review scopes');
assert.match(api, /shop-recommendations/, 'resident recommendation route family must be present');
assert.ok(api.includes('const adminItem = path.match(/^\\/api\\/v1\\/admin\\/shop-recommendations'),
  'admin recommendation item route must be present');
assert.match(api, /insert into businesses[\s\S]*owner_user_id[\s\S]*select a\.approved_business_id,[\s\S]*null,/i,
  'approved recommendation must create an unowned business');
assert.doesNotMatch(api, /insert into business_applications/i, 'recommendation lane must not impersonate owner application');
assert.doesNotMatch(api, /building_code|unit_code|resident_code|auth_user_id|evidence_object_key|\bemail\b/i,
  'recommendation API must not expose residence/provider PII');

assert.match(ownerFlow, /select a\.approved_business_id,[\s\S]*a\.applicant_user_id,/i,
  'owner application must retain its existing applicant-as-owner semantics');
assert.match(app, /handleShopRecommendationRequest/);

console.log('PASS shop recommendation remains non-owner and reuses canonical business/operator architecture');
