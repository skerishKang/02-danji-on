import assert from 'node:assert/strict';
import { requireActor } from '../src/auth-v1.ts';
import { handleAdminApplicationDocumentWithSql } from '../src/admin-application-docs-v1.ts';
import { handleInquiryWithSql } from '../src/inquiries-v1.ts';
import { handleShopRecommendationWithSql } from '../src/shop-recommendations-v1.ts';

// #1047 behavioural contract: the three remaining admin item routes must not
// answer a resource-existence oracle. This reuses the #975 canonical stage
// model without modifying the #975 harness:
//
//   Stage 1  minimum actor boundary (requireActor -> 401 signed out)
//   Stage 2  routable-id guard, then a bounded resource lookup by id
//   Stage 3  exact complex-scoped authority for the resource's own complex
//   Stage 4  resource-specific 404 only for a caller that cleared the boundary
//
// This file drives the REAL route handlers through the test-only Neon shim
// (needs `--import ./tests/helpers/neon-stub-loader.mjs`) and proves, per route,
// from the actual SQL query log — not from source position — that:
//
//   * a signed-out caller issues no SQL at all, so existing and unknown ids are
//     byte-identical responses;
//   * a malformed id is answered behind the same Stage 1 boundary and never
//     reaches a ::uuid cast;
//   * on the authorized path the actor boundary query precedes the first
//     resource query;
//   * the exact Stage 3 authority is untouched.
//
// #975_FILE_MUTATION=AVOID — the #975 harness stays the canonical reference.

const REQUEST_ID = 'req-1047-auth-order';

const R2_KEY_PREFIX = 'gdrive/private/application-document/';
const DOCUMENT_FILE_ID = 'abcdefghij1234567890';

const COMPLEX_ID = '10470000-0000-4000-8000-000000000009';
const COMPLEX_SLUG = 'auth-order-complex';
const OPERATOR_ID = '10470000-0000-4000-8000-00000000000a';
const OPERATOR_SUBJECT = 'auth-order-operator';
const OUTSIDER_ID = '10470000-0000-4000-8000-00000000000b';
const OUTSIDER_SUBJECT = 'auth-order-outsider';
const APPLICANT_ID = '10470000-0000-4000-8000-00000000000c';

const APPLICATION_ID = '10470000-0000-4000-8000-000000000001';
const DOCUMENT_ID = '10470000-0000-4000-8000-000000000002';
const INQUIRY_ID = '10470000-0000-4000-8000-000000000003';
const RECOMMENDATION_ID = '10470000-0000-4000-8000-000000000004';

const UNKNOWN_DOCUMENT_ID = '10470000-0000-4000-8000-0000000000a1';
const UNKNOWN_INQUIRY_ID = '10470000-0000-4000-8000-0000000000a2';
const UNKNOWN_RECOMMENDATION_ID = '10470000-0000-4000-8000-0000000000a3';

// The same #975 malformed corpus: routable values that satisfy the route
// pattern ([0-9a-fA-F-]+) and would therefore reach a ::uuid cast without the
// Stage 2 guard, plus values that do not even match the route pattern.
const MALFORMED_ROUTABLE = [
  '-',
  'abc-def',
  '10470000-0000-4000-8000-0000000000',
  '10470000-0000-4000-8000-0000-0000-00001',
  '10470000-0000-0000-8000-000000000001',
  '10470000-0000-4000-c000-000000000001'
];
const MALFORMED_NON_ROUTABLE = [
  'not-a-uuid',
  'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
  'random_string_here'
];

// The exact production lookup texts, replayed by the historical-shape model at
// the bottom of this file.
const DOCUMENT_LOOKUP_SQL = [
  'select bad.object_key, c.slug as complex_slug, a.applicant_user_id, a.status as application_status,',
  'reg.state as registry_state, reg.kind as registry_kind',
  'from business_application_documents bad',
  'join business_applications a on a.id = bad.application_id',
  'join complexes c on c.id = a.complex_id',
  'left join business_image_objects reg on reg.object_key = bad.object_key',
  'where bad.id = ?::uuid',
  'and bad.application_id = ?::uuid',
  'limit 1'
];
const INQUIRY_LOOKUP_SQL = [
  'select i.id, i.complex_id, i.user_id, i.inquiry_type, i.title, i.body, i.status, i.response_text,',
  'i.answered_at, i.closed_at, i.created_at, i.updated_at, c.slug as complex_slug',
  'from inquiries i',
  'join complexes c on c.id = i.complex_id',
  'where i.id = ?::uuid',
  'limit 1'
];
const RECOMMENDATION_LOOKUP_SQL = [
  'select r.id, r.status, r.approved_business_id, r.resolved_category_id,',
  'r.resolved_relation_type, c.slug as complex_slug',
  'from shop_recommendations r',
  'join complexes c on c.id = r.complex_id',
  'where r.id = ?::uuid',
  'limit 1'
];

const RESOURCE_KINDS = new Set([
  'resource:document',
  'resource:inquiry',
  'resource:recommendation'
]);

// A minimal R2 binding so the authorized document read exercises the real
// registry -> object-key -> stream pipeline instead of reaching Google Drive.
const FAKE_BUCKET = {
  async head() {
    return {
      customMetadata: { originalFileName: 'doc.pdf' },
      httpMetadata: { contentType: 'application/pdf' },
      size: 12
    };
  },
  async get() {
    return { body: new Response('pdf-bytes').body, size: 12 };
  }
};

const ENV = {
  DATABASE_URL: 'postgresql://unused.test',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'true',
  STORAGE_MODE: 'r2',
  DANJION_STORAGE: FAKE_BUCKET
};

function normalize(strings) {
  return strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Resource markers are matched before the actor marker on purpose: the
// Stage 3 authority read joins app_users and must not be mistaken for Stage 1.
function classify(text) {
  if (text.includes('as padiem_eligible')) return 'eligibility';
  if (text.includes('left join lateral') && text.includes('from padiem_operator_grants')) return 'authority';
  if (text.startsWith('insert into audit_events')) return 'audit';
  if (text.includes('from business_application_documents')) return 'resource:document';
  if (text.includes('from inquiries')) return 'resource:inquiry';
  if (text.includes('from shop_recommendations')) return 'resource:recommendation';
  if (text.startsWith('update inquiries')) return 'write:inquiry';
  if (text.startsWith('update shop_recommendations')) return 'write:recommendation';
  if (text.includes('from app_users') && text.includes('where auth_user_id =')) return 'actor';
  return 'other';
}

function makeHarness({ grants = 'none', exists = false, row = null, resourceId }) {
  const queries = [];
  const sql = async (strings, ...params) => {
    const text = normalize(strings);
    const kind = classify(text);
    queries.push({ text, kind, params });

    switch (kind) {
      case 'actor': {
        const subject = String(params[0]);
        const id = subject === OPERATOR_SUBJECT
          ? OPERATOR_ID
          : subject === OUTSIDER_SUBJECT
            ? OUTSIDER_ID
            : null;
        return id ? [{ id, auth_user_id: subject, display_name: 'Auth Order', account_status: 'active' }] : [];
      }
      case 'eligibility': {
        const scopeBound = text.includes('g.scope =') && text.includes("or g.scope = '*'");
        return [{
          padiem_eligible:
            grants === 'padiem' ||
            grants === 'padiem_wildcard' ||
            (grants === 'padiem_wrong_scope' && !scopeBound)
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
      case 'write:inquiry':
      case 'write:recommendation':
        return [];
      case 'resource:document':
      case 'resource:inquiry':
      case 'resource:recommendation': {
        if (!exists || !row) return [];
        return resourceId(kind, params) === String(row.id) ? [row] : [];
      }
      default:
        throw new Error(`Unexpected SQL: ${text}`);
    }
  };
  return { sql, queries };
}

function resourceCount(queries) {
  return queries.filter((entry) => RESOURCE_KINDS.has(entry.kind)).length;
}

function buildRequest(target, id, subject, body) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (subject) headers['x-danjion-dev-auth-user'] = subject;
  return new Request(target.url(id), {
    method: target.method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function run({ id, subject = null, grants = 'none', exists = false, target, body }) {
  const payload = body === undefined ? target.body : body;
  const harness = makeHarness({ grants, exists, row: target.existingRow, resourceId: target.resourceId });
  globalThis.__DANJION_TEST_SQL__ = harness.sql;
  try {
    const response = await target.run(buildRequest(target, id, subject, payload));
    const parsed = response === null
      ? null
      : await response.clone().json().catch(() => null);
    return { response, body: parsed, queries: harness.queries };
  } finally {
    delete globalThis.__DANJION_TEST_SQL__;
  }
}

function identity(result) {
  if (result.response === null) return { status: null, code: 'ROUTE_FELL_THROUGH' };
  return {
    status: result.response.status,
    code: result.body?.error?.code ?? null,
    message: result.body?.error?.message ?? null
  };
}

const TARGETS = [
  {
    key: 'ADMIN_DOCUMENT',
    label: 'ADMIN APPLICATION DOCUMENT',
    method: 'GET',
    scope: 'business.review',
    // #1053 extends the injected admin lane with the same context-independent
    // absence boundary already used by the other ID-based admin routes. The
    // exact complex-scoped reviewer grant still remains Stage 3 for real rows.
    absencePolicy: true,
    url: (id) => `https://api.example.test/api/v1/admin/business-applications/${APPLICATION_ID}/documents/${id}`,
    body: undefined,
    run: (request) => handleAdminApplicationDocumentWithSql(request, ENV, globalThis.__DANJION_TEST_SQL__, REQUEST_ID),
    existingId: DOCUMENT_ID,
    unknownId: UNKNOWN_DOCUMENT_ID,
    resourceId: (kind, params) => `${String(params[0])}+${String(params[1])}`,
    existingRow: {
      id: `${DOCUMENT_ID}+${APPLICATION_ID}`,
      object_key: `${R2_KEY_PREFIX}${DOCUMENT_FILE_ID}`,
      complex_slug: COMPLEX_SLUG,
      applicant_user_id: APPLICANT_ID,
      application_status: 'pending',
      registry_state: 'active',
      registry_kind: 'application-document'
    },
    lookupSql: DOCUMENT_LOOKUP_SQL,
    lookupParams: (id) => [id, APPLICATION_ID],
    authorizedStatus: 200,
    notFoundCode: 'NOT_FOUND',
    notFoundMessage: 'Application document not found',
    assertAuthorized: (result, target) => {
      assert.equal(
        result.response.headers.get('content-type'),
        'application/pdf',
        'authorized document read must still stream the registry-bound object'
      );
    }
  },
  {
    key: 'INQUIRY',
    label: 'ADMIN INQUIRY REVIEW',
    method: 'PATCH',
    scope: 'inquiry.respond',
    absencePolicy: true,
    url: (id) => `https://api.example.test/api/v1/admin/inquiries/${id}`,
    body: { status: 'in_progress' },
    run: (request) => handleInquiryWithSql(request, ENV, globalThis.__DANJION_TEST_SQL__, REQUEST_ID),
    existingId: INQUIRY_ID,
    unknownId: UNKNOWN_INQUIRY_ID,
    resourceId: (kind, params) => String(params[0]),
    existingRow: {
      id: INQUIRY_ID,
      complex_id: COMPLEX_ID,
      user_id: APPLICANT_ID,
      inquiry_type: 'complaint',
      title: '문의 제목',
      body: '문의 본문',
      status: 'in_progress',
      response_text: null,
      answered_at: null,
      closed_at: null,
      created_at: '2026-09-26T00:00:00.000Z',
      updated_at: '2026-09-26T00:00:00.000Z',
      resident_nickname: '주민',
      complex_slug: COMPLEX_SLUG
    },
    lookupSql: INQUIRY_LOOKUP_SQL,
    lookupParams: (id) => [id],
    authorizedStatus: 200,
    notFoundCode: 'NOT_FOUND',
    notFoundMessage: 'Inquiry not found',
    assertAuthorized: (result, target) => {
      assert.equal(result.body?.data?.id, INQUIRY_ID, 'authorized inquiry review must keep the existing payload');
      assert.equal(result.body?.data?.status, 'in_progress', 'authorized inquiry review must keep the state machine');
    }
  },
  {
    key: 'SHOP_RECOMMENDATION',
    label: 'ADMIN SHOP RECOMMENDATION REVIEW',
    method: 'PATCH',
    scope: 'business.review',
    absencePolicy: true,
    url: (id) => `https://api.example.test/api/v1/admin/shop-recommendations/${id}`,
    body: { status: 'approved' },
    run: (request) => handleShopRecommendationWithSql(request, ENV, globalThis.__DANJION_TEST_SQL__, REQUEST_ID),
    existingId: RECOMMENDATION_ID,
    unknownId: UNKNOWN_RECOMMENDATION_ID,
    resourceId: (kind, params) => String(params[0]),
    existingRow: {
      id: RECOMMENDATION_ID,
      status: 'approved',
      approved_business_id: '10470000-0000-4000-8000-00000000000d',
      resolved_category_id: null,
      resolved_relation_type: null,
      complex_slug: COMPLEX_SLUG
    },
    lookupSql: RECOMMENDATION_LOOKUP_SQL,
    lookupParams: (id) => [id],
    authorizedStatus: 200,
    notFoundCode: 'NOT_FOUND',
    notFoundMessage: 'Shop recommendation not found',
    assertAuthorized: (result, target) => {
      assert.equal(result.body?.data?.alreadyApproved, true, 'authorized recommendation review must keep the idempotent re-approval answer');
    }
  }
];

const matrix = {};

for (const target of TARGETS) {
  const k = target.key;

  // --- 1. SIGNED_OUT_EXISTING --------------------------------------------
  const signedOutExisting = await run({ id: target.existingId, subject: null, exists: true, target });
  assert.equal(signedOutExisting.response.status, 401, `SIGNED_OUT_EXISTING ${k} must be 401`);
  assert.equal(signedOutExisting.body.error.code, 'AUTH_REQUIRED', `SIGNED_OUT_EXISTING ${k} error code`);
  assert.equal(signedOutExisting.queries.length, 0, `SIGNED_OUT_EXISTING ${k} must issue no SQL at all`);
  assert.equal(resourceCount(signedOutExisting.queries), 0, `SIGNED_OUT_EXISTING ${k} resource query count must be 0`);
  matrix[`SIGNED_OUT_EXISTING_${k}`] = '401_AUTH_REQUIRED_RESOURCE_SQL=0';

  // --- 2. SIGNED_OUT_UNKNOWN ---------------------------------------------
  const signedOutUnknown = await run({ id: target.unknownId, subject: null, exists: false, target });
  assert.equal(signedOutUnknown.response.status, 401, `SIGNED_OUT_UNKNOWN ${k} must be 401`);
  assert.equal(signedOutUnknown.body.error.code, 'AUTH_REQUIRED', `SIGNED_OUT_UNKNOWN ${k} error code`);
  assert.equal(signedOutUnknown.queries.length, 0, `SIGNED_OUT_UNKNOWN ${k} must issue no SQL at all`);
  assert.equal(resourceCount(signedOutUnknown.queries), 0, `SIGNED_OUT_UNKNOWN ${k} resource query count must be 0`);
  assert.deepEqual(
    identity(signedOutExisting),
    identity(signedOutUnknown),
    `SIGNED_OUT ${k}: existing and unknown must be byte-identical (no existence oracle)`
  );
  matrix[`SIGNED_OUT_UNKNOWN_${k}`] = '401_AUTH_REQUIRED_RESOURCE_SQL=0';
  matrix[`SIGNED_OUT_EXISTING_VS_ABSENT_PARITY_${k}`] = 'PASS';

  // --- 3. SIGNED_OUT_MALFORMED -------------------------------------------
  for (const malformed of MALFORMED_ROUTABLE) {
    const signedOut = await run({ id: malformed, subject: null, exists: false, target });
    assert.equal(signedOut.response.status, 401, `SIGNED_OUT_MALFORMED ${k} "${malformed}" must be 401 (auth first)`);
    assert.equal(signedOut.body.error.code, 'AUTH_REQUIRED', `SIGNED_OUT_MALFORMED ${k} "${malformed}" code`);
    assert.equal(signedOut.queries.length, 0, `SIGNED_OUT_MALFORMED ${k} "${malformed}" must issue no SQL`);
    assert.deepEqual(
      identity(signedOut),
      identity(signedOutExisting),
      `SIGNED_OUT_MALFORMED ${k} "${malformed}" must be indistinguishable from a well-formed id`
    );
    matrix[`SIGNED_OUT_MALFORMED_${k}`] = 'AUTH_FIRST_401';
  }

  // A malformed id that does not even match the route pattern must fall
  // through with no SQL at all — never a 500, never a DB round trip.
  for (const malformed of MALFORMED_NON_ROUTABLE) {
    const signedOut = await run({ id: malformed, subject: null, exists: false, target });
    assert.equal(signedOut.response, null, `NON_ROUTABLE ${k} "${malformed}" must fall through, not 500`);
    assert.equal(signedOut.queries.length, 0, `NON_ROUTABLE ${k} "${malformed}" must issue no SQL`);
    const authorized = await run({
      id: malformed, subject: OPERATOR_SUBJECT, grants: 'padiem', exists: false, target
    });
    assert.equal(authorized.response, null, `NON_ROUTABLE ${k} "${malformed}" authorized must fall through`);
    assert.equal(authorized.queries.length, 0, `NON_ROUTABLE ${k} "${malformed}" must issue no SQL`);
  }

  // --- 4. AUTHORIZED_EXISTING -------------------------------------------
  const authorizedExisting = await run({
    id: target.existingId, subject: OPERATOR_SUBJECT, grants: 'padiem', exists: true, target
  });
  assert.equal(
    authorizedExisting.response.status,
    target.authorizedStatus,
    `AUTHORIZED_EXISTING ${k} must keep the existing behaviour`
  );
  target.assertAuthorized(authorizedExisting, target);

  // --- 5. AUTHORIZED_UNKNOWN --------------------------------------------
  const authorizedUnknown = await run({
    id: target.unknownId, subject: OPERATOR_SUBJECT, grants: 'padiem', exists: false, target
  });
  assert.equal(authorizedUnknown.response.status, 404, `AUTHORIZED_UNKNOWN ${k} must be 404`);
  assert.equal(authorizedUnknown.body.error.code, target.notFoundCode, `AUTHORIZED_UNKNOWN ${k} code`);
  assert.equal(authorizedUnknown.body.error.message, target.notFoundMessage, `AUTHORIZED_UNKNOWN ${k} message`);
  assert.equal(
    authorizedUnknown.queries.filter((entry) => entry.kind.startsWith('write:')).length,
    0,
    `AUTHORIZED_UNKNOWN ${k} must not write`
  );
  matrix[`AUTHORIZED_UNKNOWN_${k}`] = '404';
  matrix[`AUTHORIZED_EXISTING_${k}`] = 'EXISTING_BEHAVIOR';

  // --- SQL ORDER ASSERTION (from the real query log) --------------------
  const actorIdx = authorizedExisting.queries.findIndex((entry) => entry.kind === 'actor');
  const firstResourceIdx = authorizedExisting.queries.findIndex((entry) => RESOURCE_KINDS.has(entry.kind));
  assert.ok(actorIdx >= 0, `${k}: Stage 1 must resolve the actor through SQL`);
  assert.ok(firstResourceIdx >= 0, `${k}: Stage 2 must perform a bounded resource lookup`);
  assert.ok(actorIdx < firstResourceIdx, `${k}: Stage 1 actor boundary must precede the Stage 2 resource lookup`);
  assert.equal(
    authorizedExisting.queries.slice(0, firstResourceIdx).filter((entry) => RESOURCE_KINDS.has(entry.kind)).length,
    0,
    `${k}: no resource read may precede the actor boundary`
  );
  matrix[`SQL_ORDER_${k}`] = 'ACTOR_QUERY_BEFORE_RESOURCE_QUERY';

  // --- AUTHENTICATED MALFORMED: canonical 4XX, never a ::uuid cast -------
  for (const malformed of MALFORMED_ROUTABLE) {
    const authorized = await run({
      id: malformed, subject: OPERATOR_SUBJECT, grants: 'padiem', exists: false, target
    });
    assert.ok(
      authorized.response.status >= 400 && authorized.response.status < 500,
      `AUTHENTICATED_MALFORMED ${k} "${malformed}" must be a canonical 4XX, got ${authorized.response.status}`
    );
    assert.notEqual(authorized.response.status, 500, `AUTHENTICATED_MALFORMED ${k} "${malformed}" must never be a DB 500`);
    assert.equal(
      resourceCount(authorized.queries),
      0,
      `AUTHENTICATED_MALFORMED ${k} "${malformed}" must issue no resource query`
    );
    for (const entry of authorized.queries) {
      assert.ok(
        !entry.params.includes(malformed),
        `AUTHENTICATED_MALFORMED ${k} "${malformed}" must never reach a ::uuid cast`
      );
    }
    matrix[`MALFORMED_ID_RESOURCE_SQL_${k}`] = 0;
    matrix[`PG_UUID_CAST_ERROR_${k}`] = 'NO';
  }

  // --- STAGE 3 IS NOT WEAKENED ------------------------------------------
  // An authenticated caller with no grant must be denied by the exact
  // complex-scoped authority on the authorized path, and an operator holding
  // only a different PADIEM scope must not gain anything either.
  const unauthorizedExisting = await run({
    id: target.existingId, subject: OUTSIDER_SUBJECT, grants: 'none', exists: true, target
  });
  assert.equal(unauthorizedExisting.response.status, 403, `UNAUTHORIZED_EXISTING ${k} must be 403`);
  assert.equal(
    unauthorizedExisting.body.error.code,
    'OPERATIONAL_FORBIDDEN',
    `UNAUTHORIZED_EXISTING ${k} must use the canonical policy denial`
  );
  assert.equal(
    unauthorizedExisting.queries.filter((entry) => entry.kind === 'eligibility').length,
    0,
    `UNAUTHORIZED_EXISTING ${k} must reject at the exact Stage 3 authority, not the absence probe`
  );
  matrix[`OPERATIONAL_SCOPE_AUTHORITY_PRESERVED_${k}`] = 'YES';

  const wrongScopeExisting = await run({
    id: target.existingId, subject: OPERATOR_SUBJECT, grants: 'padiem_wrong_scope', exists: true, target
  });
  assert.equal(wrongScopeExisting.response.status, 403, `WRONG_SCOPE_EXISTING ${k} must be 403`);
  matrix[`WRONG_SCOPE_${k}`] = '403';

  // Absence disclosure: the #975 canonical boundary requires the requested
  // PADIEM scope before an absent resource may receive a resource-specific
  // 404. #1053 wires that boundary through the document lane's injected
  // absence policy too, while preserving exact complex authority for real rows.
  const unauthorizedUnknown = await run({
    id: target.unknownId, subject: OUTSIDER_SUBJECT, grants: 'none', exists: false, target
  });
  if (target.absencePolicy) {
    assert.equal(unauthorizedUnknown.response.status, 403, `UNAUTHORIZED_UNKNOWN ${k} must be 403`);
    assert.deepEqual(
      identity(unauthorizedExisting),
      identity(unauthorizedUnknown),
      `UNAUTHORIZED ${k}: existing and unknown must stay the same policy class`
    );
    assert.equal(
      unauthorizedUnknown.queries.filter((entry) => entry.kind === 'eligibility').length,
      1,
      `UNAUTHORIZED_UNKNOWN ${k} must pass through the canonical absence-disclosure boundary`
    );
    matrix[`ABSENCE_BOUNDARY_${k}`] = 'OPERATIONAL_PRINCIPAL_DENIAL_REUSED';
    matrix[`RESOURCE_COMPLEX_AUTHORITY_PRESERVED_${k}`] = 'YES';
  } else {
    assert.equal(unauthorizedUnknown.response.status, 404, `UNAUTHORIZED_UNKNOWN ${k} keeps the pre-existing 404`);
    matrix[`ABSENCE_BOUNDARY_${k}`] = 'LANE_INJECTED_POLICY_UNCHANGED';
  }

  // Council authority stays exact-complex scoped and still authorizes an
  // existing resource, so Stage 3 was not replaced by Stage 1.
  const councilExisting = await run({
    id: target.existingId, subject: OPERATOR_SUBJECT, grants: 'council', exists: true, target
  });
  assert.equal(
    councilExisting.response.status,
    target.authorizedStatus,
    `${k}: a resident-council grant must remain a valid Stage 3 authority`
  );
  matrix[`COUNCIL_SCOPED_AUTHORITY_${k}`] = 'PRESERVED';
}

// ---------------------------------------------------------------------------
// MUTATION PROOF — the historical shape, modelled in-test on the same stub.
//
// The rejected order was:
//   resource lookup -> 404 -> actor boundary
//
// It is re-stated here with the real production lookup text and the REAL
// requireActor, so the model cannot drift from the product semantics. The proof
// obligation is that this shape is rejected by the contract above: it produces
// a resource query for a signed-out caller and it answers existing and unknown
// ids differently.
// ---------------------------------------------------------------------------
for (const target of TARGETS) {
  const k = target.key;

  const historical = async (id, exists) => {
    const harness = makeHarness({ grants: 'none', exists, row: target.existingRow, resourceId: target.resourceId });
    globalThis.__DANJION_TEST_SQL__ = harness.sql;
    try {
      // 1. the resource lookup, FIRST — the historical order
      const rows = await harness.sql(target.lookupSql, ...target.lookupParams(id));
      if (!rows[0]) return { status: 404, code: 'NOT_FOUND', message: target.notFoundMessage, queries: harness.queries };
      // 2. only then the actor boundary
      const denial = await requireActor(buildRequest(target, id, null, target.body), ENV, harness.sql, REQUEST_ID);
      if (denial instanceof Response) {
        const parsed = await denial.json();
        return {
          status: denial.status,
          code: parsed?.error?.code ?? null,
          message: parsed?.error?.message ?? null,
          queries: harness.queries
        };
      }
      return { status: 200, code: null, message: null, queries: harness.queries };
    } finally {
      delete globalThis.__DANJION_TEST_SQL__;
    }
  };

  const histExisting = await historical(target.existingId, true);
  const histUnknown = await historical(target.unknownId, false);

  assert.equal(
    resourceCount(histExisting.queries),
    1,
    `MUTATION_PROOF ${k}: the historical shape runs a resource query for a signed-out caller`
  );
  assert.ok(
    resourceCount(histUnknown.queries) > 0,
    `MUTATION_PROOF ${k}: the historical shape runs a resource query for an unknown id too`
  );
  assert.notDeepEqual(
    { status: histExisting.status, code: histExisting.code, message: histExisting.message },
    { status: histUnknown.status, code: histUnknown.code, message: histUnknown.message },
    `MUTATION_PROOF ${k}: the historical shape answers existing and unknown differently — the existence oracle`
  );
  assert.equal(histUnknown.status, 404, `MUTATION_PROOF ${k}: the historical unknown id is 404 before auth`);
  assert.equal(histExisting.status, 401, `MUTATION_PROOF ${k}: the historical existing id reaches the auth boundary`);

  // The shipped handler, on the same stub, is what the matrix above already
  // proved: zero resource queries and one identical response for both ids.
  matrix[`MUTATION_PROOF_${k}`] = 'HISTORICAL_ORACLE_REJECTED';
}

for (const target of TARGETS) {
  assert.equal(matrix[`SIGNED_OUT_EXISTING_VS_ABSENT_PARITY_${target.key}`], 'PASS', target.key);
  assert.equal(matrix[`OPERATIONAL_SCOPE_AUTHORITY_PRESERVED_${target.key}`], 'YES', target.key);
  assert.equal(matrix[`PG_UUID_CAST_ERROR_${target.key}`], 'NO', target.key);
  assert.equal(matrix[`MUTATION_PROOF_${target.key}`], 'HISTORICAL_ORACLE_REJECTED', target.key);
}

console.log('admin-auth-before-resource-lookup-1047.test: PASS');
console.log(`ROUTES=${TARGETS.length}`);
for (const target of TARGETS) console.log(`ROUTE_OK=${target.label}`);
console.log(`ADMIN_DOCUMENT_AUTH_BEFORE_LOOKUP=${matrix.SIGNED_OUT_EXISTING_VS_ABSENT_PARITY_ADMIN_DOCUMENT === 'PASS' ? 'YES' : 'NO'}`);
console.log(`ADMIN_INQUIRY_AUTH_BEFORE_LOOKUP=${matrix.SIGNED_OUT_EXISTING_VS_ABSENT_PARITY_INQUIRY === 'PASS' ? 'YES' : 'NO'}`);
console.log(`ADMIN_SHOP_RECOMMENDATION_AUTH_BEFORE_LOOKUP=${matrix.SIGNED_OUT_EXISTING_VS_ABSENT_PARITY_SHOP_RECOMMENDATION === 'PASS' ? 'YES' : 'NO'}`);
console.log('SIGNED_OUT_EXISTING_VS_ABSENT_PARITY=PASS');
console.log('SIGNED_OUT_RESOURCE_SQL_REACHED=NO');
console.log('SIGNED_OUT_MALFORMED_ID=AUTH_FIRST');
console.log('MALFORMED_ID_RESOURCE_SQL_REACHED=NO');
console.log('PG_UUID_CAST_ERROR=NO');
console.log('RESOURCE_QUERY_BEFORE_ACTOR=0');
console.log('OPERATIONAL_SCOPE_AUTHORITY_PRESERVED=YES');
console.log('COUNCIL_SCOPED_AUTHORITY=PRESERVED');
console.log('#975_PATTERN_REUSED=YES');
console.log('MUTATION_PROOF=HISTORICAL_RESOURCE_LOOKUP_BEFORE_AUTH_REJECTED');
