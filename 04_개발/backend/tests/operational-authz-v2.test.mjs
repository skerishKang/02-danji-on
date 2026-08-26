import assert from 'node:assert/strict';
import { requireOperationalAuthority } from '../src/operational-authz-v2.ts';

const env = {
  DATABASE_URL: 'postgres://synthetic.invalid/danjion',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'true'
};

const actorsBySubject = new Map([
  ['sub-P', { id: 'user-P', auth_user_id: 'sub-P', display_name: 'P' }],
  ['sub-C', { id: 'user-C', auth_user_id: 'sub-C', display_name: 'C' }],
  ['sub-S', { id: 'user-S', auth_user_id: 'sub-S', display_name: 'S' }],
  ['sub-M', { id: 'user-M', auth_user_id: 'sub-M', display_name: 'M' }]
]);

const complexes = new Map([
  ['complex-1', { id: 'complex-id-1', slug: 'complex-1' }],
  ['complex-2', { id: 'complex-id-2', slug: 'complex-2' }]
]);

const padiemWildcardUsers = new Set(['user-P']);
const councilGrants = new Map([
  ['user-C|complex-id-1|council.business.review', { id: 'council-business', scope: 'council.business.review' }],
  ['user-C|complex-id-1|council.official-content.manage', { id: 'council-posts', scope: 'council.official-content.manage' }],
  ['user-C|complex-id-1|council.benefit.manage', { id: 'council-benefits', scope: 'council.benefit.manage' }]
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

  if (query.includes('left join lateral') && query.includes('from padiem_operator_grants')) {
    const actorId = String(values[0]);
    const padiemScope = String(values[1]);
    const councilActorId = String(values[3]);
    const councilScope = String(values[4]);
    const complexSlug = String(values[5]);
    const complex = complexes.get(complexSlug);
    if (!complex) return [];

    const council = councilGrants.get(`${councilActorId}|${complex.id}|${councilScope}`);
    return [{
      complex_id: complex.id,
      complex_slug: complex.slug,
      padiem_grant_id: padiemWildcardUsers.has(actorId) ? 'padiem-wildcard' : null,
      padiem_granted_scope: padiemWildcardUsers.has(actorId) ? '*' : null,
      council_grant_id: council?.id ?? null,
      council_granted_scope: council?.scope ?? null,
      requested_padiem_scope: padiemScope
    }];
  }

  if (query.startsWith('insert into audit_events')) {
    auditEvents.push({
      requestId: String(values[0]),
      actorUserId: String(values[1]),
      complexId: values[2] == null ? null : String(values[2]),
      requestedScope: String(values[3]),
      decision: String(values[4]),
      reasonCode: String(values[5]),
      metadata: JSON.parse(String(values[6]))
    });
    return [];
  }

  throw new Error(`Unexpected SQL in operational authz test: ${query}`);
}

function request(subject, extraHeaders = {}) {
  return new Request('https://danjion.test/api/v1/admin/test', {
    headers: {
      'x-danjion-dev-auth-user': subject,
      ...extraHeaders
    }
  });
}

async function errorOf(value) {
  assert.ok(value instanceof Response, 'expected authorization failure Response');
  const payload = await value.json();
  return { status: value.status, code: payload.error?.code };
}

const padiemBusiness = await requireOperationalAuthority(
  request('sub-P'), env, sql, 'req-P-business', 'complex-1', 'business.review', 'council.business.review'
);
assert.ok(!(padiemBusiness instanceof Response));
assert.equal(padiemBusiness.authorityKind, 'padiem');
assert.equal(padiemBusiness.grantedScope, '*');

const padiemOfficial = await requireOperationalAuthority(
  request('sub-P'), env, sql, 'req-P-post', 'complex-2', 'official-content.manage', 'council.official-content.manage'
);
assert.ok(!(padiemOfficial instanceof Response));
assert.equal(padiemOfficial.authorityKind, 'padiem');

const councilBusiness = await requireOperationalAuthority(
  request('sub-C'), env, sql, 'req-C-business', 'complex-1', 'business.review', 'council.business.review'
);
assert.ok(!(councilBusiness instanceof Response));
assert.equal(councilBusiness.authorityKind, 'resident_council');
assert.equal(councilBusiness.complexId, 'complex-id-1');

const councilBenefit = await requireOperationalAuthority(
  request('sub-C'), env, sql, 'req-C-benefit', 'complex-1', 'benefit.manage', 'council.benefit.manage'
);
assert.ok(!(councilBenefit instanceof Response));
assert.equal(councilBenefit.authorityKind, 'resident_council');

const councilWrongComplex = await requireOperationalAuthority(
  request('sub-C'), env, sql, 'req-C-wrong', 'complex-2', 'business.review', 'council.business.review'
);
assert.deepEqual(await errorOf(councilWrongComplex), { status: 403, code: 'OPERATIONAL_FORBIDDEN' });

// S represents management-office onboarding support. It has no resident-council grant and must not satisfy day-to-day operations.
const supportDenied = await requireOperationalAuthority(
  request('sub-S'), env, sql, 'req-S', 'complex-1', 'official-content.manage', 'council.official-content.manage'
);
assert.deepEqual(await errorOf(supportDenied), { status: 403, code: 'OPERATIONAL_FORBIDDEN' });

// M represents a historical apartment manager/admin with no explicit new grant.
const legacyManagerDenied = await requireOperationalAuthority(
  request('sub-M'), env, sql, 'req-M', 'complex-1', 'benefit.manage', 'council.benefit.manage'
);
assert.deepEqual(await errorOf(legacyManagerDenied), { status: 403, code: 'OPERATIONAL_FORBIDDEN' });

const forgedDenied = await requireOperationalAuthority(
  request('sub-M', {
    'x-danjion-role': 'admin',
    'x-danjion-verified': 'true',
    'x-danjion-complex': 'complex-1'
  }),
  env,
  sql,
  'req-forged',
  'complex-1',
  'business.review',
  'council.business.review'
);
assert.deepEqual(await errorOf(forgedDenied), { status: 403, code: 'OPERATIONAL_FORBIDDEN' });

assert.equal(auditEvents.length, 8, 'every operational authorization decision must be audited once');
assert.equal(auditEvents.filter((event) => event.decision === 'allowed').length, 4);
assert.equal(auditEvents.filter((event) => event.decision === 'denied').length, 4);
assert.ok(auditEvents.some((event) => event.metadata.authorityKind === 'padiem'));
assert.ok(auditEvents.some((event) => event.metadata.authorityKind === 'resident_council'));

console.log('Operational AuthZ v2 PASS: PADIEM + council allowed, support/legacy manager denied');
