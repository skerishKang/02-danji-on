import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { requireActor, jwtVerificationErrorCode } from '../src/auth-v1.ts';

const ISSUER = 'https://auth.example.test';
const JWKS_URL = `${ISSUER}/neondb/auth/.well-known/jwks.json`;
const AMBIGUOUS_JWKS_URL = `${ISSUER}/neondb/auth/.well-known/jwks-duplicate-kid.json`;
const SUBJECT = '860dc360-609f-4b7d-9e70-ec93fe6414d3';
const APP_USER_ID = '11111111-1111-4111-8111-111111111111';
const BASE_ENV = {
  DATABASE_URL: 'postgresql://unused-in-unit-test',
  APP_ENV: 'production',
  DEV_AUTH_BYPASS: 'false',
  NEON_AUTH_BASE_URL: `${ISSUER}/neondb/auth`,
  NEON_AUTH_JWKS_URL: JWKS_URL
};
const DANJION_ENV = {
  DATABASE_URL: BASE_ENV.DATABASE_URL,
  APP_ENV: 'production',
  DEV_AUTH_BYPASS: 'false',
  DANJION_AUTH_BASE_URL: ISSUER,
  DANJION_AUTH_JWKS_URL: JWKS_URL
};

function mockSql(existing = null, { providerId = null, phoneOnboarding = false } = {}) {
  let linked = existing;
  const queries = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    queries.push(text);
    if (text.includes('select id, auth_user_id, display_name')) {
      return linked ? [linked] : [];
    }
    if (text.includes('from danjion_auth.account')) {
      return ['google', 'naver', 'kakao'].includes(providerId) ? [{ provider_id: providerId }] : [];
    }
    if (text.includes('from signup_contact_receipts')) {
      return phoneOnboarding ? [{ accepted: 1 }] : [];
    }
    if (text.includes('insert into app_users')) {
      linked = {
        id: APP_USER_ID,
        auth_user_id: String(values[0]),
        display_name: String(values[1]),
        account_status: 'active'
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
    const url = String(input);
    if (url === AMBIGUOUS_JWKS_URL) {
      return Response.json({ keys: [jwk, { ...jwk }] }, { status: 200 });
    }
    assert.equal(url, JWKS_URL);
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
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (...args) => warnings.push(args.map(String).join(' '));
      let result;
      try {
        result = await requireActor(request, BASE_ENV, sql, 'req-invalid');
      } finally {
        console.warn = originalWarn;
      }
      assert.equal(await errorCode(result), 'AUTH_JWT_MALFORMED');
      assert.equal(warnings.length, 1, 'malformed token must emit exactly one sanitized diagnostic');
      const diagnostic = JSON.parse(warnings[0].replace('[DanjiOn JWT Verify] ', ''));
      assert.deepEqual(Object.keys(diagnostic).sort(), ['errorClaim', 'errorCode', 'errorName', 'requestId']);
      assert.equal(diagnostic.requestId, 'req-invalid');
      assert.equal(diagnostic.errorCode, 'ERR_JWS_INVALID');
      assert.ok(!warnings[0].includes('not-a-jwt'), 'diagnostic must not contain the token');
    }

    {
      const existing = {
        id: APP_USER_ID,
        auth_user_id: SUBJECT,
        display_name: '기존 사용자',
        account_status: 'active'
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
      const existing = {
        id: APP_USER_ID,
        auth_user_id: SUBJECT,
        display_name: '탈퇴한 사용자',
        account_status: 'closed'
      };
      const { sql, queries } = mockSql(existing);
      const request = new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${await token()}` }
      });
      const result = await requireActor(request, BASE_ENV, sql, 'req-closed');
      assert.equal(await errorCode(result), 'AUTH_ACCOUNT_CLOSED');
      assert.equal(queries.filter((query) => query.includes('insert into app_users')).length, 0, 'closed account must never be re-bootstrapped');
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

    for (const providerId of ['google', 'naver', 'kakao']) {
      const { sql, queries } = mockSql(null, { providerId });
      const request = new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${await token()}` }
      });
      const result = await requireActor(request, DANJION_ENV, sql, `req-social-${providerId}`);
      assert.deepEqual(result, {
        id: APP_USER_ID,
        authUserId: SUBJECT,
        displayName: '테스트 사용자'
      });
      assert.equal(queries.filter((query) => query.includes('from danjion_auth.account')).length, 0);
      assert.equal(queries.filter((query) => query.includes('from signup_contact_receipts')).length, 0, `${providerId} must not require a phone receipt`);
      assert.equal(queries.filter((query) => query.includes('insert into app_users')).length, 1);
    }

    {
      const { sql, queries } = mockSql(null, { providerId: 'credential' });
      const request = new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${await token()}` }
      });
      const result = await requireActor(request, DANJION_ENV, sql, 'req-direct-without-phone');
      assert.deepEqual(result, {
        id: APP_USER_ID,
        authUserId: SUBJECT,
        displayName: '테스트 사용자'
      });
      assert.equal(queries.filter((query) => query.includes('from signup_contact_receipts')).length, 0);
      assert.equal(queries.filter((query) => query.includes('insert into app_users')).length, 1);
    }

    {
      const { sql, queries } = mockSql(null, { providerId: 'credential', phoneOnboarding: true });
      const request = new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${await token()}` }
      });
      const result = await requireActor(request, DANJION_ENV, sql, 'req-direct-with-phone');
      assert.deepEqual(result, {
        id: APP_USER_ID,
        authUserId: SUBJECT,
        displayName: '테스트 사용자'
      });
      assert.equal(queries.filter((query) => query.includes('insert into app_users')).length, 1);
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
      assert.equal(await errorCode(result), 'AUTH_JWT_ISSUER_INVALID');
    }

    {
      const badAudience = await new SignJWT({ id: SUBJECT, name: '테스트 사용자' })
        .setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid })
        .setSubject(SUBJECT)
        .setIssuer(ISSUER)
        .setAudience('https://wrong-audience.example.test')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      const { sql } = mockSql();
      const result = await requireActor(new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${badAudience}` }
      }), BASE_ENV, sql, 'req-wrong-audience');
      assert.equal(await errorCode(result), 'AUTH_JWT_AUDIENCE_INVALID');
    }

    {
      const expired = await new SignJWT({ id: SUBJECT, name: '테스트 사용자' })
        .setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid })
        .setSubject(SUBJECT)
        .setIssuer(ISSUER)
        .setAudience(ISSUER)
        .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
        .sign(privateKey);
      const { sql } = mockSql();
      const result = await requireActor(new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${expired}` }
      }), BASE_ENV, sql, 'req-expired');
      assert.equal(await errorCode(result), 'AUTH_JWT_EXPIRED');
    }

    {
      const other = await generateKeyPair('EdDSA');
      const badSignature = await new SignJWT({ id: SUBJECT, name: '테스트 사용자' })
        .setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid })
        .setSubject(SUBJECT)
        .setIssuer(ISSUER)
        .setAudience(ISSUER)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(other.privateKey);
      const { sql } = mockSql();
      const result = await requireActor(new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${badSignature}` }
      }), BASE_ENV, sql, 'req-signature');
      assert.equal(await errorCode(result), 'AUTH_JWT_SIGNATURE_INVALID');
    }

    {
      const hsToken = await new SignJWT({ id: SUBJECT, name: '테스트 사용자' })
        .setProtectedHeader({ alg: 'HS256', kid: jwk.kid })
        .setSubject(SUBJECT)
        .setIssuer(ISSUER)
        .setAudience(ISSUER)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(new Uint8Array(32).fill(7));
      const { sql } = mockSql();
      const result = await requireActor(new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${hsToken}` }
      }), BASE_ENV, sql, 'req-alg-not-allowed');
      assert.equal(await errorCode(result), 'AUTH_JWT_ALG_INVALID');
    }

    {
      const unknownKid = await new SignJWT({ id: SUBJECT, name: '테스트 사용자' })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'kid-not-in-jwks' })
        .setSubject(SUBJECT)
        .setIssuer(ISSUER)
        .setAudience(ISSUER)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      const { sql } = mockSql();
      const result = await requireActor(new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${unknownKid}` }
      }), BASE_ENV, sql, 'req-key-not-found');
      assert.equal(await errorCode(result), 'AUTH_JWT_KEY_NOT_FOUND');
    }

    {
      const { sql } = mockSql();
      const result = await requireActor(new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${await token()}` }
      }), { ...BASE_ENV, NEON_AUTH_JWKS_URL: AMBIGUOUS_JWKS_URL }, sql, 'req-key-ambiguous');
      assert.equal(await errorCode(result), 'AUTH_JWT_KEY_AMBIGUOUS');
    }

    {
      const notYetValid = await new SignJWT({ id: SUBJECT, name: '테스트 사용자' })
        .setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid })
        .setSubject(SUBJECT)
        .setIssuer(ISSUER)
        .setAudience(ISSUER)
        .setIssuedAt()
        .setNotBefore(Math.floor(Date.now() / 1000) + 3600)
        .setExpirationTime('5m')
        .sign(privateKey);
      const { sql } = mockSql();
      const result = await requireActor(new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${notYetValid}` }
      }), BASE_ENV, sql, 'req-not-yet-valid');
      assert.equal(await errorCode(result), 'AUTH_JWT_NOT_YET_VALID');
    }

    {
      const missingSubject = await new SignJWT({ id: SUBJECT, name: '테스트 사용자' })
        .setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid })
        .setIssuer(ISSUER)
        .setAudience(ISSUER)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      const { sql } = mockSql();
      const result = await requireActor(new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${missingSubject}` }
      }), BASE_ENV, sql, 'req-subject-missing');
      assert.equal(await errorCode(result), 'AUTH_JWT_SUBJECT_MISSING');
    }

    {
      const inconsistent = await new SignJWT({ id: SUBJECT, name: '테스트 사용자' })
        .setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid })
        .setSubject('different-subject')
        .setIssuer(ISSUER)
        .setAudience(ISSUER)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      const { sql } = mockSql();
      const result = await requireActor(new Request('https://api.example.test/api/v1/me', {
        headers: { authorization: `Bearer ${inconsistent}` }
      }), BASE_ENV, sql, 'req-subject-inconsistent');
      assert.equal(await errorCode(result), 'AUTH_JWT_SUBJECT_INCONSISTENT');
    }

    {
      const joseCode = (name, code, claim) => Object.assign(new Error(`${name} fixture`), { name, code, ...(claim === undefined ? {} : { claim }) });
      assert.equal(jwtVerificationErrorCode(joseCode('JWSSignatureVerificationFailed', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED')), 'AUTH_JWT_SIGNATURE_INVALID');
      assert.equal(jwtVerificationErrorCode(joseCode('JWTExpired', 'ERR_JWT_EXPIRED')), 'AUTH_JWT_EXPIRED');
      assert.equal(jwtVerificationErrorCode(joseCode('JOSEAlgNotAllowed', 'ERR_JOSE_ALG_NOT_ALLOWED')), 'AUTH_JWT_ALG_INVALID');
      assert.equal(jwtVerificationErrorCode(joseCode('JWTClaimValidationFailed', 'ERR_JWT_CLAIM_VALIDATION_FAILED', 'iss')), 'AUTH_JWT_ISSUER_INVALID');
      assert.equal(jwtVerificationErrorCode(joseCode('JWTClaimValidationFailed', 'ERR_JWT_CLAIM_VALIDATION_FAILED', 'aud')), 'AUTH_JWT_AUDIENCE_INVALID');
      assert.equal(jwtVerificationErrorCode(joseCode('JWTClaimValidationFailed', 'ERR_JWT_CLAIM_VALIDATION_FAILED', 'nbf')), 'AUTH_JWT_NOT_YET_VALID');
      assert.equal(jwtVerificationErrorCode(joseCode('JWTClaimValidationFailed', 'ERR_JWT_CLAIM_VALIDATION_FAILED', 'sub')), 'AUTH_JWT_CLAIM_INVALID');
      assert.equal(jwtVerificationErrorCode(joseCode('JWKSNoMatchingKey', 'ERR_JWKS_NO_MATCHING_KEY')), 'AUTH_JWT_KEY_NOT_FOUND');
      assert.equal(jwtVerificationErrorCode(joseCode('JWKSMultipleMatchingKeys', 'ERR_JWKS_MULTIPLE_MATCHING_KEYS')), 'AUTH_JWT_KEY_AMBIGUOUS');
      assert.equal(jwtVerificationErrorCode(joseCode('JWSTimeout', 'ERR_JWKS_TIMEOUT')), 'AUTH_JWT_JWKS_TIMEOUT');
      assert.equal(jwtVerificationErrorCode(joseCode('JWKSInvalid', 'ERR_JWKS_INVALID')), 'AUTH_JWT_JWKS_INVALID');
      assert.equal(jwtVerificationErrorCode(joseCode('JWKInvalid', 'ERR_JWK_INVALID')), 'AUTH_JWT_JWKS_INVALID');
      assert.equal(jwtVerificationErrorCode(joseCode('JWTInvalid', 'ERR_JWT_INVALID')), 'AUTH_JWT_MALFORMED');
      assert.equal(jwtVerificationErrorCode(joseCode('JWSInvalid', 'ERR_JWS_INVALID')), 'AUTH_JWT_MALFORMED');
      assert.equal(jwtVerificationErrorCode(joseCode('JWTClaimValidationFailed', 'ERR_JWT_CLAIM_VALIDATION_FAILED')), 'AUTH_INVALID');
      assert.equal(jwtVerificationErrorCode(joseCode('JWTClaimValidationFailed', 'ERR_JWT_CLAIM_VALIDATION_FAILED', '')), 'AUTH_INVALID');
      assert.equal(jwtVerificationErrorCode(joseCode('Whatever', 'ERR_NOT_CLASSIFIED')), 'AUTH_INVALID');
      assert.equal(jwtVerificationErrorCode(new Error('plain error')), 'AUTH_INVALID');
      assert.equal(jwtVerificationErrorCode('string error'), 'AUTH_INVALID');
      assert.equal(jwtVerificationErrorCode(null), 'AUTH_INVALID');
      assert.equal(jwtVerificationErrorCode(undefined), 'AUTH_INVALID');
    }

    console.log('PASS auth-v1 provider-aware account bootstrap contract');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

await main();
