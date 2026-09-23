/**
 * #910 CENTRAL_MERGE_BLOCKER=R2_DELETE_LIFECYCLE_PARITY — runtime regression.
 *
 * The R2 delete lane previously short-circuited removeObject(): an R2 head hit
 * led straight to r2Delete() with only an uploader check for the image kinds,
 * bypassing:
 *   - business-image reference checks + active -> delete_pending -> retired
 *   - application-document reference (DOCUMENT_IN_USE) + uploader authorization
 *   - official-news-image official-content.manage authority, post reference
 *     check and the durable delete intent/retirement
 *
 * This test drives the REAL route entry (handleStorageRequest DELETE) in R2 mode
 * against a stateful SQL double and an in-memory R2 bucket double and locks:
 *   R2_BUSINESS_IMAGE_FULL_LIFECYCLE     intent -> r2Delete -> retired
 *   R2_BUSINESS_IMAGE_IN_USE_409         reference wins, object untouched
 *   R2_BUSINESS_IMAGE_DELETE_PENDING     reconcile -> r2Delete -> retired
 *   R2_BUSINESS_IMAGE_UNREGISTERED       legacy path keeps #105 guard, r2Delete
 *   R2_APPLICATION_DOCUMENT_IN_USE_409   reference wins, object untouched
 *   R2_APPLICATION_DOCUMENT_DELETE_200   uploader only, r2Delete runs
 *   R2_APPLICATION_DOCUMENT_NON_UPLOADER private HOLD deny (Drive parity)
 *   R2_OFFICIAL_NEWS_FULL_LIFECYCLE      official-content.manage (non-uploader)
 *   R2_OFFICIAL_NEWS_POST_IN_USE_409     post reference wins, object untouched
 *   R2_OFFICIAL_NEWS_DELETE_PENDING      reconcile -> r2Delete -> retired
 *   R2_OFFICIAL_NEWS_AUTHORITY_DENIED    no uploader shortcut around authority
 *   R2_ONLY_MISS_FAIL_CLOSED_404         no Drive/network touch, object kept
 *   MIGRATION_WINDOW_DRIVE_FALLBACK      r2 miss + Drive credentials retire via Drive
 *
 * The neon driver is swapped by the test-only loader (tests/helpers/neon-stub-*).
 * Run: npx tsx --import ./tests/helpers/neon-stub-loader.mjs tests/r2-delete-lifecycle-parity.test.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleStorageRequest } from '../src/storage-v1.ts';

const root = new URL('../', import.meta.url);
const storageSource = await readFile(new URL('src/storage-v1.ts', root), 'utf8');

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '33333333-3333-4333-8333-333333333333';
const COMPLEX_ID = '22222222-2222-4222-8222-222222222222';
const COMPLEX_SLUG = 'bangnim-myeongji-roadhill';
const SUBJECT = 'dev-auth-subject-r2-delete';
const FOLDER_ID = 'drive_public_folder_1234567890';

const BUSINESS_FILE = 'bir2fileid0123456789abcd';
const DOC_FILE = 'adr2fileid0123456789abcdef';
const OFFICIAL_FILE = 'onir2fileid0123456789abcde';
const BUSINESS_KEY = `gdrive/public/business-image/${BUSINESS_FILE}`;
const DOC_KEY = `gdrive/private/application-document/${DOC_FILE}`;
const OFFICIAL_KEY = `gdrive/public/official-news-image/${OFFICIAL_FILE}`;

function r2KeyFor(kind, fileId) {
  const visibility = kind === 'application-document' ? 'private' : 'public';
  return `gdrive/${visibility}/${kind}/${fileId}`;
}

function makeBucket(events) {
  const objects = new Map();
  return {
    deletes: () => events.filter((event) => event === 'r2-delete').length,
    has: (kind, fileId) => objects.has(r2KeyFor(kind, fileId)),
    seed(kind, fileId, extraMetadata = {}) {
      const visibility = kind === 'application-document' ? 'private' : 'public';
      objects.set(r2KeyFor(kind, fileId), {
        size: 128,
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          originalFileName: 'file.png',
          danjionKind: kind,
          danjionVisibility: visibility,
          danjionUploaderUserId: ACTOR_ID,
          ...extraMetadata
        }
      });
    },
    async head(key) {
      return objects.get(key) || null;
    },
    async get() {
      return null;
    },
    async put() {
      throw new Error('unexpected R2 put in the delete lane');
    },
    async delete(key) {
      events.push('r2-delete');
      objects.delete(key);
    }
  };
}


// Stateful SQL double. Plain tagged calls return a lazily-executed thenable
// descriptor so the same function satisfies both `await sql`...`` and
// `sql.transaction([sql`...`, sql`...`])` (the neon driver contract).
function makeSql(fixture, events) {
  const live = { state: fixture.state ?? 'active' };
  const run = (text) => {
    if (text.includes("set state = 'retired'")) {
      if (live.state === 'delete_pending') {
        live.state = 'retired';
        events.push('finalize-retired');
        return [{ state: 'retired' }];
      }
      return [];
    }
    if (text.includes('select state from business_image_objects')) return [{ state: live.state }];
    if (text.includes('from app_users')) {
      return [{ id: ACTOR_ID, auth_user_id: SUBJECT, display_name: 'R2 Delete Actor', account_status: 'active' }];
    }
    if (text.includes('from business_image_objects')) {
      if (fixture.unregistered) return [];
      return [{
        object_key: fixture.objectKey,
        uploader_user_id: fixture.uploader ?? ACTOR_ID,
        complex_id: COMPLEX_ID,
        state: live.state
      }];
    }
    if (text.includes('from business_application_documents bad')) {
      return [{ document_in_use: fixture.documentInUse === true }];
    }
    if (text.includes('from business_media bm')) {
      return [{ business_media_in_use: false, application_in_use: false, application_photos_in_use: false }];
    }
    if (text.includes('padiem_operator_grants')) {
      if (fixture.authorityDenied) return [];
      return [{
        complex_id: COMPLEX_ID,
        complex_slug: COMPLEX_SLUG,
        padiem_grant_id: 'grant-official-content',
        padiem_granted_scope: 'official-content.manage',
        council_grant_id: null,
        council_granted_scope: null
      }];
    }
    if (text.includes('insert into audit_events')) return [];
    if (text.includes('select slug') && text.includes('from complexes')) return [{ slug: COMPLEX_SLUG }];
    if (text.includes('from complex_posts')) return [{ post_in_use: fixture.postInUse === true }];
    throw new Error(`unexpected sql in r2 delete parity test: ${text.slice(0, 160)}`);
  };
  const sql = (strings, ...values) => {
    const text = strings.join(' ');
    return {
      text,
      values,
      then(onFulfilled, onRejected) {
        return Promise.resolve().then(() => run(text)).then(onFulfilled, onRejected);
      }
    };
  };
  sql.transaction = async (queries) => {
    assert.equal(queries.length, 2, 'delete intent must be one 2-statement transaction');
    const [lock, decision] = queries;
    assert.match(lock.text, /for update/, 'the registry row must be locked first');
    assert.match(decision.text, /set state = 'delete_pending'/, 'the same transaction must acquire the intent');
    if (fixture.unregistered) return [[], []];
    events.push('lock-row');
    const official = decision.text.includes('post_in_use');
    const inUse = official ? fixture.postInUse === true : fixture.businessInUse === true;
    if (inUse) {
      events.push('intent-refused');
      return [
        [{ object_key: fixture.objectKey, uploader_user_id: fixture.uploader ?? ACTOR_ID, complex_id: COMPLEX_ID, state: live.state }],
        [official
          ? { state: live.state, post_in_use: true, delete_intent_acquired: false }
          : {
              state: live.state,
              uploader_user_id: fixture.uploader ?? ACTOR_ID,
              business_media_in_use: true,
              application_in_use: false,
              application_photos_in_use: false,
              delete_intent_acquired: false
            }]
      ];
    }
    const acquired = live.state === 'active';
    if (acquired) live.state = 'delete_pending';
    events.push(acquired ? 'intent-acquired' : 'intent-skipped');
    return [
      [{ object_key: fixture.objectKey, uploader_user_id: fixture.uploader ?? ACTOR_ID, complex_id: COMPLEX_ID, state: live.state }],
      [official
        ? { state: live.state, post_in_use: false, delete_intent_acquired: acquired }
        : {
            state: live.state,
            uploader_user_id: fixture.uploader ?? ACTOR_ID,
            business_media_in_use: false,
            application_in_use: false,
            application_photos_in_use: false,
            delete_intent_acquired: acquired
          }]
    ];
  };
  return { sql, state: () => live.state };
}

function makeR2Env(bucket) {
  return {
    DATABASE_URL: 'postgres://unused-in-stub-test',
    APP_ENV: 'development',
    DEV_AUTH_BYPASS: 'true',
    STORAGE_MODE: 'r2',
    DANJION_STORAGE: bucket
  };
}

function makeMigrationWindowEnv(bucket) {
  return {
    ...makeR2Env(bucket),
    GOOGLE_DRIVE_CLIENT_ID: 'stub-client-id',
    GOOGLE_DRIVE_CLIENT_SECRET: 'stub-client-secret',
    GOOGLE_DRIVE_REFRESH_TOKEN: 'stub-refresh-token',
    GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID: FOLDER_ID
  };
}

function deleteRequest(objectKey) {
  return new Request(`http://test/api/v1/storage/objects?objectKey=${encodeURIComponent(objectKey)}`, {
    method: 'DELETE',
    headers: { 'x-danjion-dev-auth-user': SUBJECT }
  });
}

async function runDelete(fixture, requestId, options = {}) {
  const events = [];
  const bucket = makeBucket(events);
  if (options.seed) options.seed(bucket);
  const env = (options.dual ? makeMigrationWindowEnv : makeR2Env)(bucket);
  const harness = makeSql(fixture, events);
  globalThis.__DANJION_TEST_SQL__ = harness.sql;
  try {
    const response = await handleStorageRequest(deleteRequest(fixture.objectKey), env, requestId);
    assert.ok(response instanceof Response, 'DELETE route must answer, never fall through');
    return { response, body: await response.json(), events, bucket, harness };
  } finally {
    delete globalThis.__DANJION_TEST_SQL__;
  }
}

const realFetch = globalThis.fetch;
function installFetchStub(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ href: String(url), method: init?.method || 'GET' });
    return handler(String(url), init);
  };
  return calls;
}
function restoreFetch() {
  globalThis.fetch = realFetch;
}

/* ---------------------------------------------------------------------- */
/* business-image: full lifecycle                                          */
/* ---------------------------------------------------------------------- */

// R2_BUSINESS_IMAGE_FULL_LIFECYCLE: reference check + durable intent + r2Delete + retired.
{
  const { response, body, events, bucket, harness } = await runDelete(
    { objectKey: BUSINESS_KEY, state: 'active' },
    'req-r2-bi-full',
    { seed: (b) => b.seed('business-image', BUSINESS_FILE) }
  );
  assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(body)}`);
  assert.equal(body.data.objectKey, BUSINESS_KEY);
  assert.equal(body.data.deleted, true);
  assert.equal(body.data.retired, true, 'the registry row must retire, not just the object');
  assert.equal(bucket.deletes(), 1, 'exactly one R2 delete');
  assert.equal(bucket.has('business-image', BUSINESS_FILE), false);
  assert.equal(harness.state(), 'retired');
  assert.deepEqual(
    events.filter((event) => event !== 'r2-delete'),
    ['lock-row', 'intent-acquired', 'finalize-retired'],
    'delete intent must commit before the physical delete and the finalize'
  );
  assert.ok(events.indexOf('intent-acquired') < events.indexOf('r2-delete'), 'r2Delete only after intent');
  assert.ok(events.indexOf('r2-delete') < events.indexOf('finalize-retired'), 'finalize only after r2Delete');
  console.log('PASS R2_BUSINESS_IMAGE_FULL_LIFECYCLE intent->r2Delete->retired');
}

// R2_BUSINESS_IMAGE_IN_USE_409: a product reference blocks deletion; object untouched.
{
  const { response, body, events, bucket, harness } = await runDelete(
    { objectKey: BUSINESS_KEY, state: 'active', businessInUse: true },
    'req-r2-bi-in-use',
    { seed: (b) => b.seed('business-image', BUSINESS_FILE) }
  );
  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'BUSINESS_IMAGE_IN_USE');
  assert.equal(bucket.deletes(), 0, 'a referenced image must never reach r2Delete');
  assert.equal(bucket.has('business-image', BUSINESS_FILE), true);
  assert.equal(harness.state(), 'active');
  assert.deepEqual(events, ['lock-row', 'intent-refused']);
  console.log('PASS R2_BUSINESS_IMAGE_IN_USE_409 reference wins, object untouched');
}

// R2_BUSINESS_IMAGE_DELETE_PENDING: reconcile drives the R2 delete and retires.
{
  const { response, body, events, bucket, harness } = await runDelete(
    { objectKey: BUSINESS_KEY, state: 'delete_pending' },
    'req-r2-bi-pending',
    { seed: (b) => b.seed('business-image', BUSINESS_FILE) }
  );
  assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(body)}`);
  assert.equal(body.data.deleted, true);
  assert.equal(body.data.retired, true);
  // Drive-parity: when the remote delete actually runs, the response carries
  // { deleted, retired } and no `reconciled` flag (that flag is only set when
  // the object was already gone/trashed).
  assert.equal(body.data.reconciled, undefined);
  assert.equal(bucket.deletes(), 1);
  assert.equal(harness.state(), 'retired');
  assert.deepEqual(events, ['r2-delete', 'finalize-retired'], 'delete_pending reconcile must not re-acquire intent');
  console.log('PASS R2_BUSINESS_IMAGE_DELETE_PENDING reconcile->r2Delete->retired');
}

// R2_BUSINESS_IMAGE_UNREGISTERED: legacy path keeps authorization + #105 reference guard.
{
  const { response, body, events, bucket } = await runDelete(
    { objectKey: BUSINESS_KEY, unregistered: true },
    'req-r2-bi-legacy',
    { seed: (b) => b.seed('business-image', BUSINESS_FILE) }
  );
  assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(body)}`);
  assert.equal(body.data.deleted, true);
  assert.equal(body.data.legacyUnregistered, true);
  assert.equal(bucket.deletes(), 1);
  assert.deepEqual(events, ['r2-delete'], 'legacy path must not touch the lifecycle registry');
  console.log('PASS R2_BUSINESS_IMAGE_UNREGISTERED legacy guard kept, r2Delete after conflict check');
}
/* ---------------------------------------------------------------------- */
/* application-document                                                    */
/* ---------------------------------------------------------------------- */

// R2_APPLICATION_DOCUMENT_IN_USE_409: the reference guard runs before any object read.
{
  const { response, body, events, bucket } = await runDelete(
    { objectKey: DOC_KEY, documentInUse: true },
    'req-r2-doc-in-use',
    { seed: (b) => b.seed('application-document', DOC_FILE) }
  );
  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'DOCUMENT_IN_USE');
  assert.equal(bucket.deletes(), 0, 'a referenced document must never reach r2Delete');
  assert.equal(bucket.has('application-document', DOC_FILE), true);
  assert.deepEqual(events, [], 'the reference conflict must stop before any lifecycle/object mutation');
  console.log('PASS R2_APPLICATION_DOCUMENT_IN_USE_409 reference wins, object untouched');
}

// R2_APPLICATION_DOCUMENT_DELETE_200: uploader + unreferenced -> R2 delete.
{
  const { response, body, events, bucket } = await runDelete(
    { objectKey: DOC_KEY, documentInUse: false },
    'req-r2-doc-delete',
    { seed: (b) => b.seed('application-document', DOC_FILE) }
  );
  assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(body)}`);
  assert.equal(body.data.deleted, true);
  assert.equal(bucket.deletes(), 1);
  assert.equal(bucket.has('application-document', DOC_FILE), false);
  assert.deepEqual(events, ['r2-delete'], 'documents have no lifecycle registry row to retire');
  console.log('PASS R2_APPLICATION_DOCUMENT_DELETE_200 conflict check + uploader authz -> r2Delete');
}

// R2_APPLICATION_DOCUMENT_NON_UPLOADER: private-kind HOLD parity with the Drive lane.
{
  const { response, body, events, bucket } = await runDelete(
    { objectKey: DOC_KEY, documentInUse: false },
    'req-r2-doc-foreign',
    { seed: (b) => b.seed('application-document', DOC_FILE, { danjionUploaderUserId: OTHER_USER }) }
  );
  assert.equal(response.status, 503);
  assert.equal(body.error.code, 'RESIDENT_VERIFICATION_POLICY_HOLD',
    'a non-uploader delete of a private object must hit the exact Drive-lane HOLD boundary');
  assert.equal(bucket.deletes(), 0);
  assert.equal(bucket.has('application-document', DOC_FILE), true);
  assert.deepEqual(events, []);
  console.log('PASS R2_APPLICATION_DOCUMENT_NON_UPLOADER private HOLD deny (Drive parity)');
}

/* ---------------------------------------------------------------------- */
/* fail-closed + migration window                                          */
/* ---------------------------------------------------------------------- */

// R2_ONLY_MISS_FAIL_CLOSED_404: R2-only deployment, object absent -> 404 and
// never a Drive credential/network touch.
{
  const fetchCalls = installFetchStub(() => new Response('unexpected network', { status: 500 }));
  let outcome;
  try {
    outcome = await runDelete({ objectKey: BUSINESS_KEY, state: 'active' }, 'req-r2-miss');
  } finally {
    restoreFetch();
  }
  assert.equal(outcome.response.status, 404);
  assert.equal(outcome.body.error.code, 'NOT_FOUND');
  assert.equal(fetchCalls.length, 0, 'R2-only delete must never fall through to Drive/network');
  assert.equal(outcome.bucket.deletes(), 0);
  assert.deepEqual(outcome.events, [], 'a missing object must not acquire an intent');
  console.log('PASS R2_ONLY_MISS_FAIL_CLOSED_404 no Drive credential path, no mutation');
}

// MIGRATION_WINDOW_DRIVE_FALLBACK: r2 miss + Drive credentials still configured
// -> the Drive lane retires the legacy object through the full lifecycle.
{
  const driveMetadata = {
    id: BUSINESS_FILE,
    name: 'legacy.png',
    mimeType: 'image/png',
    size: '128',
    trashed: false,
    parents: [FOLDER_ID],
    appProperties: {
      danjionKind: 'business-image',
      danjionVisibility: 'public',
      danjionUploaderUserId: ACTOR_ID
    }
  };
  const fetchCalls = installFetchStub((href, init) => {
    if (href.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'stub-token', expires_in: 3600 }), {
        headers: { 'content-type': 'application/json' }
      });
    }
    if (init?.method === 'PATCH') return new Response('{}', { status: 200 });
    if (href.includes('www.googleapis.com/drive/v3/files/')) {
      return new Response(JSON.stringify(driveMetadata), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('unexpected', { status: 500 });
  });
  let outcome;
  try {
    outcome = await runDelete({ objectKey: BUSINESS_KEY, state: 'active' }, 'req-r2-dual', { dual: true });
  } finally {
    restoreFetch();
  }
  assert.equal(outcome.response.status, 200, `expected 200, got ${outcome.response.status}: ${JSON.stringify(outcome.body)}`);
  assert.equal(outcome.body.data.retired, true);
  assert.equal(outcome.bucket.deletes(), 0, 'a Drive-only legacy object must not hit R2 delete');
  assert.equal(outcome.harness.state(), 'retired');
  assert.ok(fetchCalls.some((call) => call.method === 'PATCH'), 'the Drive trash side effect must run');
  console.log('PASS MIGRATION_WINDOW_DRIVE_FALLBACK Drive-only object retired via Drive lifecycle');
}


/* ---------------------------------------------------------------------- */
/* official-news-image                                                     */
/* ---------------------------------------------------------------------- */

// R2_OFFICIAL_NEWS_FULL_LIFECYCLE: official-content.manage authority (actor is
// deliberately NOT the uploader), post reference check, intent, r2Delete, retired.
{
  const { response, body, events, bucket, harness } = await runDelete(
    { objectKey: OFFICIAL_KEY, state: 'active', uploader: OTHER_USER },
    'req-r2-on-full',
    { seed: (b) => b.seed('official-news-image', OFFICIAL_FILE, { danjionUploaderUserId: OTHER_USER }) }
  );
  assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(body)}`);
  assert.equal(body.data.deleted, true);
  assert.equal(body.data.retired, true);
  assert.equal(bucket.deletes(), 1);
  assert.equal(bucket.has('official-news-image', OFFICIAL_FILE), false);
  assert.equal(harness.state(), 'retired');
  assert.deepEqual(
    events.filter((event) => event !== 'r2-delete'),
    ['lock-row', 'intent-acquired', 'finalize-retired'],
    'official-news delete must acquire the durable intent before the physical delete'
  );
  assert.ok(events.indexOf('intent-acquired') < events.indexOf('r2-delete'));
  console.log('PASS R2_OFFICIAL_NEWS_FULL_LIFECYCLE authority(not uploader)->intent->r2Delete->retired');
}

// R2_OFFICIAL_NEWS_POST_IN_USE_409: a published-post reference blocks deletion.
{
  const { response, body, events, bucket, harness } = await runDelete(
    { objectKey: OFFICIAL_KEY, state: 'active', uploader: OTHER_USER, postInUse: true },
    'req-r2-on-in-use',
    { seed: (b) => b.seed('official-news-image', OFFICIAL_FILE, { danjionUploaderUserId: OTHER_USER }) }
  );
  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'OFFICIAL_NEWS_IMAGE_IN_USE');
  assert.equal(bucket.deletes(), 0, 'a referenced official-news image must never reach r2Delete');
  assert.equal(bucket.has('official-news-image', OFFICIAL_FILE), true);
  assert.equal(harness.state(), 'active');
  assert.deepEqual(events, ['lock-row', 'intent-refused']);
  console.log('PASS R2_OFFICIAL_NEWS_POST_IN_USE_409 post reference wins, object untouched');
}

// R2_OFFICIAL_NEWS_DELETE_PENDING: reconcile resolves the R2 backend and retires.
{
  const { response, body, events, bucket, harness } = await runDelete(
    { objectKey: OFFICIAL_KEY, state: 'delete_pending', uploader: OTHER_USER },
    'req-r2-on-pending',
    { seed: (b) => b.seed('official-news-image', OFFICIAL_FILE, { danjionUploaderUserId: OTHER_USER }) }
  );
  assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(body)}`);
  assert.equal(body.data.retired, true);
  assert.equal(bucket.deletes(), 1);
  assert.equal(harness.state(), 'retired');
  assert.deepEqual(events, ['r2-delete', 'finalize-retired'], 'delete_pending reconcile must not re-acquire intent');
  console.log('PASS R2_OFFICIAL_NEWS_DELETE_PENDING reconcile->r2Delete->retired');
}

// R2_OFFICIAL_NEWS_AUTHORITY_DENIED: no operational authority -> denied before
// any object mutation (the retired R2 shortcut only checked uploader identity).
{
  const { response, body, events, bucket } = await runDelete(
    { objectKey: OFFICIAL_KEY, state: 'active', uploader: ACTOR_ID, authorityDenied: true },
    'req-r2-on-denied',
    { seed: (b) => b.seed('official-news-image', OFFICIAL_FILE) }
  );
  assert.equal(response.status, 404, `authority denial must not disclose the object, got ${response.status}`);
  assert.equal(body.error.code, 'COMPLEX_NOT_FOUND');
  assert.equal(bucket.deletes(), 0, 'even the uploader cannot delete without official-content authority');
  assert.equal(bucket.has('official-news-image', OFFICIAL_FILE), true);
  assert.deepEqual(events, [], 'denial must precede any lifecycle/object mutation');
  console.log('PASS R2_OFFICIAL_NEWS_AUTHORITY_DENIED no uploader shortcut around authority');
}

/* ---------------------------------------------------------------------- */
/* drift guards: the R2 shortcut must stay deleted                         */
/* ---------------------------------------------------------------------- */

{
  const removeStart = storageSource.indexOf('async function removeObject(');
  const removeEnd = storageSource.indexOf('export async function handleStorageRequest', removeStart);
  const removeBlock = storageSource.slice(removeStart, removeEnd);
  const firstKindBranch = removeBlock.indexOf("if (parsed.kind === 'resident-evidence')");
  assert.ok(firstKindBranch > 0, 'kind routing must exist');
  assert.equal(
    removeBlock.slice(0, firstKindBranch).includes('r2Delete'),
    false,
    'no r2Delete shortcut may exist before the kind lifecycle lanes'
  );
  // Every physical R2 delete inside the route must come after its kind guard.
  const docBranch = removeBlock.indexOf("if (parsed.kind === 'application-document')");
  const docConflict = removeBlock.indexOf('await applicationDocumentDeleteConflict(', docBranch);
  const docDelete = removeBlock.indexOf('await r2Delete(', docBranch);
  assert.ok(docConflict > 0 && docDelete > docConflict, 'document r2Delete only after the reference conflict check');
  const officialIntent = removeBlock.indexOf('await acquireOfficialNewsImageDeleteIntent(');
  const officialTrash = removeBlock.indexOf('return trashOfficialNewsImageAndFinalize(', officialIntent);
  assert.ok(officialIntent > 0 && officialTrash > officialIntent, 'official-news trash only after the durable intent');
  assert.ok(removeBlock.includes('removeRegisteredBusinessImage('), 'business-image must route through the lifecycle lane');

  const trashBusinessStart = storageSource.indexOf('async function trashBusinessImageAndFinalize(');
  const trashBusinessEnd = storageSource.indexOf('async function reconcileBusinessImageRetirement(', trashBusinessStart);
  const trashBusinessBlock = storageSource.slice(trashBusinessStart, trashBusinessEnd);
  assert.ok(trashBusinessBlock.includes('r2Delete'), 'R2 retirement must delete the R2 object');
  assert.ok(trashBusinessBlock.includes('googleFetch'), 'the Drive retirement side effect must remain intact');
  assert.ok(
    trashBusinessBlock.indexOf('r2Delete') < trashBusinessBlock.indexOf('finalizeBusinessImageRetired'),
    'the registry row retires only after the physical R2 delete'
  );

  const trashOfficialStart = storageSource.indexOf('async function trashOfficialNewsImageAndFinalize(');
  const trashOfficialEnd = storageSource.indexOf('async function reconcileOfficialNewsImageRetirement(', trashOfficialStart);
  const trashOfficialBlock = storageSource.slice(trashOfficialStart, trashOfficialEnd);
  assert.ok(trashOfficialBlock.includes('r2Delete'), 'official-news R2 retirement must delete the R2 object');
  assert.ok(trashOfficialBlock.includes('googleFetch'), 'the Drive retirement side effect must remain intact');

  assert.ok(storageSource.includes('readDeleteObjectMetadata'), 'backend-resolved delete metadata helper must exist');
  assert.ok(storageSource.includes('resolveDeleteBackend'), 'backend resolution for reconcile lanes must exist');
  console.log('PASS DRIFT_GUARDS R2 delete shortcut stays deleted, lifecycle lanes own every backend');
}

console.log('r2-delete-lifecycle-parity: PASS (13 runtime cases + drift guards)');


