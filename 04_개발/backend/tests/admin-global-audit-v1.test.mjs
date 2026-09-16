import assert from 'node:assert/strict';
import {
  globalAuditResponse,
  handleAdminGlobalAuditRequest
} from '../src/admin-global-audit-v1.ts';

const env = {
  DATABASE_URL: 'postgres://synthetic.invalid/danjion',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'true'
};

const actors = new Map([
  ['sub-admin', { id: '11111111-1111-4111-8111-111111111111', auth_user_id: 'sub-admin', display_name: 'Super' }],
  ['sub-operator', { id: '22222222-2222-4222-8222-222222222222', auth_user_id: 'sub-operator', display_name: 'Operator' }]
]);

const grants = new Map([
  ['11111111-1111-4111-8111-111111111111', [{ id: 'g1', scope: '*' }]],
  ['22222222-2222-4222-8222-222222222222', [{ id: 'g2', scope: 'business.review' }]]
]);

let auditSelectValues = null;

function normalized(strings) {
  return strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function sql(strings, ...values) {
  const query = normalized(strings);

  if (query.includes('from app_users')) {
    const actor = actors.get(String(values[0]));
    return actor ? [actor] : [];
  }

  if (query.includes('from padiem_operator_grants')) {
    assert.match(query, /status = 'active'/);
    assert.match(query, /expires_at is null or expires_at > now\(\)/);
    return grants.get(String(values[0])) ?? [];
  }

  if (query.startsWith('insert into audit_events')) {
    return [];
  }

  if (query.includes('from audit_events e')) {
    for (const forbidden of ['actor_user_id', 'complex_id', 'resource_id', 'request_id', 'metadata']) {
      assert.ok(!query.includes(forbidden), `global audit summary query must not select ${forbidden}`);
    }
    auditSelectValues = values;
    return [{
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      actor_kind: 'operator',
      action: 'admin.principal.update',
      scope: 'platform.authz.manage',
      resource_type: 'administrator-principal',
      decision: 'allowed',
      reason_code: 'ADMIN_PRINCIPAL_UPDATED',
      created_at: '2026-09-16T15:00:00.000Z',
      actor_user_id: 'must-not-leak',
      metadata: { secret: 'must-not-leak' }
    }];
  }

  throw new Error(`Unexpected SQL: ${query}`);
}

function request(subject, query = '') {
  return new Request('https://danjion.test/api/v1/admin/audit-events' + query, {
    headers: subject ? { 'x-danjion-dev-auth-user': subject } : {}
  });
}

async function bodyOf(response) {
  return response.json();
}

const admin = await globalAuditResponse(
  request('sub-admin', '?limit=999&decision=allowed&before=2026-09-17T00:00:00Z'),
  env,
  sql,
  'req-audit-admin'
);
assert.equal(admin.status, 200);
const adminBody = await bodyOf(admin);
assert.equal(adminBody.data.length, 1);
assert.deepEqual(adminBody.data[0], {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  actorKind: 'operator',
  action: 'admin.principal.update',
  scope: 'platform.authz.manage',
  resourceType: 'administrator-principal',
  decision: 'allowed',
  reasonCode: 'ADMIN_PRINCIPAL_UPDATED',
  createdAt: '2026-09-16T15:00:00.000Z'
});
for (const forbidden of ['actorUserId', 'complexId', 'resourceId', 'requestId', 'metadata']) {
  assert.equal(adminBody.data[0][forbidden], undefined, `response must omit ${forbidden}`);
}
assert.equal(auditSelectValues.at(-1), 200, 'limit must clamp to 200');
assert.equal(auditSelectValues[0], 'allowed');
assert.equal(auditSelectValues[2], '2026-09-17T00:00:00.000Z');

const operator = await globalAuditResponse(request('sub-operator'), env, sql, 'req-audit-op');
assert.equal(operator.status, 403);
assert.equal((await bodyOf(operator)).error.code, 'PRIVILEGED_FORBIDDEN');

const invalidDecision = await globalAuditResponse(
  request('sub-admin', '?decision=anything'),
  env,
  sql,
  'req-audit-invalid-decision'
);
assert.equal(invalidDecision.status, 400);
assert.equal((await bodyOf(invalidDecision)).error.code, 'VALIDATION_ERROR');

const invalidBefore = await globalAuditResponse(
  request('sub-admin', '?before=yesterday'),
  env,
  sql,
  'req-audit-invalid-before'
);
assert.equal(invalidBefore.status, 400);
assert.equal((await bodyOf(invalidBefore)).error.code, 'VALIDATION_ERROR');

const noDb = await handleAdminGlobalAuditRequest(
  request('sub-admin'),
  { ...env, DATABASE_URL: '' },
  'req-audit-no-db'
);
assert.ok(noDb instanceof Response);
assert.equal(noDb.status, 503);

assert.equal(
  await handleAdminGlobalAuditRequest(
    new Request('https://danjion.test/api/v1/admin/audit-events', { method: 'POST' }),
    env,
    'req-audit-post'
  ),
  null
);
assert.equal(
  await handleAdminGlobalAuditRequest(
    new Request('https://danjion.test/api/v1/admin/other'),
    env,
    'req-audit-other'
  ),
  null
);

console.log('Admin global audit V1 contract PASS');
