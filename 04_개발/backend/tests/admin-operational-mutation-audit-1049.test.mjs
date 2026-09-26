// #1049 — ADMIN MUTATION AUDIT CONTRACT (defined here, enforced in source).
//
// The four operational admin mutation families must record their business
// mutations in the canonical audit_events stream, atomically enough that the
// global audit surface can never claim complete administrator history while
// omitting a covered write:
//
//   BUSINESS_MUTATION_COMMIT  IFF  MUTATION_AUDIT_COMMIT
//
// AUTHORIZATION_AUDIT != MUTATION_AUDIT. The pre-existing
// `authorization.operational-check` decision audit stays untouched; successful
// requests normally carry BOTH kinds.
//
// CONTRACT MATRIX (verified below against the real handlers):
//
// FAMILY          OPERATION   SOURCE_FUNCTION                   WRITE_SHAPE                 IDEMPOTENT_NO_WRITE_PATH          ACTION                          SCOPE                  RESOURCE_TYPE       RESOURCE_ID   REASON_CODE                       METADATA                      ATOMICITY_STRATEGY
// official-content create     createPost / insert...WithAttachment INSERT complex_posts        none                              admin.official-content.create   requestedScope         complex_post        mutated.id    ADMIN_OFFICIAL_CONTENT_CREATED    {fromStatus:null,toStatus}    single CTE (locked+mutated+audited+barrier on attachment path)
// official-content update     patchPost / update...WithAttachment  UPDATE complex_posts        none                              admin.official-content.update   requestedScope         complex_post        mutated.id    ADMIN_OFFICIAL_CONTENT_UPDATED    {fromStatus,toStatus}         single CTE (locked+mutated+audited+barrier on attachment path)
// benefit         create      createBenefit                       INSERT benefits             none                              admin.benefit.create            requestedScope         benefit             mutated.id    ADMIN_BENEFIT_CREATED             {fromStatus:null,toStatus}    single CTE (mutated+audited+barrier)
// benefit         update      patchBenefit                        UPDATE benefits             none                              admin.benefit.update            requestedScope         benefit             mutated.id    ADMIN_BENEFIT_UPDATED             {fromStatus,toStatus}         single CTE (mutated+audited+barrier)
// inquiry         review      adminReview                         UPDATE inquiries            already in requested state        admin.inquiry.review            requestedScope         inquiry             mutated.id    ADMIN_INQUIRY_STATUS_UPDATED      {fromStatus,toStatus}         single CTE; answered joins notification in one sql.transaction
// shop-recommendation review  adminReview                         UPDATE shop_recommendations  alreadyApproved                  admin.shop-recommendation.review requestedScope        shop_recommendation mutated.id    ADMIN_SHOP_RECOMMENDATION_REVIEWED {fromStatus,toStatus}       single CTE (approved+created_*+audited+barrier on approval)
//
// Common audit row: actor_user_id=operator.id, actor_kind='operator',
// complex_id=operator.complexId, scope=operator.requestedScope (the authority
// lane that actually passed: official-content.manage /
// council.official-content.manage, ...), decision='allowed'.
//
// This file is behavioural: it runs the REAL handlers (and the real app fetch
// boundary for the failure lane) against a stateful SQL double that models
// PostgreSQL semantics — one statement is atomic, sql.transaction rolls every
// statement back together. A bare throw with no state tracking would not prove
// anything about surviving rows.
//
//   OFFICIAL_CREATE_SUCCESS / OFFICIAL_CREATE_ATTACHMENT_SUCCESS
//   OFFICIAL_UPDATE_SUCCESS / OFFICIAL_UPDATE_ATTACHMENT_SUCCESS
//   BENEFIT_CREATE_SUCCESS / BENEFIT_UPDATE_SUCCESS
//   INQUIRY_IN_PROGRESS_SUCCESS / INQUIRY_ANSWER_SUCCESS / INQUIRY_CLOSE_SUCCESS
//   SHOP_CHANGES_REQUESTED_SUCCESS / SHOP_REJECTED_SUCCESS / SHOP_APPROVED_SUCCESS
//   SHOP_UNRESOLVED_CHANGES_REQUESTED_SUCCESS
//   DENIED_NO_MUTATION_AUDIT / VALIDATION_FAILURE_NO_MUTATION_AUDIT
//   CONFLICT_NO_MUTATION_AUDIT / IDEMPOTENT_NO_WRITE_NO_MUTATION_AUDIT
//   AUDIT_FAILURE_INJECTION (official content / benefit / inquiry / shop)
//   PII_MINIMIZED / GLOBAL_AUDIT_1048_PROJECTION_COMPAT
import assert from 'node:assert/strict';
import { handleAdminOperationalRequest } from '../src/admin-operational-v2.ts';
import { handleInquiryWithSql } from '../src/inquiries-v1.ts';
import { handleShopRecommendationWithSql } from '../src/shop-recommendations-v1.ts';
import {
  insertOfficialNewsPostWithAttachment,
  updateOfficialNewsPostWithAttachment
} from '../src/official-news-attachment-v1.ts';
import { globalAuditResponse } from '../src/admin-global-audit-v1.ts';
import app from '../src/app.ts';

const TS = '2026-09-26T12:00:00.000Z';

const COMPLEX_ID = '10490000-0000-4000-8000-000000000001';
const COMPLEX_SLUG = 'audit-test-complex';
const OPERATOR_ID = '10490000-0000-4000-8000-000000000002';
const POST_ID = '10490000-0000-4000-8000-000000000003';
const BENEFIT_ID = '10490000-0000-4000-8000-000000000004';
const INQUIRY_ID = '10490000-0000-4000-8000-000000000005';
const REC_ID = '10490000-0000-4000-8000-000000000006';
const BUSINESS_ID = '10490000-0000-4000-8000-000000000007';
const OUTSIDER_ID = '10490000-0000-4000-8000-000000000008';
const SUPER_ID = '10490000-0000-4000-8000-000000000009';
const CATEGORY_ID = '10490000-0000-4000-8000-00000000000a';
const RESIDENT_ID = '10490000-0000-4000-8000-00000000000b';

const OPERATOR_SUBJECT = 'op-subject';
const OUTSIDER_SUBJECT = 'outsider-subject';
const SUPER_SUBJECT = 'super-subject';

const ENV = {
  DATABASE_URL: 'postgresql://unused.invalid/danjion',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'true',
  // Required by the app-level auth facade before the admin chain runs; the
  // injection lane drives the real app.fetch boundary.
  DANJION_AUTH_BASE_URL: 'http://localhost:8787',
  BETTER_AUTH_SECRET: 'test-secret-not-real-0123456789abcdef0123456789abcdef'
};

// Distinctive private content. None of it may ever surface in an audit row.
const PRIVATE_TITLE = '비공개-제목-1049';
const PRIVATE_BODY = '비공개-본문-1049';
const PRIVATE_NOTE = '비공개-리뷰노트-1049';
const PRIVATE_RESPONSE = '비공개-답변-1049';

const ACTORS = new Map([
  [OPERATOR_SUBJECT, { id: OPERATOR_ID, auth_user_id: OPERATOR_SUBJECT, display_name: '운영자', account_status: 'active' }],
  [OUTSIDER_SUBJECT, { id: OUTSIDER_ID, auth_user_id: OUTSIDER_SUBJECT, display_name: '외부인', account_status: 'active' }],
  [SUPER_SUBJECT, { id: SUPER_ID, auth_user_id: SUPER_SUBJECT, display_name: '최고관리자', account_status: 'active' }]
]);

/**
 * A SQL double that models real PostgreSQL semantics for the #1049 contract:
 *
 *  - one statement is one atomic unit: the audit row and the business write
 *    inside the same data-modifying CTE either both apply or neither does;
 *  - `sql.transaction([...])` stages every statement and restores the previous
 *    state when any of them throws;
 *  - mutation gates (WHERE status ...) are modelled, so a gate miss produces
 *    ZERO rows and, with the audit bound to the mutated rows, ZERO audits.
 */
function makeWorld(options = {}) {
  const world = {
    authority: options.authority ?? 'padiem', // 'padiem' | 'council' | 'none'
    attachmentActive: options.attachmentActive ?? true,
    categoryActive: options.categoryActive ?? true,
    failAudit: false,
    post: options.post ?? null,
    benefit: options.benefit ?? null,
    inquiry: options.inquiry ?? null,
    recommendation: options.recommendation ?? null,
    businesses: [],
    relations: [],
    notifications: [],
    mutationAudits: [],
    authorityAudits: [],
    counts: {
      postWrites: 0,
      benefitWrites: 0,
      inquiryWrites: 0,
      recommendationWrites: 0,
      businessInserts: 0,
      relationInserts: 0,
      notificationInserts: 0
    },
    transactions: 0
  };

  const businessMutationCount = () =>
    world.counts.postWrites + world.counts.benefitWrites + world.counts.inquiryWrites +
    world.counts.recommendationWrites + world.counts.businessInserts + world.counts.relationInserts;

  const snapshot = () => JSON.parse(JSON.stringify({
    post: world.post,
    benefit: world.benefit,
    inquiry: world.inquiry,
    recommendation: world.recommendation,
    businesses: world.businesses,
    relations: world.relations,
    notifications: world.notifications,
    mutationAudits: world.mutationAudits,
    counts: world.counts
  }));
  const restore = (snap) => {
    world.post = snap.post;
    world.benefit = snap.benefit;
    world.inquiry = snap.inquiry;
    world.recommendation = snap.recommendation;
    world.businesses = snap.businesses;
    world.relations = snap.relations;
    world.notifications = snap.notifications;
    world.mutationAudits = snap.mutationAudits;
    world.counts = snap.counts;
  };

  // Uniform #1049 mutation-audit layout: the audit block is always the trailing
  // five parameters (requestId, actor, complex, scope, metadata JSON) and its
  // select spells exactly five quoted literals in a fixed order
  // (actor_kind, action, resource_type, decision, reason_code).
  const extractAudit = (raw, values) => {
    const auditStart = raw.indexOf('insert into audit_events');
    const segment = raw.slice(auditStart, raw.indexOf('returning id', auditStart));
    const literals = [...segment.matchAll(/'([^']*)'/g)].map((match) => match[1]);
    assert.equal(literals.length, 5, 'the audit select must spell exactly five literals');
    const [actorKind, action, resourceType, decision, reasonCode] = literals;
    const [requestId, actorUserId, complexId, scope, metadataJson] = values.slice(-5);
    return {
      request_id: String(requestId),
      actor_user_id: String(actorUserId),
      actor_kind: actorKind,
      complex_id: String(complexId),
      action,
      scope: String(scope),
      resource_type: resourceType,
      decision,
      reason_code: reasonCode,
      metadata: JSON.parse(String(metadataJson)),
      created_at: TS
    };
  };

  const recordMutationAudit = (raw, values, resourceId) => {
    // Statement-level atomicity: a failing audit insert aborts the whole
    // statement, so the business write must not be applied either.
    if (world.failAudit) throw new Error('synthetic audit_events insert failure');
    world.mutationAudits.push({ ...extractAudit(raw, values), resource_id: String(resourceId) });
  };

  const applyMutation = (raw, values) => {
    const t = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    const attach = t.includes('from business_image_objects');

    if (attach) {
      // LOCK + POST MUTATION + AUDIT in one statement (official-news helpers).
      // A retired/deleted registry row misses the lock, so zero rows and zero
      // audits are produced — NEW_REFERENCE XOR DELETE_INTENT is preserved.
      const inserting = t.includes('insert into complex_posts');
      if (!world.attachmentActive) return [];
      if (inserting) {
        const id = `1049ffff-0000-4000-8000-00000000000${world.counts.postWrites + 1}`;
        recordMutationAudit(raw, values, id);
        world.counts.postWrites += 1;
        world.post = { id, status: JSON.parse(String(values.slice(-5)[4])).toStatus };
        return [{ id, status: world.post.status, created_at: TS }];
      }
      assert.ok(world.post, 'attachment update needs a seeded post');
      recordMutationAudit(raw, values, world.post.id);
      world.counts.postWrites += 1;
      world.post = { ...world.post, status: JSON.parse(String(values.slice(-5)[4])).toStatus };
      return [{ id: world.post.id, status: world.post.status, updated_at: TS }];
    }

    if (t.includes('insert into complex_posts')) {
      const id = `1049ffff-0000-4000-8000-00000000000${world.counts.postWrites + 1}`;
      recordMutationAudit(raw, values, id);
      world.counts.postWrites += 1;
      world.post = { id, status: JSON.parse(String(values.slice(-5)[4])).toStatus };
      return [{ id, status: world.post.status, created_at: TS }];
    }

    if (t.includes('update complex_posts')) {
      assert.ok(world.post, 'post update needs a seeded post');
      recordMutationAudit(raw, values, world.post.id);
      world.counts.postWrites += 1;
      world.post = { ...world.post, status: JSON.parse(String(values.slice(-5)[4])).toStatus };
      return [{ id: world.post.id, status: world.post.status, updated_at: TS }];
    }

    if (t.includes('insert into benefits')) {
      const id = `1049ffff-0000-4000-8000-00000000000${world.counts.benefitWrites + 1}`;
      recordMutationAudit(raw, values, id);
      world.counts.benefitWrites += 1;
      world.benefit = { id, status: JSON.parse(String(values.slice(-5)[4])).toStatus };
      return [{ id, status: world.benefit.status, created_at: TS }];
    }

    if (t.includes('update benefits')) {
      assert.ok(world.benefit, 'benefit update needs a seeded benefit');
      recordMutationAudit(raw, values, world.benefit.id);
      world.counts.benefitWrites += 1;
      world.benefit = { ...world.benefit, status: JSON.parse(String(values.slice(-5)[4])).toStatus };
      return [{ id: world.benefit.id, status: world.benefit.status, updated_at: TS }];
    }

    if (t.includes('update inquiries')) {
      const row = world.inquiry;
      assert.ok(row, 'inquiry mutation needs a seeded inquiry');
      // Status gate: a miss writes nothing and therefore audits nothing.
      const gate = t.includes("set status = 'in_progress'")
        ? row.status === 'received'
        : t.includes("set status = 'answered'")
          ? ['received', 'in_progress'].includes(row.status)
          : row.status === 'answered';
      if (!gate) return [];
      const toStatus = JSON.parse(String(values.slice(-5)[4])).toStatus;
      recordMutationAudit(raw, values, row.id);
      world.counts.inquiryWrites += 1;
      world.inquiry = {
        ...row,
        status: toStatus,
        response_text: toStatus === 'answered' ? PRIVATE_RESPONSE : row.response_text,
        answered_at: toStatus === 'answered' ? TS : row.answered_at,
        closed_at: toStatus === 'closed' ? TS : null,
        updated_at: TS
      };
      return [{ ...world.inquiry }];
    }

    if (t.startsWith('with approved as (')) {
      const row = world.recommendation;
      assert.ok(row, 'approval needs a seeded recommendation');
      if (!['pending', 'changes_requested'].includes(row.status)) return [];
      const approvedBusinessId = row.approved_business_id ?? BUSINESS_ID;
      recordMutationAudit(raw, values, row.id);
      world.counts.recommendationWrites += 1;
      world.counts.businessInserts += 1;
      world.counts.relationInserts += 1;
      world.businesses.push({ id: approvedBusinessId });
      world.relations.push({ business_id: approvedBusinessId, complex_id: COMPLEX_ID });
      world.recommendation = {
        ...row,
        status: 'approved',
        approved_business_id: approvedBusinessId,
        reviewed_at: TS
      };
      return [{
        id: row.id,
        status: 'approved',
        review_note: PRIVATE_NOTE,
        approved_business_id: approvedBusinessId,
        reviewed_at: TS
      }];
    }

    if (t.includes('update shop_recommendations')) {
      const row = world.recommendation;
      assert.ok(row, 'recommendation mutation needs a seeded recommendation');
      if (!['pending', 'changes_requested'].includes(row.status)) return [];
      const toStatus = JSON.parse(String(values.slice(-5)[4])).toStatus;
      recordMutationAudit(raw, values, row.id);
      world.counts.recommendationWrites += 1;
      world.recommendation = { ...row, status: toStatus, reviewed_at: TS };
      return [{ id: row.id, status: toStatus, review_note: PRIVATE_NOTE, reviewed_at: TS }];
    }

    throw new Error('unexpected mutation statement: ' + t);
  };

  const runQuery = (strings, values) => {
    const raw = strings.join(' ');
    const t = raw.toLowerCase().replace(/\s+/g, ' ').trim();

    // --- authorization decision audits (must stay; regression-guarded) ------
    if (t.startsWith('insert into audit_events')) {
      const decision = String(values[4]);
      world.authorityAudits.push({
        action: raw.includes('authorization.operational-check')
          ? 'authorization.operational-check'
          : 'authorization.padiem-authority-check',
        scope: String(values[3]),
        decision
      });
      return [];
    }

    // --- one-statement mutation + audit (the #1049 shapes) -----------------
    if (t.includes('insert into audit_events')) return applyMutation(raw, values);

    // --- notification write (inquiry answer transaction) -------------------
    if (t.includes('insert into notifications')) {
      const exists = world.notifications.some((n) => n.source === `inquiry-answer:${INQUIRY_ID}`);
      if (!exists) {
        world.notifications.push({ source: `inquiry-answer:${INQUIRY_ID}` });
        world.counts.notificationInserts += 1;
      }
      return exists ? [] : [{ id: 'notification-1' }];
    }

    // --- reads ------------------------------------------------------------
    if (t.includes('as padiem_eligible')) {
      return [{ padiem_eligible: world.authority === 'padiem' }];
    }
    if (t.includes('select id, scope') && t.includes('from padiem_operator_grants')) {
      return world.authority === 'padiem' ? [{ id: 'grant-super', scope: '*' }] : [];
    }
    if (t.includes('left join lateral') && t.includes('from padiem_operator_grants')) {
      return [{
        complex_id: COMPLEX_ID,
        complex_slug: COMPLEX_SLUG,
        padiem_grant_id: world.authority === 'padiem' ? 'grant-padiem' : null,
        padiem_granted_scope: world.authority === 'padiem' ? '*' : null,
        council_grant_id: world.authority === 'council' ? 'grant-council' : null,
        council_granted_scope: world.authority === 'council' ? 'council.business.review' : null
      }];
    }
    if (t.includes('from app_users') && t.includes('where auth_user_id =')) {
      const actor = ACTORS.get(String(values[0]));
      return actor ? [actor] : [];
    }
    if (t.includes('from complex_posts p')) {
      return world.post ? [{ ...world.post, complex_slug: COMPLEX_SLUG }] : [];
    }
    if (t.includes('select be.*, c.slug as complex_slug')) {
      return world.benefit ? [{ ...world.benefit, business_id: BUSINESS_ID, complex_slug: COMPLEX_SLUG }] : [];
    }
    if (t.includes('from businesses b')) {
      return [{ id: BUSINESS_ID }];
    }
    if (t.includes('from inquiries i') && t.includes('join complexes c')) {
      return world.inquiry ? [{ ...world.inquiry, complex_slug: COMPLEX_SLUG }] : [];
    }
    if (t.includes('from shop_recommendations r')) {
      return world.recommendation ? [{ ...world.recommendation, complex_slug: COMPLEX_SLUG }] : [];
    }
    if (t.includes('from business_categories bc')) {
      return [{ id: CATEGORY_ID, is_active: world.categoryActive }];
    }
    if (t.includes('from audit_events e')) {
      // The global audit summary read: return full rows (including the fields
      // the projection must drop) so the test proves what is omitted.
      return world.mutationAudits.map((row, index) => ({
        id: `audit-${index}`,
        actor_kind: row.actor_kind,
        action: row.action,
        scope: row.scope,
        resource_type: row.resource_type,
        decision: row.decision,
        reason_code: row.reason_code,
        created_at: row.created_at,
        actor_user_id: 'must-not-leak',
        complex_id: 'must-not-leak',
        resource_id: 'must-not-leak',
        request_id: 'must-not-leak',
        metadata: { secret: 'must-not-leak' }
      }));
    }

    throw new Error('unexpected SQL in mutation-audit test: ' + t);
  };

  const sql = (strings, ...values) => {
    let promise = null;
    const run = () => (promise ||= Promise.resolve().then(() => runQuery(strings, values)));
    return {
      then: (onOk, onErr) => run().then(onOk, onErr),
      catch: (onErr) => run().catch(onErr),
      finally: (onFinally) => run().finally(onFinally),
      run
    };
  };
  sql.transaction = async (queries) => {
    assert.ok(Array.isArray(queries), 'transaction must receive the whole write set as an array');
    world.transactions += 1;
    const snap = snapshot();
    try {
      const results = [];
      for (const q of queries) {
        results.push(typeof q.run === 'function' ? await q.run() : await q);
      }
      return results;
    } catch (error) {
      restore(snap);
      throw error;
    }
  };

  return { sql, world, businessMutationCount };
}

function jsonRequest(method, path, body, subject = OPERATOR_SUBJECT) {
  const headers = { 'content-type': 'application/json' };
  if (subject) headers['x-danjion-dev-auth-user'] = subject;
  return new Request(`https://api.example.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function runAdmin(harness, method, path, body, subject = OPERATOR_SUBJECT) {
  globalThis.__DANJION_TEST_SQL__ = harness.sql;
  try {
    return await handleAdminOperationalRequest(jsonRequest(method, path, body, subject), ENV, 'req-1049-admin');
  } finally {
    delete globalThis.__DANJION_TEST_SQL__;
  }
}

async function runInquiry(harness, inquiryId, body, subject = OPERATOR_SUBJECT) {
  return handleInquiryWithSql(
    jsonRequest('PATCH', `/api/v1/admin/inquiries/${inquiryId}`, body, subject),
    ENV, harness.sql, 'req-1049-inquiry'
  );
}

async function runShop(harness, recId, body, subject = OPERATOR_SUBJECT) {
  return handleShopRecommendationWithSql(
    jsonRequest('PATCH', `/api/v1/admin/shop-recommendations/${recId}`, body, subject),
    ENV, harness.sql, 'req-1049-shop'
  );
}

function assertMutationAudit(row, expected) {
  assert.equal(row.request_id, expected.requestId);
  assert.equal(row.actor_user_id, OPERATOR_ID);
  assert.equal(row.actor_kind, 'operator');
  assert.equal(row.complex_id, COMPLEX_ID);
  assert.equal(row.action, expected.action);
  assert.equal(row.scope, expected.scope);
  assert.equal(row.resource_type, expected.resourceType);
  assert.equal(row.resource_id, expected.resourceId);
  assert.equal(row.decision, 'allowed');
  assert.equal(row.reason_code, expected.reasonCode);
  assert.deepEqual(row.metadata, expected.metadata);
}

// ===========================================================================
// OFFICIAL CONTENT
// ===========================================================================
{
  const h = makeWorld();
  const res = await runAdmin(h, 'POST', `/api/v1/admin/complexes/${COMPLEX_SLUG}/posts`, {
    sourceName: '관리사무소', category: '공지', title: PRIVATE_TITLE, body: PRIVATE_BODY, status: 'published'
  });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(h.businessMutationCount(), 1, 'BUSINESS_MUTATION_COUNT=1');
  assert.equal(h.world.mutationAudits.length, 1, 'MUTATION_AUDIT_COUNT=1');
  assertMutationAudit(h.world.mutationAudits[0], {
    requestId: 'req-1049-admin',
    action: 'admin.official-content.create',
    scope: 'official-content.manage',
    resourceType: 'complex_post',
    resourceId: body.data.id,
    reasonCode: 'ADMIN_OFFICIAL_CONTENT_CREATED',
    metadata: { fromStatus: null, toStatus: 'published' }
  });
  assert.equal(h.world.counts.postWrites, 1);
  assert.ok(
    h.world.authorityAudits.some((a) => a.action === 'authorization.operational-check' && a.decision === 'allowed'),
    'AUTHORITY_DECISION_AUDIT_REGRESSION=PASS (allowed lane still audited)'
  );
  console.log('OFFICIAL_CREATE_SUCCESS=PASS');
}
{
  const h = makeWorld();
  const write = {
    objectKey: 'gdrive/public/official-news-image/file1',
    complexId: COMPLEX_ID,
    complexSlug: COMPLEX_SLUG,
    authorUserId: OPERATOR_ID,
    sourceName: '관리사무소',
    category: '공지',
    title: PRIVATE_TITLE,
    body: PRIVATE_BODY,
    channel: 'apartment_news',
    displayMode: 'article',
    status: 'published',
    publishedAt: null,
    audit: { requestId: 'req-1049-attach', scope: 'council.official-content.manage', fromStatus: null }
  };
  const rows = await insertOfficialNewsPostWithAttachment(h.sql, write);
  assert.equal(rows.length, 1, 'REFERENCE_WINS must still commit exactly one post row');
  assert.equal(h.world.mutationAudits.length, 1, 'MUTATION_AUDIT_COUNT=1');
  assertMutationAudit(h.world.mutationAudits[0], {
    requestId: 'req-1049-attach',
    action: 'admin.official-content.create',
    scope: 'council.official-content.manage',
    resourceType: 'complex_post',
    resourceId: rows[0].id,
    reasonCode: 'ADMIN_OFFICIAL_CONTENT_CREATED',
    metadata: { fromStatus: null, toStatus: 'published' }
  });
  console.log('OFFICIAL_CREATE_ATTACHMENT_SUCCESS=PASS');

  // DELETE_WINS: the lock misses -> zero rows AND zero mutation audits.
  const lost = makeWorld({ attachmentActive: false });
  const lostRows = await insertOfficialNewsPostWithAttachment(lost.sql, write);
  assert.equal(lostRows.length, 0, 'DELETE_WINS must stay zero-row');
  assert.equal(lost.world.mutationAudits.length, 0, 'a lock miss must not fabricate a mutation audit');
  assert.equal(lost.businessMutationCount(), 0);
  console.log('OFFICIAL_ATTACHMENT_LOCK_MISS_AUDIT=0');
}
{
  const h = makeWorld({
    post: { id: POST_ID, status: 'published', title: PRIVATE_TITLE, body: PRIVATE_BODY }
  });
  const res = await runAdmin(h, 'PATCH', `/api/v1/admin/posts/${POST_ID}`, { title: PRIVATE_TITLE, status: 'archived' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(h.businessMutationCount(), 1, 'BUSINESS_MUTATION_COUNT=1');
  assert.equal(h.world.mutationAudits.length, 1, 'MUTATION_AUDIT_COUNT=1');
  assertMutationAudit(h.world.mutationAudits[0], {
    requestId: 'req-1049-admin',
    action: 'admin.official-content.update',
    scope: 'official-content.manage',
    resourceType: 'complex_post',
    resourceId: POST_ID,
    reasonCode: 'ADMIN_OFFICIAL_CONTENT_UPDATED',
    metadata: { fromStatus: 'published', toStatus: 'archived' }
  });
  console.log('OFFICIAL_UPDATE_SUCCESS=PASS');
}
{
  const h = makeWorld({ post: { id: POST_ID, status: 'draft' } });
  const rows = await updateOfficialNewsPostWithAttachment(h.sql, POST_ID, {
    objectKey: 'gdrive/public/official-news-image/file2',
    complexId: COMPLEX_ID,
    complexSlug: COMPLEX_SLUG,
    authorUserId: OPERATOR_ID,
    sourceName: '관리사무소',
    category: '공지',
    title: PRIVATE_TITLE,
    body: PRIVATE_BODY,
    channel: 'apartment_news',
    displayMode: 'highlight',
    status: 'published',
    publishedAt: null,
    audit: { requestId: 'req-1049-attach-update', scope: 'official-content.manage', fromStatus: 'draft' }
  });
  assert.equal(rows.length, 1);
  assert.equal(h.world.mutationAudits.length, 1, 'MUTATION_AUDIT_COUNT=1');
  assertMutationAudit(h.world.mutationAudits[0], {
    requestId: 'req-1049-attach-update',
    action: 'admin.official-content.update',
    scope: 'official-content.manage',
    resourceType: 'complex_post',
    resourceId: POST_ID,
    reasonCode: 'ADMIN_OFFICIAL_CONTENT_UPDATED',
    metadata: { fromStatus: 'draft', toStatus: 'published' }
  });
  console.log('OFFICIAL_UPDATE_ATTACHMENT_SUCCESS=PASS');
}

// ===========================================================================
// BENEFITS
// ===========================================================================
{
  const h = makeWorld();
  const res = await runAdmin(h, 'POST', `/api/v1/admin/complexes/${COMPLEX_SLUG}/benefits`, {
    businessId: BUSINESS_ID, title: PRIVATE_TITLE, status: 'active'
  });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(h.businessMutationCount(), 1, 'BUSINESS_MUTATION_COUNT=1');
  assert.equal(h.world.mutationAudits.length, 1, 'MUTATION_AUDIT_COUNT=1');
  assertMutationAudit(h.world.mutationAudits[0], {
    requestId: 'req-1049-admin',
    action: 'admin.benefit.create',
    scope: 'benefit.manage',
    resourceType: 'benefit',
    resourceId: body.data.id,
    reasonCode: 'ADMIN_BENEFIT_CREATED',
    metadata: { fromStatus: null, toStatus: 'active' }
  });
  console.log('BENEFIT_CREATE_SUCCESS=PASS');
}
{
  const h = makeWorld({ benefit: { id: BENEFIT_ID, status: 'active' } });
  const res = await runAdmin(h, 'PATCH', `/api/v1/admin/benefits/${BENEFIT_ID}`, {
    title: PRIVATE_TITLE, status: 'suspended'
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(h.businessMutationCount(), 1, 'BUSINESS_MUTATION_COUNT=1');
  assert.equal(h.world.mutationAudits.length, 1, 'MUTATION_AUDIT_COUNT=1');
  assertMutationAudit(h.world.mutationAudits[0], {
    requestId: 'req-1049-admin',
    action: 'admin.benefit.update',
    scope: 'benefit.manage',
    resourceType: 'benefit',
    resourceId: BENEFIT_ID,
    reasonCode: 'ADMIN_BENEFIT_UPDATED',
    metadata: { fromStatus: 'active', toStatus: 'suspended' }
  });
  console.log('BENEFIT_UPDATE_SUCCESS=PASS');
}

// ===========================================================================
// INQUIRY REVIEW
// ===========================================================================
{
  const h = makeWorld({ inquiry: {
    id: INQUIRY_ID, complex_id: COMPLEX_ID, user_id: RESIDENT_ID,
    inquiry_type: 'complaint', title: PRIVATE_TITLE, body: PRIVATE_BODY,
    status: 'received', response_text: null, answered_at: null, closed_at: null,
    created_at: TS, updated_at: TS
  } });
  const res = await runInquiry(h, INQUIRY_ID, { status: 'in_progress' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.data.status, 'in_progress');
  assert.equal(h.businessMutationCount(), 1, 'BUSINESS_MUTATION_COUNT=1');
  assert.equal(h.world.mutationAudits.length, 1, 'MUTATION_AUDIT_COUNT=1');
  assertMutationAudit(h.world.mutationAudits[0], {
    requestId: 'req-1049-inquiry',
    action: 'admin.inquiry.review',
    scope: 'inquiry.respond',
    resourceType: 'inquiry',
    resourceId: INQUIRY_ID,
    reasonCode: 'ADMIN_INQUIRY_STATUS_UPDATED',
    metadata: { fromStatus: 'received', toStatus: 'in_progress' }
  });
  console.log('INQUIRY_IN_PROGRESS_SUCCESS=PASS');
}
{
  const h = makeWorld({ inquiry: {
    id: INQUIRY_ID, complex_id: COMPLEX_ID, user_id: RESIDENT_ID,
    inquiry_type: 'complaint', title: PRIVATE_TITLE, body: PRIVATE_BODY,
    status: 'in_progress', response_text: null, answered_at: null, closed_at: null,
    created_at: TS, updated_at: TS
  } });
  const res = await runInquiry(h, INQUIRY_ID, { status: 'answered', response: PRIVATE_RESPONSE });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.data.status, 'answered');
  assert.equal(h.world.transactions, 1, 'answer write + audit + notification stay one transaction');
  assert.equal(h.world.counts.inquiryWrites, 1);
  assert.equal(h.world.counts.notificationInserts, 1);
  assert.equal(h.world.mutationAudits.length, 1, 'MUTATION_AUDIT_COUNT=1');
  assertMutationAudit(h.world.mutationAudits[0], {
    requestId: 'req-1049-inquiry',
    action: 'admin.inquiry.review',
    scope: 'inquiry.respond',
    resourceType: 'inquiry',
    resourceId: INQUIRY_ID,
    reasonCode: 'ADMIN_INQUIRY_STATUS_UPDATED',
    metadata: { fromStatus: 'in_progress', toStatus: 'answered' }
  });
  console.log('INQUIRY_ANSWER_SUCCESS=PASS');
}
{
  const h = makeWorld({ inquiry: {
    id: INQUIRY_ID, complex_id: COMPLEX_ID, user_id: RESIDENT_ID,
    inquiry_type: 'complaint', title: PRIVATE_TITLE, body: PRIVATE_BODY,
    status: 'answered', response_text: PRIVATE_RESPONSE, answered_at: TS, closed_at: null,
    created_at: TS, updated_at: TS
  } });
  const res = await runInquiry(h, INQUIRY_ID, { status: 'closed' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.data.status, 'closed');
  assert.equal(h.businessMutationCount(), 1, 'BUSINESS_MUTATION_COUNT=1');
  assert.equal(h.world.mutationAudits.length, 1, 'MUTATION_AUDIT_COUNT=1');
  assertMutationAudit(h.world.mutationAudits[0], {
    requestId: 'req-1049-inquiry',
    action: 'admin.inquiry.review',
    scope: 'inquiry.respond',
    resourceType: 'inquiry',
    resourceId: INQUIRY_ID,
    reasonCode: 'ADMIN_INQUIRY_STATUS_UPDATED',
    metadata: { fromStatus: 'answered', toStatus: 'closed' }
  });
  console.log('INQUIRY_CLOSE_SUCCESS=PASS');
}

// ===========================================================================
// SHOP RECOMMENDATION REVIEW
// ===========================================================================
function seededRecommendation(overrides = {}) {
  return {
    id: REC_ID, status: 'pending', approved_business_id: null,
    resolved_category_id: CATEGORY_ID, resolved_relation_type: 'neighbor',
    reviewed_at: null, ...overrides
  };
}
{
  const h = makeWorld({ recommendation: seededRecommendation() });
  const res = await runShop(h, REC_ID, { status: 'changes_requested', reviewNote: PRIVATE_NOTE });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(h.world.recommendation.status, 'changes_requested');
  assert.equal(h.businessMutationCount(), 1, 'BUSINESS_MUTATION_COUNT=1');
  assert.equal(h.world.mutationAudits.length, 1, 'MUTATION_AUDIT_COUNT=1');
  assertMutationAudit(h.world.mutationAudits[0], {
    requestId: 'req-1049-shop',
    action: 'admin.shop-recommendation.review',
    scope: 'business.review',
    resourceType: 'shop_recommendation',
    resourceId: REC_ID,
    reasonCode: 'ADMIN_SHOP_RECOMMENDATION_REVIEWED',
    metadata: { fromStatus: 'pending', toStatus: 'changes_requested' }
  });
  console.log('SHOP_CHANGES_REQUESTED_SUCCESS=PASS');
}
{
  const h = makeWorld({ recommendation: seededRecommendation() });
  const res = await runShop(h, REC_ID, { status: 'rejected', reviewNote: PRIVATE_NOTE });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(h.businessMutationCount(), 1, 'BUSINESS_MUTATION_COUNT=1');
  assert.equal(h.world.mutationAudits.length, 1, 'MUTATION_AUDIT_COUNT=1');
  assertMutationAudit(h.world.mutationAudits[0], {
    requestId: 'req-1049-shop',
    action: 'admin.shop-recommendation.review',
    scope: 'business.review',
    resourceType: 'shop_recommendation',
    resourceId: REC_ID,
    reasonCode: 'ADMIN_SHOP_RECOMMENDATION_REVIEWED',
    metadata: { fromStatus: 'pending', toStatus: 'rejected' }
  });
  console.log('SHOP_REJECTED_SUCCESS=PASS');
}
{
  const h = makeWorld({ recommendation: seededRecommendation() });
  const res = await runShop(h, REC_ID, { status: 'approved', reviewNote: PRIVATE_NOTE });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.data.status, 'approved');
  assert.equal(h.world.counts.recommendationWrites, 1);
  assert.equal(h.world.counts.businessInserts, 1);
  assert.equal(h.world.counts.relationInserts, 1);
  assert.equal(h.world.mutationAudits.length, 1, 'approved row IFF audit row');
  assertMutationAudit(h.world.mutationAudits[0], {
    requestId: 'req-1049-shop',
    action: 'admin.shop-recommendation.review',
    scope: 'business.review',
    resourceType: 'shop_recommendation',
    resourceId: REC_ID,
    reasonCode: 'ADMIN_SHOP_RECOMMENDATION_REVIEWED',
    metadata: { fromStatus: 'pending', toStatus: 'approved' }
  });
  console.log('SHOP_APPROVED_SUCCESS=PASS');
}
{
  // Approval authority unresolved: the fallback writes a REAL
  // changes_requested transition, so it must be audited too.
  const h = makeWorld({ recommendation: seededRecommendation({
    resolved_category_id: null, resolved_relation_type: null
  }) });
  const res = await runShop(h, REC_ID, { status: 'approved' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.data.status, 'changes_requested');
  assert.equal(body.data.categoryUnresolved, 'REPORT_RB_UNRESOLVED');
  assert.equal(h.world.counts.recommendationWrites, 1);
  assert.equal(h.world.counts.businessInserts, 0, 'unresolved approval must not materialize a business');
  assert.equal(h.world.mutationAudits.length, 1, 'the real changes_requested write is a covered mutation');
  assertMutationAudit(h.world.mutationAudits[0], {
    requestId: 'req-1049-shop',
    action: 'admin.shop-recommendation.review',
    scope: 'business.review',
    resourceType: 'shop_recommendation',
    resourceId: REC_ID,
    reasonCode: 'ADMIN_SHOP_RECOMMENDATION_REVIEWED',
    metadata: { fromStatus: 'pending', toStatus: 'changes_requested' }
  });
  console.log('SHOP_UNRESOLVED_CHANGES_REQUESTED_SUCCESS=PASS');
}

// ===========================================================================
// DENIED / VALIDATION / CONFLICT / IDEMPOTENT — no allowed mutation audit
// ===========================================================================
{
  const h = makeWorld({
    authority: 'none',
    inquiry: {
      id: INQUIRY_ID, complex_id: COMPLEX_ID, user_id: RESIDENT_ID,
      inquiry_type: 'complaint', title: PRIVATE_TITLE, body: PRIVATE_BODY,
      status: 'received', response_text: null, answered_at: null, closed_at: null,
      created_at: TS, updated_at: TS
    }
  });
  const res = await runInquiry(h, INQUIRY_ID, { status: 'in_progress' }, OUTSIDER_SUBJECT);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, 'OPERATIONAL_FORBIDDEN');
  assert.equal(h.world.mutationAudits.length, 0, 'FAILED_MUTATION_ALLOWED_AUDIT=0');
  assert.equal(h.businessMutationCount(), 0);
  assert.ok(
    h.world.authorityAudits.some((a) => a.action === 'authorization.operational-check' && a.decision === 'denied'),
    'AUTHORITY_DECISION_AUDIT_REGRESSION=PASS (denied lane still audited)'
  );
  console.log('DENIED_NO_MUTATION_AUDIT=PASS');
}
{
  const h = makeWorld();
  const res = await runAdmin(h, 'POST', `/api/v1/admin/complexes/${COMPLEX_SLUG}/posts`, {
    sourceName: '관리사무소', category: '공지', body: PRIVATE_BODY, status: 'published'
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
  assert.equal(h.world.mutationAudits.length, 0, 'FAILED_MUTATION_ALLOWED_AUDIT=0');
  assert.equal(h.businessMutationCount(), 0);
  console.log('VALIDATION_FAILURE_NO_MUTATION_AUDIT=PASS');
}
{
  const h = makeWorld({ inquiry: {
    id: INQUIRY_ID, complex_id: COMPLEX_ID, user_id: RESIDENT_ID,
    inquiry_type: 'complaint', title: PRIVATE_TITLE, body: PRIVATE_BODY,
    status: 'received', response_text: null, answered_at: null, closed_at: null,
    created_at: TS, updated_at: TS
  } });
  const res = await runInquiry(h, INQUIRY_ID, { status: 'closed' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.code, 'CONFLICT');
  assert.equal(h.world.mutationAudits.length, 0, 'FAILED_MUTATION_ALLOWED_AUDIT=0');
  assert.equal(h.businessMutationCount(), 0, 'a gate miss writes nothing');
  console.log('CONFLICT_NO_MUTATION_AUDIT=PASS');
}
{
  // already answered -> success with ZERO writes and ZERO mutation audits.
  const h = makeWorld({ inquiry: {
    id: INQUIRY_ID, complex_id: COMPLEX_ID, user_id: RESIDENT_ID,
    inquiry_type: 'complaint', title: PRIVATE_TITLE, body: PRIVATE_BODY,
    status: 'answered', response_text: PRIVATE_RESPONSE, answered_at: TS, closed_at: null,
    created_at: TS, updated_at: TS
  } });
  const res = await runInquiry(h, INQUIRY_ID, { status: 'answered', response: PRIVATE_RESPONSE });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.data.status, 'answered');
  assert.equal(h.businessMutationCount(), 0, 'IDEMPOTENT_NO_WRITE');
  assert.equal(h.world.counts.notificationInserts, 0, 'IDEMPOTENT_NO_WRITE');
  assert.equal(h.world.mutationAudits.length, 0, 'IDEMPOTENT_NO_WRITE_NO_MUTATION_AUDIT');

  // already closed -> success with ZERO writes and ZERO mutation audits.
  const closed = makeWorld({ inquiry: {
    id: INQUIRY_ID, complex_id: COMPLEX_ID, user_id: RESIDENT_ID,
    inquiry_type: 'complaint', title: PRIVATE_TITLE, body: PRIVATE_BODY,
    status: 'closed', response_text: PRIVATE_RESPONSE, answered_at: TS, closed_at: TS,
    created_at: TS, updated_at: TS
  } });
  const closedRes = await runInquiry(closed, INQUIRY_ID, { status: 'closed' });
  assert.equal(closedRes.status, 200);
  assert.equal(closed.businessMutationCount(), 0);
  assert.equal(closed.world.mutationAudits.length, 0, 'IDEMPOTENT_NO_WRITE_NO_MUTATION_AUDIT');

  // alreadyApproved -> explicit replay answer with ZERO mutation audits.
  const approved = makeWorld({ recommendation: seededRecommendation({
    status: 'approved', approved_business_id: BUSINESS_ID
  }) });
  const approvedRes = await runShop(approved, REC_ID, { status: 'approved' });
  const approvedBody = await approvedRes.json();
  assert.equal(approvedRes.status, 200);
  assert.equal(approvedBody.data.alreadyApproved, true);
  assert.equal(approved.businessMutationCount(), 0);
  assert.equal(approved.world.mutationAudits.length, 0, 'IDEMPOTENT_NO_WRITE_NO_MUTATION_AUDIT');
  console.log('IDEMPOTENT_NO_WRITE_NO_MUTATION_AUDIT=PASS');
}

// ===========================================================================
// AUDIT FAILURE INJECTION — one representative per family, through the real
// HTTP boundary (app.fetch maps the thrown statement to 500 INTERNAL_ERROR).
//
// Required observations per family:
//   HTTP_FAILURE=YES
//   BUSINESS_MUTATION_SURVIVES=NO
//   MUTATION_AUDIT_SURVIVES=NO
// ===========================================================================
async function expectAuditFailureRollback({ label, makeWorldOptions, method, path, body, assertWorld }) {
  const h = makeWorld(makeWorldOptions);
  h.world.failAudit = true;
  globalThis.__DANJION_TEST_SQL__ = h.sql;
  let response;
  try {
    response = await app.fetch(jsonRequest(method, path, body), ENV);
  } finally {
    delete globalThis.__DANJION_TEST_SQL__;
  }
  assert.equal(response.status, 500, `${label}: HTTP_FAILURE=YES`);
  assert.equal((await response.json()).error.code, 'INTERNAL_ERROR', `${label}: HTTP_FAILURE=YES`);
  assert.ok(
    h.world.authorityAudits.length > 0,
    `${label}: the request must have reached the handler and its authority gate`
  );
  assert.equal(h.world.mutationAudits.length, 0, `${label}: MUTATION_AUDIT_SURVIVES=NO`);
  assert.equal(h.businessMutationCount(), 0, `${label}: BUSINESS_MUTATION_SURVIVES=NO`);
  assertWorld(h.world);
  console.log(`AUDIT_FAILURE_ROLLBACK_${label}=PASS`);
}

await expectAuditFailureRollback({
  label: 'OFFICIAL_CONTENT',
  makeWorldOptions: {},
  method: 'POST',
  path: `/api/v1/admin/complexes/${COMPLEX_SLUG}/posts`,
  body: { sourceName: '관리사무소', category: '공지', title: PRIVATE_TITLE, body: PRIVATE_BODY, status: 'published' },
  assertWorld: (world) => assert.equal(world.counts.postWrites, 0)
});

await expectAuditFailureRollback({
  label: 'BENEFIT',
  makeWorldOptions: { benefit: { id: BENEFIT_ID, status: 'active' } },
  method: 'PATCH',
  path: `/api/v1/admin/benefits/${BENEFIT_ID}`,
  body: { title: PRIVATE_TITLE, status: 'suspended' },
  assertWorld: (world) => {
    assert.equal(world.counts.benefitWrites, 0);
    assert.equal(world.benefit.status, 'active', 'the benefit row must survive unchanged');
  }
});

await expectAuditFailureRollback({
  label: 'INQUIRY',
  makeWorldOptions: { inquiry: {
    id: INQUIRY_ID, complex_id: COMPLEX_ID, user_id: RESIDENT_ID,
    inquiry_type: 'complaint', title: PRIVATE_TITLE, body: PRIVATE_BODY,
    status: 'in_progress', response_text: null, answered_at: null, closed_at: null,
    created_at: TS, updated_at: TS
  } },
  method: 'PATCH',
  path: `/api/v1/admin/inquiries/${INQUIRY_ID}`,
  body: { status: 'answered', response: PRIVATE_RESPONSE },
  assertWorld: (world) => {
    assert.equal(world.counts.inquiryWrites, 0);
    assert.equal(world.inquiry.status, 'in_progress', 'the inquiry must roll back with the failed audit');
    assert.equal(world.counts.notificationInserts, 0, 'the notification must roll back with the failed audit');
    assert.equal(world.transactions, 1, 'the answer unit is one rollback-able transaction');
  }
});

await expectAuditFailureRollback({
  label: 'SHOP_RECOMMENDATION',
  makeWorldOptions: { recommendation: seededRecommendation() },
  method: 'PATCH',
  path: `/api/v1/admin/shop-recommendations/${REC_ID}`,
  body: { status: 'approved', reviewNote: PRIVATE_NOTE },
  assertWorld: (world) => {
    assert.equal(world.counts.recommendationWrites, 0);
    assert.equal(world.recommendation.status, 'pending');
    assert.equal(world.counts.businessInserts, 0, 'no business may materialize without its audit');
    assert.equal(world.counts.relationInserts, 0);
  }
});

// ===========================================================================
// PII / PRIVATE CONTENT MINIMIZATION (migration 011 contract)
// ===========================================================================
{
  const h = makeWorld();
  await runAdmin(h, 'POST', `/api/v1/admin/complexes/${COMPLEX_SLUG}/posts`, {
    sourceName: '관리사무소', category: '공지', title: PRIVATE_TITLE, body: PRIVATE_BODY, status: 'published'
  });
  await runAdmin(h, 'POST', `/api/v1/admin/complexes/${COMPLEX_SLUG}/benefits`, {
    businessId: BUSINESS_ID, title: PRIVATE_TITLE, status: 'active'
  });
  assert.equal(h.world.mutationAudits.length, 2);
  for (const audit of h.world.mutationAudits) {
    assert.deepEqual(
      Object.keys(audit.metadata).sort(),
      ['fromStatus', 'toStatus'],
      'AUDIT_METADATA_PII_MINIMIZED: metadata carries state enums only'
    );
    assert.equal(audit.metadata.fromStatus === null || typeof audit.metadata.fromStatus === 'string', true);
    const serialized = JSON.stringify(audit);
    for (const secret of [PRIVATE_TITLE, PRIVATE_BODY, PRIVATE_NOTE, PRIVATE_RESPONSE]) {
      assert.ok(!serialized.includes(secret), `audit must never store private content: ${secret}`);
    }
  }
  console.log('AUDIT_METADATA_PII_MINIMIZED=YES');
}

// ===========================================================================
// GLOBAL AUDIT 1048 PROJECTION COMPAT — the new rows express themselves through
// the privacy-bounded projection fields (action, scope, resourceType, decision,
// reasonCode, createdAt) and leak nothing else.
// ===========================================================================
{
  const h = makeWorld({ post: { id: POST_ID, status: 'published' } });
  await runAdmin(h, 'PATCH', `/api/v1/admin/posts/${POST_ID}`, { title: PRIVATE_TITLE, status: 'archived' });
  globalThis.__DANJION_TEST_SQL__ = h.sql;
  let projected;
  try {
    projected = await globalAuditResponse(
      jsonRequest('GET', '/api/v1/admin/audit-events?limit=10', undefined, SUPER_SUBJECT),
      ENV, h.sql, 'req-1049-projection'
    );
  } finally {
    delete globalThis.__DANJION_TEST_SQL__;
  }
  assert.equal(projected.status, 200);
  const { data } = await projected.json();
  assert.equal(data.length, 1);
  assert.deepEqual(Object.keys(data[0]).sort(), [
    'action', 'actorKind', 'createdAt', 'decision', 'id', 'reasonCode', 'resourceType', 'scope'
  ], 'the projection stays privacy-bounded');
  assert.equal(data[0].action, 'admin.official-content.update');
  assert.equal(data[0].scope, 'official-content.manage');
  assert.equal(data[0].resourceType, 'complex_post');
  assert.equal(data[0].decision, 'allowed');
  assert.equal(data[0].reasonCode, 'ADMIN_OFFICIAL_CONTENT_UPDATED');
  assert.equal(data[0].createdAt, TS);
  for (const forbidden of ['actorUserId', 'complexId', 'resourceId', 'requestId', 'metadata']) {
    assert.equal(data[0][forbidden], undefined, `projection must omit ${forbidden}`);
  }
  console.log('GLOBAL_AUDIT_1048_REGRESSION=PASS');
}

console.log('ADMIN_MUTATION_AUDIT_CONTRACT=DEFINED');
console.log('OFFICIAL_CONTENT_MUTATION_AUDIT=PASS');
console.log('BENEFIT_MUTATION_AUDIT=PASS');
console.log('INQUIRY_MUTATION_AUDIT=PASS');
console.log('SHOP_RECOMMENDATION_MUTATION_AUDIT=PASS');
console.log('SUCCESS_MUTATION_AUDIT_EXACTLY_ONCE=PASS');
console.log('FAILED_MUTATION_ALLOWED_AUDIT=0');
console.log('IDEMPOTENT_NO_WRITE_AUDIT=0');
console.log('AUDIT_FAILURE_ROLLBACK=PASS');
console.log('AUTHORITY_DECISION_AUDIT_REGRESSION=PASS');
console.log('admin-operational-mutation-audit-1049: PASS');
