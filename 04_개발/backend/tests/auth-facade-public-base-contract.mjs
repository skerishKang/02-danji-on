import assert from 'node:assert/strict';
import {
  createDanjionAuth,
  resolveAuthPublicBaseUrl,
  AUTH_FACADE_MARKER_HEADER,
  AUTH_FACADE_MARKER_VALUE,
  PRIMARY_PRODUCTION_AUTH_BASE_URL,
  LEGACY_PRODUCTION_AUTH_BASE_URL,
  CANONICAL_PAGES_AUTH_BASE_URL
} from '../src/auth-better-v1.ts';

const WORKER_BASE = 'https://padiem-danjion-api-production.padiem.workers.dev';
const env = {
  DATABASE_URL: 'postgresql://unused@neon.invalid/db',
  DANJION_AUTH_BASE_URL: WORKER_BASE,
  BETTER_AUTH_SECRET: 'a'.repeat(48),
  GOOGLE_CLIENT_ID: 'fake-google-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'fake-google-client-secret',
  KAKAO_CLIENT_ID: '00000000000000000000000000000000',
  KAKAO_CLIENT_SECRET: 'fake-kakao-client-secret'
};

const makeSignInSocialRequest = (headers = {}, callbackURL = CANONICAL_PAGES_AUTH_BASE_URL, provider = 'google') => new Request(
  `${WORKER_BASE}/api/auth/sign-in/social`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ provider, callbackURL })
  }
);

/* --- bounded per-request public-base resolver --- */
assert.equal(resolveAuthPublicBaseUrl(env), WORKER_BASE, 'no request must keep the env Worker base');
assert.equal(resolveAuthPublicBaseUrl(env, makeSignInSocialRequest()), WORKER_BASE, 'direct Worker request must keep the env base');
assert.equal(resolveAuthPublicBaseUrl(env, makeSignInSocialRequest({
  [AUTH_FACADE_MARKER_HEADER]: AUTH_FACADE_MARKER_VALUE,
  origin: PRIMARY_PRODUCTION_AUTH_BASE_URL
})), PRIMARY_PRODUCTION_AUTH_BASE_URL, 'facade marker + primary custom Origin must select primary custom base');
assert.equal(resolveAuthPublicBaseUrl(env, makeSignInSocialRequest({
  [AUTH_FACADE_MARKER_HEADER]: AUTH_FACADE_MARKER_VALUE,
  origin: CANONICAL_PAGES_AUTH_BASE_URL
})), CANONICAL_PAGES_AUTH_BASE_URL, 'facade marker + canonical Origin must select the canonical Pages base');
assert.equal(resolveAuthPublicBaseUrl(env, makeSignInSocialRequest({
  [AUTH_FACADE_MARKER_HEADER]: AUTH_FACADE_MARKER_VALUE,
  origin: LEGACY_PRODUCTION_AUTH_BASE_URL
})), LEGACY_PRODUCTION_AUTH_BASE_URL, 'facade marker + legacy Origin must select legacy Pages base');
assert.equal(resolveAuthPublicBaseUrl({ ...env, APP_ENV: 'qa' }, makeSignInSocialRequest({
  [AUTH_FACADE_MARKER_HEADER]: AUTH_FACADE_MARKER_VALUE,
  origin: 'https://danjion-qa.pages.dev'
})), 'https://danjion-qa.pages.dev', 'QA facade marker + exact QA Origin must select the QA Pages base');
assert.equal(resolveAuthPublicBaseUrl(env, makeSignInSocialRequest({
  [AUTH_FACADE_MARKER_HEADER]: AUTH_FACADE_MARKER_VALUE,
  origin: 'https://danjion-qa.pages.dev'
})), WORKER_BASE, 'QA facade origin must remain disabled outside APP_ENV=qa');
assert.equal(resolveAuthPublicBaseUrl(env, makeSignInSocialRequest({ origin: PRIMARY_PRODUCTION_AUTH_BASE_URL })),
  WORKER_BASE, 'primary Origin without the marker must not flip the base');
assert.equal(resolveAuthPublicBaseUrl(env, makeSignInSocialRequest({ origin: CANONICAL_PAGES_AUTH_BASE_URL })),
  WORKER_BASE, 'canonical Origin without the marker must not flip the base');
assert.equal(resolveAuthPublicBaseUrl(env, makeSignInSocialRequest({
  [AUTH_FACADE_MARKER_HEADER]: AUTH_FACADE_MARKER_VALUE,
  origin: 'https://evil-danjion.padiem.net'
})), WORKER_BASE, 'spoofed primary origin must not flip the base');
assert.equal(resolveAuthPublicBaseUrl(env, makeSignInSocialRequest({
  [AUTH_FACADE_MARKER_HEADER]: AUTH_FACADE_MARKER_VALUE,
  origin: 'https://danjion.padiem.net.evil.example'
})), WORKER_BASE, 'suffix-spoofed primary origin must not flip the base');
assert.equal(resolveAuthPublicBaseUrl(env, makeSignInSocialRequest({ [AUTH_FACADE_MARKER_HEADER]: AUTH_FACADE_MARKER_VALUE })),
  WORKER_BASE, 'marker without the canonical Origin must not flip the base');
assert.equal(resolveAuthPublicBaseUrl(env, makeSignInSocialRequest({
  [AUTH_FACADE_MARKER_HEADER]: 'attacker-controlled-v9',
  origin: CANONICAL_PAGES_AUTH_BASE_URL
})), WORKER_BASE, 'a forged marker value must not flip the base');
assert.equal(resolveAuthPublicBaseUrl(env, makeSignInSocialRequest({
  [AUTH_FACADE_MARKER_HEADER]: AUTH_FACADE_MARKER_VALUE,
  origin: 'https://evil-attacker.example'
})), WORKER_BASE, 'the marker must never select an arbitrary origin');
assert.equal(resolveAuthPublicBaseUrl(env, makeSignInSocialRequest({
  [AUTH_FACADE_MARKER_HEADER]: `${AUTH_FACADE_MARKER_VALUE}, attacker-v9`,
  origin: CANONICAL_PAGES_AUTH_BASE_URL
})), WORKER_BASE, 'a duplicated/dictated marker value must not flip the base');
assert.throws(() => resolveAuthPublicBaseUrl({ ...env, DANJION_AUTH_BASE_URL: undefined }),
  /DANJION_AUTH_BASE_URL is required/,
  'a missing env base must stay fail-closed even alongside the facade contract');
assert.throws(() => resolveAuthPublicBaseUrl(
  { ...env, DANJION_AUTH_BASE_URL: undefined },
  makeSignInSocialRequest({
    [AUTH_FACADE_MARKER_HEADER]: AUTH_FACADE_MARKER_VALUE,
    origin: CANONICAL_PAGES_AUTH_BASE_URL
  })
), /DANJION_AUTH_BASE_URL is required/,
  'a facade request must not mask a missing Worker configuration');

/* --- executable: real Better Auth social URL generation, per-mode redirect_uri --- */
const neonJson = (payload) => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { 'content-type': 'application/json' }
});

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (url.includes('.invalid')) {
    let parsed = {};
    try { parsed = JSON.parse(init?.body ?? '{}'); } catch { /* keep empty */ }
    const statement = String(parsed.query ?? parsed.statement ?? '');
    const params = Array.isArray(parsed.params) ? parsed.params : [];
    const returning = statement.match(/returning\s+(.+)$/i);
    if (returning) {
      const names = [...returning[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      return neonJson({
        fields: names.map((name) => ({ name, dataTypeID: 25 })),
        rows: [names.map((_, index) => String(params[index] ?? ''))],
        affected_rows: 1
      });
    }
    return neonJson({ fields: [], rows: [] });
  }
  throw new Error(`auth-facade-public-base-contract: unexpected outbound fetch ${url}`);
};

const facadeRequest = makeSignInSocialRequest({
  [AUTH_FACADE_MARKER_HEADER]: AUTH_FACADE_MARKER_VALUE,
  origin: CANONICAL_PAGES_AUTH_BASE_URL
});
const directRequest = makeSignInSocialRequest({ origin: WORKER_BASE }, `${WORKER_BASE}/`);

const readAuthUrl = async (auth, request) => {
  const response = await auth.handler(request);
  assert.equal(response.status, 200, `sign-in/social must succeed (${response.status})`);
  const body = await response.json();
  const url = body?.url ?? body?.data?.url;
  assert.equal(typeof url, 'string', 'sign-in/social must return a provider authorization URL');
  return new URL(url);
};

const facadeAuthUrl = await readAuthUrl(
  createDanjionAuth(env, resolveAuthPublicBaseUrl(env, facadeRequest)),
  facadeRequest
);
assert.equal(facadeAuthUrl.origin, 'https://accounts.google.com', 'facade mode must still reach Google');
assert.equal(facadeAuthUrl.searchParams.get('redirect_uri'),
  'https://danjion.pages.dev/api/auth/callback/google',
  'facade-mode Better Auth callback base must be exactly the canonical Pages base');

const primaryFacadeRequest = makeSignInSocialRequest({
  [AUTH_FACADE_MARKER_HEADER]: AUTH_FACADE_MARKER_VALUE,
  origin: PRIMARY_PRODUCTION_AUTH_BASE_URL
}, PRIMARY_PRODUCTION_AUTH_BASE_URL);
const primaryFacadeAuthUrl = await readAuthUrl(
  createDanjionAuth(env, resolveAuthPublicBaseUrl(env, primaryFacadeRequest)),
  primaryFacadeRequest
);
assert.equal(primaryFacadeAuthUrl.origin, 'https://accounts.google.com', 'primary facade mode must still reach Google');
assert.equal(primaryFacadeAuthUrl.searchParams.get('redirect_uri'),
  'https://danjion.padiem.net/api/auth/callback/google',
  'primary facade-mode callback base must be exactly the custom domain base');

const directAuthUrl = await readAuthUrl(
  createDanjionAuth(env, resolveAuthPublicBaseUrl(env, directRequest)),
  directRequest
);
assert.equal(directAuthUrl.origin, 'https://accounts.google.com', 'direct mode must still reach Google');
assert.equal(directAuthUrl.searchParams.get('redirect_uri'),
  `${WORKER_BASE}/api/auth/callback/google`,
  'direct Worker mode must keep the existing Worker callback base unchanged');

/* --- kakao: the canonical Pages callback is provider-agnostic --- */
const kakaoFacadeRequest = makeSignInSocialRequest({
  [AUTH_FACADE_MARKER_HEADER]: AUTH_FACADE_MARKER_VALUE,
  origin: CANONICAL_PAGES_AUTH_BASE_URL
}, CANONICAL_PAGES_AUTH_BASE_URL, 'kakao');
const kakaoFacadeAuthUrl = await readAuthUrl(
  createDanjionAuth(env, resolveAuthPublicBaseUrl(env, kakaoFacadeRequest)),
  kakaoFacadeRequest
);
assert.equal(kakaoFacadeAuthUrl.origin, 'https://kauth.kakao.com', 'facade mode must still reach Kakao');
assert.equal(kakaoFacadeAuthUrl.searchParams.get('redirect_uri'),
  'https://danjion.pages.dev/api/auth/callback/kakao',
  'Kakao facade-mode callback base must be exactly the canonical Pages base');

const primaryKakaoFacadeRequest = makeSignInSocialRequest({
  [AUTH_FACADE_MARKER_HEADER]: AUTH_FACADE_MARKER_VALUE,
  origin: PRIMARY_PRODUCTION_AUTH_BASE_URL
}, PRIMARY_PRODUCTION_AUTH_BASE_URL, 'kakao');
const primaryKakaoFacadeAuthUrl = await readAuthUrl(
  createDanjionAuth(env, resolveAuthPublicBaseUrl(env, primaryKakaoFacadeRequest)),
  primaryKakaoFacadeRequest
);
assert.equal(primaryKakaoFacadeAuthUrl.origin, 'https://kauth.kakao.com', 'primary facade mode must still reach Kakao');
assert.equal(primaryKakaoFacadeAuthUrl.searchParams.get('redirect_uri'),
  'https://danjion.padiem.net/api/auth/callback/kakao',
  'Kakao primary facade callback base must be exactly the custom domain base');

const kakaoDirectRequest = makeSignInSocialRequest({ origin: WORKER_BASE }, `${WORKER_BASE}/`, 'kakao');
const kakaoDirectAuthUrl = await readAuthUrl(
  createDanjionAuth(env, resolveAuthPublicBaseUrl(env, kakaoDirectRequest)),
  kakaoDirectRequest
);
assert.equal(kakaoDirectAuthUrl.origin, 'https://kauth.kakao.com', 'direct mode must still reach Kakao');
assert.equal(kakaoDirectAuthUrl.searchParams.get('redirect_uri'),
  `${WORKER_BASE}/api/auth/callback/kakao`,
  'direct Worker mode must keep the Kakao callback base unchanged');

console.log('auth-facade-public-base-contract: PASS');
