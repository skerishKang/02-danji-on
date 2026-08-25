import assert from 'node:assert/strict';
import { requirePadiemOperator, requireVerifiedResident } from '../src/authorization-v2.ts';

const env = {
  DATABASE_URL: 'postgres://synthetic.invalid/danjion',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'true'
};

const actorsBySubject = new Map([
  ['sub-A', { id: 'user-A', auth_user_id: 'sub-A', display_name: 'A' }],
  ['sub-B', { id: 'user-B', auth_user_id: 'sub-B', display_name: 'B' }],
  ['sub-C', { id: 'user-C', auth_user_id: 'sub-C', display_name: 'C' }],
  ['sub-D', { id: 'user-D', auth_user_id: 'sub-D', display_name: 'D' }],
  ['sub-O', { id: 'user-O', auth_user_id: 'sub-O', display_name: 'O' }],
  ['sub-M', { id: 'user-M', auth_user_id: 'sub-M', display_name: 'M' }]
]);

const residents = new Map([
  ['user-A|complex-1', { membership_id: 'hm-A', membership_role: 'primary', household_id: 'house-1', complex_id: 'complex-id-1', complex_slug: 'complex-1' }],
  ['user-B|complex-1', { membership_id: 'hm-B', membership_role: 'member', household_id: 'house-1', complex_id: 'complex-id-1', complex_slug: 'complex-1' }],
  ['user-C|complex-2', { membership_id: 'hm-C', membership_role: 'primary', household_id: 'house-2', complex_id: 'complex-id-2', complex_slug: 'complex-2' }],
  ['user-M|complex-1', { membership_id: 'hm-M', membership_role: 'member', household_id: 'house-3', complex_id: 'complex-id-1', complex_slug: 'complex-1' }]
]);

const grants = new Map([
  ['user-O|community.moderate', { id: 'grant-O', scope: 'community.moderate' }]
]);

const auditEvents = [];

function normalized(strings) {
  return strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function sql(strings, ...values) {
  const query = normalized(strings);

  if (query.includes('from app_users')) {
    const subject = String(values[0]);
    const actor = actorsBySubject.get(subject);
    return actor ? [actor] : [];
  }

  if (query.includes('from household_memberships hm')) {
    const actorId = String(values[0]);
    const complexSlug = String(values[1]);
    const resident = residents.get(`${actorId}|${complexSlug}`);
    return resident ? [resident] : [];
  }

  if (query.includes('from padiem_operator_grants')) {
    const actorId = String(values[0]);
    const requestedScope = String(values[1]);
    return grants.has(`${actorId}|${requestedScope}`)
      ? [grants.get(`${actorId}|${requestedScope}`)]
      : [];
  }

  if (query.startsWith('insert into audit_events')) {
    auditEvents.push({
      requestId: String(values[0]),
      actorUserId: String(values[1]),
      scope: String(values[2]),
      decision: String(values[3]),
      reasonCode: String(values[4]),
      metadata: JSON.parse(String(values[5]))
    });
    return [];
  }

  throw new Error(`Unexpected SQL in test: ${query}`);
}

function request(subject, extraHeaders = {}) {
  return new Request('https://danjion.test/private', {
    headers: {
      'x-danjion-dev-auth-user': subject,
      ...extraHeaders
    }
  });
}

async function responseError(value) {
  assert.ok(value instanceof Response, 'expected authorization failure Response');
  const payload = await value.json();
  return { status: value.status, code: payload.error?.code };
}

const residentA = await requireVerifiedResident(request('sub-A'), env, sql, 'req-A', 'complex-1');
assert.ok(!(residentA instanceof Response));
assert.equal(residentA.id, 'user-A');
assert.equal(residentA.householdId, 'house-1');
assert.equal(residentA.membershipRole, 'primary');

const residentB = await requireVerifiedResident(request('sub-B'), env, sql, 'req-B', 'complex-1');
assert.ok(!(residentB instanceof Response));
assert.equal(residentB.id, 'user-B');
assert.equal(residentB.membershipRole, 'member');

const wrongComplex = await requireVerifiedResident(request('sub-C'), env, sql, 'req-C', 'complex-1');
assert.deepEqual(await responseError(wrongComplex), { status: 403, code: 'RESIDENT_VERIFICATION_REQUIRED' });

const unverified = await requireVerifiedResident(request('sub-D'), env, sql, 'req-D', 'complex-1');
assert.deepEqual(await responseError(unverified), { status: 403, code: 'RESIDENT_VERIFICATION_REQUIRED' });

const operator = await requirePadiemOperator(request('sub-O'), env, sql, 'req-O', 'community.moderate');
assert.ok(!(operator instanceof Response));
assert.equal(operator.id, 'user-O');
assert.equal(operator.grantedScope, 'community.moderate');

// M may be a verified apartment resident/legacy manager elsewhere, but that never grants PADIEM platform authority.
const managerWithoutGrant = await requirePadiemOperator(request('sub-M'), env, sql, 'req-M', 'community.moderate');
assert.deepEqual(await responseError(managerWithoutGrant), { status: 403, code: 'OPERATOR_FORBIDDEN' });

// Forged client claims are irrelevant because authorization is derived from requireActor() + DB state.
const forged = await requirePadiemOperator(
  request('sub-D', {
    'x-danjion-role': 'operator',
    'x-danjion-verified': 'true',
    'x-danjion-complex': 'complex-1'
  }),
  env,
  sql,
  'req-forged',
  'community.moderate'
);
assert.deepEqual(await responseError(forged), { status: 403, code: 'OPERATOR_FORBIDDEN' });

assert.equal(auditEvents.length, 3, 'operator allow and denials must all be audited');
assert.deepEqual(
  auditEvents.map(({ actorUserId, decision, reasonCode }) => ({ actorUserId, decision, reasonCode })),
  [
    { actorUserId: 'user-O', decision: 'allowed', reasonCode: 'OPERATOR_SCOPE_GRANTED' },
    { actorUserId: 'user-M', decision: 'denied', reasonCode: 'OPERATOR_SCOPE_MISSING' },
    { actorUserId: 'user-D', decision: 'denied', reasonCode: 'OPERATOR_SCOPE_MISSING' }
  ]
);

console.log('Authorization v2 principals PASS: A/B/C/D/O/M + forged-client boundary');
