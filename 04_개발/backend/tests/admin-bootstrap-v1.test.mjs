import assert from 'node:assert/strict';
import {
  bootstrapAdminAuthorityResponse,
  handleAdminBootstrapRequest
} from '../src/admin-bootstrap-v1.ts';

const env = {
  DATABASE_URL: 'postgres://synthetic.invalid/danjion',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'true'
};

const actorsBySubject = new Map([
  ['sub-operator', { id: '00000000-0000-4000-8000-000000000101', auth_user_id: 'ba-operator', display_name: 'Operator' }],
  ['sub-admin', { id: '00000000-0000-4000-8000-000000000102', auth_user_id: 'ba-admin', display_name: 'Admin' }],
  ['sub-unlisted', { id: '00000000-0000-4000-8000-000000000103', auth_user_id: 'ba-unlisted', display_name: 'Unlisted' }],
  ['sub-unverified', { id: '00000000-0000-4000-8000-000000000104', auth_user_id: 'ba-unverified', display_name: 'Unverified' }],
  ['sub-credential', { id: '00000000-0000-4000-8000-000000000105', auth_user_id: 'ba-credential', display_name: 'Credential' }],
  ['sub-invalid', { id: '00000000-0000-4000-8000-000000000106', auth_user_id: 'ba-invalid', display_name: 'Invalid' }]
]);

const principalByActor = new Map([
  ['00000000-0000-4000-8000-000000000101', {
    id: '10000000-0000-4000-8000-000000000001',
    authority_level: 'operator',
    scopes: [
      'benefit.manage',
      'business.review',
      'community.moderate',
      'inquiry.respond',
      'official-content.manage',
      'resident.verification.exempt',
      'resident_news.review',
      'safety.report.review'
    ]
  }],
  ['00000000-0000-4000-8000-000000000102', {
    id: '10000000-0000-4000-8000-000000000002',
    authority_level: 'admin',
    scopes: ['*']
  }],
  ['00000000-0000-4000-8000-000000000106', {
    id: '10000000-0000-4000-8000-000000000006',
    authority_level: 'admin',
    scopes: ['business.review']
  }]
]);

const activeGrants = new Map();
const auditEvents = [];
let failBootstrapQuery = false;

function normalized(strings) {
  return strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
}

function grantsFor(actorId) {
  if (!activeGrants.has(actorId)) activeGrants.set(actorId, new Set());
  return activeGrants.get(actorId);
}

async function sql(strings, ...values) {
  const query = normalized(strings);

  if (query.includes('join padiem_admin_identity_allowlist p')) {
    assert.match(query, /p\.provider = 'google'/, 'bootstrap must be provider-pinned to Google');
    assert.match(query, /u\.email_verified = true/, 'bootstrap must require verified Better Auth email');
    assert.match(query, /lower\(a\.provider_id\) = 'google'/, 'bootstrap must require an attached Google account');
    assert.match(query, /p\.status = 'active'/, 'bootstrap must require active pre-registration');
    assert.match(query, /p\.expires_at is null or p\.expires_at > now\(\)/, 'bootstrap must enforce registration expiry');
    assert.match(query, /p\.provider_account_id is null[\s\S]*p\.provider_account_id = a\.account_id/, 'optional provider account pin must be enforced');
    if (failBootstrapQuery) {
      failBootstrapQuery = false;
      throw new Error('synthetic bootstrap DB failure');
    }
    const actorId = String(values[0]);
    const principal = principalByActor.get(actorId);
    return principal ? [principal] : [];
  }

  if (query.includes('from app_users') && !query.includes('padiem_admin_identity_allowlist')) {
    const subject = String(values[0]);
    const actor = actorsBySubject.get(subject);
    return actor ? [actor] : [];
  }

  if (query.startsWith('insert into padiem_operator_grants')) {
    assert.match(query, /on conflict do nothing/, 'bootstrap grant materialization must be retry-idempotent');
    assert.doesNotMatch(query, /request\.json|x-danjion-role/i, 'grant SQL must not rely on client authority input');
    const actorId = String(values[0]);
    const scope = String(values[1]);
    grantsFor(actorId).add(scope);
    return [];
  }

  if (query.includes('from padiem_operator_grants')) {
    assert.match(query, /status = 'active'/, 'authority readback must require active grants');
    assert.match(query, /expires_at is null or expires_at > now\(\)/, 'authority readback must enforce expiry');
    const actorId = String(values[0]);
    return [...grantsFor(actorId)].sort().map((scope, index) => ({ id: 'g-' + index, scope }));
  }

  if (query.startsWith('insert into audit_events')) {
    assert.match(query, /authorization\.admin-bootstrap/, 'bootstrap decisions must use a dedicated audit action');
    auditEvents.push({
      requestId: String(values[0]),
      actorId: String(values[1]),
      decision: String(values[3]),
      reasonCode: String(values[4]),
      metadata: JSON.parse(String(values[5]))
    });
    return [];
  }

  throw new Error('Unexpected SQL in admin bootstrap test: ' + query);
}

function request(subject, body) {
  const headers = subject ? { 'x-danjion-dev-auth-user': subject } : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request('https://danjion.test/api/v1/admin/bootstrap', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function payload(response, status) {
  assert.ok(response instanceof Response);
  assert.equal(response.status, status);
  return response.json();
}

// 1. Unauthenticated callers are rejected before any bootstrap logic.
{
  const response = await bootstrapAdminAuthorityResponse(request(null), env, sql, 'req-401');
  const body = await payload(response, 401);
  assert.equal(body.error.code, 'AUTH_REQUIRED');
}

// 2. Authenticated but not pre-registered -> 403.
for (const subject of ['sub-unlisted', 'sub-unverified', 'sub-credential']) {
  const response = await bootstrapAdminAuthorityResponse(request(subject), env, sql, 'req-denied-' + subject);
  const body = await payload(response, 403);
  assert.equal(body.error.code, 'ADMIN_BOOTSTRAP_NOT_ALLOWED');
  assert.equal(auditEvents.at(-1).decision, 'denied');
  assert.equal(auditEvents.at(-1).reasonCode, 'ADMIN_BOOTSTRAP_NOT_ALLOWLISTED');
}

// 3. Malformed registration shape fails closed, never downgraded to a usable grant.
{
  const response = await bootstrapAdminAuthorityResponse(request('sub-invalid'), env, sql, 'req-invalid');
  const body = await payload(response, 503);
  assert.equal(body.error.code, 'ADMIN_BOOTSTRAP_PRINCIPAL_INVALID');
  assert.equal(grantsFor(actorsBySubject.get('sub-invalid').id).size, 0);
}

// 4. Bounded OPERATIONAL registration materializes only server-registered scopes.
{
  const hostileBody = {
    provider: 'google',
    email: 'attacker@example.com',
    authorityLevel: 'admin',
    scopes: ['*', 'platform.system.manage']
  };
  const response = await bootstrapAdminAuthorityResponse(request('sub-operator', hostileBody), env, sql, 'req-op');
  const body = await payload(response, 200);
  assert.deepEqual(body.data, {
    level: 'operator',
    label: '일반관리자',
    scopes: [
      'benefit.manage',
      'business.review',
      'community.moderate',
      'inquiry.respond',
      'official-content.manage',
      'resident.verification.exempt',
      'resident_news.review',
      'safety.report.review'
    ],
    wildcard: false
  });
  assert.deepEqual([...grantsFor(actorsBySubject.get('sub-operator').id)].sort(), [
    'benefit.manage',
    'business.review',
    'community.moderate',
    'inquiry.respond',
    'official-content.manage',
    'resident.verification.exempt',
    'resident_news.review',
    'safety.report.review'
  ]);
  assert.equal(auditEvents.at(-1).decision, 'allowed');
  assert.equal(auditEvents.at(-1).reasonCode, 'ADMIN_BOOTSTRAP_GRANTED');
  assert.equal(auditEvents.at(-1).metadata.authorityLevel, 'operator');
}

// 5. SUPER registration preserves wildcard plus the full bounded operational bundle.
{
  const response = await bootstrapAdminAuthorityResponse(request('sub-admin'), env, sql, 'req-admin');
  const body = await payload(response, 200);
  assert.deepEqual(body.data, {
    level: 'admin',
    label: '최고관리자',
    scopes: [
      '*',
      'benefit.manage',
      'business.review',
      'community.moderate',
      'inquiry.respond',
      'official-content.manage',
      'resident.verification.exempt',
      'resident_news.review',
      'safety.report.review'
    ],
    wildcard: true
  });
  assert.deepEqual([...grantsFor(actorsBySubject.get('sub-admin').id)].sort(), [
    '*',
    'benefit.manage',
    'business.review',
    'community.moderate',
    'inquiry.respond',
    'official-content.manage',
    'resident.verification.exempt',
    'resident_news.review',
    'safety.report.review'
  ]);
}

// 6. Retry is idempotent: no duplicate or widened grant appears.
{
  const actorId = actorsBySubject.get('sub-operator').id;
  const before = [...grantsFor(actorId)].sort();
  const response = await bootstrapAdminAuthorityResponse(request('sub-operator'), env, sql, 'req-op-retry');
  await payload(response, 200);
  assert.deepEqual([...grantsFor(actorId)].sort(), before);
}

// 7. Bootstrap lookup outage is fail-closed with 503.
{
  failBootstrapQuery = true;
  const response = await bootstrapAdminAuthorityResponse(request('sub-admin'), env, sql, 'req-db');
  const body = await payload(response, 503);
  assert.equal(body.error.code, 'ADMIN_BOOTSTRAP_UNAVAILABLE');
}

// 8. Handler only owns POST /api/v1/admin/bootstrap; missing DB fails closed before Neon use.
{
  assert.equal(
    await handleAdminBootstrapRequest(new Request('https://danjion.test/api/v1/admin/bootstrap', { method: 'GET' }), env, 'req-get'),
    null
  );
  assert.equal(
    await handleAdminBootstrapRequest(new Request('https://danjion.test/api/v1/admin/other', { method: 'POST' }), env, 'req-other'),
    null
  );
  const noDb = await handleAdminBootstrapRequest(
    new Request('https://danjion.test/api/v1/admin/bootstrap', { method: 'POST' }),
    { ...env, DATABASE_URL: '' },
    'req-nodb'
  );
  const body = await payload(noDb, 503);
  assert.equal(body.error.code, 'DATABASE_NOT_CONFIGURED');
}

// Audit metadata remains bounded and contains no contact/token/provider payload snapshots.
assert.ok(auditEvents.length >= 7);
assert.ok(auditEvents.every((event) => !('email' in event.metadata)));
assert.ok(auditEvents.every((event) => !('token' in event.metadata)));

console.log('Admin pre-registered Google bootstrap runtime contract PASS');
