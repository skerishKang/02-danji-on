/**
 * #984 [Auth/UI] — runtime social-provider capability contract.
 *
 * The public UI may render a social provider ONLY when the runtime actually
 * registered it. This suite pins, against the real module:
 *   1. the availability matrix (google-only / kakao-only / both / neither),
 *   2. the COMPLETE-credential-pair rule (an id-only or secret-only
 *      configuration must never be advertised as available),
 *   3. Naver staying permanently absent from the UI capability list (#586),
 *   4. the GET /api/auth/capabilities endpoint shape, cache policy, and its
 *      guarantee that no credential material and no DB query ever leave it.
 *
 * Only fabricated 'fake-…' values are used; no secret is printed or logged.
 */
import assert from 'node:assert/strict';
import {
  AUTH_CAPABILITY_PATH,
  configuredUiSocialProviders,
  handleBetterAuthRequest
} from '../src/auth-better-v1.ts';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://unused@neon.invalid/db',
  DANJION_AUTH_BASE_URL: 'https://auth.test.invalid',
  BETTER_AUTH_SECRET: 'b'.repeat(48)
};

const GOOGLE_ID = 'fake-google-client-id';
const GOOGLE_SECRET = 'fake-google-client-secret';
const KAKAO_ID = 'fake-kakao-client-id';
const KAKAO_SECRET = 'fake-kakao-client-secret';
const NAVER_ID = 'fake-naver-client-id';
const NAVER_SECRET = 'fake-naver-client-secret';

const envWith = (extra = {}) => ({ ...BASE_ENV, ...extra });
const providersFor = (extra) => configuredUiSocialProviders(envWith(extra));

/* --- provider availability matrix ------------------------------------------- */
assert.deepEqual(providersFor({ GOOGLE_CLIENT_ID: GOOGLE_ID, GOOGLE_CLIENT_SECRET: GOOGLE_SECRET }),
  ['google'], 'GOOGLE_ONLY must expose only google');
assert.deepEqual(providersFor({ KAKAO_CLIENT_ID: KAKAO_ID, KAKAO_CLIENT_SECRET: KAKAO_SECRET }),
  ['kakao'], 'KAKAO_ONLY must expose only kakao');
assert.deepEqual(providersFor({
  GOOGLE_CLIENT_ID: GOOGLE_ID,
  GOOGLE_CLIENT_SECRET: GOOGLE_SECRET,
  KAKAO_CLIENT_ID: KAKAO_ID,
  KAKAO_CLIENT_SECRET: KAKAO_SECRET
}), ['kakao', 'google'], 'BOTH must return product order kakao then google, never alphabetical');
assert.deepEqual(providersFor({}), [], 'NEITHER must resolve to an empty list');
console.log('SOCIAL_PROVIDER_MATRIX=GOOGLE_ONLY|KAKAO_ONLY|BOTH|NEITHER=PASS');

/* --- incomplete credential pairs are never available ------------------------ */
assert.deepEqual(providersFor({ GOOGLE_CLIENT_ID: GOOGLE_ID }), [],
  'GOOGLE_CLIENT_ID only must stay unavailable');
assert.deepEqual(providersFor({ GOOGLE_CLIENT_SECRET: GOOGLE_SECRET }), [],
  'GOOGLE_CLIENT_SECRET only must stay unavailable');
assert.deepEqual(providersFor({ KAKAO_CLIENT_ID: KAKAO_ID }), [],
  'KAKAO_CLIENT_ID only must stay unavailable');
assert.deepEqual(providersFor({ KAKAO_CLIENT_SECRET: KAKAO_SECRET }), [],
  'KAKAO_CLIENT_SECRET only must stay unavailable');
assert.deepEqual(providersFor({
  GOOGLE_CLIENT_ID: GOOGLE_ID,
  KAKAO_CLIENT_ID: KAKAO_ID
}), [], 'two id-only providers must still resolve to an empty list');
assert.deepEqual(providersFor({ GOOGLE_CLIENT_ID: '   ', GOOGLE_CLIENT_SECRET: GOOGLE_SECRET }), [],
  'a blank id must not count as a present credential');
assert.deepEqual(providersFor({ GOOGLE_CLIENT_ID: GOOGLE_ID, GOOGLE_CLIENT_SECRET: '   ' }), [],
  'a blank secret must not count as a present credential');
console.log('INCOMPLETE_CREDENTIAL_PAIR=UNAVAILABLE=PASS');

/* --- Naver stays out of the UI capability list ------------------------------ */
const naverOnly = providersFor({ NAVER_CLIENT_ID: NAVER_ID, NAVER_CLIENT_SECRET: NAVER_SECRET });
assert.deepEqual(naverOnly, [], 'NAVER_CONFIGURED_UI_BUTTON must be NO even with a complete Naver pair');
const naverMixed = providersFor({
  NAVER_CLIENT_ID: NAVER_ID,
  NAVER_CLIENT_SECRET: NAVER_SECRET,
  GOOGLE_CLIENT_ID: GOOGLE_ID,
  GOOGLE_CLIENT_SECRET: GOOGLE_SECRET
});
assert.deepEqual(naverMixed, ['google'], 'a complete Naver pair must never leak into the UI list');
assert.equal(naverMixed.includes('naver'), false, 'naver must never appear in the UI capability list');
console.log('NAVER_CONFIGURED_UI_BUTTON=NO=PASS');

/* --- public GET /api/auth/capabilities endpoint --------------------------------- */
assert.equal(AUTH_CAPABILITY_PATH, '/api/auth/capabilities', 'the capability route must stay stable');

const outboundUrls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  outboundUrls.push(url);
  throw new Error(`social-provider-runtime-capability-984: unexpected outbound fetch ${url}`);
};

try {
  const env = envWith({
    GOOGLE_CLIENT_ID: GOOGLE_ID,
    GOOGLE_CLIENT_SECRET: GOOGLE_SECRET,
    KAKAO_CLIENT_ID: KAKAO_ID,
    KAKAO_CLIENT_SECRET: KAKAO_SECRET
  });

  const capabilityResponse = await handleBetterAuthRequest(
    new Request('https://x.test/api/auth/capabilities', { method: 'GET' }),
    env
  );
  assert.ok(capabilityResponse, 'GET /api/auth/capabilities must be handled by the auth facade');
  assert.equal(capabilityResponse.status, 200, 'GET /api/auth/capabilities must return 200');
  assert.equal(capabilityResponse.headers.get('cache-control'), 'no-store',
    'the capability response must never be cached');

  const capabilityText = await capabilityResponse.text();
  const capabilityBody = JSON.parse(capabilityText);
  assert.deepEqual(capabilityBody, { data: { socialProviders: ['kakao', 'google'] } },
    'the capability payload must be exactly { data: { socialProviders } } in product order');

  for (const secretLiteral of [
    GOOGLE_ID, GOOGLE_SECRET, KAKAO_ID, KAKAO_SECRET,
    BASE_ENV.DATABASE_URL, BASE_ENV.BETTER_AUTH_SECRET
  ]) {
    assert.equal(capabilityText.includes(secretLiteral), false,
      'the capability response must not contain credential/env material');
  }
  assert.equal(/client[_-]?secret|client[_-]?id|DATABASE_URL|BETTER_AUTH_SECRET/i.test(capabilityText), false,
    'the capability response must not even name credential fields');

  // GET-only: the same path with another method must not be served by the
  // capability route (and, being outside /api/auth/, must fall through to null).
  const postResponse = await handleBetterAuthRequest(
    new Request('https://x.test/api/auth/capabilities', { method: 'POST' }),
    env
  );
  assert.ok(postResponse, 'POST /api/auth/capabilities must be rejected explicitly');
  assert.equal(postResponse.status, 405, 'POST /api/auth/capabilities must return 405');
  assert.equal(postResponse.headers.get('allow'), 'GET', 'capability endpoint must advertise GET as the only allowed method');
  assert.equal(postResponse.headers.get('cache-control'), 'no-store', 'method rejection must not be cached');

  // The capability read must never touch the database or any outbound service.
  assert.deepEqual(outboundUrls, [], 'the capability route must perform zero outbound fetch (DB query 0)');
} finally {
  globalThis.fetch = originalFetch;
}
console.log('AUTH_CAPABILITY_ENDPOINT_GET_ONLY=200_DB0=PASS');

console.log('social-provider-runtime-capability-984-contract: PASS');
