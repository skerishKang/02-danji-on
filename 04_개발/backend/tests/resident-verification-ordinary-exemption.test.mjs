import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// #823: ONE ordinary email test account gets resident-verification exemption
// WITHOUT any admin/operator/super-admin authority. This file proves the three
// structural guarantees that the authorization-v2 route cases cannot:
//
//   1. The ordinary exempt admission never mints a `padiem_operator_grants`
//      row: `resolvePadiemAuthority().level` stays 'none', so the admin
//      console (`GET /api/v1/admin/authority`) keeps returning 403 and the
//      account is neither operator nor admin.
//   2. The self-facing exemption probe reports true for the allowlisted
//      account (grant-free) and false for everyone else.
//   3. The source allowlist is exact-match only: no '*', no wildcards, no
//      domain patterns, and it never touches any household table.
//
// Run: npx tsx tests/resident-verification-ordinary-exemption.test.mjs
import { resolvePadiemAuthority } from '../src/padiem-authority-v1.ts';
import { resolveAdminAuthorityResponse } from '../src/admin-authority-v1.ts';
import { resolveResidentVerificationExemptionResponse } from '../src/resident-verification-exemption-v1.ts';
import {
  ORDINARY_TEST_RESIDENT_EXEMPT_EMAILS,
  isOrdinaryTestResidentExemptEmail,
  normalizeOrdinaryExemptionEmail
} from '../src/resident-verification-ordinary-exemption-v1.ts';

const env = {
  DATABASE_URL: 'postgres://synthetic.invalid/danjion',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'true'
};

const TEST_EMAIL = 'skerish1@naver.com';

const actorsBySubject = new Map([
  ['sub-T', { id: 'user-T', auth_user_id: 'sub-T', display_name: 'Ordinary Test Resident' }],
  ['sub-N', { id: 'user-N', auth_user_id: 'sub-N', display_name: 'Ordinary Neighbor' }]
]);

const authUsers = new Map([
  ['sub-T', { email: TEST_EMAIL, email_verified: false, credential_account: true }],
  ['sub-N', { email: 'neighbor@example.com', email_verified: true, credential_account: false }]
]);

const queries = [];

async function sql(strings, ...values) {
  const text = strings.join('?').replace(/\s+/g, ' ').trim();
  queries.push(text.toLowerCase());

  if (text.includes('from app_users')) {
    const actor = actorsBySubject.get(String(values[0]));
    return actor ? [actor] : [];
  }
  if (text.includes('from padiem_operator_grants')) {
    // The ordinary test account holds NO grants; nobody in this file does.
    return [];
  }
  if (text.includes('from danjion_auth."user" u')) {
    const user = authUsers.get(String(values[0]));
    return user ? [user] : [];
  }
  if (text.startsWith('insert into audit_events')) return [];
  throw new Error(`Unexpected SQL in test: ${text}`);
}

function request(subject) {
  return new Request('https://danjion.test/private', {
    headers: { 'x-danjion-dev-auth-user': subject }
  });
}

/* ==== 1. no grant rows: level 'none', admin console stays 403 ==== */
{
  const actor = { id: 'user-T', authUserId: 'sub-T', displayName: 'Ordinary Test Resident' };
  const authority = await resolvePadiemAuthority(sql, actor.id);
  assert.equal(authority.level, 'none', 'TEST_ACCOUNT_NOT_OPERATOR: zero grants keeps the level at none');
  assert.equal(authority.wildcard, false, 'the test account never holds a wildcard');
  assert.deepEqual(authority.scopes, [], 'the test account holds no operator scopes');

  const adminAuthority = await resolveAdminAuthorityResponse(request('sub-T'), env, sql, 'req-admin-T');
  assert.ok(adminAuthority instanceof Response);
  assert.equal(adminAuthority.status, 403,
    'the ordinary exempt account must never receive an admin-authority profile');
  const body = await adminAuthority.json();
  assert.equal(body.error.code, 'ADMIN_AUTHORITY_REQUIRED');
}

/* ==== 2. the self probe reports the ordinary exemption ==== */
{
  const exemptProbe = await resolveResidentVerificationExemptionResponse(request('sub-T'), env, sql, 'req-probe-T');
  assert.ok(!(exemptProbe instanceof Response) || exemptProbe.status === 200);
  const exemptBody = await exemptProbe.json();
  assert.equal(exemptBody.data.exempt, true, 'probe must report the allowlisted credential account as exempt');

  const ordinaryProbe = await resolveResidentVerificationExemptionResponse(request('sub-N'), env, sql, 'req-probe-N');
  const ordinaryBody = await ordinaryProbe.json();
  assert.equal(ordinaryBody.data.exempt, false, 'a non-listed account stays non-exempt');
}

/* ==== 3. nothing in this flow writes grants or reads households ==== */
{
  const grantWrites = queries.filter((q) => q.startsWith('insert into padiem_operator_grants'));
  assert.deepEqual(grantWrites, [], 'the exemption path must never materialize authority rows');
  const householdReads = queries.filter((q) => q.includes('household'));
  assert.deepEqual(householdReads, [], 'the exemption path must never touch household tables');
}

/* ==== 4. source-level allowlist invariants ==== */
{
  const source = await readFile(new URL('../src/resident-verification-ordinary-exemption-v1.ts', import.meta.url), 'utf8');
  assert.equal(ORDINARY_TEST_RESIDENT_EXEMPT_EMAILS.length, 1,
    'exactly one ordinary test account may be allowlisted (the four admins are NOT here)');
  assert.equal(ORDINARY_TEST_RESIDENT_EXEMPT_EMAILS[0], TEST_EMAIL);
  assert.ok(source.includes('Object.freeze('), 'the allowlist must be frozen at module level');
  assert.match(source, /const ORDINARY_TEST_RESIDENT_EXEMPT_EMAILS = Object\.freeze\(\s*\[\s*'skerish1@naver\.com'\s*\]/,
    'the frozen source list carries exactly the one allowlisted address');
  for (const entry of ORDINARY_TEST_RESIDENT_EXEMPT_EMAILS) {
    assert.ok(!entry.includes('*'), `allowlist entry ${entry} must be an exact address`);
  }
  assert.ok(!/.endsWith|startsWith|includes\((?!email\))/i.test(source.match(/export function isOrdinaryTestResidentExemptEmail[\s\S]*?\n}/)[0]),
    'matching must stay exact-set, never prefix/suffix/domain logic');

  assert.equal(normalizeOrdinaryExemptionEmail(' SKERISH1@NAVER.COM '), TEST_EMAIL, 'normalization is trim+lower only');
  assert.equal(normalizeOrdinaryExemptionEmail('*'), null, 'bare wildcard is never a usable address');
  assert.equal(isOrdinaryTestResidentExemptEmail('*@naver.com'), false, 'wildcard-shaped addresses never match');
  assert.equal(isOrdinaryTestResidentExemptEmail('skerish1x@naver.com'), false, 'lookalike addresses never match');
  assert.equal(isOrdinaryTestResidentExemptEmail('skerish1@naver.com.extra'), false);
  assert.equal(isOrdinaryTestResidentExemptEmail(TEST_EMAIL), true);
}

console.log('RESIDENT_VERIFICATION_ORDINARY_EXEMPTION_TEST_ACCOUNT_NOT_OPERATOR=PASS');
console.log('RESIDENT_VERIFICATION_ORDINARY_EXEMPTION_ADMIN_CONSOLE_403=PASS');
console.log('RESIDENT_VERIFICATION_ORDINARY_EXEMPTION_PROBE=PASS');
console.log('RESIDENT_VERIFICATION_ORDINARY_EXEMPTION_EXACT_MATCH_ONLY=PASS');
console.log('Resident-verification ordinary test exemption PASS: exact email, zero grants, zero household access');
