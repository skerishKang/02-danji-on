import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import core from '../src/core-v1.ts';

const ENV = {
  DATABASE_URL: 'postgresql://synthetic.invalid/danjion',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'false'
};

const BUSINESS_ID = '123e4567-e89b-42d3-a456-426614174000';
const POST_ID = '123e4567-e89b-42d3-a456-426614174001';
const BUSINESS_ROW = {
  id: BUSINESS_ID,
  kind: 'shop',
  name: 'Approved Business',
  summary: 'Public summary',
  description: 'Public description',
  price_text: 'Price',
  service_area: 'Complex',
  availability_text: 'Available',
  category_slug: 'food',
  category_name: 'Food',
  categories: ['food'],
  relation_type: 'resident'
};
const POST_ROW = {
  id: POST_ID,
  source_name: 'Office',
  category: 'notice',
  channel: 'apartment_news',
  display_mode: 'standard',
  title: 'Published post',
  body: 'Public body',
  attachment_object_key: null,
  published_at: '2026-09-24T00:00:00.000Z',
  reaction_count: 0
};

function sqlText(strings) {
  return strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function request(pathname, handler) {
  const seen = [];
  const originalError = console.error;
  console.error = () => {};
  globalThis.__DANJION_TEST_SQL__ = async (strings, ...values) => {
    const text = sqlText(strings);
    seen.push({ text, values });
    return handler(text);
  };
  try {
    const response = await core.fetch(
      new Request(`https://api.example.test${pathname}`, {
        headers: { 'x-danjion-request-id': 'req-973' }
      }),
      ENV
    );
    return { response, seen };
  } finally {
    delete globalThis.__DANJION_TEST_SQL__;
    console.error = originalError;
  }
}

async function contract(pathname, handler) {
  const { response, seen } = await request(pathname, handler);
  return { status: response.status, body: await response.json(), seen };
}

const malformedUuidCases = [
  '-',
  '----',
  'abc-def',
  BUSINESS_ID.slice(0, 35),
  `${BUSINESS_ID}0`,
  `${BUSINESS_ID.slice(0, -1)}g`,
  '123e4567--e89b-42d3-a456-426614174000',
  '123e4567-e89b-42d3-a456',
  '123e4567-e89b-62d3-a456-426614174000',
  'not-a-uuid'
];

for (const resource of ['businesses', 'posts']) {
  for (const malformed of malformedUuidCases) {
    const result = await contract(
      `/api/v1/complexes/valid-complex/${resource}/${encodeURIComponent(malformed)}`,
      () => { throw new Error(`malformed ${resource} UUID must not execute SQL`); }
    );
    assert.equal(result.status, 404, `${resource} malformed UUID must be 4xx`);
    assert.equal(result.body.error.code, 'NOT_FOUND');
    assert.equal(result.seen.length, 0, `${resource} malformed UUID must execute zero queries`);
  }
}

const malformedSlugCases = ['%', '%2', '%ZZ', '%E0%A4'];
const publicSlugRoutes = [
  '/api/v1/complexes/%ZZ',
  '/api/v1/complexes/%ZZ/businesses',
  `/api/v1/complexes/%ZZ/businesses/${BUSINESS_ID}`,
  '/api/v1/complexes/%ZZ/benefits',
  '/api/v1/complexes/%ZZ/posts',
  `/api/v1/complexes/%ZZ/posts/${POST_ID}`
];

for (const rawSlug of malformedSlugCases) {
  const result = await contract(
    `/api/v1/complexes/${rawSlug}`,
    () => { throw new Error('malformed slug must not execute SQL'); }
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'INVALID_COMPLEX_SLUG');
  assert.equal(result.seen.length, 0);
}
for (const pathname of publicSlugRoutes) {
  const result = await contract(
    pathname,
    () => { throw new Error('malformed public slug route must not execute SQL'); }
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'INVALID_COMPLEX_SLUG');
  assert.equal(result.seen.length, 0);
}

const validBusiness = await contract(
  `/api/v1/complexes/valid-complex/businesses/${BUSINESS_ID.toUpperCase()}`,
  (text) => {
    if (text.includes('from businesses b')) return [BUSINESS_ROW];
    if (text.includes('from business_media')) return [];
    if (text.includes('from benefits')) return [];
    throw new Error(`unexpected valid business SQL: ${text}`);
  }
);
assert.equal(validBusiness.status, 200);
assert.equal(validBusiness.body.data.id, BUSINESS_ID);
assert.equal(validBusiness.seen.length, 3);
assert.match(validBusiness.seen[0].text, /c\.status = any/);
assert.match(validBusiness.seen[0].text, /r\.verification_status = 'verified'/);

const validPost = await contract(
  `/api/v1/complexes/valid-complex/posts/${POST_ID.toUpperCase()}`,
  (text) => {
    if (text.includes('from complex_posts p')) return [POST_ROW];
    throw new Error(`unexpected valid post SQL: ${text}`);
  }
);
assert.equal(validPost.status, 200);
assert.equal(validPost.body.data.id, POST_ID);
assert.equal(validPost.seen.length, 1);
assert.match(validPost.seen[0].text, /c\.status = any/);
assert.match(validPost.seen[0].text, /p\.status = 'published'/);

const coreSource = await readFile(new URL('../src/core-v1.ts', import.meta.url), 'utf8');
function assertSourceContract(source) {
  assert.match(source, /import \{ UUID \} from '\.\/application-docs-core-v1'/);
  const publicSource = source.slice(
    source.indexOf('async function handlePublicGet('),
    source.indexOf('async function handlePrivate(')
  );
  assert.equal(publicSource.split('decodePublicComplexSlug(match[1])').length - 1, 6);
  assert.equal(publicSource.includes('decodeURIComponent(match[1])'), false);
  assert.match(
    source,
    /function decodePublicComplexSlug\(raw: string\): string \| null \{[\s\S]*?return decodeComplexSlug\(raw\);/
  );
  assert.match(source, /import \{ decodeComplexSlug \} from '\.\/complex-slug-v1'/);
  const businessRoute = source.indexOf("/businesses\\/([0-9a-fA-F-]+)$/");
  const businessGuard = source.indexOf('if (!UUID.test(businessId))', businessRoute);
  const businessQuery = source.indexOf('select b.id, b.kind', businessRoute);
  assert.ok(businessRoute >= 0 && businessRoute < businessGuard && businessGuard < businessQuery);
  const postRoute = source.indexOf("/posts\\/([0-9a-fA-F-]+)$/");
  const postGuard = source.indexOf('if (!UUID.test(postId))', postRoute);
  const postQuery = source.indexOf('select p.id, p.source_name', postRoute);
  assert.ok(postRoute >= 0 && postRoute < postGuard && postGuard < postQuery);
}
assertSourceContract(coreSource);

const withoutUuidGuards = coreSource
  .replace("    if (!UUID.test(businessId)) return fail('NOT_FOUND', 'Business not found', 404, id);\n", '')
  .replace("    if (!UUID.test(postId)) return fail('NOT_FOUND', 'Post not found', 404, id);\n", '');
assert.throws(() => assertSourceContract(withoutUuidGuards));

const withUnsafeSlugDecoder = coreSource.replace(
  'return decodeComplexSlug(raw);',
  'return raw;'
);
assert.throws(() => assertSourceContract(withUnsafeSlugDecoder));

console.log('MALFORMED_BUSINESS_UUID=4XX_NOT_500');
console.log('MALFORMED_POST_UUID=4XX_NOT_500');
console.log('MALFORMED_SLUG_ENCODING=4XX_NOT_500');
console.log('INVALID_IDENTIFIER_DB_QUERY=0');
console.log('VALID_BUSINESS_UUID_EXISTING_BEHAVIOR=PRESERVED');
console.log('VALID_POST_UUID_EXISTING_BEHAVIOR=PRESERVED');
console.log('VALID_SLUG_EXISTING_BEHAVIOR=PRESERVED');
console.log('#971_PUBLIC_COMPLEX_GATE=PRESERVED');
console.log('#971_VERIFIED_RELATION_GATE=PRESERVED');
console.log('NO_PG_UUID_CAST_ERROR_FOR_INVALID_INPUT=PASS');
console.log('UUID_VALIDATOR_BYPASS_MUTATION_PROOF=PASS');
console.log('SAFE_SLUG_DECODER_BYPASS_MUTATION_PROOF=PASS');
console.log('core-public-route-identifiers: PASS');
