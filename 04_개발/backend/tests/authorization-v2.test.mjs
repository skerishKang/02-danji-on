import assert from 'node:assert/strict';
import { requireComplexOperator, requirePadiemOperator, requireVerifiedResident } from '../src/authorization-v2.ts';

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
  ['sub-M', { id: 'user-M', auth_user_id: 'sub-M', display_name: 'M' }],
  ['sub-R', { id: 'user-R', auth_user_id: 'sub-R', display_name: 'R' }],
  ['sub-S', { id: 'user-S', auth_user_id: 'sub-S', display_name: 'S' }],
  ['sub-E', { id: 'user-E', auth_user_id: 'sub-E', display_name: 'Exempt Operator' }],
  ['sub-W', { id: 'user-W', auth_user_id: 'sub-W', display_name: 'Exempt Super' }],
  ['sub-X', { id: 'user-X', auth_user_id: 'sub-X', display_name: 'Bare Wildcard' }],
  ['sub-E2', { id: 'user-E2', auth_user_id: 'sub-E2', display_name: 'Lookalike Scope' }],
  ['sub-E3', { id: 'user-E3', auth_user_id: 'sub-E3', display_name: 'Domain Wildcard' }],
  ['sub-G1', { id: 'user-G1', auth_user_id: 'sub-G1', display_name: 'Revoked Grant' }],
  ['sub-G2', { id: 'user-G2', auth_user_id: 'sub-G2', display_name: 'Expired Grant' }],
  ['sub-T', { id: 'user-T', auth_user_id: 'sub-T', display_name: 'Ordinary Test Resident' }],
  ['sub-U', { id: 'user-U', auth_user_id: 'sub-U', display_name: 'Unverified Social' }],
  ['sub-U2', { id: 'user-U2', auth_user_id: 'sub-U2', display_name: 'Verified Social' }],
  ['sub-V', { id: 'user-V', auth_user_id: 'sub-V', display_name: 'Lookalike Email' }],
  ['sub-V2', { id: 'user-V2', auth_user_id: 'sub-V2', display_name: 'Wildcard Email' }]
]);

const residents = new Map([
  ['user-A|complex-1', { membership_id: 'hm-A', membership_role: 'primary', household_id: 'house-1', complex_id: 'complex-id-1', complex_slug: 'complex-1' }],
  ['user-B|complex-1', { membership_id: 'hm-B', membership_role: 'member', household_id: 'house-1', complex_id: 'complex-id-1', complex_slug: 'complex-1' }],
  ['user-C|complex-2', { membership_id: 'hm-C', membership_role: 'primary', household_id: 'house-2', complex_id: 'complex-id-2', complex_slug: 'complex-2' }],
  ['user-M|complex-1', { membership_id: 'hm-M', membership_role: 'member', household_id: 'house-3', complex_id: 'complex-id-1', complex_slug: 'complex-1' }]
]);

const complexes = new Map([
  ['complex-1', { complex_id: 'complex-id-1', complex_slug: 'complex-1' }],
  ['complex-2', { complex_id: 'complex-id-2', complex_slug: 'complex-2' }]
]);

const padiemGrants = new Map([
  ['user-O|community.moderate', { id: 'grant-O', scope: 'community.moderate' }]
]);

// Case C/D fixtures: the canonical resolver selects only grants whose row is
// `status = 'active'` AND (`expires_at is null` OR `expires_at > now()`).
// A near-miss scope string and a revoked/expired grant must therefore both stay
// outside the exemption, so the mock models the row shape the SQL actually reads.
const authorityGrants = new Map([
  ['user-E', [{ id: 'grant-E', scope: 'resident.verification.exempt', status: 'active', expires_at: null }]],
  ['user-W', [
    { id: 'grant-W0', scope: '*', status: 'active', expires_at: null },
    { id: 'grant-W1', scope: 'resident.verification.exempt', status: 'active', expires_at: null }
  ]],
  ['user-X', [{ id: 'grant-X', scope: '*', status: 'active', expires_at: null }]],
  // Similar-name scopes: only the exact string exempts.
  ['user-E2', [{ id: 'grant-E2', scope: 'resident.verification.exempt.extra', status: 'active', expires_at: null }]],
  // Domain-level wildcard lookalike.
  ['user-E3', [{ id: 'grant-E3', scope: 'resident.verification.*', status: 'active', expires_at: null }]],
  // Revoked grant: same exact scope, but not active.
  ['user-G1', [{ id: 'grant-G1', scope: 'resident.verification.exempt', status: 'revoked', expires_at: null }]],
  // Expired grant: active status but expires_at in the past.
  ['user-G2', [{ id: 'grant-G2', scope: 'resident.verification.exempt', status: 'active', expires_at: '2020-01-01T00:00:00Z' }]]
]);

const complexGrants = new Map([
  ['user-R|complex-1|resident_council|council.official_posts.manage', {
    id: 'grant-R', operator_kind: 'resident_council', scope: 'council.official_posts.manage'
  }],
  ['user-S|complex-1|onboarding_support|onboarding.support', {
    id: 'grant-S', operator_kind: 'onboarding_support', scope: 'onboarding.support'
  }]
]);

const auditEvents = [];

// #823 fixtures: auth-side identity rows the ordinary-exemption fallback reads.
const authUsers = new Map([
  ['sub-T', { email: 'skerish1@naver.com', email_verified: false, credential_account: true }],
  ['sub-U', { email: 'skerish1@naver.com', email_verified: false, credential_account: false }],
  ['sub-U2', { email: 'skerish1@naver.com', email_verified: true, credential_account: false }],
  ['sub-V', { email: 'skerish1x@naver.com', email_verified: false, credential_account: true }],
  ['sub-V2', { email: '*@naver.com', email_verified: false, credential_account: true }]
]);
let ordinaryLookups = 0;

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

  if (query.includes('from padiem_operator_grants') && query.includes('order by scope')) {
    const actorId = String(values[0]);
    // Mirror the canonical predicate: active + (no expiry OR expiry in the future).
    // `now` is read from the same source the runtime uses, never hardcoded.
    const nowMs = Date.now();
    return (authorityGrants.get(actorId) || [])
      .filter((grant) => String(grant.status) === 'active')
      .filter((grant) => grant.expires_at == null || Date.parse(String(grant.expires_at)) > nowMs)
      .sort((a, b) => String(a.scope).localeCompare(String(b.scope)))
      .map((grant) => ({ id: grant.id, scope: grant.scope }));
  }

  if (query.includes('from padiem_operator_grants')) {
    const actorId = String(values[0]);
    const requestedScope = String(values[1]);
    return padiemGrants.has(`${actorId}|${requestedScope}`)
      ? [padiemGrants.get(`${actorId}|${requestedScope}`)]
      : [];
  }

  if (query.includes('from complexes') && !query.includes('left join complex_operator_grants g')) {
    const complexSlug = String(values[0]);
    const complex = complexes.get(complexSlug);
    return complex ? [complex] : [];
  }

  if (query.includes('left join complex_operator_grants g')) {
    const actorId = String(values[0]);
    const operatorKind = String(values[1]);
    const requestedScope = String(values[2]);
    const complexSlug = String(values[3]);
    const complex = complexes.get(complexSlug);
    if (!complex) return [];
    const grant = complexGrants.get(`${actorId}|${complexSlug}|${operatorKind}|${requestedScope}`);
    return [{
      ...complex,
      operator_grant_id: grant?.id ?? null,
      operator_kind: grant?.operator_kind ?? null,
      scope: grant?.scope ?? null
    }];
  }

  if (query.startsWith('insert into audit_events')) {
    auditEvents.push({
      requestId: String(values[0]),
      actorUserId: String(values[1]),
      complexId: values[2] == null ? null : String(values[2]),
      scope: String(values[3]),
      decision: String(values[4]),
      reasonCode: String(values[5]),
      metadata: JSON.parse(String(values[6]))
    });
    return [];
  }

  if (query.includes('from danjion_auth."user" u')) {
    ordinaryLookups += 1;
    const subject = String(values[0]);
    const user = authUsers.get(subject);
    return user ? [user] : [];
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
assert.equal(residentA.residentVerificationExempt, false);

const residentB = await requireVerifiedResident(request('sub-B'), env, sql, 'req-B', 'complex-1');
assert.ok(!(residentB instanceof Response));
assert.equal(residentB.id, 'user-B');
assert.equal(residentB.membershipRole, 'member');

const wrongComplex = await requireVerifiedResident(request('sub-C'), env, sql, 'req-C', 'complex-1');
assert.deepEqual(await responseError(wrongComplex), { status: 403, code: 'RESIDENT_VERIFICATION_REQUIRED' });

const unverified = await requireVerifiedResident(request('sub-D'), env, sql, 'req-D', 'complex-1');
assert.deepEqual(await responseError(unverified), { status: 403, code: 'RESIDENT_VERIFICATION_REQUIRED' });

const ordinaryLookupsBeforeGrantCases = ordinaryLookups;
const exemptOperator = await requireVerifiedResident(request('sub-E'), env, sql, 'req-E', 'complex-1');
assert.ok(!(exemptOperator instanceof Response));
assert.equal(exemptOperator.id, 'user-E');
assert.equal(exemptOperator.complexId, 'complex-id-1');
assert.equal(exemptOperator.residentVerificationExempt, true);
assert.equal(exemptOperator.householdId, null);
assert.equal(exemptOperator.membershipId, null);
assert.equal(exemptOperator.membershipRole, null);

const exemptSuper = await requireVerifiedResident(request('sub-W'), env, sql, 'req-W', 'complex-1');
assert.ok(!(exemptSuper instanceof Response));
assert.equal(exemptSuper.id, 'user-W');
assert.equal(exemptSuper.residentVerificationExempt, true);
assert.equal(exemptSuper.householdId, null);

// #823: the grant path must SHORT-CIRCUIT — admin/exempt-grant admissions
// never consult the ordinary allowlist at all.
assert.equal(ordinaryLookups, ordinaryLookupsBeforeGrantCases,
  'grant-path admissions must short-circuit before the ordinary allowlist lookup');

const bareWildcard = await requireVerifiedResident(request('sub-X'), env, sql, 'req-X', 'complex-1');
assert.deepEqual(await responseError(bareWildcard), { status: 403, code: 'RESIDENT_VERIFICATION_REQUIRED' });

// Case C — similar-name scopes must never exempt. Only the exact canonical
// string 'resident.verification.exempt' exempts; prefixed extensions and
// domain-level wildcards stay ordinary residents.
const lookalikeScope = await requireVerifiedResident(request('sub-E2'), env, sql, 'req-E2', 'complex-1');
assert.deepEqual(await responseError(lookalikeScope), { status: 403, code: 'RESIDENT_VERIFICATION_REQUIRED' });

const domainWildcard = await requireVerifiedResident(request('sub-E3'), env, sql, 'req-E3', 'complex-1');
assert.deepEqual(await responseError(domainWildcard), { status: 403, code: 'RESIDENT_VERIFICATION_REQUIRED' });

// Case D — an inactive or expired grant carrying the exact scope must not
// exempt: exemption is bound to a currently-valid, non-revoked grant.
const revokedGrant = await requireVerifiedResident(request('sub-G1'), env, sql, 'req-G1', 'complex-1');
assert.deepEqual(await responseError(revokedGrant), { status: 403, code: 'RESIDENT_VERIFICATION_REQUIRED' });

const expiredGrant = await requireVerifiedResident(request('sub-G2'), env, sql, 'req-G2', 'complex-1');
assert.deepEqual(await responseError(expiredGrant), { status: 403, code: 'RESIDENT_VERIFICATION_REQUIRED' });

// ==== #823 ordinary test-resident exemption (source allowlist, zero grants) ====
const ordinaryExempt = await requireVerifiedResident(request('sub-T'), env, sql, 'req-T', 'complex-1');
assert.ok(!(ordinaryExempt instanceof Response), 'the allowlisted credential test account must pass');
assert.equal(ordinaryExempt.id, 'user-T');
assert.equal(ordinaryExempt.residentVerificationExempt, true);
assert.equal(ordinaryExempt.householdId, null, 'the exemption must never synthesize a householdId');
assert.equal(ordinaryExempt.membershipId, null, 'the exemption must never synthesize a membershipId');
assert.equal(ordinaryExempt.membershipRole, null, 'the exemption must never synthesize a membershipRole');

// Same allowlisted address without the credential provider and without the
// verified-email bit stays an ordinary unverified resident.
const unverifiedSocial = await requireVerifiedResident(request('sub-U'), env, sql, 'req-U', 'complex-1');
assert.deepEqual(await responseError(unverifiedSocial), { status: 403, code: 'RESIDENT_VERIFICATION_REQUIRED' });

const verifiedSocial = await requireVerifiedResident(request('sub-U2'), env, sql, 'req-U2', 'complex-1');
assert.ok(!(verifiedSocial instanceof Response));
assert.equal(verifiedSocial.residentVerificationExempt, true);

// Exact address only: lookalikes and wildcard-shaped addresses never match.
const lookalikeEmail = await requireVerifiedResident(request('sub-V'), env, sql, 'req-V', 'complex-1');
assert.deepEqual(await responseError(lookalikeEmail), { status: 403, code: 'RESIDENT_VERIFICATION_REQUIRED' });

const wildcardEmail = await requireVerifiedResident(request('sub-V2'), env, sql, 'req-V2', 'complex-1');
assert.deepEqual(await responseError(wildcardEmail), { status: 403, code: 'RESIDENT_VERIFICATION_REQUIRED' });

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

const council = await requireComplexOperator(
  request('sub-R'), env, sql, 'req-council', 'complex-1', 'council.official_posts.manage'
);
assert.ok(!(council instanceof Response));
assert.equal(council.operatorKind, 'resident_council');
assert.equal(council.complexId, 'complex-id-1');
assert.equal(council.grantedScope, 'council.official_posts.manage');

const onboarding = await requireComplexOperator(
  request('sub-S'), env, sql, 'req-onboarding', 'complex-1', 'onboarding.support'
);
assert.ok(!(onboarding instanceof Response));
assert.equal(onboarding.operatorKind, 'onboarding_support');
assert.equal(onboarding.grantedScope, 'onboarding.support');

// Management-office/onboarding support can never satisfy a council operational scope.
const supportCannotOperateCouncil = await requireComplexOperator(
  request('sub-S'), env, sql, 'req-support-council', 'complex-1', 'council.official_posts.manage'
);
assert.deepEqual(await responseError(supportCannotOperateCouncil), { status: 403, code: 'COMPLEX_OPERATOR_FORBIDDEN' });

// PADIEM platform authority remains separate; it does not silently become a resident-council grant.
const padiemNotCouncil = await requireComplexOperator(
  request('sub-O'), env, sql, 'req-padiem-council', 'complex-1', 'council.official_posts.manage'
);
assert.deepEqual(await responseError(padiemNotCouncil), { status: 403, code: 'COMPLEX_OPERATOR_FORBIDDEN' });

// Legacy manager/admin labels and forged headers do not create council authority.
const legacyManagerNotCouncil = await requireComplexOperator(
  request('sub-M', {
    'x-danjion-role': 'resident_council',
    'x-danjion-verified': 'true',
    'x-danjion-complex': 'complex-1'
  }),
  env,
  sql,
  'req-manager-council',
  'complex-1',
  'council.official_posts.manage'
);
assert.deepEqual(await responseError(legacyManagerNotCouncil), { status: 403, code: 'COMPLEX_OPERATOR_FORBIDDEN' });

const invalidScope = await requireComplexOperator(
  request('sub-R'), env, sql, 'req-invalid-scope', 'complex-1', 'official_posts.manage'
);
assert.deepEqual(await responseError(invalidScope), { status: 400, code: 'COMPLEX_OPERATOR_SCOPE_INVALID' });

assert.equal(auditEvents.length, 8, 'PADIEM and complex-operator allow/deny decisions must all be audited');
assert.deepEqual(
  auditEvents.map(({ actorUserId, complexId, decision, reasonCode }) => ({ actorUserId, complexId, decision, reasonCode })),
  [
    { actorUserId: 'user-O', complexId: null, decision: 'allowed', reasonCode: 'OPERATOR_SCOPE_GRANTED' },
    { actorUserId: 'user-M', complexId: null, decision: 'denied', reasonCode: 'OPERATOR_SCOPE_MISSING' },
    { actorUserId: 'user-D', complexId: null, decision: 'denied', reasonCode: 'OPERATOR_SCOPE_MISSING' },
    { actorUserId: 'user-R', complexId: 'complex-id-1', decision: 'allowed', reasonCode: 'COMPLEX_OPERATOR_SCOPE_GRANTED' },
    { actorUserId: 'user-S', complexId: 'complex-id-1', decision: 'allowed', reasonCode: 'COMPLEX_OPERATOR_SCOPE_GRANTED' },
    { actorUserId: 'user-S', complexId: 'complex-id-1', decision: 'denied', reasonCode: 'COMPLEX_OPERATOR_SCOPE_MISSING' },
    { actorUserId: 'user-O', complexId: 'complex-id-1', decision: 'denied', reasonCode: 'COMPLEX_OPERATOR_SCOPE_MISSING' },
    { actorUserId: 'user-M', complexId: 'complex-id-1', decision: 'denied', reasonCode: 'COMPLEX_OPERATOR_SCOPE_MISSING' }
  ]
);

console.log('Authorization v2 principals PASS: resident + PADIEM + council/onboarding separation');
