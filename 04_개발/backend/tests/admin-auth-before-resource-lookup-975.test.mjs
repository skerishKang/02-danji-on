import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { handleAdminOperationalRequest } from '../src/admin-operational-v2.ts';
import { handleAdminReviewContextRequest } from '../src/admin-review-context-v1.ts';

// #975 runtime contract: ID-based admin routes must not answer a resource
// existence oracle. The required stage order is
//
//   Stage 1  minimum actor boundary (requireActor -> 401 signed out)
//   Stage 2  bounded resource lookup by id
//   Stage 3  exact complex-scoped authority for the resource's own complex
//   Stage 4  404 only for a caller that cleared the operational-principal boundary
//
// This file drives the REAL route handlers through the test-only Neon shim
// (needs `--import ./tests/helpers/neon-stub-loader.mjs`) and proves, per
// affected route, the acceptance matrix, the SQL query order and the fact that
// a malformed id never reaches a ::uuid cast.
//
// AUTH_MODEL             = requireActor (Stage 1) + requireOperationalAuthority (Stage 3)
// STAGE1_ACTOR_BOUNDARY  = requireActor, before any resource read
// STAGE2_RESOURCE_LOOKUP = single bounded id lookup
// STAGE3_SCOPED_AUTHORITY= requireOperationalAuthority on the row's own complex

const REQUEST_ID = 'req-975-auth-order';

const ENV = {
  DATABASE_URL: 'postgresql://unused.test',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'true'
};

const COMPLEX_ID = '97500000-0000-4000-8000-000000000004';
const COMPLEX_SLUG = 'auth-order-complex';
const OPERATOR_ID = '97500000-0000-4000-8000-000000000005';
const OPERATOR_SUBJECT = 'auth-order-operator';
const OUTSIDER_ID = '97500000-0000-4000-8000-000000000006';
const OUTSIDER_SUBJECT = 'auth-order-outsider';
const APPLICANT_ID = '97500000-0000-4000-8000-000000000007';
const BUSINESS_ID = '97500000-0000-4000-8000-000000000008';

const POST_ID = '97500000-0000-4000-8000-000000000001';
const BENEFIT_ID = '97500000-0000-4000-8000-000000000002';
const APPLICATION_ID = '97500000-0000-4000-8000-000000000003';

const UNKNOWN_POST_ID = '97500000-0000-4000-8000-0000000000a1';
const UNKNOWN_BENEFIT_ID = '97500000-0000-4000-8000-0000000000a2';
const UNKNOWN_APPLICATION_ID = '97500000-0000-4000-8000-0000000000a3';

// Malformed ids that still satisfy the route pattern ([0-9a-fA-F-]+) and would
// therefore reach a ::uuid cast without the #975 guard.
const MALFORMED_ROUTABLE = [
  '-',
  'abc-def',
  '97500000-0000-4000-8000-0000000000',
  '97500000-0000-4000-8000-0000-0000-00001',
  '97500000-0000-0000-8000-000000000001',
  '97500000-0000-4000-c000-000000000001'
];

// Malformed ids that do not even match the route pattern. They must fall
// through with no SQL at all (never a 500, never a DB round trip).
const MALFORMED_NON_ROUTABLE = [
  'not-a-uuid',
  'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
  'random_string_here'
];

const RESOURCE_KINDS = new Set(['resource:post', 'resource:benefit', 'resource:application', 'resource:application-context']);

function normalize(strings) {
  return strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Resource markers are matched before the actor marker on purpose: the
// review-context read joins app_users and must not be mistaken for Stage 1.
function classify(text) {
  if (text.includes('as padiem_eligible')) return 'eligibility';
  if (text.includes('left join lateral') && text.includes('from padiem_operator_grants')) return 'authority';
  if (text.startsWith('insert into audit_events')) return 'audit';
  if (text.includes('from business_application_photos')) return 'gallery';
  if (text.includes('from business_application_documents')) return 'documents';
  if (text.includes('from complex_posts')) return 'resource:post';
  if (text.includes('from benefits')) return 'resource:benefit';
  if (text.includes('from business_applications')) return 'resource:application-context';
  if (text.includes('update complex_posts')) return 'write:post';
  if (text.includes('update benefits')) return 'write:benefit';
  if (text.includes('update business_applications')) return 'write:application';
  if (text.includes('from app_users') && text.includes('where auth_user_id =')) return 'actor';
  return 'other';
}

function makeHarness({ grants = 'none', exists = false, row = null, written = null } = {}) {
  const queries = [];
  const sql = async (strings, ...params) => {
    const text = normalize(strings);
    const kind = classify(text);
    queries.push({ text, kind, params });

    switch (kind) {
      case 'actor': {
        const subject = String(params[0]);
        const id = subject === OPERATOR_SUBJECT ? OPERATOR_ID : subject === OUTSIDER_SUBJECT ? OUTSIDER_ID : null;
        return id ? [{ id, auth_user_id: subject, display_name: 'Auth Order', account_status: 'active' }] : [];
      }
      case 'eligibility': {
        const scopeBound = text.includes('g.scope =') && text.includes("or g.scope = '*'");
        return [{
          // The pre-CENTRAL implementation asked only whether ANY PADIEM grant
          // existed. Keep that distinction observable so a wrong-scope grant
          // would reproduce the oracle unless source binds requestedScope.
          padiem_eligible:
            grants === 'padiem' ||
            grants === 'padiem_wildcard' ||
            (grants === 'padiem_wrong_scope' && !scopeBound),
          // Kept in the harness so the old "any council grant" implementation
          // would also reproduce the cross-complex absence oracle.
          council_eligible: grants === 'council' || grants === 'council_other_complex'
        }];
      }
      case 'authority':
        return [{
          complex_id: COMPLEX_ID,
          complex_slug: COMPLEX_SLUG,
          padiem_grant_id: grants === 'padiem' || grants === 'padiem_wildcard' ? 'grant-padiem' : null,
          padiem_granted_scope: grants === 'padiem_wildcard' ? '*' : grants === 'padiem' ? String(params[1]) : null,
          council_grant_id: grants === 'council' ? 'grant-council' : null,
          council_granted_scope: grants === 'council' ? String(params[3]) : null
        }];
      case 'audit': return [];
      case 'gallery': return [];
      case 'documents': return [];
      case 'resource:post':
      case 'resource:benefit':
      case 'resource:application-context':
        return exists && row ? [row] : [];
      case 'write:post':
      case 'write:benefit':
      case 'write:application':
        return written ? [written] : [];
      default:
        throw new Error(`Unexpected SQL: ${text}`);
    }
  };
  return { sql, queries };
}

function resourceCount(queries) {
  return queries.filter((entry) => RESOURCE_KINDS.has(entry.kind)).length;
}

function operationalRequest(method, url, subject, body) {
  const headers = { 'content-type': 'application/json' };
  if (subject) headers['x-danjion-dev-auth-user'] = subject;
  return body === undefined
    ? new Request(url, { method, headers })
    : new Request(url, { method, headers, body: JSON.stringify(body) });
}

async function run({ id, subject = null, grants = 'none', exists = false, target }) {
  const harness = makeHarness({ grants, exists, row: target.existingRow, written: target.writtenRow });
  globalThis.__DANJION_TEST_SQL__ = harness.sql;
  try {
    const request = operationalRequest(target.method, target.url(id), subject, target.body);
    const response = await target.run(request);
    const body = response === null ? null : await response.clone().json();
    return { response, body, queries: harness.queries };
  } finally {
    delete globalThis.__DANJION_TEST_SQL__;
  }
}

const REVIEW_CONTEXT_ROW = {
  id: APPLICATION_ID,
  complex_id: COMPLEX_ID,
  complex_slug: COMPLEX_SLUG,
  status: 'pending',
  approved_business_id: null,
  business_name: '인증 대상 카페',
  category_name: '카페',
  service_summary: '요약',
  price_text: '가격',
  service_area: '단지 내',
  availability_text: '상시',
  benefit_text: '혜택',
  representative_image_object_key: null,
  relation_type: 'resident',
  relation_raw: 'resident',
  resolved_relation_type: 'resident',
  applicant_name: '신청자',
  membership_verification_status: 'verified',
  verification_evidence_count: 1
};

const TARGETS = [
  {
    key: 'POST',
    label: 'PATCH POST',
    method: 'PATCH',
    url: (id) => `https://api.example.test/api/v1/admin/posts/${id}`,
    body: { title: '변경된 제목' },
    run: (request) => handleAdminOperationalRequest(request, ENV, REQUEST_ID),
    focusedScope: 'official-content.manage',
    existingId: POST_ID,
    unknownId: UNKNOWN_POST_ID,
    existingRow: {
      id: POST_ID,
      complex_id: COMPLEX_ID,
      complex_slug: COMPLEX_SLUG,
      source_name: '관리사무소',
      category: '공지',
      title: '기존 제목',
      body: '기존 본문',
      attachment_object_key: null,
      status: 'published',
      display_mode: 'highlight'
    },
    writtenRow: {
      id: POST_ID,
      source_name: '관리사무소',
      category: '공지',
      title: '변경된 제목',
      body: '기존 본문',
      status: 'published',
      published_at: null,
      updated_at: '2026-09-24T00:00:00.000Z',
      channel: 'management_office',
      display_mode: 'highlight'
    },
    writeKind: 'write:post',
    notFoundCode: 'NOT_FOUND',
    notFoundMessage: 'Post not found',
    authorizedStatus: 200
  },
  {
    key: 'BENEFIT',
    label: 'PATCH BENEFIT',
    method: 'PATCH',
    url: (id) => `https://api.example.test/api/v1/admin/benefits/${id}`,
    body: { title: '변경된 혜택' },
    run: (request) => handleAdminOperationalRequest(request, ENV, REQUEST_ID),
    focusedScope: 'benefit.manage',
    existingId: BENEFIT_ID,
    unknownId: UNKNOWN_BENEFIT_ID,
    existingRow: {
      id: BENEFIT_ID,
      complex_id: COMPLEX_ID,
      complex_slug: COMPLEX_SLUG,
      business_id: BUSINESS_ID,
      title: '기존 혜택',
      description: '',
      conditions: null,
      starts_at: null,
      ends_at: null,
      status: 'active'
    },
    writtenRow: {
      id: BENEFIT_ID,
      business_id: BUSINESS_ID,
      title: '변경된 혜택',
      description: '',
      conditions: null,
      starts_at: null,
      ends_at: null,
      status: 'active',
      updated_at: '2026-09-24T00:00:00.000Z'
    },
    writeKind: 'write:benefit',
    notFoundCode: 'NOT_FOUND',
    notFoundMessage: 'Benefit not found',
    authorizedStatus: 200
  },
  {
    key: 'APPLICATION',
    label: 'PATCH BUSINESS APPLICATION',
    method: 'PATCH',
    url: (id) => `https://api.example.test/api/v1/admin/business-applications/${id}`,
    body: { status: 'changes_requested' },
    run: (request) => handleAdminOperationalRequest(request, ENV, REQUEST_ID),
    focusedScope: 'business.review',
    existingId: APPLICATION_ID,
    unknownId: UNKNOWN_APPLICATION_ID,
    existingRow: {
      id: APPLICATION_ID,
      status: 'pending',
      approved_business_id: null,
      applicant_user_id: APPLICANT_ID,
      representative_image_object_key: null,
      category_name: '카페',
      complex_slug: COMPLEX_SLUG,
      relation_type: 'resident',
      relation_raw: 'resident',
      resolved_relation_type: 'resident'
    },
    writtenRow: {
      id: APPLICATION_ID,
      status: 'changes_requested',
      review_note: null,
      reviewed_at: '2026-09-24T00:00:00.000Z'
    },
    writeKind: 'write:application',
    notFoundCode: 'NOT_FOUND',
    notFoundMessage: 'Business application not found',
    authorizedStatus: 200
  },
  {
    key: 'APPLICATION_CONTEXT',
    label: 'REVIEW CONTEXT',
    method: 'GET',
    url: (id) => `https://api.example.test/api/v1/admin/business-applications/${id}/review-context`,
    body: undefined,
    run: (request) => handleAdminReviewContextRequest(request, ENV, REQUEST_ID),
    focusedScope: 'business.review',
    existingId: APPLICATION_ID,
    unknownId: UNKNOWN_APPLICATION_ID,
    existingRow: REVIEW_CONTEXT_ROW,
    writtenRow: null,
    writeKind: null,
    notFoundCode: 'NOT_FOUND',
    notFoundMessage: 'Business application not found',
    authorizedStatus: 200
  }
];

function identity(result) {
  assert.ok(result.response, 'expected a Response');
  return {
    status: result.response.status,
    code: result.body?.error?.code ?? null,
    message: result.body?.error?.message ?? null
  };
}

const matrix = {};
const observed = [];

for (const target of TARGETS) {
  const k = target.key;

  // --- SIGNED_OUT_EXISTING / SIGNED_OUT_UNKNOWN ---------------------------
  const signedOutExisting = await run({ id: target.existingId, subject: null, exists: true, target });
  const signedOutUnknown = await run({ id: target.unknownId, subject: null, exists: false, target });
  for (const [label, scenario] of [['EXISTING', signedOutExisting], ['UNKNOWN', signedOutUnknown]]) {
    assert.equal(scenario.response.status, 401, `SIGNED_OUT_${label} ${k} must be 401 AUTH_REQUIRED`);
    assert.equal(scenario.body.error.code, 'AUTH_REQUIRED', `SIGNED_OUT_${label} ${k} error code`);
    assert.equal(scenario.queries.length, 0, `SIGNED_OUT_${label} ${k} must issue no SQL at all`);
    assert.equal(resourceCount(scenario.queries), 0, `SIGNED_OUT_${label} ${k} must issue no resource query`);
  }
  assert.deepEqual(identity(signedOutExisting), identity(signedOutUnknown),
    `SIGNED_OUT ${k} existing and unknown must be indistinguishable`);
  matrix[`SIGNED_OUT_EXISTING_${k}`] = '401';
  matrix[`SIGNED_OUT_UNKNOWN_${k}`] = '401';
  matrix.SIGNED_OUT_RESOURCE_QUERY_COUNT = 0;

  // --- UNAUTHORIZED_EXISTING / UNAUTHORIZED_UNKNOWN -----------------------
  const unauthorizedExisting = await run({ id: target.existingId, subject: OUTSIDER_SUBJECT, grants: 'none', exists: true, target });
  const unauthorizedUnknown = await run({ id: target.unknownId, subject: OUTSIDER_SUBJECT, grants: 'none', exists: false, target });
  for (const [label, scenario] of [['EXISTING', unauthorizedExisting], ['UNKNOWN', unauthorizedUnknown]]) {
    assert.equal(scenario.response.status, 403, `UNAUTHORIZED_${label} ${k} must be 403`);
    assert.equal(scenario.body.error.code, 'OPERATIONAL_FORBIDDEN', `UNAUTHORIZED_${label} ${k} error code`);
    assert.equal(scenario.queries.filter((e) => e.kind.startsWith('write:')).length, 0,
      `UNAUTHORIZED_${label} ${k} must never reach a write`);
  }
  assert.deepEqual(identity(unauthorizedExisting), identity(unauthorizedUnknown),
    `UNAUTHORIZED ${k} existing and unknown must be the same policy class (no existence oracle)`);
  // Bounded proof: the two-stage design lets an ungranted-but-authenticated
  // caller reach exactly one bounded lookup (Stage 2) and no write, and the
  // count is identical for existing and unknown ids.
  assert.equal(resourceCount(unauthorizedExisting.queries), 1,
    `UNAUTHORIZED_EXISTING ${k} must stay bounded to a single resource lookup`);
  assert.equal(resourceCount(unauthorizedUnknown.queries), 1,
    `UNAUTHORIZED_UNKNOWN ${k} must stay bounded to a single resource lookup`);
  assert.equal(unauthorizedExisting.queries.filter((e) => e.kind === 'eligibility').length, 0,
    `UNAUTHORIZED_EXISTING ${k} must reject at the exact Stage 3 authority, not the absence probe`);
  matrix[`UNAUTHORIZED_EXISTING_${k}`] = '403_OPERATIONAL_FORBIDDEN';
  matrix[`UNAUTHORIZED_UNKNOWN_${k}`] = '403_OPERATIONAL_FORBIDDEN_SAME_POLICY_CLASS';
  matrix[`UNAUTHORIZED_${k}_ORACLE`] = 'NONE';

  // --- PARTIAL AUTHORITY MUST NOT REOPEN THE ORACLE -----------------------
  // A PADIEM operator holding some other scope must see the same 403 for an
  // existing and unknown id. The pre-CENTRAL helper incorrectly treated any
  // PADIEM grant as enough to disclose a resource-specific 404 for unknown ids.
  const wrongScopeExisting = await run({
    id: target.existingId, subject: OPERATOR_SUBJECT, grants: 'padiem_wrong_scope', exists: true, target
  });
  const wrongScopeUnknown = await run({
    id: target.unknownId, subject: OPERATOR_SUBJECT, grants: 'padiem_wrong_scope', exists: false, target
  });
  assert.equal(wrongScopeExisting.response.status, 403, `WRONG_SCOPE_EXISTING ${k} must be 403`);
  assert.equal(wrongScopeUnknown.response.status, 403, `WRONG_SCOPE_UNKNOWN ${k} must be 403`);
  assert.deepEqual(identity(wrongScopeExisting), identity(wrongScopeUnknown),
    `WRONG_SCOPE PADIEM ${k} existing/unknown must not reveal existence`);

  // Council authority is exact-complex scoped. With no row there is no complex
  // to prove, so unknown ids must fail closed rather than treating "any council
  // grant" as permission to receive a resource-specific 404.
  const otherComplexCouncilExisting = await run({
    id: target.existingId, subject: OPERATOR_SUBJECT, grants: 'council_other_complex', exists: true, target
  });
  const otherComplexCouncilUnknown = await run({
    id: target.unknownId, subject: OPERATOR_SUBJECT, grants: 'council_other_complex', exists: false, target
  });
  assert.equal(otherComplexCouncilExisting.response.status, 403,
    `OTHER_COMPLEX_COUNCIL_EXISTING ${k} must be 403`);
  assert.equal(otherComplexCouncilUnknown.response.status, 403,
    `OTHER_COMPLEX_COUNCIL_UNKNOWN ${k} must be 403`);
  assert.deepEqual(identity(otherComplexCouncilExisting), identity(otherComplexCouncilUnknown),
    `OTHER_COMPLEX_COUNCIL ${k} existing/unknown must not reveal existence`);

  const councilUnknown = await run({
    id: target.unknownId, subject: OPERATOR_SUBJECT, grants: 'council', exists: false, target
  });
  assert.equal(councilUnknown.response.status, 403,
    `COUNCIL_UNKNOWN ${k} must fail closed because no owning complex exists`);
  assert.equal(councilUnknown.body.error.code, 'OPERATIONAL_FORBIDDEN',
    `COUNCIL_UNKNOWN ${k} must use the canonical policy denial`);

  // --- AUTHORIZED_UNKNOWN / AUTHORIZED_EXISTING ---------------------------
  const authorizedUnknown = await run({
    id: target.unknownId, subject: OPERATOR_SUBJECT, grants: 'padiem', exists: false, target
  });
  assert.equal(authorizedUnknown.response.status, 404, `AUTHORIZED_UNKNOWN ${k} must be 404`);
  assert.equal(authorizedUnknown.body.error.code, target.notFoundCode, `AUTHORIZED_UNKNOWN ${k} code`);
  assert.equal(authorizedUnknown.body.error.message, target.notFoundMessage, `AUTHORIZED_UNKNOWN ${k} message`);
  assert.equal(authorizedUnknown.queries.filter((e) => e.kind.startsWith('write:')).length, 0,
    `AUTHORIZED_UNKNOWN ${k} must not write`);

  const authorizedExisting = await run({
    id: target.existingId, subject: OPERATOR_SUBJECT, grants: 'padiem', exists: true, target
  });
  assert.equal(authorizedExisting.response.status, target.authorizedStatus,
    `AUTHORIZED_EXISTING ${k} must keep the existing behavior`);
  if (target.writeKind) {
    assert.equal(authorizedExisting.queries.filter((e) => e.kind === target.writeKind).length, 1,
      `AUTHORIZED_EXISTING ${k} must perform exactly one ${target.writeKind}`);
    assert.ok(authorizedExisting.body?.data, `AUTHORIZED_EXISTING ${k} must return the canonical data envelope`);
  } else {
    assert.equal(authorizedExisting.queries.filter((e) => e.kind.startsWith('write:')).length, 0,
      `AUTHORIZED_EXISTING ${k} must stay a read`);
    assert.equal(authorizedExisting.body?.data?.publicProfile?.businessName, '인증 대상 카페',
      'review context must keep the existing payload shape');
    assert.equal(authorizedExisting.body?.data?.reviewBasis?.applicantDisplayName, '신청자',
      'review context must keep the existing review basis shape');
    assert.deepEqual(authorizedExisting.body?.data?.photoObjectKeys, [], 'review context keeps the gallery list');
  }
  matrix[`AUTHORIZED_UNKNOWN_${k}`] = '404';
  matrix[`AUTHORIZED_EXISTING_${k}`] = 'EXISTING_BEHAVIOR';

  // Stage order proof: the actor boundary is the first SQL of the request and it
  // precedes the very first resource read.
  const firstResourceIdx = authorizedExisting.queries.findIndex((e) => RESOURCE_KINDS.has(e.kind));
  const actorIdx = authorizedExisting.queries.findIndex((e) => e.kind === 'actor');
  assert.ok(actorIdx >= 0, `${k}: Stage 1 must resolve the actor through SQL`);
  assert.ok(firstResourceIdx >= 0, `${k}: Stage 2 must perform a bounded resource lookup`);
  assert.ok(actorIdx < firstResourceIdx,
    `${k}: Stage 1 actor boundary must run before the Stage 2 resource lookup`);
  assert.equal(authorizedExisting.queries.slice(0, firstResourceIdx).filter((e) => RESOURCE_KINDS.has(e.kind)).length, 0,
    `${k}: no resource read may precede the actor boundary`);

  // --- MALFORMED IDS ------------------------------------------------------
  for (const malformed of MALFORMED_ROUTABLE) {
    const signedOut = await run({ id: malformed, subject: null, exists: false, target });
    assert.equal(signedOut.response.status, 401, `${k} malformed "${malformed}" signed out must be 401`);
    assert.equal(signedOut.queries.length, 0, `${k} malformed "${malformed}" signed out must issue no SQL`);

    const authorized = await run({ id: malformed, subject: OPERATOR_SUBJECT, grants: 'padiem', exists: false, target });
    assert.equal(authorized.response.status, 404, `${k} malformed "${malformed}" authorized must be 4XX (404)`);
    assert.equal(authorized.body.error.code, 'NOT_FOUND', `${k} malformed "${malformed}" code`);
    assert.equal(resourceCount(authorized.queries), 0, `${k} malformed "${malformed}" must issue no resource query`);
    assert.equal(authorized.queries.filter((e) => e.kind.startsWith('write:')).length, 0,
      `${k} malformed "${malformed}" must never write`);

    const unauthorized = await run({ id: malformed, subject: OUTSIDER_SUBJECT, grants: 'none', exists: false, target });
    assert.equal(unauthorized.response.status, 403, `${k} malformed "${malformed}" unauthorized must be 403 (same class)`);

    for (const scenario of [signedOut, authorized, unauthorized]) {
      for (const entry of scenario.queries) {
        assert.ok(!entry.params.includes(malformed),
          `${k} malformed "${malformed}" must never reach a ::uuid cast`);
      }
    }
    matrix.INVALID_UUID_DB_QUERY = 0;
  }

  for (const malformed of MALFORMED_NON_ROUTABLE) {
    const signedOut = await run({ id: malformed, subject: null, exists: false, target });
    assert.equal(signedOut.response, null, `${k} non-routable "${malformed}" must fall through, not 500`);
    assert.equal(signedOut.queries.length, 0, `${k} non-routable "${malformed}" must issue no SQL`);

    const authorized = await run({ id: malformed, subject: OPERATOR_SUBJECT, grants: 'padiem', exists: false, target });
    assert.equal(authorized.response, null, `${k} non-routable "${malformed}" authorized must fall through`);
    assert.equal(authorized.queries.length, 0, `${k} non-routable "${malformed}" must issue no SQL`);
  }

  // --- COUNCIL-SCOPED AUTHORITY still passes Stage 3 ----------------------
  const councilAuthorized = await run({
    id: target.existingId, subject: OPERATOR_SUBJECT, grants: 'council', exists: true, target
  });
  assert.equal(councilAuthorized.response.status, target.authorizedStatus,
    `${k}: a resident-council grant must remain a valid Stage 3 authority`);
  assert.equal(councilAuthorized.queries.filter((e) => e.kind === 'eligibility').length, 0,
    `${k}: an existing resource must not need the absent-resource eligibility probe`);

  observed.push(`${target.label} ok`);
}

// ---------------------------------------------------------------------------
// Structural ordering guard: the source must keep Stage 1 in front of the read.
// ---------------------------------------------------------------------------
const source = await readFile(fileURLToPath(new URL('../src/admin-operational-v2.ts', import.meta.url)), 'utf8');
const reviewSource = await readFile(fileURLToPath(new URL('../src/admin-review-context-v1.ts', import.meta.url)), 'utf8');
const authzSource = await readFile(fileURLToPath(new URL('../src/operational-authz-v2.ts', import.meta.url)), 'utf8');

for (const [name, end] of [
  ['async function patchPost(', 'async function createBenefit('],
  ['async function patchBenefit(', '/**'],
  ['async function patchApplication(', 'async function createPost(']
]) {
  const start = source.indexOf(name);
  const stop = source.indexOf(end, start);
  assert.ok(start >= 0 && stop > start, `${name} must be discoverable`);
  const block = source.slice(start, stop);
  const actorBoundary = block.indexOf('await requireActor(request, env, sql, requestId)');
  const lookup = block.indexOf('::uuid');
  assert.ok(actorBoundary >= 0, `${name} must establish the Stage 1 actor boundary`);
  assert.ok(lookup > actorBoundary, `${name}: the resource lookup must run after the actor boundary`);
  assert.ok(block.indexOf('UUID.test(') > actorBoundary, `${name}: the id guard must run after the actor boundary`);
}

const reviewActor = reviewSource.indexOf('await requireActor(request, env, sql, requestId)');
const reviewLookup = reviewSource.indexOf('where a.id = ${applicationId}::uuid');
assert.ok(reviewActor >= 0 && reviewLookup > reviewActor,
  'review context must authenticate before the application/review-context read');
assert.ok(reviewSource.indexOf('UUID.test(applicationId)') > reviewActor,
  'review context must guard the id after the actor boundary');

// The boundary helper is additive only: it must never replace the exact authority.
assert.match(authzSource, /export async function operationalPrincipalDenial/,
  'the #975 boundary must live in the canonical operational AuthZ module');
const absenceBoundaryStart = authzSource.indexOf('export async function operationalPrincipalDenial');
const exactAuthorityStart = authzSource.indexOf('export async function requireOperationalAuthority', absenceBoundaryStart);
const absenceBoundary = authzSource.slice(absenceBoundaryStart, exactAuthorityStart);
assert.match(absenceBoundary, /g\.scope = \$\{requestedScope\}/,
  'absence disclosure must require the requested PADIEM operation scope');
assert.match(absenceBoundary, /g\.scope = '\*'/,
  'absence disclosure must preserve the canonical PADIEM wildcard');
assert.doesNotMatch(absenceBoundary, /council_eligible|from complex_operator_grants/,
  'complex-scoped council authority cannot authorize an absent resource without an owning complex');
assert.match(authzSource, /operator_kind = 'resident_council'/, 'council eligibility keeps the canonical operator kind');
assert.doesNotMatch(authzSource, /x-danjion-role|x-danjion-verified|x-danjion-complex/i,
  'client headers must never grant the #975 boundary');
for (const block of [source, reviewSource]) {
  assert.match(block, /requireOperationalAuthority/, 'the exact complex-scoped authority must remain the Stage 3 gate');
}

console.log('admin-auth-before-resource-lookup-975.test: PASS');
console.log(`ROUTES=${TARGETS.length}`);
for (const target of TARGETS) console.log(`ROUTE_OK=${target.label}`);
console.log(`SIGNED_OUT_EXISTING=401`);
console.log(`SIGNED_OUT_UNKNOWN=401`);
console.log(`UNAUTHORIZED_EXISTING=403_SAME_CLASS`);
console.log(`UNAUTHORIZED_UNKNOWN=403_SAME_CLASS`);
console.log(`AUTHORIZED_UNKNOWN=404`);
console.log(`AUTHORIZED_EXISTING=EXISTING_BEHAVIOR`);
console.log(`SIGNED_OUT_RESOURCE_QUERY_COUNT=0`);
console.log(`RESOURCE_QUERY_BEFORE_ACTOR=0`);
console.log(`INVALID_UUID_DB_QUERY=0`);
console.log(`PG_UUID_CAST_ERROR=NO`);
console.log(`MALFORMED_ID=4XX_NOT_500`);
console.log(`COUNCIL_SCOPED_AUTHORITY=PRESERVED`);
console.log(`WRONG_SCOPE_PADIEM_ORACLE=NONE`);
console.log(`OTHER_COMPLEX_COUNCIL_ORACLE=NONE`);
console.log(`COUNCIL_UNKNOWN=403_CONTEXT_REQUIRED`);
