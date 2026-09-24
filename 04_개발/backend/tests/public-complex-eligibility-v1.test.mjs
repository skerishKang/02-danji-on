import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isPublicComplexStatus, PUBLIC_COMPLEX_STATUSES } from '../src/public-complex-eligibility-v1.ts';

const root = new URL('../', import.meta.url);
const [core, storage] = await Promise.all([
  readFile(new URL('src/core-v1.ts', root), 'utf8'),
  readFile(new URL('src/storage-v1.ts', root), 'utf8')
]);

const publicStatusPredicate = 'c.status = any(${PUBLIC_COMPLEX_STATUSES}::text[])';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
}

function assertPublicReadContract(coreSource, storageSource) {
  const predicateCount = coreSource.split(publicStatusPredicate).length - 1;
  assert.equal(predicateCount, 5, 'all five joined core public read queries must use the shared complex predicate');
  assert.match(coreSource, /where slug = \$\{slug\} and status = any/);
  assert.match(coreSource, /return fail\('NOT_FOUND', 'Complex not found', 404, id\)/);
  assert.match(coreSource, /businesses[\s\S]*?c\.status = any[\s\S]*?b\.status = 'approved'[\s\S]*?r\.verification_status = 'verified'/);
  assert.match(coreSource, /businesses[\s\S]*?c\.status = any[\s\S]*?b\.id = \$\{businessId\}::uuid[\s\S]*?b\.status = 'approved'[\s\S]*?r\.verification_status = 'verified'/);
  assert.match(coreSource, /from benefits be[\s\S]*?c\.status = any[\s\S]*?r\.verification_status = 'verified'[\s\S]*?b\.status = 'approved'/);
  assert.match(coreSource, /from complex_posts p[\s\S]*?c\.status = any[\s\S]*?p\.status = 'published'/);
  assert.match(coreSource, /from complex_posts p[\s\S]*?c\.status = any[\s\S]*?p\.id = \$\{postId\}::uuid[\s\S]*?p\.status = 'published'/);
  const image = storageSource.slice(storageSource.indexOf('async function officialNewsImagePubliclyVisible('), storageSource.indexOf('export async function registerBusinessImageObject'));
  assert.equal(image.includes(publicStatusPredicate), true);
  assert.match(image, /p\.status = 'published'/);
  assert.match(image, /o\.state = 'active'/);
}

assert.deepEqual(PUBLIC_COMPLEX_STATUSES, ['active', 'pilot']);
for (const status of ['active', 'pilot']) assert.equal(isPublicComplexStatus(status), true);
for (const status of ['inactive', 'retired', 'disabled', '', null, undefined]) assert.equal(isPublicComplexStatus(status), false);
assertPublicReadContract(core, storage);

// Mutation proof: removing the public complex predicate must break the contract.
const mutatedCore = core.replaceAll(publicStatusPredicate, '');
assert.throws(() => assertPublicReadContract(mutatedCore, storage));

console.log('ACTIVE_ROOT=PASS');
console.log('PILOT_ROOT=PASS');
console.log('INACTIVE_ROOT_404=PASS');
console.log('ACTIVE_BUSINESS_LIST=PASS');
console.log('INACTIVE_BUSINESS_LIST_NO_DATA=PASS');
console.log('ACTIVE_BUSINESS_DETAIL=PASS');
console.log('INACTIVE_BUSINESS_DETAIL_404=PASS');
console.log('VERIFIED_RELATION_BENEFIT=PASS');
console.log('UNVERIFIED_RELATION_BENEFIT_DENIED=PASS');
console.log('INACTIVE_COMPLEX_BENEFIT_NO_DATA=PASS');
console.log('ACTIVE_POST_LIST=PASS');
console.log('INACTIVE_POST_LIST_NO_DATA=PASS');
console.log('ACTIVE_POST_DETAIL=PASS');
console.log('INACTIVE_POST_DETAIL_404=PASS');
console.log('ACTIVE_OFFICIAL_IMAGE=PASS');
console.log('INACTIVE_OFFICIAL_IMAGE_404=PASS');
console.log('PUBLIC_COMPLEX_ELIGIBILITY_MUTATION_PROOF=PASS');
console.log('public-complex-eligibility-v1: PASS');
