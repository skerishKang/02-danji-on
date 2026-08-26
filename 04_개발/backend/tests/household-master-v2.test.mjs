import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleHouseholdUnitMasterWithSql } from '../src/household-master-v2.ts';

const env = {
  DATABASE_URL: 'postgres://synthetic.invalid/danjion',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'true'
};

const queries = [];

function normalized(strings) {
  return strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function sql(strings, ...values) {
  const query = normalized(strings);
  queries.push({ query, values });

  if (query.includes('from app_users')) {
    return String(values[0]) === 'sub-onboarding'
      ? [{
          id: '11111111-1111-4111-8111-111111111111',
          auth_user_id: 'sub-onboarding',
          display_name: '온보딩 사용자'
        }]
      : [];
  }

  if (query.includes('from complexes')) {
    const slug = String(values[0]);
    if (slug !== 'bangnim-myeongji-roadhill') return [];
    return [{
      id: '22222222-2222-4222-8222-222222222222',
      slug,
      name: '방림명지로드힐'
    }];
  }

  if (query.includes('from complex_units')) {
    assert.match(query, /status = 'active'/, 'unit master must filter inactive units');
    assert.match(query, /order by building_code asc, unit_code asc/, 'unit master must have deterministic picker ordering');
    assert.doesNotMatch(query, /household_invite_tokens|family_invites|household_memberships/, 'picker read must not join resident/invite state');
    return [
      { id: '33333333-3333-4333-8333-333333333301', building_code: '101', unit_code: '101' },
      { id: '33333333-3333-4333-8333-333333333302', building_code: '101', unit_code: '102' },
      { id: '33333333-3333-4333-8333-333333333303', building_code: '102', unit_code: '101' }
    ];
  }

  throw new Error(`Unexpected SQL in household-master-v2 test: ${query}`);
}

function request(path = '/api/v1/complexes/bangnim-myeongji-roadhill/household/units', subject = 'sub-onboarding', extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (subject) headers['x-danjion-dev-auth-user'] = subject;
  return new Request(`https://danjion.test${path}`, { headers });
}

const response = await handleHouseholdUnitMasterWithSql(request(), env, sql, 'req-units');
assert.ok(response instanceof Response);
assert.equal(response.status, 200);
const payload = await response.json();
assert.equal(payload.data.complex.slug, 'bangnim-myeongji-roadhill');
assert.equal(payload.data.complex.name, '방림명지로드힐');
assert.deepEqual(payload.data.units.map(({ buildingCode, unitCode }) => `${buildingCode}-${unitCode}`), [
  '101-101',
  '101-102',
  '102-101'
]);

const serialized = JSON.stringify(payload);
for (const forbidden of [
  'householdId',
  'household_id',
  'membership',
  'invite',
  'token',
  'phone',
  'email',
  'provider',
  'verificationStatus',
  'verification_status',
  'operator'
]) {
  assert.equal(serialized.includes(forbidden), false, `response must not expose ${forbidden}`);
}

const unauthenticated = await handleHouseholdUnitMasterWithSql(request(undefined, null), env, sql, 'req-no-auth');
assert.ok(unauthenticated instanceof Response);
assert.equal(unauthenticated.status, 401);
assert.equal((await unauthenticated.json()).error.code, 'AUTH_REQUIRED');

const unknownComplex = await handleHouseholdUnitMasterWithSql(
  request('/api/v1/complexes/not-a-current-complex/household/units'),
  env,
  sql,
  'req-not-found'
);
assert.ok(unknownComplex instanceof Response);
assert.equal(unknownComplex.status, 404);
assert.equal((await unknownComplex.json()).error.code, 'NOT_FOUND');

const forged = await handleHouseholdUnitMasterWithSql(
  request(undefined, 'sub-onboarding', {
    'x-danjion-role': 'admin',
    'x-danjion-verified': 'true',
    'x-danjion-household-id': 'forged-household'
  }),
  env,
  sql,
  'req-forged'
);
assert.ok(forged instanceof Response);
assert.equal(forged.status, 200, 'forged role/verification headers must not change this authentication-only read');
assert.deepEqual((await forged.json()).data.units.map((unit) => unit.id), payload.data.units.map((unit) => unit.id));

const appSource = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
assert.match(appSource, /handleHouseholdUnitMasterRequest/, 'app router must import household master handler');
assert.match(appSource, /const householdMasterResponse = await handleHouseholdUnitMasterRequest/, 'app router must invoke household master handler');

assert.ok(queries.some(({ query }) => query.includes('from complex_units')), 'active unit master SQL must execute');
console.log('Household unit master API PASS: authenticated picker read + privacy boundary');
