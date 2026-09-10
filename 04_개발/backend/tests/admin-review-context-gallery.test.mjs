import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readApplicationPhotoGallery } from '../src/admin-review-context-v1.ts';

// GAP-4 CENTRAL-REVIEW: reviewer gallery visibility contract.
// The admin review context must expose the full persisted
// business_application_photos gallery, ordered by sort_order, scoped to the
// application. Strings prove structure; this proves runtime behaviour:
//  - rows come back in the persisted sort_order,
//  - an empty read yields [] (never undefined, never a downgrade),
//  - a database failure propagates (fail closed; the caller turns it into 500),
//  - malformed rows cannot leak empty keys.

const REQUEST_ID = 'req-gallery';
const APP_ID = '0f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5061';
const KEY_A = 'gdrive/public/business-image/file_aaaaaaaaaa';
const KEY_B = 'gdrive/public/business-image/file_bbbbbbbbbb';
const KEY_C = 'gdrive/public/business-image/file_cccccccccc';

function makeSql(rows, { failRead = false } = {}) {
  const state = { reads: 0, lastQuery: '', lastParams: [] };
  const sql = (strings, ...params) => {
    state.reads += 1;
    state.lastQuery = strings.join('?');
    state.lastParams = params;
    if (failRead) return Promise.reject(new Error('db outage'));
    return Promise.resolve(rows);
  };
  return { sql, state };
}

// 1. Deterministic gallery: sort_order sequence preserved, keys returned as-is.
{
  const { sql, state } = makeSql([
    { object_key: KEY_A },
    { object_key: KEY_B },
    { object_key: KEY_C }
  ]);
  const keys = await readApplicationPhotoGallery(sql, APP_ID);
  assert.deepEqual(keys, [KEY_A, KEY_B, KEY_C], 'gallery must preserve the persisted sort_order sequence');
  assert.equal(state.reads, 1, 'gallery read must be exactly one query');
  assert.match(state.lastQuery, /from business_application_photos/, 'gallery must read the GAP-4 table');
  assert.match(state.lastQuery, /where application_id = \?::uuid/, 'gallery must be scoped to one application id');
  assert.match(state.lastQuery, /order by sort_order asc/, 'gallery must be ordered by sort_order ascending');
  assert.deepEqual(state.lastParams, [APP_ID], 'the only query parameter must be the application id');
}

// 2. Missing gallery => [] only when the read succeeds with no rows.
{
  const { sql } = makeSql([]);
  const keys = await readApplicationPhotoGallery(sql, APP_ID);
  assert.deepEqual(keys, [], 'a successful read with no rows must return an empty array');
}

// 3. DB read failure must propagate (fail closed), never [] or a silent downgrade.
{
  const { sql } = makeSql([], { failRead: true });
  await assert.rejects(
    () => readApplicationPhotoGallery(sql, APP_ID),
    /db outage/,
    'a failed gallery read must reject so the endpoint fails closed (500), never representative-only'
  );
}

// 4. Malformed rows cannot leak empty keys.
{
  const { sql } = makeSql([{ object_key: KEY_A }, { object_key: null }, {}, { object_key: '' }]);
  const keys = await readApplicationPhotoGallery(sql, APP_ID);
  assert.deepEqual(keys, [KEY_A], 'null/missing/empty object_key rows must be filtered out');
}

// 5. Handler wiring (structural): the gallery is read only after operator
// authorization, exposed as photoObjectKeys, and the representative mirror
// stays in the response for backward compatibility.
{
  const review = await readFile(new URL('../src/admin-review-context-v1.ts', import.meta.url), 'utf8');
  const idxAuthz = review.indexOf('if (operator instanceof Response) return operator;');
  const idxRead = review.indexOf('await readApplicationPhotoGallery(sql, String(row.id))');
  const idxResponse = review.indexOf('photoObjectKeys,');
  assert.ok(idxAuthz > -1 && idxRead > idxAuthz, 'gallery read must run only after operator authorization');
  assert.ok(idxResponse > idxRead, 'photoObjectKeys must be part of the authorized response');
  assert.match(review, /representativeImageObjectKey: row\.representative_image_object_key/, 'representative mirror must remain backward compatible');
  assert.doesNotMatch(review, /resident-evidence|application-document/i, 'no private document semantics may enter the reviewer gallery');
  assert.doesNotMatch(review, /select \*[\s\S]*from business_application_photos/, 'gallery read must select explicit columns only');
}

// 6. Storage authorization regression guard: the gallery exposes object keys
// only (business-image visibility is unchanged); no stream/download route or
// private-route logic may be added to this module.
{
  const review = await readFile(new URL('../src/admin-review-context-v1.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(review, /streamObject|visibility\s*===\s*'private'/, 'review context must never serve object bytes or private visibility paths');
  assert.doesNotMatch(review, /gdrive\/private/, 'no private object key namespace may appear in review context');
}

console.log(`Admin review context gallery contract PASS: scoped+ordered gallery, [] on empty, fail closed on outage (${REQUEST_ID})`);
