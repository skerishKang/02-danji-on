import assert from 'node:assert/strict';
import { resolveCreateReplay } from '../src/resident-economy-v2.ts';

// GAP-4 CENTRAL-REVIEW: executable guard for the idempotent replay path.
// Strings prove structure; this proves runtime behaviour:
//  - a completed request replays its stored gallery with NO object revalidation
//    (no transaction is opened and only the gallery read runs),
//  - a fingerprint mismatch rejects before any gallery read,
//  - a gallery read outage FAILS CLOSED (503), never a success with an empty gallery.

const REQUEST_ID = 'req-replay';
const FINGERPRINT = 'fp-match';
const KEY_A = 'gdrive/public/business-image/file_aaaaaaaaaa';
const KEY_B = 'gdrive/public/business-image/file_bbbbbbbbbb';

function makeSql(rows, { transactionShouldNotRun = true } = {}) {
  const state = { reads: 0, transactions: 0 };
  const sql = () => {
    state.reads += 1;
    return Promise.resolve(rows);
  };
  sql.transaction = () => {
    state.transactions += 1;
    if (transactionShouldNotRun) throw new Error('replay must never open a DB transaction');
    return Promise.resolve([]);
  };
  return { sql, state };
}

// Completed request: 200 replay, stored gallery echoed, no transaction, one read.
{
  const { sql, state } = makeSql([{ object_key: KEY_A }, { object_key: KEY_B }]);
  const res = await resolveCreateReplay(sql, { id: 'app-1', submission_fingerprint: FINGERPRINT }, FINGERPRINT, REQUEST_ID);
  assert.ok(res instanceof Response, 'replay returns a Response');
  assert.equal(res.status, 200, 'a matching completed request replays as 200');
  const body = await res.json();
  assert.equal(body.data.idempotency_replayed, true, 'replay must be flagged idempotency_replayed');
  assert.deepEqual(body.data.photoObjectKeys, [KEY_A, KEY_B], 'replay must return the persisted gallery');
  assert.equal(state.transactions, 0, 'replay must not open a write transaction');
  assert.equal(state.reads, 1, 'replay must issue only the gallery read (no registry/Drive revalidation)');
}

// Fingerprint mismatch: 409 IDEMPOTENCY_KEY_REUSED before any gallery read.
{
  const { sql, state } = makeSql([{ object_key: KEY_A }]);
  const res = await resolveCreateReplay(sql, { id: 'app-1', submission_fingerprint: 'fp-different' }, FINGERPRINT, REQUEST_ID);
  assert.equal(res.status, 409, 'same key + different body must reject with 409');
  const body = await res.json();
  assert.equal(body.error.code, 'IDEMPOTENCY_KEY_REUSED', 'mismatch must surface IDEMPOTENCY_KEY_REUSED');
  assert.equal(state.reads, 0, 'a mismatch must reject before reading the gallery');
}

// Gallery read outage: FAIL CLOSED with 503, never a success with an empty gallery.
{
  const state = { reads: 0 };
  const sql = () => {
    state.reads += 1;
    return Promise.reject(new Error('synthetic gallery read outage'));
  };
  sql.transaction = () => {
    throw new Error('replay must not open a DB transaction');
  };
  const res = await resolveCreateReplay(sql, { id: 'app-1', submission_fingerprint: FINGERPRINT }, FINGERPRINT, REQUEST_ID);
  assert.equal(res.status, 503, 'a persisted-gallery read failure must fail closed (503)');
  const body = await res.json();
  assert.equal(body.error.code, 'GALLERY_READ_UNAVAILABLE', 'must surface GALLERY_READ_UNAVAILABLE');
  assert.equal(state.reads, 1, 'the read must be attempted exactly once before failing closed');
}

// Genuinely new request (no completed match): fall through to create.
{
  const { sql } = makeSql([]);
  const res = await resolveCreateReplay(sql, null, FINGERPRINT, REQUEST_ID);
  assert.equal(res, null, 'no completed match must return null so create proceeds');
}

console.log('PASS business application photos replay: order-independent, no object revalidation, fail-closed gallery read');
