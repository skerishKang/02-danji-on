import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import core from '../src/core-v1.ts';
import { handleBusinessReviewRequest } from '../src/business-reviews-v1.ts';
import { handleAdminOperationalRequest } from '../src/admin-operational-v2.ts';
import { decodeComplexSlug } from '../src/complex-slug-v1.ts';

const REQUEST_ID = 'req-1018-safe-complex-slug';
const ENV = {
  DATABASE_URL: 'postgresql://synthetic.invalid/danjion',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'false'
};
const BUSINESS_ID = '10180000-0000-4000-8000-000000000001';
const REVIEW_ID = '10180000-0000-4000-8000-000000000002';
const VALID_SLUG = 'banglim-myeongji-roadhill';
const MALFORMED_SLUGS = ['%', '%2', '%ZZ', '%E0%A4'];

const representativeRoutes = [
  {
    name: 'private-business-contact',
    method: 'GET',
    pathname: (slug) => `/api/v1/complexes/${slug}/businesses/${BUSINESS_ID}/contact`,
    invoke: (request) => core.fetch(request, ENV)
  },
  {
    name: 'resident-business-reviews',
    method: 'GET',
    pathname: (slug) => `/api/v1/complexes/${slug}/businesses/${BUSINESS_ID}/reviews`,
    invoke: (request) => handleBusinessReviewRequest(request, ENV, REQUEST_ID)
  },
  {
    name: 'admin-official-posts',
    method: 'GET',
    pathname: (slug) => `/api/v1/admin/complexes/${slug}/posts`,
    invoke: (request) => handleAdminOperationalRequest(request, ENV, REQUEST_ID)
  }
];

async function dispatch(route, rawSlug) {
  let sqlCalls = 0;
  globalThis.__DANJION_TEST_SQL__ = async () => {
    sqlCalls += 1;
    throw new Error(`${route.name} malformed slug must not execute SQL`);
  };
  try {
    const response = await route.invoke(new Request(
      `https://api.example.test${route.pathname(rawSlug)}`,
      {
        method: route.method,
        headers: { 'x-danjion-request-id': REQUEST_ID }
      }
    ));
    assert.ok(response, `${route.name} must dispatch a response`);
    return { response, sqlCalls };
  } finally {
    delete globalThis.__DANJION_TEST_SQL__;
  }
}

for (const route of representativeRoutes) {
  const validControl = await dispatch(route, VALID_SLUG);
  assert.equal(
    validControl.response.status,
    401,
    `${route.name} valid slug must pass slug validation and retain the auth boundary`
  );
  assert.equal(validControl.sqlCalls, 0);

  for (const rawSlug of MALFORMED_SLUGS) {
    const { response, sqlCalls } = await dispatch(route, rawSlug);
    const body = await response.json();
    assert.equal(response.status, 400, `${route.name} ${rawSlug} must be 4xx`);
    assert.notEqual(response.status, 500, `${route.name} ${rawSlug} must not become 500`);
    assert.equal(body.error.code, 'INVALID_COMPLEX_SLUG');
    assert.equal(body.error.message, 'Invalid complex slug');
    assert.equal(body.requestId, REQUEST_ID);
    assert.equal(sqlCalls, 0, `${route.name} ${rawSlug} must execute zero queries`);
  }
}

assert.equal(decodeComplexSlug(VALID_SLUG), VALID_SLUG, 'valid canonical slug parity must be preserved');
for (const rawSlug of MALFORMED_SLUGS) {
  assert.equal(decodeComplexSlug(rawSlug), null, `${rawSlug} must fail closed`);
}

const sourceFiles = [
  'core-v1.ts',
  'business-reviews-v1.ts',
  'business-review-comments-v1.ts',
  'admin-operational-v2.ts',
  'household-unit-association-v1.ts',
  'household-code-verification-v1.ts',
  'business-share-v1.ts',
  'admin-household-review-v1.ts',
  'admin-household-messaging-v1.ts',
  'admin-household-codes-v1.ts',
  'admin-audit-v1.ts'
];
const sources = new Map(await Promise.all(sourceFiles.map(async (name) => [
  name,
  await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')
])));
const helperSource = await readFile(new URL('../src/complex-slug-v1.ts', import.meta.url), 'utf8');

function assertSourceContract(helper, routeSources) {
  assert.match(helper, /decodeURIComponent\(raw\)\.trim\(\)/);
  assert.match(helper, /catch \{[\s\S]*?return null;/);
  assert.match(helper, /COMPLEX_SLUG\.test\(decoded\) \? decoded : null/);
  for (const [name, source] of routeSources) {
    assert.match(source, /import \{ decodeComplexSlug \} from '\.\/complex-slug-v1'/, `${name} must import the safe decoder`);
    assert.ok(source.includes('decodeComplexSlug('), `${name} must execute the safe decoder`);
    assert.equal(source.includes('decodeURIComponent(match[1])'), false, `${name} must not raw-decode a route slug`);
  }
}
assertSourceContract(helperSource, sources);

const unsafeHelper = helperSource
  .replace('const decoded = decodeURIComponent(raw).trim();', 'const decoded = raw.trim();')
  .replace('return COMPLEX_SLUG.test(decoded) ? decoded : null;', 'return decoded;');
assert.throws(() => assertSourceContract(unsafeHelper, sources), 'removing URIError fail-closed handling must fail the contract');

for (const [name, source] of sources) {
  const bypassed = source.replaceAll('decodeComplexSlug(', 'unsafeDecodeComplexSlug(');
  assert.throws(
    () => assertSourceContract(helperSource, new Map([[name, bypassed]])),
    `bypassing the safe decoder in ${name} must fail the contract`
  );
}

console.log('REPRESENTATIVE_PRIVATE_ADMIN_ROUTES=3');
console.log(`MALFORMED_PERCENT_ENCODING_CASES=${MALFORMED_SLUGS.length}`);
console.log('MALFORMED_PERCENT_ENCODING=400_INVALID_COMPLEX_SLUG');
console.log('URI_ERROR_ESCAPE=0');
console.log('INVALID_COMPLEX_SLUG_DB_QUERY=0');
console.log(`VALID_SLUG_PARITY=${VALID_SLUG}`);
console.log('SAFE_DECODER_BYPASS_MUTATION_PROOF=PASS');
console.log('UNSAFE_HELPER_MUTATION_PROOF=PASS');
console.log('safe-complex-slug-1018: PASS');
