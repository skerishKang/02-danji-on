import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { requireActor } from '../src/auth-v1.ts';

const ISSUER = 'https://auth.example.test';
const JWKS_URL = `${ISSUER}/neondb/auth/.well-known/jwks.json`;
const SUBJECT = '860dc360-609f-4b7d-9e70-ec93fe6414d3';
const APP_USER_ID = '11111111-1111-4111-8111-111111111111';
const BASE_ENV = {
  DATABASE_URL: 'postgresql://unused-in-unit-test',
  APP_ENV: 'production',
  DEV_AUTH_BYPASS: 'false',
  NEON_AUTH_BASE_URL: `${ISSUER}/neondb/auth`,
  NEON_AUTH_JWKS_URL: JWKS_URL
};

function mockSql(existing = null) {
  let linked = existing;
  const queries = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    queries.push(text);
    if (text.includes('select id, auth_user_id, display_name')) {
      return linked ? [linked] : [];
    }
    if (text.includes('insert into app_users')) {
      linked = {
        id: APP_USER_ID,
        auth_user_id: String(values[0]),
        display_name: String(values[1])
      };
      return [linked];
    }
    throw new Error(`Unexpected SQL in auth unit test: ${text}`);
  };
  return { sql, queries };
}

async function errorCode(response) {
  assert.ok(response instanceof Response);
  return (await response.json()).error.code;
}

async function main() {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'danjion-test-key';
  jwk.alg = 'EdDSA';
  jwk.use = 'sig';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), JWKS_URL);
    return Response.json({ keys: [jwk] }, { status: 200 });
  };

  const token = async (claims = {}, issuer = ISSUER) => new SignJWT({
    id: SUBJECT,
    name: '테스트 사용자',
    ...claims
  })
    .setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid })
    .setSubject(SUBJECT)
    .setIssuer(issuer)
    .setAudience(ISSUER)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

  try {
    {
      const { sql, queries } = mockSql();
      const request = new Request('https://api.example.test/api/v1/me', {
        headers: { 'x-danjion-dev-auth-user': 'dev-manager-001' }
      });
      const result = await requireActor(request, { ...BASE_ENV, DEV_AUTH_BYPASS: 'true' }, sql, 'req-no-auth');
      assert.equal(await errorCode(result), 'AUTH_REQUIRED');
      assert.equal(queries.length, 0, 'production must ignore the dev auth header');
    }

    {
      const { sql } = mockSql();
      const request = new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: 'Bearer placeholder' }
      });
      const result = await requireActor(request, {
        DATABASE_URL: BASE_ENV.DATABASE_URL,
        APP_ENV: 'production'
      }, sql, 'req-not-configured');
      assert.equal(await errorCode(result), 'AUTH_NOT_CONFIGURED');
    }

    {
      const { sql } = mockSql();
      const request = new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: 'Bearer not-a-jwt' }
      });
      const result = await requireActor(request, BASE_ENV, sql, 'req-invalid');
      assert.equal(await errorCode(result), 'AUTH_INVALID');
    }

    {
      const existing = {
        id: APP_USER_ID,
        auth_user_id: SUBJECT,
        display_name: '기존 사용자'
      };
      const { sql, queries } = mockSql(existing);
      const request = new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${await token()}` }
      });
      const result = await requireActor(request, BASE_ENV, sql, 'req-existing');
      assert.deepEqual(result, {
        id: APP_USER_ID,
        authUserId: SUBJECT,
        displayName: '기존 사용자'
      });
      assert.equal(queries.filter((query) => query.includes('insert into app_users')).length, 0);
    }

    {
      const { sql, queries } = mockSql();
      const request = new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${await token()}` }
      });
      const result = await requireActor(request, BASE_ENV, sql, 'req-bootstrap');
      assert.deepEqual(result, {
        id: APP_USER_ID,
        authUserId: SUBJECT,
        displayName: '테스트 사용자'
      });
      assert.equal(queries.filter((query) => query.includes('insert into app_users')).length, 1);
      assert.equal(queries.some((query) => query.includes('complex_memberships')), false);
    }

    {
      const { sql } = mockSql();
      const request = new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${await token({ banned: true })}` }
      });
      const result = await requireActor(request, BASE_ENV, sql, 'req-banned');
      assert.equal(await errorCode(result), 'AUTH_FORBIDDEN');
    }

    {
      const { sql } = mockSql();
      const request = new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${await token({}, 'https://wrong-issuer.example.test')}` }
      });
      const result = await requireActor(request, BASE_ENV, sql, 'req-wrong-issuer');
      assert.equal(await errorCode(result), 'AUTH_INVALID');
    }

    console.log('PASS auth-v1 live Neon Auth contract');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

await main();
