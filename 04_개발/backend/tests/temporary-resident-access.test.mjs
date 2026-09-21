import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/*
 * #868 — Temporary Resident Access mode.
 *
 * OWNER DECISION: the authoritative Unit Master and the household-code issuance
 * are not ready, so `TEMP_RESIDENT_ACCESS_MODE=true` admits SIGNED-IN ordinary
 * members to the GENERAL resident surfaces for the time being.
 *
 * This contract is deliberately two-layered:
 *   1. runtime — the switch is fail-closed, it never widens AuthN/AuthZ, it
 *      fabricates no household, and it is fully reversible by flipping the var
 *   2. source — the switch is consulted strictly AFTER the AuthN gate, the
 *      canonical 403 stays the fallback, and production pins the mode in
 *      source-controlled config (never only in the Cloudflare dashboard)
 *
 * Run: npx tsx tests/temporary-resident-access.test.mjs
 */
import {
  requireComplexOperator,
  requirePadiemOperator,
  requireVerifiedResident
} from '../src/authorization-v2.ts';
import { resolveAdminAuthorityResponse } from '../src/admin-authority-v1.ts';
import { resolvePadiemAuthority } from '../src/padiem-authority-v1.ts';
import { resolveResidentVerificationExemptionResponse } from '../src/resident-verification-exemption-v1.ts';
import {
  TEMP_RESIDENT_ACCESS_MODE_VAR,
  isTemporaryResidentAccessEnabled,
  parseTemporaryResidentAccessMode
} from '../src/temporary-resident-access-v1.ts';

const BASE_ENV = {
  DATABASE_URL: 'postgres://synthetic.invalid/danjion',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'true'
};
const TEMP_OFF_ENV = { ...BASE_ENV };
const TEMP_ON_ENV = { ...BASE_ENV, TEMP_RESIDENT_ACCESS_MODE: 'true' };

const actorsBySubject = new Map([
  ['sub-N', { id: 'user-N', auth_user_id: 'sub-N', display_name: 'Ordinary Neighbor' }],
  ['sub-V', { id: 'user-V', auth_user_id: 'sub-V', display_name: 'Verified Resident' }],
  ['sub-E', { id: 'user-E', auth_user_id: 'sub-E', display_name: 'Exempt Principal' }],
  ['sub-O', { id: 'user-O', auth_user_id: 'sub-O', display_name: 'Scoped Operator' }]
]);

// Real verified household membership rows for the canonical resident path.
const residents = new Map([
  ['user-V|complex-1', {
    membership_id: 'hm-V',
    membership_role: 'primary',
    household_id: 'house-V',
    complex_id: 'complex-id-1',
    complex_slug: 'complex-1'
  }]
]);

// Accounts that already hold a real verified membership anywhere.
const verifiedMemberships = new Set(['user-V']);

const authorityGrants = new Map([
  ['user-E', [{ id: 'grant-E', scope: 'resident.verification.exempt', status: 'active', expires_at: null }]]
]);

const padiemGrants = new Map([
  ['user-O|community.moderate', { id: 'grant-O', scope: 'community.moderate' }]
]);

const complexes = new Map([
  ['complex-1', { complex_id: 'complex-id-1', complex_slug: 'complex-1' }]
]);

const queryLog = [];

function normalized(strings) {
  return strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function sql(strings, ...values) {
  const query = normalized(strings);
  queryLog.push(query);

  if (query.includes('from app_users')) {
    const actor = actorsBySubject.get(String(values[0]));
    return actor ? [actor] : [];
  }

  if (query.includes('from household_memberships hm')) {
    // The canonical resident gate joins `complexes`; the #868 membership probe
    // is slug-less and does not.
    if (query.includes('join complexes c')) {
      const resident = residents.get(`${String(values[0])}|${String(values[1])}`);
      return resident ? [resident] : [];
    }
    return verifiedMemberships.has(String(values[0])) ? [{ membership_id: 'hm-probe' }] : [];
  }

  if (query.includes('from padiem_operator_grants') && query.includes('order by scope')) {
    const actorId = String(values[0]);
    const nowMs = Date.now();
    return (authorityGrants.get(actorId) || [])
      .filter((grant) => String(grant.status) === 'active')
      .filter((grant) => grant.expires_at == null || Date.parse(String(grant.expires_at)) > nowMs)
      .map((grant) => ({ id: grant.id, scope: grant.scope }));
  }

  if (query.includes('from padiem_operator_grants')) {
    const key = `${String(values[0])}|${String(values[1])}`;
    return padiemGrants.has(key) ? [padiemGrants.get(key)] : [];
  }

  if (query.includes('left join complex_operator_grants g')) {
    const complex = complexes.get(String(values[3]));
    if (!complex) return [];
    return [{ ...complex, operator_grant_id: null, operator_kind: null, scope: null }];
  }

  if (query.includes('from complexes')) {
    const complex = complexes.get(String(values[0]));
    return complex ? [complex] : [];
  }

  // No account in this file is on the #823 ordinary allowlist.
  if (query.includes('from danjion_auth."user" u')) return [];

  if (query.startsWith('insert into audit_events')) return [];

  throw new Error(`Unexpected SQL in #868 test: ${query}`);
}

function request(subject, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (subject) headers['x-danjion-dev-auth-user'] = subject;
  return new Request('https://danjion.test/private', { headers });
}

function probeRequest(subject) {
  return new Request('https://danjion.test/api/v1/me/resident-verification-exemption', {
    headers: subject ? { 'x-danjion-dev-auth-user': subject } : {}
  });
}

async function responseError(value) {
  assert.ok(value instanceof Response, 'expected a failure Response');
  const payload = await value.json();
  return { status: value.status, code: payload.error?.code };
}

function probeData(value) {
  return value.json().then((payload) => payload.data);
}

/* ============ 1. the switch parses fail-closed ============ */
{
  assert.equal(TEMP_RESIDENT_ACCESS_MODE_VAR, 'TEMP_RESIDENT_ACCESS_MODE', 'the env var name is canonical');
  assert.equal(parseTemporaryResidentAccessMode('true'), true, 'the exact string true enables the mode');
  assert.equal(parseTemporaryResidentAccessMode(' true '), true, 'surrounding whitespace is ignored');
  assert.equal(parseTemporaryResidentAccessMode('TRUE'), true, 'ASCII case is ignored');
  for (const value of ['false', '', ' ', '1', '0', 'yes', 'on', 'no', 'enabled', 'truee', 'TRUE!', null, undefined, true, false, 1, 0, {}, []]) {
    assert.equal(parseTemporaryResidentAccessMode(value), false,
      `only the exact string 'true' enables temporary access; ${JSON.stringify(value)} must stay OFF`);
  }
  assert.equal(isTemporaryResidentAccessEnabled(undefined), false, 'a missing env object is OFF');
  assert.equal(isTemporaryResidentAccessEnabled(null), false, 'a null env object is OFF');
  assert.equal(isTemporaryResidentAccessEnabled({}), false, 'an absent var is OFF');
  assert.equal(isTemporaryResidentAccessEnabled({ TEMP_RESIDENT_ACCESS_MODE: 'false' }), false);
  assert.equal(isTemporaryResidentAccessEnabled({ TEMP_RESIDENT_ACCESS_MODE: 'true' }), true);
}

/* ============ 2. TEMP OFF keeps the strict 403 ============ */
{
  const denied = await requireVerifiedResident(request('sub-N'), TEMP_OFF_ENV, sql, 'req-off-N', 'complex-1');
  assert.deepEqual(await responseError(denied), { status: 403, code: 'RESIDENT_VERIFICATION_REQUIRED' },
    'TEMP OFF + no membership must keep the existing strict resident-verification failure');
}

/* ============ 3. TEMP ON still denies signed-out traffic ============ */
{
  const anonymous = await requireVerifiedResident(request(null), TEMP_ON_ENV, sql, 'req-on-anon', 'complex-1');
  assert.deepEqual(await responseError(anonymous), { status: 401, code: 'AUTH_REQUIRED' },
    'SIGNED_OUT_STILL_DENIED: the switch is unreachable without an authenticated actor');

  const anonymousProbe = await resolveResidentVerificationExemptionResponse(probeRequest(null), TEMP_ON_ENV, sql, 'req-probe-anon');
  assert.deepEqual(await responseError(anonymousProbe), { status: 401, code: 'AUTH_REQUIRED' },
    'the self probe must also refuse anonymous callers while the switch is on');
}

/* ============ 4. TEMP ON admits a signed-in ordinary member, household-free ==== */
{
  const admitted = await requireVerifiedResident(request('sub-N'), TEMP_ON_ENV, sql, 'req-on-N', 'complex-1');
  assert.ok(!(admitted instanceof Response), 'TEMP ON + signed-in ordinary must pass the general resident gate');
  assert.equal(admitted.id, 'user-N', 'the admission keeps the real actor identity');
  assert.equal(admitted.complexId, 'complex-id-1', 'the admission resolves the requested complex');
  assert.equal(admitted.residentVerificationExempt, true, 'a temporary admission is an exemption, not a verification');
  assert.equal(admitted.householdId, null, 'FAKE_HOUSEHOLD=0: no household may be invented');
  assert.equal(admitted.membershipId, null, 'FAKE_MEMBERSHIP=0: no membership may be invented');
  assert.equal(admitted.membershipRole, null, 'no membership role may be invented');
}

/* ============ 5. TEMP ON widens no admin/operator authority ============ */
{
  const authority = await resolvePadiemAuthority(sql, 'user-N');
  assert.equal(authority.level, 'none', 'the temporary admission mints no PADIEM authority');
  assert.deepEqual(authority.scopes, [], 'the temporary admission grants no operator scope');

  const adminAuthority = await resolveAdminAuthorityResponse(request('sub-N'), TEMP_ON_ENV, sql, 'req-admin-N');
  assert.ok(adminAuthority instanceof Response);
  assert.deepEqual(await responseError(adminAuthority), { status: 403, code: 'ADMIN_AUTHORITY_REQUIRED' },
    'ADMIN_WIDENING=NO: the admin console stays closed for a temporary user');

  const padiemOperator = await requirePadiemOperator(request('sub-N'), TEMP_ON_ENV, sql, 'req-op-N', 'community.moderate');
  assert.deepEqual(await responseError(padiemOperator), { status: 403, code: 'OPERATOR_FORBIDDEN' },
    'OPERATOR_WIDENING=NO: a PADIEM operator scope is still required');

  const complexOperator = await requireComplexOperator(
    request('sub-N'), TEMP_ON_ENV, sql, 'req-co-N', 'complex-1', 'council.official_posts.manage'
  );
  assert.deepEqual(await responseError(complexOperator), { status: 403, code: 'COMPLEX_OPERATOR_FORBIDDEN' },
    'OPERATOR_WIDENING=NO: complex operator authority is still required');

  const scopedOperator = await requirePadiemOperator(request('sub-O'), TEMP_ON_ENV, sql, 'req-op-O', 'community.moderate');
  assert.ok(!(scopedOperator instanceof Response), 'a real operator grant still works unchanged');
  assert.equal(scopedOperator.grantedScope, 'community.moderate');
}

/* ============ 6. a real verified resident keeps the real resident path ========= */
{
  for (const [label, env] of [['TEMP OFF', TEMP_OFF_ENV], ['TEMP ON', TEMP_ON_ENV]]) {
    const resident = await requireVerifiedResident(request('sub-V'), env, sql, `req-V-${label}`, 'complex-1');
    assert.ok(!(resident instanceof Response), `${label}: a real verified resident must pass`);
    assert.equal(resident.residentVerificationExempt, false, `${label}: a real resident is not an exemption`);
    assert.equal(resident.householdId, 'house-V', `${label}: the real householdId must be preserved`);
    assert.equal(resident.membershipId, 'hm-V', `${label}: the real membershipId must be preserved`);
    assert.equal(resident.membershipRole, 'primary', `${label}: the real membershipRole must be preserved`);
  }
}

/* ============ 7. the self probe distinguishes temporary from canonical ========= */
{
  assert.deepEqual(
    await probeData(await resolveResidentVerificationExemptionResponse(probeRequest('sub-N'), TEMP_OFF_ENV, sql, 'req-p-off-N')),
    { exempt: false },
    'TEMP OFF keeps the original byte-compatible probe answer'
  );
  assert.deepEqual(
    await probeData(await resolveResidentVerificationExemptionResponse(probeRequest('sub-E'), TEMP_OFF_ENV, sql, 'req-p-off-E')),
    { exempt: true },
    'TEMP OFF keeps the canonical operator exemption answer'
  );
  assert.deepEqual(
    await probeData(await resolveResidentVerificationExemptionResponse(probeRequest('sub-N'), TEMP_ON_ENV, sql, 'req-p-on-N')),
    { exempt: true, temporary: true },
    'TEMP ON + ordinary member must report the additive temporary state'
  );
  assert.deepEqual(
    await probeData(await resolveResidentVerificationExemptionResponse(probeRequest('sub-V'), TEMP_ON_ENV, sql, 'req-p-on-V')),
    { exempt: false },
    'TEMP ON must never label an already-verified resident as temporary'
  );
  assert.deepEqual(
    await probeData(await resolveResidentVerificationExemptionResponse(probeRequest('sub-E'), TEMP_ON_ENV, sql, 'req-p-on-E')),
    { exempt: true },
    'a canonical operator exemption must stay distinguishable from temporary access'
  );
}

/* ============ 8. the extra membership lookup runs ONLY while the switch is on = */
{
  const membershipProbe = (entry) => entry.includes('from household_memberships hm') && !entry.includes('join complexes c');

  const beforeOff = queryLog.filter(membershipProbe).length;
  await resolveResidentVerificationExemptionResponse(probeRequest('sub-N'), TEMP_OFF_ENV, sql, 'req-p-off-N2');
  await resolveResidentVerificationExemptionResponse(probeRequest('sub-V'), TEMP_OFF_ENV, sql, 'req-p-off-V2');
  assert.equal(queryLog.filter(membershipProbe).length, beforeOff,
    'TEMP OFF must not add any household read to the self exemption probe');

  const beforeOn = queryLog.filter(membershipProbe).length;
  await resolveResidentVerificationExemptionResponse(probeRequest('sub-V'), TEMP_ON_ENV, sql, 'req-p-on-V2');
  assert.equal(queryLog.filter(membershipProbe).length, beforeOn + 1,
    'TEMP ON must resolve the real membership before answering, so verified residents stay non-temporary');
}

/* ============ 9. source invariants ============ */
{
  const root = new URL('../', import.meta.url);
  const [authorization, exemption, temporary, authEnv, wranglerRaw] = await Promise.all([
    readFile(new URL('src/authorization-v2.ts', root), 'utf8'),
    readFile(new URL('src/resident-verification-exemption-v1.ts', root), 'utf8'),
    readFile(new URL('src/temporary-resident-access-v1.ts', root), 'utf8'),
    readFile(new URL('src/auth-v1.ts', root), 'utf8'),
    readFile(new URL('wrangler.jsonc', root), 'utf8')
  ]);

  // The switch is consulted strictly AFTER the AuthN gate.
  const authnAt = authorization.indexOf('const actor = await requireActor(request, env, sql, requestId);');
  const switchAt = authorization.indexOf('isTemporaryResidentAccessEnabled(env)');
  assert.ok(authnAt >= 0 && switchAt > authnAt,
    'the temporary switch must be consulted only after requireActor() resolved a signed-in actor');

  // The canonical strict 403 remains the fallback when the switch is off.
  assert.match(
    authorization,
    /if \(!ordinaryExempt && !isTemporaryResidentAccessEnabled\(env\)\) \{\s*\n\s*return fail\('RESIDENT_VERIFICATION_REQUIRED', 'Verified resident access required', 403, requestId\);/,
    'TEMP OFF must fall back to the unchanged strict resident-verification refusal'
  );

  // No operator/admin authority resolver may consult the switch.
  const operatorPart = authorization.slice(authorization.indexOf('export async function requirePadiemOperator'));
  assert.ok(operatorPart.length > 0, 'the operator resolvers must remain in authorization-v2');
  assert.doesNotMatch(operatorPart, /isTemporaryResidentAccessEnabled|TEMP_RESIDENT_ACCESS_MODE/,
    'operator authority must never consult the temporary switch');

  // No household/membership identifier may be synthesized anywhere.
  assert.doesNotMatch(authorization, /householdId:\s*['"`][^'"`]+['"`]/,
    'the authorization module must never synthesize a householdId literal');
  assert.doesNotMatch(temporary, /householdId:\s*['"`][^'"`]+['"`]|membershipId:\s*['"`][^'"`]+['"`]/,
    'the temporary-access module must never synthesize a household/membership id');
  assert.doesNotMatch(temporary, /insert into|update\s+\w+\s+set|delete from/i,
    'the temporary switch is read-only: it may never write product state');
  assert.doesNotMatch(temporary, /padiem_operator_grants|padiem_admin_identity_allowlist/i,
    'the temporary switch must never read or write an authority table');
  assert.doesNotMatch(temporary, /request\.headers|request\.url/,
    'the temporary switch must never be derived from request input');
  assert.match(authEnv, /TEMP_RESIDENT_ACCESS_MODE\?: string;/, 'the switch must be part of the canonical auth env surface');

  // The probe consults the canonical sources first, the switch last.
  const probeBody = exemption.slice(exemption.indexOf('const authority = await resolvePadiemAuthority'));
  assert.ok(probeBody.indexOf('resolveOrdinaryTestResidentExemption') < probeBody.indexOf('isTemporaryResidentAccessEnabled'),
    'the canonical grant/allowlist answers must be resolved before the temporary switch');
  assert.ok(probeBody.indexOf('isTemporaryResidentAccessEnabled') < probeBody.indexOf('hasVerifiedResidentMembership'),
    'the switch must be checked before the real-membership refinement');

  // Source-controlled config: fail-closed default, pinned ON for production.
  const wrangler = JSON.parse(wranglerRaw);
  assert.equal(wrangler.vars?.TEMP_RESIDENT_ACCESS_MODE, 'false',
    'the default (dev) config must stay fail-closed');
  assert.equal(wrangler.env?.production?.vars?.TEMP_RESIDENT_ACCESS_MODE, 'true',
    '#868: production must pin the temporary mode in source-controlled config, never only in the dashboard');
  assert.ok(!(wrangler.env?.production?.secrets?.required ?? []).includes('TEMP_RESIDENT_ACCESS_MODE'),
    'the temporary switch is a source-visible config var, not a dashboard secret');
}

console.log('TEMP_SWITCH_FAIL_CLOSED=PASS');
console.log('TEMP_OFF_STRICT_403=PASS');
console.log('SIGNED_OUT_STILL_DENIED=PASS');
console.log('SIGNED_IN_TEMP_ACCESS=PASS');
console.log('FAKE_HOUSEHOLD=0 FAKE_MEMBERSHIP=0');
console.log('ADMIN_WIDENING=NO OPERATOR_WIDENING=NO');
console.log('REAL_RESIDENT_REGRESSION=PASS');
console.log('EXEMPTION_API_TEMPORARY_STATE=PASS');
console.log('PASS #868 temporary resident access contract');
