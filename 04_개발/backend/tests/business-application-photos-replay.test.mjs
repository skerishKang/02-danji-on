import assert from 'node:assert/strict';
import { resolveCreateReplay } from '../src/resident-economy-v2.ts';

// GAP-4 CENTRAL-REVIEW: executable guard for the idempotent replay path.
// Strings prove structure; this proves runtime behaviour:
//  - a completed request replays its stored gallery AND persisted documents
//    with NO object revalidation (no DB transaction is opened),
//  - a fingerprint mismatch rejects before any read,
//  - a gallery OR document read outage FAILS CLOSED (503), never a success with
//    an empty persisted set.

const REQUEST_ID = 'req-replay';
const FINGERPRINT = 'fp-match';
const KEY_A = 'gdrive/public/business-image/file_aaaaaaaaaa';
const KEY_B = 'gdrive/public/business-image/file_bbbbbbbbbb';
const DOC_1 = 'gdrive/private/application-document/doc_11111111';

function makeSql({
  galleryRows = [],
  documentRows = [],
  galleryFails = false,
  documentFails = false
} = {}, { transactionShouldNotRun = true } = {}) {
  const state = { reads: 0, transactions: 0 };
  const sql = (strings) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings ?? '');
    state.reads += 1;
    if (/business_application_documents/i.test(text)) {
      return documentFails
        ? Promise.reject(new Error('synthetic document read outage'))
        : Promise.resolve(documentRows);
    }
    return galleryFails
      ? Promise.reject(new Error('synthetic gallery read outage'))
      : Promise.resolve(galleryRows);
  };
  sql.transaction = () => {
    state.transactions += 1;
    if (transactionShouldNotRun) throw new Error('replay must never open a DB transaction');
    return Promise.resolve([]);
  };
  return { sql, state };
}

// Completed request: 200 replay, stored gallery + documents echoed, no transaction.
{
  const { sql, state } = makeSql({
    galleryRows: [{ object_key: KEY_A }, { object_key: KEY_B }],
    documentRows: [{ id: '11111111-1111-4111-8111-111111111111', object_key: DOC_1, document_kind: 'operation_proof', sort_order: 0 }]
  });
  const res = await resolveCreateReplay(sql, { id: 'app-1', submission_fingerprint: FINGERPRINT }, FINGERPRINT, REQUEST_ID);
  assert.ok(res instanceof Response, 'replay returns a Response');
  assert.equal(res.status, 200, 'a matching completed request replays as 200');
  const body = await res.json();
  assert.equal(body.data.idempotency_replayed, true, 'replay must be flagged idempotency_replayed');
  assert.deepEqual(body.data.photoObjectKeys, [KEY_A, KEY_B], 'replay must return the persisted gallery');
  assert.deepEqual(
    body.data.documents,
    [{ id: '11111111-1111-4111-8111-111111111111', objectKey: DOC_1, kind: 'operation_proof', sortOrder: 0 }],
    'replay must return the persisted document set'
  );
  assert.equal(state.transactions, 0, 'replay must not open a write transaction');
  assert.equal(state.reads, 2, 'replay must issue the gallery read then the document read (no registry/Drive revalidation)');
}

// Fingerprint mismatch: 409 IDEMPOTENCY_KEY_REUSED before any read.
{
  const { sql, state } = makeSql({ galleryRows: [{ object_key: KEY_A }] });
  const res = await resolveCreateReplay(sql, { id: 'app-1', submission_fingerprint: 'fp-different' }, FINGERPRINT, REQUEST_ID);
  assert.equal(res.status, 409, 'same key + different body must reject with 409');
  const body = await res.json();
  assert.equal(body.error.code, 'IDEMPOTENCY_KEY_REUSED', 'mismatch must surface IDEMPOTENCY_KEY_REUSED');
  assert.equal(state.reads, 0, 'a mismatch must reject before reading anything');
}

// Gallery read outage: FAIL CLOSED with 503, never a success with an empty gallery.
{
  const { sql, state } = makeSql({ galleryRows: [{ object_key: KEY_A }], galleryFails: true });
  const res = await resolveCreateReplay(sql, { id: 'app-1', submission_fingerprint: FINGERPRINT }, FINGERPRINT, REQUEST_ID);
  assert.equal(res.status, 503, 'a persisted-gallery read failure must fail closed (503)');
  const body = await res.json();
  assert.equal(body.error.code, 'GALLERY_READ_UNAVAILABLE', 'must surface GALLERY_READ_UNAVAILABLE');
  assert.equal(state.reads, 1, 'the gallery read must be attempted exactly once before failing closed');
}

// Document read outage (gallery ok): FAIL CLOSED with 503, never a replay that
// reports a persisted document set as empty.
{
  const { sql, state } = makeSql({
    galleryRows: [{ object_key: KEY_A }],
    documentRows: [{ id: '11111111-1111-4111-8111-111111111111', object_key: DOC_1, document_kind: 'operation_proof', sort_order: 0 }],
    documentFails: true
  });
  const res = await resolveCreateReplay(sql, { id: 'app-1', submission_fingerprint: FINGERPRINT }, FINGERPRINT, REQUEST_ID);
  assert.equal(res.status, 503, 'a persisted-document read failure must fail closed (503)');
  const body = await res.json();
  assert.equal(body.error.code, 'DOCUMENT_REGISTRY_UNAVAILABLE', 'must surface DOCUMENT_REGISTRY_UNAVAILABLE');
  assert.equal(state.reads, 2, 'the gallery read succeeds then the document read fails closed');
}

// Genuinely new request (no completed match): fall through to create.
{
  const { sql } = makeSql();
  const res = await resolveCreateReplay(sql, null, FINGERPRINT, REQUEST_ID);
  assert.equal(res, null, 'no completed match must return null so create proceeds');
}

console.log('PASS business application photos replay: order-independent, no object revalidation, fail-closed gallery and document reads');
