import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import core from '../src/core-v1.ts';
import { requireActor } from '../src/auth-v1.ts';
import { requireVerifiedResident } from '../src/authorization-v2.ts';
import {
  DB_AVAILABILITY_CODE,
  DB_AVAILABILITY_MESSAGE,
  isDbAvailabilityError
} from '../src/db-availability-v1.ts';

const CORE_ENV = {
  DATABASE_URL: 'postgresql://synthetic.invalid/danjion',
  APP_ENV: 'production',
  DEV_AUTH_BYPASS: 'false'
};

const RESIDENT_ENV = {
  DATABASE_URL: 'postgresql://synthetic.invalid/danjion',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'true'
};

const ISSUER = 'https://auth.example.test';
const JWKS_URL = `${ISSUER}/neondb/auth/.well-known/jwks.json`;
const SUBJECT = '860dc360-609f-4b7d-9e70-ec93fe6414d3';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ROW = {
  id: USER_ID,
  auth_user_id: SUBJECT,
  display_name: 'Test User',
  account_status: 'active'
};
const ACTOR = {
  id: USER_ID,
  authUserId: SUBJECT,
  displayName: 'Test User'
};
const RESIDENT_ROW = {
  membership_id: 'membership-1',
  membership_role: 'primary',
  household_id: 'household-1',
  complex_id: 'complex-1',
  complex_slug: 'complex-a'
};
const SECRET_MARKERS = [
  'DATABASE_URL=private',
  'db.internal',
  'select private_column',
  'raw-stack-token'
];

function neonError(message, fields = {}) {
  return Object.assign(new Error(message), { name: 'NeonDbError', ...fields });
}

function transportError(code = 'ECONNRESET') {
  return neonError('DATABASE_URL=private db.internal select private_column raw-stack-token', {
    sourceError: Object.assign(new TypeError('socket transport failed'), { code })
  });
}

function sqlText(strings) {
  return strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function responseContract(response) {
  assert.ok(response instanceof Response);
  const raw = await response.text();
  return {
    status: response.status,
    body: JSON.parse(raw),
    raw
  };
}

function assertSanitized(raw) {
  for (const marker of SECRET_MARKERS) {
    assert.equal(raw.includes(marker), false, `response must not expose ${marker}`);
  }
}

async function healthWith(sql) {
  const originalError = console.error;
  console.error = () => {};
  globalThis.__DANJION_TEST_SQL__ = sql;
  try {
    return await core.fetch(new Request('https://api.example.test/api/health', {
      headers: { 'x-danjion-request-id': 'req-health' }
    }), CORE_ENV);
  } finally {
    delete globalThis.__DANJION_TEST_SQL__;
    console.error = originalError;
  }
}

async function residentWith(membershipResult) {
  let membershipCalls = 0;
  const sql = async (strings) => {
    const text = sqlText(strings);
    if (text.includes('from app_users')) return [ACTOR_ROW];
    if (text.includes('from household_memberships hm')) {
      membershipCalls += 1;
      if (membershipResult instanceof Error) throw membershipResult;
      return membershipResult ? [RESIDENT_ROW] : [];
    }
    throw new Error(`Unexpected resident SQL: ${text}`);
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await requireVerifiedResident(
      new Request('https://api.example.test/private', {
        headers: { 'x-danjion-dev-auth-user': SUBJECT }
      }),
      RESIDENT_ENV,
      sql,
      'req-resident',
      'complex-a'
    );
    return { response, membershipCalls };
  } finally {
    console.error = originalError;
  }
}

async function main() {
  assert.equal(DB_AVAILABILITY_CODE, 'DB_AVAILABILITY_UNAVAILABLE');
  assert.equal(DB_AVAILABILITY_MESSAGE, 'Database is temporarily unavailable');

  assert.equal(isDbAvailabilityError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })), true);
  assert.equal(isDbAvailabilityError(transportError('ETIMEDOUT')), true);
  assert.equal(isDbAvailabilityError(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), true);
  assert.equal(isDbAvailabilityError(neonError('server unavailable')), true);
  assert.equal(isDbAvailabilityError(neonError('connection failure', { code: '08006' })), true);
  assert.equal(isDbAvailabilityError(neonError('syntax error', { code: '42601' })), false);
  assert.equal(isDbAvailabilityError(neonError('constraint violation', { code: '23505' })), false);
  assert.equal(isDbAvailabilityError(new Error('application defect')), false);
  assert.equal(isDbAvailabilityError(new Error('message mentions ECONNREFUSED only')), false);

  {
    let calls = 0;
    const response = await healthWith(async () => {
      calls += 1;
      return [{ ok: 1 }];
    });
    const contract = await responseContract(response);
    assert.equal(contract.status, 200);
    assert.deepEqual(contract.body, {
      data: { status: 'ok', database: 'ok' },
      requestId: 'req-health'
    });
    assert.equal(calls, 1, 'healthy health must execute one query and no retry');
  }

  {
    let calls = 0;
    const contract = await responseContract(await healthWith(async () => {
      calls += 1;
      throw transportError();
    }));
    assert.equal(contract.status, 503);
    assert.equal(contract.body.error.code, DB_AVAILABILITY_CODE);
    assert.equal(contract.body.error.message, DB_AVAILABILITY_MESSAGE);
    assertSanitized(contract.raw);
    assert.equal(calls, 1, 'health availability failure must not retry');
  }

  {
    let calls = 0;
    const contract = await responseContract(await healthWith(async () => {
      calls += 1;
      throw neonError('syntax error at raw-stack-token', { code: '42601' });
    }));
    assert.equal(contract.status, 500);
    assert.equal(contract.body.error.code, 'INTERNAL_ERROR');
    assert.equal(calls, 1, 'health SQL defect must execute once');
  }

  {
    const healthy = await residentWith(true);
    assert.equal(healthy.response instanceof Response, false);
    assert.deepEqual(healthy.response, {
      ...ACTOR,
      complexId: 'complex-1',
      complexSlug: 'complex-a',
      residentVerificationExempt: false,
      householdId: 'household-1',
      membershipId: 'membership-1',
      membershipRole: 'primary'
    });
    assert.equal(healthy.membershipCalls, 1);
  }

  {
    const unavailable = await residentWith(transportError());
    const contract = await responseContract(unavailable.response);
    assert.equal(contract.status, 503);
    assert.equal(contract.body.error.code, DB_AVAILABILITY_CODE);
    assert.equal(contract.body.error.message, DB_AVAILABILITY_MESSAGE);
    assertSanitized(contract.raw);
    assert.equal(unavailable.membershipCalls, 1, 'resident availability failure must not retry');
  }

  {
    const defect = await residentWith(neonError('syntax error', { code: '42601' }));
    const contract = await responseContract(defect.response);
    assert.equal(contract.status, 500);
    assert.equal(contract.body.error.code, 'RESIDENT_AUTHZ_FAILED');
    assert.equal(defect.membershipCalls, 1);
  }

  const { publicKey, privateKey } = await generateKeyPair('EdDSA');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'db-availability-test-key';
  jwk.alg = 'EdDSA';
  jwk.use = 'sig';
  const token = await new SignJWT({ id: SUBJECT, name: 'Test User' })
    .setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid })
    .setSubject(SUBJECT)
    .setIssuer(ISSUER)
    .setAudience(ISSUER)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  const authEnv = {
    DATABASE_URL: CORE_ENV.DATABASE_URL,
    APP_ENV: 'production',
    DEV_AUTH_BYPASS: 'false',
    NEON_AUTH_BASE_URL: `${ISSUER}/neondb/auth`,
    NEON_AUTH_JWKS_URL: JWKS_URL
  };
  const authRequest = () => new Request('https://api.example.test/api/v1/me', {
    headers: { authorization: `Bearer ${token}` }
  });

  async function actorWith(identityResult) {
    let identityCalls = 0;
    const sql = async (strings) => {
      const text = sqlText(strings);
      if (text.includes('select id, auth_user_id, display_name')) {
        identityCalls += 1;
        if (identityResult instanceof Error) throw identityResult;
        return identityResult ? [ACTOR_ROW] : [];
      }
      throw new Error(`Unexpected actor SQL: ${text}`);
    };
    const result = await requireActor(authRequest(), authEnv, sql, 'req-actor');
    return { result, identityCalls };
  }

  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  console.error = () => {};
  globalThis.fetch = async (input) => {
    assert.equal(String(input), JWKS_URL);
    return Response.json({ keys: [jwk] }, { status: 200 });
  };
  try {
    const healthy = await actorWith(true);
    assert.deepEqual(healthy.result, ACTOR);
    assert.equal(healthy.identityCalls, 1, 'healthy actor lookup must not retry');

    const unavailable = await actorWith(transportError('ECONNREFUSED'));
    const unavailableContract = await responseContract(unavailable.result);
    assert.equal(unavailableContract.status, 503);
    assert.equal(unavailableContract.body.error.code, DB_AVAILABILITY_CODE);
    assert.equal(unavailableContract.body.error.message, DB_AVAILABILITY_MESSAGE);
    assertSanitized(unavailableContract.raw);
    assert.equal(unavailable.identityCalls, 1, 'actor availability failure must not retry');

    const defect = await actorWith(neonError('constraint failure', { code: '23505' }));
    const defectContract = await responseContract(defect.result);
    assert.equal(defectContract.status, 500);
    assert.equal(defectContract.body.error.code, 'AUTH_IDENTITY_LINK_FAILED');
    assert.equal(defect.identityCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }

  process.stdout.write('PASS #950 DB availability 503 classification with SQL-defect 500 preservation and zero retries\n');
}

await main();
