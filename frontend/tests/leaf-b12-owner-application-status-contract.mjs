import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createApplicationReportBridge,
  normalizeOwnerApplication,
  ownerApplicationStatusLabel,
  ownerDocumentKindLabel,
  OWNER_APPLICATION_STATUSES
} from '../assets/application-report-bridge.js';

// Assignment #313 [Leaf B12]: owner application status readback + private
// document reopen, built on the existing owner application contract and the
// GAP-5 Phase-B document route (#310 / PR #353).
//
// Locked invariants:
//   - the four canonical statuses are preserved verbatim and never collapsed
//     (rejected must not be softened into changes_requested)
//   - document bytes are reachable ONLY through
//     GET /api/v1/me/business-applications/:applicationId/documents/:documentId
//     addressed by the server-issued (applicationId, documentId) pair
//   - no object key is ever promoted into a URL and no Drive/public URL is built
//   - the static/demo lane is untouched: with no apiBase nothing is claimed
//   - every failure fails closed with an honest notice, never a fake success
// Run: node frontend/tests/leaf-b12-owner-application-status-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const apply25a = await read('../25A_신청제보.html');
const bridgeSrc = await read('../assets/application-report-bridge.js');

const APP_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';

/* ------------------------------------------------------------------ *
 * 1. Source contract: 25A stays additive and never owns the route
 * ------------------------------------------------------------------ */

/* --- the status panel is additive and starts hidden --- */
assert.ok(apply25a.includes('class="section owner-only" hidden="" id="myApplicationsSection"'),
  '25A must add the owner-only status panel in its hidden default state');
const formOpen = apply25a.indexOf('<form class="form mode-owner" id="requestForm">');
const panelAt = apply25a.indexOf('id="myApplicationsSection"');
const originalFirst = apply25a.indexOf('<h2>가게와 신청자</h2>');
assert.ok(formOpen > -1 && panelAt > formOpen && originalFirst > panelAt,
  'the status panel must be the first section inside the form, ahead of the untouched original section');
assert.ok(apply25a.includes('<h2>내 신청 현황</h2>'), 'the panel must carry the owner-facing status heading');

/* --- the page consumes the bridge method, never a hand-rolled route --- */
assert.ok(apply25a.includes('openOwnerApplicationDocument('),
  '25A must reopen documents through the bridge method');
assert.ok(!apply25a.includes('/documents/'),
  '25A must not build the document route itself - the bridge owns the path');
assert.ok(!apply25a.includes('business-applications'),
  '25A must not build any application path itself - the bridge owns the base');
assert.ok(apply25a.includes('listOwnerApplications('),
  '25A must read the caller own applications through the bridge');

/* --- no object-key authority, no direct Drive/public URL, no local fake store --- */
assert.ok(!apply25a.includes('drive.google'),
  '25A must never build a Google Drive URL');
assert.ok(!apply25a.includes('storage/public'),
  '25A must never route private documents through the public media proxy');
assert.ok(!apply25a.includes('localStorage'),
  '25A must not fake-persist any application or document state locally');
const panelBlock = apply25a.slice(panelAt, apply25a.indexOf('</form>'));
assert.ok(!panelBlock.includes('objectKey'),
  'the status panel must not reference object keys - access authority is the server-issued id pair only');

/* --- statuses come from the single shared authority, not a page-local table --- */
assert.ok(apply25a.includes('ownerApplicationStatusLabel('),
  '25A must render statuses through the shared label authority (no divergent page-local table)');
assert.ok(apply25a.includes('ownerDocumentKindLabel('),
  '25A must render document kinds through the shared label authority');

/* --- the panel is owner-mode only, so report mode keeps its own surface --- */
assert.ok(apply25a.includes('.mode-report .owner-only{display:none}'),
  'the existing owner/report mode split must remain in place');
assert.ok(apply25a.includes('#myApplicationsSection[hidden]{display:none!important}'),
  'the panel must stay hidden until its own load resolves');

/* --- photo gallery and private document concepts stay separate --- */
assert.ok(apply25a.includes('내가 제출한 비공개 서류'),
  'the panel must label private documents as private submissions');
assert.ok(!/photo-gallery|photoGallery|photo-thumb|photo-remove|renderPhotoGallery/.test(apply25a),
  'the panel must not introduce any photo gallery presentation');
assert.ok(apply25a.includes('photoObjectKeys:uploadedKeys'),
  'the existing photo submission payload must be untouched');

/* --- fail-closed branches are present and honest --- */
for (const notice of [
  '로그인 후 이용 가능합니다.',
  '서버가 문서 식별자를 제공하지 않아 이 서류는 다시 열 수 없습니다.',
  '신청 현황을 불러오지 못했습니다'
]) {
  assert.ok(apply25a.includes(notice), `25A must fail closed with: ${notice}`);
}
assert.ok(/if\(!apiBase\)return;/.test(apply25a),
  '25A must return before any request when apiBase is absent (static/demo lane untouched)');

/* --- the sibling submission form is preserved verbatim --- */
for (const preserved of [
  'id="requestForm"', 'id="submitBtn"', 'id="ownerProof"', 'id="photos"',
  '내 가게 등록 신청', '이웃가게 제보',
  'const MAX_PHOTOS=3;', "const OWNER_RELATIONS=new Set(['self','co','family','etc']);"
]) {
  assert.ok(apply25a.includes(preserved), `existing 25A surface must be preserved: ${preserved}`);
}

/* ------------------------------------------------------------------ *
 * 2. Bridge source contract: route shape and no Drive/object-key path
 * ------------------------------------------------------------------ */
assert.ok(bridgeSrc.includes('/api/v1/me/business-applications/${appId}/documents/${docId}'),
  'the bridge must target exactly the applicant document route');
assert.ok(!bridgeSrc.includes('/api/v1/admin'),
  'the bridge must not reach into the reviewer lane');
assert.ok(!bridgeSrc.includes('drive.google'),
  'the bridge must never build a Google Drive URL');
assert.ok(!bridgeSrc.includes('storage/public'),
  'the bridge must never route private documents through the public media proxy');

/* ------------------------------------------------------------------ *
 * 3. Runtime: status semantics are preserved, never collapsed
 * ------------------------------------------------------------------ */
assert.deepEqual(OWNER_APPLICATION_STATUSES, ['pending', 'changes_requested', 'approved', 'rejected'],
  'the four canonical statuses must be preserved in order');

const EXPECTED_LABELS = {
  pending: '검토 대기',
  changes_requested: '보완 요청',
  approved: '승인 완료',
  rejected: '반려'
};
for (const [status, label] of Object.entries(EXPECTED_LABELS)) {
  assert.equal(ownerApplicationStatusLabel(status), label, `${status} must render as ${label}`);
}
assert.notEqual(ownerApplicationStatusLabel('rejected'), ownerApplicationStatusLabel('changes_requested'),
  'rejected must never collapse into changes_requested');
assert.equal(ownerApplicationStatusLabel('unknown-state'), '상태 확인 중',
  'an unknown status must be surfaced honestly instead of guessed');
assert.equal(ownerApplicationStatusLabel(null), '상태 확인 중',
  'an absent status must be surfaced honestly instead of guessed');

assert.equal(ownerDocumentKindLabel('operation_proof'), '운영 확인서류');
assert.equal(ownerDocumentKindLabel('other_evidence'), '기타 증빙자료');
assert.equal(ownerDocumentKindLabel('additional_reference'), '추가 참고자료');
assert.equal(ownerDocumentKindLabel('something-else'), '제출 서류',
  'an unknown document kind must fall back honestly');

/* --- normalization preserves the server-issued document id, and never invents one --- */
{
  const withId = normalizeOwnerApplication({
    id: APP_ID, business_name: '내 가게', status: 'rejected',
    documents: [{ id: DOC_ID, object_key: 'gdrive/private/application-document/abcdefghij', document_kind: 'operation_proof', sort_order: 0 }]
  });
  assert.equal(withId.status, 'rejected', 'the rejected status must survive normalization verbatim');
  assert.equal(withId.documents.length, 1);
  assert.equal(withId.documents[0].documentId, DOC_ID,
    'the server-issued document id must be preserved for the reopen route');
  assert.equal(withId.documents[0].kind, 'operation_proof');

  const withoutId = normalizeOwnerApplication({
    id: APP_ID, business_name: '내 가게', status: 'pending',
    documents: [{ object_key: 'gdrive/private/application-document/abcdefghij', document_kind: 'operation_proof', sort_order: 0 }]
  });
  assert.equal(withoutId.documents[0].documentId, '',
    'an absent document id must stay absent - it must never be derived from the object key');
}

/* ------------------------------------------------------------------ *
 * 4. Runtime: the reopen transport is exactly the applicant route
 * ------------------------------------------------------------------ */
const okHeaders = (contentType, disposition) => ({
  get: (k) => {
    const key = String(k).toLowerCase();
    if (key === 'content-type') return contentType;
    if (key === 'content-disposition') return disposition;
    return null;
  }
});

{
  const calls = [];
  const sentinel = { size: 12, type: 'application/pdf' };
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: okHeaders('application/pdf', `attachment; filename="application-document-${DOC_ID}.pdf"`),
      async blob() { return sentinel; },
      async json() { return null; }
    };
  };
  const bridge = createApplicationReportBridge({ apiBase: 'https://api.example', fetchImpl });
  const result = await bridge.openOwnerApplicationDocument(APP_ID, DOC_ID);
  assert.equal(result.ok, true, 'a 200 document response must succeed');
  assert.equal(result.status, 200);
  assert.equal(result.blob, sentinel, 'the streamed bytes must be handed back untouched');
  assert.equal(result.contentType, 'application/pdf');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.example/api/v1/me/business-applications/${APP_ID}/documents/${DOC_ID}`,
    'the request must address exactly the applicant document route');
  assert.equal(calls[0].init.credentials, 'include', 'the document read must carry the session credentials');
  assert.equal(calls[0].init.method, undefined, 'the document read must be a plain GET');
  assert.ok(!calls[0].url.includes('gdrive') && !calls[0].url.includes('objectKey'),
    'no object key may ever appear in the document request URL');
  assert.ok(!calls[0].url.includes('?'), 'the document route must not be parameterised by a caller-supplied key');
}

/* --- malformed or missing ids fail closed BEFORE any network call --- */
for (const [label, appId, docId] of [
  ['malformed applicationId', 'not-a-uuid', DOC_ID],
  ['malformed documentId', APP_ID, '12345'],
  ['missing documentId', APP_ID, undefined],
  ['empty documentId', APP_ID, ''],
  ['object key used as documentId', APP_ID, 'gdrive/private/application-document/abcdefghij']
]) {
  let called = 0;
  const bridge = createApplicationReportBridge({
    apiBase: 'https://api.example',
    fetchImpl: async () => { called += 1; throw new Error('must not be reached'); }
  });
  const result = await bridge.openOwnerApplicationDocument(appId, docId);
  assert.equal(result.ok, false, `${label} must not succeed`);
  assert.equal(result.reason, 'validation-error', `${label} must fail closed as a validation error`);
  assert.equal(called, 0, `${label} must fail closed before any network call`);
}

/* --- auth / server / network failures map to the shared closed reasons --- */
for (const [status, reason] of [[401, 'auth-required'], [403, 'auth-required'], [404, 'server-error'], [409, 'server-error'], [400, 'server-error'], [503, 'server-error']]) {
  const bridge = createApplicationReportBridge({
    apiBase: 'https://api.example',
    fetchImpl: async () => ({
      ok: false, status,
      headers: okHeaders('application/json', ''),
      async blob() { return null; },
      async json() { return { error: { code: 'X' } }; }
    })
  });
  const result = await bridge.openOwnerApplicationDocument(APP_ID, DOC_ID);
  assert.equal(result.ok, false, `HTTP ${status} must not be reported as success`);
  assert.equal(result.reason, reason, `HTTP ${status} must map to ${reason}`);
}

{
  const bridge = createApplicationReportBridge({
    apiBase: 'https://api.example',
    fetchImpl: async () => { throw new Error('offline'); }
  });
  const result = await bridge.openOwnerApplicationDocument(APP_ID, DOC_ID);
  assert.equal(result.ok, false, 'a transport failure must not be reported as success');
  assert.equal(result.reason, 'network-error');
}

/* --- a rejected owner application still resolves its own documents --- *
 * The backend applicant lane allows pending / changes_requested / approved /
 * rejected, so the frontend must not pre-filter a rejected application out of
 * the reopen surface. */
{
  const calls = [];
  const bridge = createApplicationReportBridge({
    apiBase: 'https://api.example',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/api/v1/me/business-applications')) {
        return {
          ok: true, status: 200,
          async json() {
            return {
              data: [{
                id: APP_ID, business_name: '내 가게', status: 'rejected', review_note: '서류 보완 필요',
                documents: [{ id: DOC_ID, document_kind: 'operation_proof', sort_order: 0 }]
              }]
            };
          }
        };
      }
      return {
        ok: true, status: 200,
        headers: okHeaders('image/png', `inline; filename="application-document-${DOC_ID}"`),
        async blob() { return { size: 3, type: 'image/png' }; },
        async json() { return null; }
      };
    }
  });
  const listed = await bridge.listOwnerApplications();
  assert.equal(listed.ok, true);
  assert.equal(listed.data[0].status, 'rejected', 'a rejected application must still be listed for its owner');
  const docId = listed.data[0].documents[0].documentId;
  assert.equal(docId, DOC_ID);
  const reopened = await bridge.openOwnerApplicationDocument(listed.data[0].id, docId);
  assert.equal(reopened.ok, true, 'the rejected owner must still be able to reopen their own document');
  assert.ok(calls[1].url.endsWith(`/documents/${DOC_ID}`), 'the reopen must hit the applicant document route');
  assert.equal(calls[1].url.includes(OTHER_ID), false, 'another application id must never leak into the request');
}

/* ------------------------------------------------------------------ *
 * 5. Canonical merged backend wire shape (#365)
 * ------------------------------------------------------------------ *
 * The owner list lane in the merged backend (core-v1 GET
 * /api/v1/me/business-applications, #362) emits every document with the exact
 * camelCase keys { id, objectKey, kind, sortOrder }:
 *
 *   json_build_object('id', d.id, 'objectKey', d.object_key,
 *                     'kind', d.document_kind, 'sortOrder', d.sort_order)
 *
 * and the resident-economy document reader (#362) emits the same four keys.
 * The sections above mainly exercise the snake_case aliases, so they would not
 * catch a future frontend regression that drops or reorders the canonical
 * camelCase reads. These assertions pin the canonical shape directly.
 *
 * Test-only: no runtime defect was found while writing this section.
 */

/* --- source contract: the canonical camelCase keys are read first, in order --- */
assert.ok(
  bridgeSrc.includes("documentId: String(doc.id ?? doc.documentId ?? doc.document_id ?? '')"),
  'the bridge must read the canonical document id first (id -> documentId)'
);
assert.ok(
  bridgeSrc.includes("objectKey: String(doc.objectKey ?? doc.object_key ?? '')"),
  'the bridge must read the canonical camelCase objectKey first'
);
assert.ok(
  bridgeSrc.includes("kind: String(doc.kind ?? doc.document_kind ?? '')"),
  'the bridge must read the canonical camelCase kind first'
);
assert.ok(
  bridgeSrc.includes("sortOrder: Number(doc.sortOrder ?? doc.sort_order ?? 0)"),
  'the bridge must read the canonical camelCase sortOrder first'
);

const DOC_ID_2 = '44444444-4444-4444-8444-444444444444';
const CANONICAL_KEY_1 = 'gdrive/private/application-document/aaaaaaaaaa';
const CANONICAL_KEY_2 = 'gdrive/private/application-document/bbbbbbbbbb';

/* --- runtime: the exact merged camelCase shape normalizes completely --- */
{
  const normalized = normalizeOwnerApplication({
    id: APP_ID,
    business_name: '내 가게',
    status: 'approved',
    documents: [
      { id: DOC_ID, objectKey: CANONICAL_KEY_1, kind: 'operation_proof', sortOrder: 2 },
      { id: DOC_ID_2, objectKey: CANONICAL_KEY_2, kind: 'other_evidence', sortOrder: 0 }
    ]
  });

  assert.equal(normalized.documents.length, 2, 'both canonical documents must survive normalization');
  assert.deepEqual(normalized.documents.map(d => d.documentId), [DOC_ID, DOC_ID_2],
    'each document must keep its own server-issued id - ids must never be cross-wired');
  assert.equal(normalized.documents[0].documentId, DOC_ID, 'the canonical id must normalize to documentId');
  assert.equal(normalized.documents[0].objectKey, CANONICAL_KEY_1, 'the canonical objectKey must be preserved verbatim');
  assert.equal(normalized.documents[0].kind, 'operation_proof', 'the canonical kind must be preserved verbatim');
  assert.equal(normalized.documents[0].sortOrder, 2, 'the canonical sortOrder must be preserved as a number');
  assert.equal(normalized.documents[1].sortOrder, 0, 'a canonical zero sortOrder must survive');
  assert.deepEqual(normalized.documents.map(d => d.sortOrder), [2, 0],
    'the frontend must not re-sort - the merged backend owns document ordering');
  for (const doc of normalized.documents) {
    assert.equal(typeof doc.sortOrder, 'number', 'sortOrder must always normalize to a number');
    assert.equal(typeof doc.documentId, 'string', 'documentId must always normalize to a string');
    assert.equal(typeof doc.objectKey, 'string', 'objectKey must always normalize to a string');
  }
}

/* --- canonical camelCase is the authority when both shapes are present --- */
{
  const both = normalizeOwnerApplication({
    id: APP_ID,
    business_name: '내 가게',
    status: 'pending',
    documents: [{
      id: DOC_ID, document_id: DOC_ID_2,
      objectKey: 'CANONICAL', object_key: 'LEGACY',
      kind: 'operation_proof', document_kind: 'other_evidence',
      sortOrder: 7, sort_order: 9
    }]
  });
  assert.equal(both.documents[0].documentId, DOC_ID, 'the canonical id must win over document_id');
  assert.equal(both.documents[0].objectKey, 'CANONICAL', 'the canonical objectKey must win over object_key');
  assert.equal(both.documents[0].kind, 'operation_proof', 'the canonical kind must win over document_kind');
  assert.equal(both.documents[0].sortOrder, 7, 'the canonical sortOrder must win over sort_order');
}

/* --- a canonical zero sortOrder must not fall through to the snake_case alias --- */
{
  const zero = normalizeOwnerApplication({
    id: APP_ID, business_name: '내 가게', status: 'pending',
    documents: [{ sortOrder: 0, sort_order: 5 }]
  });
  assert.equal(zero.documents[0].sortOrder, 0,
    'a canonical sortOrder of 0 must not be replaced by the alias - the reads use nullish coalescing, not ||');
}

/* --- a numeric-string sortOrder must still normalize to a number --- */
{
  const coerced = normalizeOwnerApplication({
    id: APP_ID, business_name: '내 가게', status: 'pending',
    documents: [{ id: DOC_ID, objectKey: CANONICAL_KEY_1, kind: 'operation_proof', sortOrder: '3' }]
  });
  assert.equal(coerced.documents[0].sortOrder, 3, 'a numeric-string sortOrder must normalize to a number');
}

/* --- a canonical document without an id keeps objectKey/kind but gains no reopen authority --- */
{
  const noId = normalizeOwnerApplication({
    id: APP_ID, business_name: '내 가게', status: 'pending',
    documents: [{ objectKey: CANONICAL_KEY_1, kind: 'operation_proof', sortOrder: 0 }]
  });
  assert.equal(noId.documents[0].documentId, '',
    'an absent canonical id must stay absent - it must never be derived from the canonical objectKey');
  assert.equal(noId.documents[0].objectKey, CANONICAL_KEY_1,
    'the objectKey is still carried for display, but it carries no reopen authority');
}

/* --- an application without documents coalesces to a truthful empty list --- */
{
  const none = normalizeOwnerApplication({ id: APP_ID, business_name: '내 가게', status: 'pending' });
  assert.deepEqual(none.documents, [], 'an application without documents must normalize to an empty list');
}

/* --- end to end: canonical list shape -> reopen through the private route --- */
{
  const calls = [];
  const bridge = createApplicationReportBridge({
    apiBase: 'https://api.example',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/api/v1/me/business-applications')) {
        return {
          ok: true, status: 200,
          async json() {
            return {
              data: [{
                id: APP_ID, business_name: '내 가게', status: 'changes_requested',
                documents: [
                  { id: DOC_ID, objectKey: CANONICAL_KEY_1, kind: 'operation_proof', sortOrder: 1 },
                  { id: DOC_ID_2, objectKey: CANONICAL_KEY_2, kind: 'additional_reference', sortOrder: 2 }
                ]
              }]
            };
          }
        };
      }
      return {
        ok: true, status: 200,
        headers: okHeaders('application/pdf', `attachment; filename="application-document-${DOC_ID_2}.pdf"`),
        async blob() { return { size: 8, type: 'application/pdf' }; },
        async json() { return null; }
      };
    }
  });

  const listed = await bridge.listOwnerApplications();
  assert.equal(listed.ok, true, 'the canonical owner list response must be accepted');
  assert.deepEqual(listed.data[0].documents.map(d => d.documentId), [DOC_ID, DOC_ID_2],
    'the merged canonical list shape must reach the UI with both ids intact');

  const target = listed.data[0].documents[1];
  const reopened = await bridge.openOwnerApplicationDocument(listed.data[0].id, target.documentId);
  assert.equal(reopened.ok, true, 'the canonical documentId must reopen the document');
  assert.equal(calls.length, 2, 'the list then the reopen must be the only two calls');
  assert.equal(calls[1].url, `https://api.example/api/v1/me/business-applications/${APP_ID}/documents/${DOC_ID_2}`,
    'the reopen must be addressed only by applicationId + documentId');
  assert.ok(calls[1].url.endsWith(`/documents/${DOC_ID_2}`),
    'the reopen must use the second document own id, never the first');
  for (const forbidden of [CANONICAL_KEY_1, CANONICAL_KEY_2, 'gdrive', 'drive.google', 'storage/public', 'objectKey', 'sortOrder']) {
    assert.equal(calls[1].url.includes(forbidden), false,
      `the reopen URL must never carry ${forbidden}`);
  }
  assert.equal(calls[1].url.includes('?'), false,
    'the reopen route must not be parameterised by a caller-supplied key');
}

/* --- the objectKey can never be substituted for the documentId --- */
{
  let called = 0;
  const bridge = createApplicationReportBridge({
    apiBase: 'https://api.example',
    fetchImpl: async () => { called += 1; throw new Error('must not be reached'); }
  });
  const asKey = await bridge.openOwnerApplicationDocument(APP_ID, CANONICAL_KEY_1);
  assert.equal(asKey.ok, false, 'a canonical objectKey must never reopen a document');
  assert.equal(asKey.reason, 'validation-error', 'the objectKey must fail closed as a validation error');
  assert.equal(called, 0, 'the objectKey must fail closed before any network call');
  assert.equal(bridge.openOwnerApplicationDocument.length, 2,
    'the reopen method must take exactly (applicationId, documentId) - there is no object-key overload');
}

/* --- 25A hands the canonical documentId to the bridge, never the objectKey --- */
assert.ok(apply25a.includes('reopen(applicationId,doc.documentId,button)'),
  '25A must reopen with the normalized documentId');
assert.ok(!/reopen\([^)]*objectKey/.test(apply25a),
  '25A must never pass an object key into the reopen path');

console.log('leaf-b12-owner-application-status-contract: PASS');
