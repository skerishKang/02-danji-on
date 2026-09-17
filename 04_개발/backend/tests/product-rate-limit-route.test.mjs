import assert from 'node:assert/strict';
import {
  PRODUCT_MUTATION_LIMITS,
  productMutationLimitForRequest
} from '../src/product-rate-limit-v1.ts';

function request(method, path) {
  return new Request(`https://danjion.test${path}`, { method });
}

const cases = [
  ['/api/v1/complexes/complex-1/community/posts', 'community_post_create'],
  ['/api/v1/complexes/complex-1/community/posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/comments', 'community_comment_create'],
  ['/api/v1/complexes/complex-1/community/reports', 'community_report_create'],
  ['/api/v1/me/reports', 'resident_safety_report_create'],
  ['/api/v1/complexes/complex-1/household/family-invites', 'family_invite_create'],
  ['/api/v1/household/family-invites/redeem', 'family_invite_redeem'],
  ['/api/v1/me/business-applications', 'business_application_create'],
  ['/api/v1/me/benefits/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/claim', 'benefit_claim'],
  ['/api/v1/conversations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/messages', 'resident_message_send'],
  ['/api/v1/complexes/complex-1/businesses/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/reviews', 'business_review_create'],
  ['/api/v1/complexes/complex-1/businesses/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/reviews/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/comments', 'business_review_comment_create'],
  ['/api/v1/me/inquiries', 'inquiry_create'],
  ['/api/v1/me/shop-recommendations', 'shop_recommendation_create']
];

for (const [path, expected] of cases) {
  assert.equal(productMutationLimitForRequest(request('POST', path)), expected, path);
}

for (const path of cases.map(([value]) => value)) {
  assert.equal(productMutationLimitForRequest(request('GET', path)), null, `GET must not be limited: ${path}`);
  assert.equal(productMutationLimitForRequest(request('DELETE', path)), null, `DELETE must not be limited: ${path}`);
}

for (const path of [
  '/api/v1/operator/complexes/complex-1/community/moderation',
  '/api/v1/operator/complexes/complex-1/community/posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/moderate',
  '/api/v1/me/account/close',
  '/api/v1/complexes/complex-1/household',
  '/api/v1/me/benefits/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/use',
  '/api/v1/me/conversations',
  '/api/v1/complexes/complex-1/businesses/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/reviews/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/reply'
]) {
  assert.equal(productMutationLimitForRequest(request('POST', path)), null, `out-of-scope POST must not be limited: ${path}`);
}

assert.deepEqual(PRODUCT_MUTATION_LIMITS.community_post_create, {
  action: 'community_post_create', max: 5, windowSeconds: 600
});
assert.deepEqual(PRODUCT_MUTATION_LIMITS.community_comment_create, {
  action: 'community_comment_create', max: 30, windowSeconds: 600
});
assert.deepEqual(PRODUCT_MUTATION_LIMITS.community_report_create, {
  action: 'community_report_create', max: 10, windowSeconds: 3600
});
assert.deepEqual(PRODUCT_MUTATION_LIMITS.resident_safety_report_create, {
  action: 'resident_safety_report_create', max: 10, windowSeconds: 3600
});
assert.deepEqual(PRODUCT_MUTATION_LIMITS.family_invite_create, {
  action: 'family_invite_create', max: 10, windowSeconds: 3600
});
assert.deepEqual(PRODUCT_MUTATION_LIMITS.family_invite_redeem, {
  action: 'family_invite_redeem', max: 10, windowSeconds: 3600
});
assert.deepEqual(PRODUCT_MUTATION_LIMITS.business_application_create, {
  action: 'business_application_create', max: 5, windowSeconds: 86400
});
assert.deepEqual(PRODUCT_MUTATION_LIMITS.benefit_claim, {
  action: 'benefit_claim', max: 30, windowSeconds: 3600
});
assert.deepEqual(PRODUCT_MUTATION_LIMITS.resident_message_send, {
  action: 'resident_message_send', max: 120, windowSeconds: 600
});
assert.deepEqual(PRODUCT_MUTATION_LIMITS.business_review_create, {
  action: 'business_review_create', max: 10, windowSeconds: 86400
});
assert.deepEqual(PRODUCT_MUTATION_LIMITS.business_review_comment_create, {
  action: 'business_review_comment_create', max: 30, windowSeconds: 600
});
assert.deepEqual(PRODUCT_MUTATION_LIMITS.inquiry_create, {
  action: 'inquiry_create', max: 10, windowSeconds: 86400
});
assert.deepEqual(PRODUCT_MUTATION_LIMITS.shop_recommendation_create, {
  action: 'shop_recommendation_create', max: 20, windowSeconds: 86400
});

console.log('PASS product mutation rate-limit route classifier and policy values');
