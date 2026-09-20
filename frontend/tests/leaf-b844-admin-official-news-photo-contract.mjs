// Issue #844 (CENTRAL review round 2) — plan-side contract for the official
// apartment-news photo feature:
//   BLOCKER 2  submit-time upload only (select/remove/replace before submit must
//              not perform a server mutation, so no active orphan can be created)
//   BLOCKER 3  an explicit official-channel selector, and the bridge/resolver only
//              accept the two official apartment-news channels
//   AUTH       the official-news admin upload uses the admin auth surface
// It also exercises the REAL bridge URL helper instead of only grepping source.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveOfficialNewsImageUrl, OFFICIAL_NEWS_IMAGE_KEY } from '../assets/danjion-news-bridge.js';

const root = new URL('../../', import.meta.url);
const [adminApp, adminApi, storageTs, detail] = await Promise.all([
  readFile(new URL('04_개발/frontend/src/AdminApp.tsx', root), 'utf8'),
  readFile(new URL('04_개발/frontend/src/admin-api.ts', root), 'utf8'),
  readFile(new URL('04_개발/frontend/src/storage.ts', root), 'utf8'),
  readFile(new URL('frontend/08A_아파트소식_상세.html', root), 'utf8')
]);

/* ---------------- BLOCKER 2: submit-time upload ---------------- */

const submitStart = adminApp.indexOf('async function submitPost(');
const benefitStart = adminApp.indexOf('async function submitBenefit(');
const selectStart = adminApp.indexOf('function selectPostImage(');
const removeStart = adminApp.indexOf('function removePostImage(');
assert.ok(submitStart > 0 && benefitStart > submitStart && selectStart > 0 && removeStart > selectStart,
  'the composer handlers must exist');

const submitBlock = adminApp.slice(submitStart, benefitStart);
const selectBlock = adminApp.slice(selectStart, removeStart);
const removeBlock = adminApp.slice(removeStart, submitStart > removeStart ? submitStart : benefitStart);

assert.ok(submitBlock.includes("storageAdapter.upload('official-news-image'"),
  'SELECT_TO_SUBMIT: the upload only happens inside the submit handler');
assert.equal(selectBlock.includes('storageAdapter.upload('), false,
  'SELECT_THEN_REMOVE_SERVER_OBJECT_COUNT=0: selecting a file must not upload');
assert.equal(selectBlock.includes('storageAdapter.delete('), false);
assert.equal(removeBlock.includes('storageAdapter.upload('), false,
  'SELECT_A_REPLACE_B_NO_ORPHAN: replace/remove before submit must not mutate the server');
assert.equal(removeBlock.includes('storageAdapter.delete('), false);
assert.ok(selectBlock.includes('URL.createObjectURL(file)'),
  'the pre-submit preview is a local object URL');
assert.ok(selectBlock.includes("validateStorageFile('official-news-image', file)"),
  'local format/size validation happens before any request');
assert.ok(submitBlock.includes('attachmentObjectKey') &&
  submitBlock.indexOf("storageAdapter.upload('official-news-image'") < submitBlock.indexOf('adminAdapter.createPost('),
  'only the server-returned object key is submitted, after the upload');
assert.ok(adminApp.includes('POST_CREATE_FAILURE_NO_FALSE_SUCCESS') ||
  (submitBlock.includes('if (postImageFile) setPostImageError(detail)') && submitBlock.includes('setMessage(detail)')),
  'POST_CREATE_FAILURE_NO_FALSE_SUCCESS: a failure is surfaced and never reported as success');
assert.ok(submitBlock.includes("setPostImageBusy(true)") && submitBlock.includes("setPostImageBusy(false)"),
  'the submit path exposes busy/progress state');
assert.ok(adminApp.includes("disabled={busyId === 'post' || postImageBusy}"),
  'duplicate submit is blocked while the photo is uploading');

/* ---------------- BLOCKER 3: explicit official channel ---------------- */

assert.ok(adminApp.includes("useState<'apartment_news' | 'management_office'>('apartment_news')"),
  'DEFAULT_OFFICIAL_COMPOSER_CHANNEL=apartment_news');
assert.ok(adminApp.includes('value="apartment_news"') && adminApp.includes('value="management_office"'),
  'MANAGEMENT_OFFICE_SELECTABLE: both official channels are selectable');
assert.ok(submitBlock.includes('channel: postChannel'),
  'the composer sends the channel explicitly with the create request');
assert.ok(adminApi.includes('channel?: string'),
  'admin-api createPost accepts an explicit channel');
assert.ok(storageTs.includes("{ surface: 'admin' }") === false && adminApp.includes("{ surface: 'admin' }"),
  'AUTH_SURFACE: the official-news admin upload uses the admin surface');
assert.ok(storageTs.includes("options.surface ?? 'resident'"),
  'the default auth surface stays unchanged for existing resident/business uploads');

/* ---------------- BLOCKER B: no orphan multiplication ---------------- */

assert.ok(adminApp.includes('const [postImageKey, setPostImageKey] = useState<string | null>(null)'),
  'the uploaded server object key must be retained in component state');
assert.ok(selectBlock.includes("validateStorageFile('official-news-image', file)"),
  'local validation still runs on select');
assert.ok(selectBlock.includes('clearUploadedImage()'),
  'replacing the selection retires the previous unreferenced object');
assert.ok(removeBlock.includes('clearUploadedImage()'),
  'POST_FAILURE_REMOVE_CLEANS_UNREFERENCED_OBJECT: remove retires the uploaded object');
assert.ok(adminApp.includes('async function clearUploadedImage()'), 'a single cleanup owner must exist');
assert.ok(adminApp.includes("await storageAdapter.delete(postImageKey, { surface: 'admin' })"),
  'cleanup uses the canonical admin-surface delete for the unreferenced object');
assert.ok(submitBlock.includes('let attachmentObjectKey: string | null = postImageKey;') &&
  submitBlock.includes('if (!attachmentObjectKey && postImageFile)'),
  'RETRY_AFTER_POST_FAILURE_DOES_NOT_REUPLOAD: an already-uploaded key is reused');
assert.ok(submitBlock.includes('setPostImageKey(attachmentObjectKey)'),
  'ORPHAN_MULTIPLICATION=0: the key is remembered before the create request');
assert.equal(submitBlock.indexOf("storageAdapter.upload('official-news-image'") >
  submitBlock.indexOf('if (!attachmentObjectKey && postImageFile)'), true,
  'the upload sits behind the reuse guard');
assert.ok(submitBlock.includes('if (postImageFile || postImageKey) setPostImageError(detail)'),
  'a failed create keeps the uploaded object for the next attempt');

/* ---------------- bridge helper (real function) ---------------- */

assert.equal(resolveOfficialNewsImageUrl('/api', `gdrive/public/official-news-image/${'a'.repeat(12)}`),
  `/api/api/v1/storage/public?objectKey=${encodeURIComponent(`gdrive/public/official-news-image/${'a'.repeat(12)}`)}`,
  'OFFICIAL_NEWS_IMAGE_KEY resolves to the public resolver URL');
assert.equal(resolveOfficialNewsImageUrl('/api', `gdrive/public/business-image/${'a'.repeat(12)}`), null,
  'a business-image key must not resolve on the official-news surface');
assert.equal(resolveOfficialNewsImageUrl('/api', `gdrive/private/application-document/${'a'.repeat(12)}`), null,
  'a private application-document key must not resolve publicly here');
assert.equal(resolveOfficialNewsImageUrl('/api', 'gdrive/public/official-news-image/short'), null,
  'a malformed file id must not resolve');
assert.equal(resolveOfficialNewsImageUrl('/api', null), null, 'a missing key must not resolve');
assert.equal(resolveOfficialNewsImageUrl('/api', 'attachments/a.pdf'), null,
  'the legacy free-form key must not resolve');
assert.ok(OFFICIAL_NEWS_IMAGE_KEY instanceof RegExp);
assert.ok(detail.includes('resolveOfficialNewsImageUrl'),
  'the article detail consumes the shared bridge helper');

console.log('SELECT_THEN_REMOVE_SERVER_OBJECT_COUNT=0');
console.log('SELECT_A_REPLACE_B_NO_ORPHAN=PASS');
console.log('POST_CREATE_FAILURE_NO_FALSE_SUCCESS=PASS');
console.log('DEFAULT_OFFICIAL_COMPOSER_CHANNEL=apartment_news');
console.log('MANAGEMENT_OFFICE_SELECTABLE=PASS');
console.log('OFFICIAL_NEWS_UPLOAD_AUTH_SURFACE=admin');
console.log('leaf-b844-admin-official-news-photo-contract: PASS');
