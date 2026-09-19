import assert from 'node:assert/strict';
import { handleCommunityResidentRequest } from '../src/community-resident-v1.ts';

// The handler builds its own `neon(env.DATABASE_URL)` client internally. To keep
// product code untouched (no #808 scope widening), the `neon` driver is swapped by
// a test-only ESM loader (see tests/helpers/neon-stub-*). Install the stub on
// globalThis and drive the REAL route handler.
// Run: npx tsx --import ./tests/helpers/neon-stub-loader.mjs tests/community-write-exemption-route.test.mjs

// Route-level runtime proof for the #808 exemption on the Community write routes.
//
// The user requirement is explicit: a generic `requireVerifiedResident()` unit
// test is NOT sufficient. This test drives the REAL route handler
// (`handleCommunityResidentRequest`) through the actual HTTP paths for
// POST /community/posts and POST /community/posts/:id/comments, against a stubbed
// sql() that answers the exact queries the handler and its authorization gate
// issue. No network, no database.
//
// Scenarios:
//   A. ADMIN_EXEMPT_NO_HOUSEHOLD_POST     — exempt scope, ZERO household rows  -> 201
//   B. ADMIN_EXEMPT_NO_HOUSEHOLD_COMMENT  — exempt scope, ZERO household rows  -> 201
//   C. ORDINARY_UNVERIFIED_POST           — no scope,     ZERO household rows  -> 403
//   D. ORDINARY_UNVERIFIED_COMMENT        — no scope,     ZERO household rows  -> 403
//
// The decisive fact: `requireVerifiedResident()` resolves the exempt principal's
// complexId DIRECTLY FROM `complexes` (by slug) — no household membership join is
// required on that path — so neither route needs a household for an exempt admin,
// while an ordinary unverified actor is refused before any write.

const ACTOR_ID = '81000000-0000-4000-8000-000000000001';
const COMPLEX_ID = '82000000-0000-4000-8000-000000000001';
const COMPLEX_SLUG = 'gate-complex';
const POST_ID = '83000000-0000-4000-8000-000000000001';
const CREATED_POST_ID = '83000000-0000-4000-8000-000000000002';
const CREATED_COMMENT_ID = '83000000-0000-4000-8000-000000000003';

const ENV = {
  DATABASE_URL: 'postgresql://unused-in-stub-test',
  APP_ENV: 'development',
  DEV_AUTH_BYPASS: 'true'
};

// ------------------------------------------------------------------ stub sql
// Answers exactly the queries the route + gate issue. `scopes` controls the
// authorization outcome; `membership` controls whether a household exists.
function stubSql({ scopes = [], membership = null, authUser = null } = {}) {
  const seen = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    seen.push({ text, values });

    // authorization-v2 #823: the ordinary test-resident fallback reads the
    // actor's auth email; no other scenario in this file needs a row.
    if (text.includes('from danjion_auth."user" u')) {
      return authUser ? [authUser] : [];
    }

    // auth-v1: actor by dev subject
    if (text.includes('from app_users') && text.includes('where auth_user_id =')) {
      return [{ id: ACTOR_ID, auth_user_id: values[0], display_name: 'Gate Actor', account_status: 'active' }];
    }
    // authorization-v2: verified household membership for the requested complex
    if (text.includes('from household_memberships hm') && text.includes('hm.status =')) {
      return membership ? [membership] : [];
    }
    // padiem-authority-v1: active operator grants
    if (text.includes('from padiem_operator_grants')) {
      return scopes.map((scope) => ({ id: `grant-${scope}`, scope }));
    }
    // authorization-v2: exempt path resolves the complex directly by slug.
    // Faithful stub: it must ALSO honour any membership predicate the product
    // code adds to this query. If product code ever requires a household here,
    // this stub returns no row (because `membership` is null in the exempt
    // scenarios) and the route fails closed — so such a regression is caught.
    if (text.includes('from complexes') && text.includes('where slug =')) {
      const requiresMembership = text.includes('household_memberships');
      if (requiresMembership && !membership) return [];
      return [{ complex_id: COMPLEX_ID, complex_slug: COMPLEX_SLUG }];
    }
    // community: post existence check (used by the comment route)
    if (text.includes('from community_posts') && text.includes('author_user_id =')) {
      return [{ id: POST_ID, author_user_id: ACTOR_ID, status: 'published' }];
    }
    // community: post insert
    if (text.includes('insert into community_posts')) {
      return [{
        id: CREATED_POST_ID,
        kind: values[2],
        category: values[6],
        title: values[3],
        body: values[4],
        status: values[7],
        published_at: values[8],
        created_at: '2026-09-20T00:00:00.000Z',
        updated_at: '2026-09-20T00:00:00.000Z'
      }];
    }
    // community: comment insert
    if (text.includes('insert into community_comments')) {
      return [{
        id: CREATED_COMMENT_ID,
        post_id: values[1],
        body: values[3],
        status: values[4],
        published_at: values[5],
        created_at: '2026-09-20T00:00:00.000Z',
        updated_at: '2026-09-20T00:00:00.000Z'
      }];
    }
    return [];
  };
  globalThis.__DANJION_TEST_SQL__ = sql;
  return { sql, seen };
}

function jsonRequest(url, method, body) {
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-danjion-dev-auth-user': 'gate-subject'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const postUrl = `https://api.test/api/v1/complexes/${COMPLEX_SLUG}/community/posts`;
const commentUrl = `https://api.test/api/v1/complexes/${COMPLEX_SLUG}/community/posts/${POST_ID}/comments`;

const EXEMPT = 'resident.verification.exempt';

/* ===== A. ADMIN_EXEMPT_NO_HOUSEHOLD_POST — exempt + no household -> 201 ===== */
{
  const { sql, seen } = stubSql({ scopes: [EXEMPT], membership: null });
  const res = await handleCommunityResidentRequest(
    jsonRequest(postUrl, 'POST', { kind: 'greeting', title: '운영자 공지', body: '경계 검증 글' }),
    ENV,
    'req-a'
  );
  assert.ok(res, 'the post route must be handled');
  assert.equal(res.status, 201,
    `ADMIN_EXEMPT_NO_HOUSEHOLD_POST must be admitted (got ${res.status})`);
  const payload = await res.json();
  assert.equal(payload.data.title, '운영자 공지');

  // the write really happened, and the complex came from the direct resolve
  const insert = seen.find((q) => q.text.includes('insert into community_posts'));
  assert.ok(insert, 'the post insert must have been issued');
  assert.equal(insert.values[0], COMPLEX_ID, 'complex must come from the exempt direct resolve');
  assert.equal(insert.values[1], ACTOR_ID, 'author must be the exempt actor');
  // and no household membership row was ever needed
  const membership = seen.find((q) => q.text.includes('from household_memberships hm'));
  assert.ok(membership, 'the gate must have probed membership first');
  console.log('PASS ADMIN_EXEMPT_NO_HOUSEHOLD_POST=201 (no membership required)');
}

/* ===== B. ADMIN_EXEMPT_NO_HOUSEHOLD_COMMENT — exempt + no household -> 201 ===== */
{
  const { sql, seen } = stubSql({ scopes: [EXEMPT], membership: null });
  const res = await handleCommunityResidentRequest(
    jsonRequest(commentUrl, 'POST', { body: '운영자 댓글' }),
    ENV,
    'req-b'
  );
  assert.ok(res, 'the comment route must be handled');
  assert.equal(res.status, 201,
    `ADMIN_EXEMPT_NO_HOUSEHOLD_COMMENT must be admitted (got ${res.status})`);
  const insert = seen.find((q) => q.text.includes('insert into community_comments'));
  assert.ok(insert, 'the comment insert must have been issued');
  assert.equal(insert.values[0], COMPLEX_ID, 'comment must be complex-scoped from the exempt resolve');
  assert.equal(insert.values[2], ACTOR_ID, 'comment author must be the exempt actor');
  console.log('PASS ADMIN_EXEMPT_NO_HOUSEHOLD_COMMENT=201 (no membership required)');
}

/* ===== C. ORDINARY_UNVERIFIED_POST — no scope + no household -> 403 ===== */
{
  const { sql, seen } = stubSql({ scopes: [], membership: null });
  const res = await handleCommunityResidentRequest(
    jsonRequest(postUrl, 'POST', { kind: 'greeting', title: '일반 글', body: '차단되어야 함' }),
    ENV,
    'req-c'
  );
  assert.ok(res);
  assert.equal(res.status, 403,
    `ORDINARY_UNVERIFIED_POST must stay refused (got ${res.status})`);
  const payload = await res.json();
  assert.equal(payload.error.code, 'RESIDENT_VERIFICATION_REQUIRED');
  assert.ok(!seen.some((q) => q.text.includes('insert into community_posts')),
    'an unverified actor must not reach any community write');
  console.log('PASS ORDINARY_UNVERIFIED_POST=403 RESIDENT_VERIFICATION_REQUIRED');
}

/* ===== D. ORDINARY_UNVERIFIED_COMMENT — no scope + no household -> 403 ===== */
{
  const { sql, seen } = stubSql({ scopes: [], membership: null });
  const res = await handleCommunityResidentRequest(
    jsonRequest(commentUrl, 'POST', { body: '일반 댓글' }),
    ENV,
    'req-d'
  );
  assert.ok(res);
  assert.equal(res.status, 403,
    `ORDINARY_UNVERIFIED_COMMENT must stay refused (got ${res.status})`);
  const payload = await res.json();
  assert.equal(payload.error.code, 'RESIDENT_VERIFICATION_REQUIRED');
  assert.ok(!seen.some((q) => q.text.includes('insert into community_comments')),
    'an unverified actor must not reach the comment write');
  console.log('PASS ORDINARY_UNVERIFIED_COMMENT=403 RESIDENT_VERIFICATION_REQUIRED');
}

/* ===== E. the exemption is not a household: an unrelated scope is refused ===== */
{
  const { sql } = stubSql({ scopes: ['household.message.manage'], membership: null });
  const res = await handleCommunityResidentRequest(
    jsonRequest(postUrl, 'POST', { kind: 'greeting', title: 'x', body: 'y' }),
    ENV,
    'req-e'
  );
  assert.equal(res.status, 403,
    'a non-exempt operator scope must not open the community write route');
  console.log('PASS UNRELATED_SCOPE_POST=403 (exemption is scope-exact, not any-operator)');
}

/* ===== F/G. #823 ordinary allowlisted test email — zero grants -> 201 ===== */
const ORDINARY_EMAIL_USER = { email: 'skerish1@naver.com', email_verified: false, credential_account: true };
{
  const { sql, seen } = stubSql({ scopes: [], membership: null, authUser: ORDINARY_EMAIL_USER });
  const res = await handleCommunityResidentRequest(
    jsonRequest(postUrl, 'POST', { kind: 'greeting', title: '테스트 글', body: '일반 테스트계정 게시' }),
    ENV,
    'req-f'
  );
  assert.equal(res.status, 201, `ORDINARY_TEST_EMAIL_POST must be admitted (got ${res.status})`);
  const insert = seen.find((q) => q.text.includes('insert into community_posts'));
  assert.ok(insert, 'the ordinary exempt post must be written');
  assert.equal(insert.values[1], ACTOR_ID, 'author is the ordinary actor itself, no impersonation');
  console.log('PASS ORDINARY_TEST_EMAIL_POST=201 (zero grants, zero household)');
}
{
  const { seen } = stubSql({ scopes: [], membership: null, authUser: ORDINARY_EMAIL_USER });
  const res = await handleCommunityResidentRequest(
    jsonRequest(commentUrl, 'POST', { body: '일반 테스트계정 댓글' }),
    ENV,
    'req-g'
  );
  assert.equal(res.status, 201, `ORDINARY_TEST_EMAIL_COMMENT must be admitted (got ${res.status})`);
  assert.ok(seen.some((q) => q.text.includes('insert into community_comments')), 'the comment must be written');
  console.log('PASS ORDINARY_TEST_EMAIL_COMMENT=201 (reply lane same boundary)');
}
{
  // The same email over an unverified social provider is NOT the test account.
  const { sql } = stubSql({
    scopes: [], membership: null,
    authUser: { email: 'skerish1@naver.com', email_verified: false, credential_account: false }
  });
  const res = await handleCommunityResidentRequest(
    jsonRequest(postUrl, 'POST', { kind: 'greeting', title: 'x', body: 'y' }),
    ENV,
    'req-h'
  );
  assert.equal(res.status, 403, 'ORDINARY_TEST_EMAIL_UNVERIFIED_SOCIAL_POST must stay refused');
  console.log('PASS ORDINARY_TEST_EMAIL_UNVERIFIED_SOCIAL_POST=403 (provider rule mirrors admin-bootstrap)');
}

console.log('PASS community write route-level exemption boundary (post + comment)');
