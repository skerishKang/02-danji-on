import assert from 'node:assert/strict';
import { handleAdminAuthorityRequest, resolveAdminAuthorityResponse } from '../src/admin-authority-v1.ts';
import {
  PRIVILEGED_PADIEM_SCOPES,
  isPrivilegedPadiemScope,
  requirePadiemPrivilegedScope,
  resolvePadiemAuthority
} from '../src/padiem-authority-v1.ts';

const env = {
  DATABASE_URL: 'postgres://synthetic.invalid/danjion',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'true'
};

const actorsBySubject = new Map([
  ['sub-admin', { id: 'user-admin', auth_user_id: 'sub-admin', display_name: 'Super' }],
  ['sub-operator', { id: 'user-operator', auth_user_id: 'sub-operator', display_name: 'Operator' }],
  ['sub-none', { id: 'user-none', auth_user_id: 'sub-none', display_name: 'Nobody' }],
  ['sub-revoked', { id: 'user-revoked', auth_user_id: 'sub-revoked', display_name: 'Revoked' }],
  ['sub-expired', { id: 'user-expired', auth_user_id: 'sub-expired', display_name: 'Expired' }]
]);

// Synthetic grant fixtures. The mock below re-implements the exact fail-closed
// predicates that the production SQL must contain (asserted on every query).
const grantsByUser = new Map([
  ['user-admin', [{ id: 'g-admin', scope: '*', status: 'active', expires_at: null }]],
  [
    'user-operator',
    [
      { id: 'g-op-1', scope: 'business.review', status: 'active', expires_at: null },
      { id: 'g-op-2', scope: 'official-content.manage', status: 'active', expires_at: null }
    ]
  ],
  ['user-none', []],
  ['user-revoked', [{ id: 'g-rev', scope: '*', status: 'revoked', expires_at: null }]],
  [
    'user-expired',
    [{ id: 'g-exp', scope: 'business.review', status: 'active', expires_at: new Date(Date.now() - 60_000).toISOString() }]
  ]
]);

const auditEvents = [];
let failNextGrantQuery = false;

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

  if (query.includes('from padiem_operator_grants')) {
    assert.match(query, /status = 'active'/, 'authority query must require status = active');
    assert.match(query, /\(expires_at is null or expires_at > now\(\)\)/, 'authority query must enforce expiry window');
    if (failNextGrantQuery) {
      failNextGrantQuery = false;
      throw new Error('synthetic database outage');
    }
    const actorId = String(values[0]);
    const now = Date.now();
    return (grantsByUser.get(actorId) ?? [])
      .filter((g) => g.status === 'active' && (!g.expires_at || new Date(g.expires_at).getTime() > now))
      .map((g) => ({ id: g.id, scope: g.scope }));
  }

  if (query.startsWith('insert into audit_events')) {
    assert.ok(query.includes('authorization.padiem-authority-check'), 'authority decisions must use the dedicated audit action');
    auditEvents.push({
      requestId: String(values[0]),
      actorUserId: String(values[1]),
      scope: String(values[3]),
      decision: String(values[4]),
      reasonCode: String(values[5]),
      metadata: JSON.parse(String(values[6]))
    });
    return [];
  }

  throw new Error(`Unexpected SQL in padiem authority test: ${query}`);
}

function request(subject, extraHeaders = {}) {
  const headers = subject ? { 'x-danjion-dev-auth-user': subject, ...extraHeaders } : { ...extraHeaders };
  return new Request('https://danjion.test/api/v1/admin/authority', { headers });
}

async function errorOf(value, expectedStatus) {
  assert.ok(value instanceof Response, 'expected a Response');
  assert.equal(value.status, expectedStatus);
  const payload = await value.json();
  return { status: value.status, code: payload.error?.code };
}

async function dataOf(response) {
  assert.ok(response instanceof Response);
  assert.equal(response.status, 200);
  const payload = await response.json();
  return payload.data;
}

// 1. Unauthenticated -> 401 (requireActor contract).
assert.deepEqual(await errorOf(await resolveAdminAuthorityResponse(request(null), env, sql, 'req-401'), 401), {
  status: 401,
  code: 'AUTH_REQUIRED'
});

// 2. Authenticated without any grant -> 403 fail-closed + denied audit.
assert.deepEqual(await errorOf(await resolveAdminAuthorityResponse(request('sub-none'), env, sql, 'req-none'), 403), {
  status: 403,
  code: 'ADMIN_AUTHORITY_REQUIRED'
});
assert.equal(auditEvents.at(-1).reasonCode, 'NO_ACTIVE_PADIEM_GRANT');
assert.equal(auditEvents.at(-1).decision, 'denied');

// 3. Bounded operator -> level operator, wildcard false, sorted scopes, label 일반관리자.
const operatorData = await dataOf(await resolveAdminAuthorityResponse(request('sub-operator'), env, sql, 'req-op'));
assert.deepEqual(operatorData, {
  level: 'operator',
  label: '일반관리자',
  scopes: ['business.review', 'official-content.manage'],
  wildcard: false
});
assert.equal(auditEvents.at(-1).reasonCode, 'AUTHORITY_OPERATOR');

// 4. Wildcard -> level admin, wildcard true, label 최고관리자.
const adminData = await dataOf(await resolveAdminAuthorityResponse(request('sub-admin'), env, sql, 'req-admin'));
assert.deepEqual(adminData, { level: 'admin', label: '최고관리자', scopes: ['*'], wildcard: true });
assert.equal(auditEvents.at(-1).reasonCode, 'AUTHORITY_SUPER_ADMIN');
assert.equal(auditEvents.at(-1).metadata.grantedScope, '*');

// 5. Revoked wildcard fails closed.
assert.equal((await resolveAdminAuthorityResponse(request('sub-revoked'), env, sql, 'req-revoked')).status, 403);

// 6. Expired bounded grant fails closed.
assert.equal((await resolveAdminAuthorityResponse(request('sub-expired'), env, sql, 'req-expired')).status, 403);

// 7. Client headers cannot elevate authority (identity comes from verified/dev actor only).
const forged = await resolveAdminAuthorityResponse(
  request('sub-none', { 'x-danjion-role': 'admin', 'x-danjion-verified': 'true', 'x-danjion-complex': 'complex-1' }),
  env,
  sql,
  'req-forged'
);
assert.equal(forged.status, 403);

// 8. Database failure is fail-closed with 503, never an allow.
failNextGrantQuery = true;
assert.deepEqual(await errorOf(await resolveAdminAuthorityResponse(request('sub-admin'), env, sql, 'req-dbdown'), 503), {
  status: 503,
  code: 'AUTHORITY_DB_ERROR'
});

// 9. Non-GET is not owned by this handler (falls through to other admin routes).
assert.equal(
  await handleAdminAuthorityRequest(new Request('https://danjion.test/api/v1/admin/authority', { method: 'POST' }), env, 'req-post'),
  null
);
assert.equal(
  await handleAdminAuthorityRequest(new Request('https://danjion.test/api/v1/admin/other', { method: 'GET' }), env, 'req-other'),
  null
);

// 10. Privileged scope guard: wildcard passes, bounded operator does not, none does not.
const privileged = PRIVILEGED_PADIEM_SCOPES[0];
assert.ok(isPrivilegedPadiemScope(privileged));
assert.ok(!isPrivilegedPadiemScope('business.review'));

const privilegedAdmin = await requirePadiemPrivilegedScope(request('sub-admin'), env, sql, 'req-priv-admin', privileged);
assert.ok(!(privilegedAdmin instanceof Response));
assert.equal(privilegedAdmin.authority.level, 'admin');

const privilegedOperator = await requirePadiemPrivilegedScope(request('sub-operator'), env, sql, 'req-priv-op', privileged);
assert.deepEqual(await errorOf(privilegedOperator, 403), { status: 403, code: 'PRIVILEGED_FORBIDDEN' });
assert.equal(auditEvents.at(-1).reasonCode, 'PRIVILEGED_WILDCARD_REQUIRED');

const privilegedNone = await requirePadiemPrivilegedScope(request('sub-none'), env, sql, 'req-priv-none', privileged);
assert.deepEqual(await errorOf(privilegedNone, 403), { status: 403, code: 'PRIVILEGED_FORBIDDEN' });
assert.equal(auditEvents.at(-1).reasonCode, 'NO_ACTIVE_PADIEM_GRANT');

const privilegedInvalid = await requirePadiemPrivilegedScope(request('sub-admin'), env, sql, 'req-priv-bad', 'business.review');
assert.deepEqual(await errorOf(privilegedInvalid, 400), { status: 400, code: 'PRIVILEGED_SCOPE_INVALID' });

const privilegedUnauth = await requirePadiemPrivilegedScope(request(null), env, sql, 'req-priv-401', privileged);
assert.deepEqual(await errorOf(privilegedUnauth, 401), { status: 401, code: 'AUTH_REQUIRED' });

// 11. resolvePadiemAuthority keeps ordinary operator scopes intact for council-governed routes.
const resolved = await resolvePadiemAuthority(sql, 'user-operator');
assert.equal(resolved.level, 'operator');
assert.ok(resolved.scopes.includes('business.review'));

// Every decision above was audited under the dedicated action.
assert.ok(auditEvents.length >= 8);
assert.ok(auditEvents.every((e) => e.reasonCode && e.decision));

// 12. Handler wiring: missing DATABASE_URL is 503 and foreign routes/methods
// return null (the 401 short-circuit is proven at core level in scenario 1).
{
  const noDb = await handleAdminAuthorityRequest(
    new Request('https://danjion.test/api/v1/admin/authority'),
    { ...env, DATABASE_URL: '' },
    'req-handler-503'
  );
  assert.ok(noDb instanceof Response);
  assert.equal(noDb.status, 503);
  const body = await noDb.json();
  assert.equal(body.error.code, 'DATABASE_NOT_CONFIGURED');
}

console.log('Padiem authority contract test PASS');
