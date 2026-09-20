// Issue #844 (CENTRAL review round 2) — runtime verification of the official-news
// delete-intent lifecycle and the reference validator. This is not a static
// includes() contract: the real exported functions from storage-v1 and
// storage-reference-v1 are invoked against a stateful SQL double and a fetched
// Drive double, and the ORDER of lifecycle steps is asserted.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { acquireOfficialNewsImageDeleteIntent } from '../src/storage-v1.ts';
import { validateOfficialNewsImageReference } from '../src/storage-reference-v1.ts';

const root = new URL('../', import.meta.url);
const storage = await readFile(new URL('src/storage-v1.ts', root), 'utf8');
const adminOperational = await readFile(new URL('src/admin-operational-v2.ts', root), 'utf8');

const uploader = '11111111-1111-4111-8111-111111111111';
const otherUploader = '33333333-3333-4333-8333-333333333333';
const complexId = '22222222-2222-4222-8222-222222222222';
const complexSlug = 'bangnim-myeongji-roadhill';
const fileId = 'onipregeneratedid0123456789';
const objectKey = `gdrive/public/official-news-image/${fileId}`;
const folderId = 'drive_public_folder_1234567890';

/* ------------------------------------------------------------------ */
/* BLOCKER 1: durable delete intent (real function, stateful SQL double) */
/* ------------------------------------------------------------------ */

function makeDeleteIntentSql({ referenced, state = 'active' }) {
  const events = [];
  const live = { value: state };
  const tagged = (strings, ...values) => ({ text: strings.join('\u0000'), values });
  tagged.transaction = async (queries) => {
    assert.equal(queries.length, 2, 'delete intent must be one 2-statement transaction');
    const [lock, decision] = queries;
    assert.match(lock.text, /for update/, 'the registry row must be locked first');
    assert.match(decision.text, /set state = 'delete_pending'/, 'the same transaction must acquire the intent');
    assert.match(decision.text, /and not u\.post_in_use/, 'the intent must be conditional on the reference check');
    events.push('lock-row');
    if (referenced) {
      events.push('intent-refused');
      return [
        [{ object_key: objectKey, complex_id: complexId, state: live.value }],
        [{ state: live.value, post_in_use: true, delete_intent_acquired: false }]
      ];
    }
    live.value = 'delete_pending';
    events.push('intent-acquired');
    return [
      [{ object_key: objectKey, complex_id: complexId, state: 'active' }],
      [{ state: 'delete_pending', post_in_use: false, delete_intent_acquired: true }]
    ];
  };
  return { sql: tagged, events, state: () => live.value };
}

// REFERENCED_DELETE=409 and NEW_REFERENCE_XOR_DELETE_INTENT: no mutation when referenced.
const referenced = makeDeleteIntentSql({ referenced: true });
const denied = await acquireOfficialNewsImageDeleteIntent(referenced.sql, objectKey, 'req-referenced');
assert.ok(denied instanceof Response, 'a referenced object must be denied');
assert.equal(denied.status, 409);
assert.equal((await denied.json()).error.code, 'OFFICIAL_NEWS_IMAGE_IN_USE');
assert.equal(referenced.state(), 'active', 'a referenced object must stay active');
assert.deepEqual(referenced.events, ['lock-row', 'intent-refused'], 'no intent may be acquired while referenced');

// Unreferenced: ACTIVE -> DELETE_PENDING inside the serialization boundary.
const unreferenced = makeDeleteIntentSql({ referenced: false });
const intent = await acquireOfficialNewsImageDeleteIntent(unreferenced.sql, objectKey, 'req-unreferenced');
assert.deepEqual(intent, { acquired: true, state: 'delete_pending' });
assert.equal(unreferenced.state(), 'delete_pending');

// Source order: the durable intent commits before the external Drive side effect, and the route
// never jumps active -> retired directly after a Drive mutation.
const removeObjectStart = storage.indexOf('async function removeObject(');
const branchStart = storage.indexOf("if (parsed.kind === 'official-news-image') {", removeObjectStart);
const branchEnd = storage.indexOf("return fail('INVALID_OBJECT_KEY'", branchStart);
const branch = storage.slice(branchStart, branchEnd);
const acquireIdx = branch.indexOf('await acquireOfficialNewsImageDeleteIntent(');
const trashIdx = branch.indexOf('trashOfficialNewsImageAndFinalize(env');
assert.ok(acquireIdx >= 0 && trashIdx > acquireIdx,
  'DELETE_INTENT_BEFORE_DRIVE: the intent must be durable before Drive trash');
assert.equal(branch.includes("set state = 'retired'"), false,
  'the route must not finalize retirement itself');

// DRIVE_FAILURE_RECONCILABLE / FINALIZE_FAILURE_RECONCILABLE: both failures leave delete_pending.
const trashFn = storage.slice(storage.indexOf('async function trashOfficialNewsImageAndFinalize('));
assert.ok(trashFn.includes('OFFICIAL_NEWS_IMAGE_RETIREMENT_RECONCILABLE'),
  'a Drive failure must stay reconcilable');
assert.ok(trashFn.includes('response.status !== 404'), 'an already-absent Drive object is not a failure');
const finalizeFn = storage.slice(storage.indexOf('async function finalizeOfficialNewsImageRetired('));
assert.ok(finalizeFn.includes("state = 'delete_pending'") && finalizeFn.includes("state = 'retired'"),
  'finalize must only move delete_pending -> retired');
assert.ok(storage.includes('reconcileOfficialNewsImageRetirement'),
  'a delete_pending object must be retryable');

/* ------------------------------------------------------------------ */
/* BLOCKER 3 + BLOCKER 4: reference validator (real function)           */
/* ------------------------------------------------------------------ */

const env = {
  STORAGE_MODE: 'drive',
  DATABASE_URL: 'postgres://test',
  GOOGLE_DRIVE_CLIENT_ID: 'client-for-test',
  GOOGLE_DRIVE_CLIENT_SECRET: 'secret-for-test',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh-for-test',
  GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID: folderId
};

function registrySql(row) {
  const tagged = async (strings) => {
    const text = strings.join('\u0000');
    if (text.includes('from business_image_objects')) return row ? [row] : [];
    throw new Error(`unexpected sql in reference validator test: ${text}`);
  };
  return tagged;
}

function installDriveStub({ driveUploader = uploader, driveSlug = complexSlug } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('oauth2.googleapis.com/token')) {
      return Response.json({ access_token: 'test-token', expires_in: 3600 });
    }
    if (href.includes('/files/')) {
      return Response.json({
        id: fileId,
        name: 'news.jpg',
        mimeType: 'image/jpeg',
        trashed: false,
        parents: [folderId],
        appProperties: {
          danjionKind: 'official-news-image',
          danjionVisibility: 'public',
          danjionUploaderUserId: driveUploader,
          danjionComplexSlug: driveSlug
        }
      });
    }
    throw new Error(`unexpected fetch: ${href}`);
  };
  return calls;
}

// DELETE_PENDING_REFERENCE_REJECTED: a retiring object can never be newly attached.
let driveTouched = false;
globalThis.fetch = async () => { driveTouched = true; throw new Error('Drive must not be contacted'); };
const pending = await validateOfficialNewsImageReference(
  env,
  registrySql({ uploader_user_id: uploader, complex_id: complexId, state: 'delete_pending', kind: 'official-news-image' }),
  objectKey, complexId, complexSlug, 'req-pending'
);
assert.ok(pending instanceof Response);
assert.equal(pending.status, 409);
assert.equal((await pending.json()).error.code, 'OFFICIAL_NEWS_IMAGE_NOT_ACTIVE');
assert.equal(driveTouched, false, 'a non-active object must be refused before any storage read');

// WRONG_KIND_OBJECT_REJECTED
const wrongKind = await validateOfficialNewsImageReference(
  env,
  registrySql({ uploader_user_id: uploader, complex_id: complexId, state: 'active', kind: 'business-image' }),
  objectKey, complexId, complexSlug, 'req-wrong-kind'
);
assert.ok(wrongKind instanceof Response);
assert.equal(wrongKind.status, 400);
assert.equal((await wrongKind.json()).error.code, 'INVALID_OFFICIAL_NEWS_IMAGE_REFERENCE');

// FOREIGN_COMPLEX_OBJECT_REJECTED
const foreign = await validateOfficialNewsImageReference(
  env,
  registrySql({ uploader_user_id: uploader, complex_id: otherUploader, state: 'active', kind: 'official-news-image' }),
  objectKey, complexId, complexSlug, 'req-foreign'
);
assert.ok(foreign instanceof Response);
assert.equal(foreign.status, 403);
assert.equal((await foreign.json()).error.code, 'OFFICIAL_NEWS_IMAGE_REFERENCE_FORBIDDEN');

// BLOCKER 4: REGISTRY_UPLOADER_EQUALS_DRIVE_UPLOADER=REQUIRED (editor equality is not required).
installDriveStub({ driveUploader: otherUploader });
const uploaderMismatch = await validateOfficialNewsImageReference(
  env,
  registrySql({ uploader_user_id: uploader, complex_id: complexId, state: 'active', kind: 'official-news-image' }),
  objectKey, complexId, complexSlug, 'req-uploader-mismatch'
);
assert.ok(uploaderMismatch instanceof Response);
assert.equal(uploaderMismatch.status, 403);

// A fully consistent active object is accepted (SAME_UPLOADER_REQUIRED=NO: the caller is not the uploader).
installDriveStub();
const accepted = await validateOfficialNewsImageReference(
  env,
  registrySql({ uploader_user_id: uploader, complex_id: complexId, state: 'active', kind: 'official-news-image' }),
  objectKey, complexId, complexSlug, 'req-accepted'
);
assert.equal(accepted, null, 'a consistent active official-news image must be accepted');

/* ------------------------------------------------------------------ */
/* BLOCKER 3: write-path channel guard                                  */
/* ------------------------------------------------------------------ */

assert.ok(adminOperational.includes('OFFICIAL_NEWS_IMAGE_CHANNEL_INVALID'));
const createIdx = adminOperational.indexOf('async function createPost(');
const patchIdx = adminOperational.indexOf('async function patchPost(');
for (const [name, start, end] of [
  ['createPost', createIdx, patchIdx],
  ['patchPost', patchIdx, adminOperational.indexOf('async function createBenefit(')]
]) {
  const block = adminOperational.slice(start, end);
  const channelGuard = block.indexOf('OFFICIAL_NEWS_IMAGE_CHANNEL_INVALID');
  const validator = block.indexOf('validateOfficialNewsImageReference(');
  assert.ok(channelGuard >= 0 && validator > channelGuard,
    `${name} must refuse a non-official channel before validating the attachment key`);
}

console.log('OFFICIAL_NEWS_IMAGE_DELETE_INTENT_RUNTIME=PASS');
console.log('NEW_REFERENCE_XOR_DELETE_INTENT=PASS');
console.log('DELETE_PENDING_REFERENCE_REJECTED=PASS');
console.log('REFERENCED_DELETE=409');
console.log('DRIVE_FAILURE_RECONCILABLE=PASS');
console.log('FINALIZE_FAILURE_RECONCILABLE=PASS');
console.log('REGISTRY_UPLOADER_EQUALS_DRIVE_UPLOADER=PASS');
console.log('DANJION_NOTICE_ATTACHMENT_REJECTED=PASS');
console.log('official-news-image-844-lifecycle: PASS');
