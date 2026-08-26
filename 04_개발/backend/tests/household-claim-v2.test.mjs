import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { handleHouseholdPrimaryClaimWithSql } from '../src/household-claim-v2.ts';

const env = {
  DATABASE_URL: 'postgres://synthetic.invalid/danjion',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'true'
};

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const COMPLEX_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_UNIT_ID = '33333333-3333-4333-8333-333333333334';
const RAW_TOKEN = 'primaryClaimToken_20260826_TEST_ONLY_7hQ2K9';
const TOKEN_HASH = createHash('sha256').update(RAW_TOKEN).digest('hex');

function normalized(strings) {
  return strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
}

function makeSql({ existing = null, claim = 'success', complexExists = true } = {}) {
  const calls = [];

  async function sql(strings, ...values) {
    const query = normalized(strings);
    calls.push({ query, values });

    if (query.includes('from app_users')) {
      return [{ id: ACTOR_ID, auth_user_id: 'sub-primary', display_name: 'Primary QA' }];
    }

    if (query.includes('from complexes')) {
      return complexExists
        ? [{ id: COMPLEX_ID, slug: 'bangnim-myeongji-roadhill', name: '방림명지로드힐' }]
        : [];
    }

    if (query.includes('from household_memberships hm') && !query.startsWith('with target as')) {
      return existing ? [existing] : [];
    }

    if (query.startsWith('with target as')) {
      assert.match(query, /from household_invite_tokens t/, 'claim must validate invite-token table');
      assert.match(query, /t\.purpose = 'primary_claim'/, 'claim must require primary_claim purpose');
      assert.match(query, /t\.status = 'active'/, 'claim must require active token');
      assert.match(query, /t\.expires_at > now\(\)/, 'claim must require unexpired token');
      assert.match(query, /h\.complex_unit_id = \?::uuid/, 'claim must bind selected unit');
      assert.match(query, /for update of t/, 'claim must lock token for concurrent redemption safety');
      assert.match(query, /insert into household_memberships/, 'claim must create household membership');
      assert.match(query, /'primary'/, 'claim must create primary role');
      assert.match(query, /'verified'/, 'claim must create verified membership');
      assert.match(query, /on conflict do nothing/, 'claim must fail closed under concurrent uniqueness races');
      assert.match(query, /update household_invite_tokens token/, 'claim must consume token in same statement');
      assert.match(query, /status = 'redeemed'/, 'primary claim must become redeemed');
      assert.match(query, /insert into audit_events/, 'success must be audited in same statement');
      assert.match(query, /primary_claim_redeemed/, 'success audit reason must be explicit');
      assert.doesNotMatch(query, /complex_memberships/, 'legacy complex_memberships must not authorize claim');
      assert.equal(values.includes(RAW_TOKEN), false, 'plaintext token must never be sent to SQL');
      assert.equal(values.includes(TOKEN_HASH), true, 'SHA-256 token hash must be sent to SQL');

      return claim === 'success'
        ? [{ membership_role: 'primary', status: 'verified', complex_unit_id: UNIT_ID }]
        : [];
    }

    if (query.startsWith('insert into audit_events')) return [];

    throw new Error(`Unexpected SQL in household-claim-v2 test: ${query}`);
  }

  return { sql, calls };
}

function request({ token = RAW_TOKEN, unitId = UNIT_ID, subject = 'sub-primary', slug = 'bangnim-myeongji-roadhill', extra = {} } = {}) {
  const headers = { 'content-type': 'application/json', ...extra };
  if (subject) headers['x-danjion-dev-auth-user'] = subject;
  return new Request(`https://danjion.test/api/v1/complexes/${slug}/household/claim`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ unitId, token })
  });
}

const valid = makeSql();
const success = await handleHouseholdPrimaryClaimWithSql(request(), env, valid.sql, 'req-success');
assert.ok(success instanceof Response);
assert.equal(success.status, 201);
assert.deepEqual((await success.json()).data, {
  status: 'verified',
  membershipRole: 'primary',
  unitId: UNIT_ID,
  alreadyVerified: false
});
for (const { values } of valid.calls) {
  assert.equal(values.includes(RAW_TOKEN), false, 'plaintext token must not appear in any SQL call');
}

const unauthenticated = makeSql();
const noAuth = await handleHouseholdPrimaryClaimWithSql(request({ subject: null }), env, unauthenticated.sql, 'req-no-auth');
assert.ok(noAuth instanceof Response);
assert.equal(noAuth.status, 401);
assert.equal((await noAuth.json()).error.code, 'AUTH_REQUIRED');

const missingComplex = makeSql({ complexExists: false });
const notFound = await handleHouseholdPrimaryClaimWithSql(request({ slug: 'unknown-complex' }), env, missingComplex.sql, 'req-complex');
assert.ok(notFound instanceof Response);
assert.equal(notFound.status, 404);
assert.equal((await notFound.json()).error.code, 'NOT_FOUND');

const already = makeSql({
  existing: { membership_role: 'primary', status: 'verified', complex_unit_id: UNIT_ID }
});
const idempotent = await handleHouseholdPrimaryClaimWithSql(request(), env, already.sql, 'req-idempotent');
assert.ok(idempotent instanceof Response);
assert.equal(idempotent.status, 200);
const idempotentPayload = await idempotent.json();
assert.equal(idempotentPayload.data.alreadyVerified, true);
assert.equal(idempotentPayload.data.status, 'verified');
assert.equal(already.calls.some(({ query }) => query.startsWith('with target as')), false, 'already-verified actor must not consume another token');

const conflicting = makeSql({
  existing: { membership_role: 'member', status: 'verified', complex_unit_id: OTHER_UNIT_ID }
});
const conflict = await handleHouseholdPrimaryClaimWithSql(request(), env, conflicting.sql, 'req-conflict');
assert.ok(conflict instanceof Response);
assert.equal(conflict.status, 409);
assert.equal((await conflict.json()).error.code, 'HOUSEHOLD_MEMBERSHIP_EXISTS');
assert.equal(conflicting.calls.some(({ query }) => query.startsWith('with target as')), false, 'existing other membership must fail before token redemption');

const unavailable = makeSql({ claim: 'unavailable' });
const denied = await handleHouseholdPrimaryClaimWithSql(request(), env, unavailable.sql, 'req-unavailable');
assert.ok(denied instanceof Response);
assert.equal(denied.status, 409);
const deniedPayload = await denied.json();
assert.equal(deniedPayload.error.code, 'HOUSEHOLD_CLAIM_UNAVAILABLE');
assert.equal(JSON.stringify(deniedPayload).includes(RAW_TOKEN), false, 'failure response must not echo plaintext token');
assert.equal(JSON.stringify(deniedPayload).includes(TOKEN_HASH), false, 'failure response must not expose token hash');

const forged = makeSql();
const forgedResponse = await handleHouseholdPrimaryClaimWithSql(
  request({
    extra: {
      'x-danjion-user-id': 'attacker',
      'x-danjion-role': 'admin',
      'x-danjion-verified': 'true',
      'x-danjion-household-id': 'forged'
    }
  }),
  env,
  forged.sql,
  'req-forged'
);
assert.ok(forgedResponse instanceof Response);
assert.equal(forgedResponse.status, 201, 'forged client authority fields must be irrelevant to server-derived claim');

const source = await readFile(new URL('../src/household-claim-v2.ts', import.meta.url), 'utf8');
assert.doesNotMatch(source, /complex_memberships/, 'primary claim must not use legacy complex membership authorization');
assert.doesNotMatch(source, /console\.(?:log|info|warn|error)[^\n]*token/i, 'claim source must never log invite token material');
assert.match(source, /crypto\.subtle\.digest\('SHA-256'/, 'claim must hash plaintext token before DB lookup');

const appSource = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
assert.match(appSource, /handleHouseholdPrimaryClaimRequest/, 'app router must import claim handler');
assert.match(appSource, /const householdClaimResponse = await handleHouseholdPrimaryClaimRequest/, 'app router must invoke claim handler');

console.log('Household primary claim API PASS: hashed token + atomic verified PRIMARY transition + privacy');
