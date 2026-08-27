import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { businessImageDeleteConflict } from '../src/storage-v1.ts';

const root = new URL('../', import.meta.url);
const storage = await readFile(new URL('src/storage-v1.ts', root), 'utf8');
const schema = await readFile(new URL('migrations/001_initial_schema.sql', root), 'utf8');
const key = 'gdrive/public/business-image/file_1234567890';

function fakeSql(row, options = {}) {
  return async (strings, ...values) => {
    if (options.throwError) throw new Error('synthetic database outage');
    const query = strings.join('?');
    assert.ok(query.includes('from business_media bm'));
    assert.ok(query.includes('from business_applications a'));
    assert.ok(query.includes("a.status in ('draft', 'pending', 'changes_requested', 'approved')"));
    assert.equal(query.includes("'rejected'"), false,
      'rejected applications are final and must not become a retention-policy delete block');
    assert.deepEqual(values, [key, key]);
    return [row];
  };
}

assert.equal(
  await businessImageDeleteConflict(fakeSql({ business_media_in_use: false, application_in_use: false }), key, 'req-free'),
  null,
  'unreferenced legacy business image must remain deletable by its authorized uploader'
);

let denied = await businessImageDeleteConflict(
  fakeSql({ business_media_in_use: true, application_in_use: false }),
  key,
  'req-media'
);
assert.ok(denied instanceof Response);
assert.equal(denied.status, 409);
assert.equal((await denied.json()).error.code, 'BUSINESS_IMAGE_IN_USE');

denied = await businessImageDeleteConflict(
  fakeSql({ business_media_in_use: false, application_in_use: true }),
  key,
  'req-application'
);
assert.ok(denied instanceof Response);
assert.equal(denied.status, 409);
assert.equal((await denied.json()).error.code, 'BUSINESS_IMAGE_IN_USE');

denied = await businessImageDeleteConflict(fakeSql(null, { throwError: true }), key, 'req-db-down');
assert.ok(denied instanceof Response);
assert.equal(denied.status, 503);
assert.equal((await denied.json()).error.code, 'BUSINESS_IMAGE_REFERENCE_CHECK_UNAVAILABLE');

assert.ok(schema.includes("status text not null default 'pending' check (status in ('draft','pending','changes_requested','approved','rejected'))"));

const helperStart = storage.indexOf('export async function businessImageDeleteConflict(');
const helperEnd = storage.indexOf('export async function registerBusinessImageObject(', helperStart);
const helperBlock = storage.slice(helperStart, helperEnd);
assert.ok(helperStart >= 0 && helperEnd > helperStart);
assert.ok(helperBlock.includes('business_media'));
assert.ok(helperBlock.includes('business_applications'));
assert.ok(helperBlock.includes("a.status in ('draft', 'pending', 'changes_requested', 'approved')"));
assert.equal(helperBlock.includes("'rejected'"), false);
assert.ok(helperBlock.includes("'BUSINESS_IMAGE_IN_USE'"));
assert.ok(helperBlock.includes("'BUSINESS_IMAGE_REFERENCE_CHECK_UNAVAILABLE'"));

// Registered images preserve the #105 protected-reference policy inside the
// authoritative delete-intent transaction, before any Drive trash side effect.
const intentStart = storage.indexOf('export async function acquireBusinessImageDeleteIntent(');
const intentEnd = storage.indexOf('async function finalizeBusinessImageRetired(', intentStart);
const intentBlock = storage.slice(intentStart, intentEnd);
const lockIndex = intentBlock.indexOf('for update');
const referenceIndex = intentBlock.indexOf('from business_media bm');
const applicationIndex = intentBlock.indexOf('from business_applications a');
const stateTransitionIndex = intentBlock.indexOf("set state = 'delete_pending'");
assert.ok(lockIndex >= 0 && referenceIndex > lockIndex,
  'registered delete must lock lifecycle row before fresh product-reference check');
assert.ok(applicationIndex > referenceIndex);
assert.ok(intentBlock.includes("a.status in ('draft', 'pending', 'changes_requested', 'approved')"));
assert.equal(intentBlock.includes("'rejected'"), false,
  'registered lifecycle must preserve rejected exclusion from #105');
assert.ok(stateTransitionIndex > applicationIndex,
  'delete intent can transition only after protected reference checks are defined');
assert.ok(intentBlock.includes("'BUSINESS_IMAGE_IN_USE'"));

const registeredStart = storage.indexOf('async function removeRegisteredBusinessImage(');
const registeredEnd = storage.indexOf('async function removeLegacyUnregisteredBusinessImage(', registeredStart);
const registeredBlock = storage.slice(registeredStart, registeredEnd);
const acquireIndex = registeredBlock.indexOf('await acquireBusinessImageDeleteIntent(');
const registeredTrashIndex = registeredBlock.indexOf('return trashBusinessImageAndFinalize(', acquireIndex);
assert.ok(acquireIndex >= 0 && registeredTrashIndex > acquireIndex,
  'registered Drive trash must occur only after authoritative delete intent commits');

// Pre-registry compatibility path keeps the exact #105 guard. Because current
// reference acquisition requires a registry row, an unregistered object cannot
// acquire a new product reference while this bounded legacy path runs.
const legacyStart = storage.indexOf('async function removeLegacyUnregisteredBusinessImage(');
const legacyEnd = storage.indexOf('async function removeObject(', legacyStart);
const legacyBlock = storage.slice(legacyStart, legacyEnd);
const legacyAuthorize = legacyBlock.indexOf('await authorizeObject(auth.actor, metadata, requestId)');
const legacyReference = legacyBlock.indexOf('await businessImageDeleteConflict(auth.sql, parsed.objectKey, requestId)');
const legacyTrash = legacyBlock.indexOf("body: JSON.stringify({ trashed: true })");
assert.ok(legacyAuthorize >= 0 && legacyReference > legacyAuthorize,
  'legacy uploader authorization must precede reference disclosure/check');
assert.ok(legacyTrash > legacyReference,
  'legacy Drive trash must occur only after #105 reference guard');
assert.ok(legacyBlock.includes('if (conflict) return conflict;'));

const removeStart = storage.indexOf('async function removeObject(');
const removeEnd = storage.indexOf('export async function handleStorageRequest', removeStart);
const removeBlock = storage.slice(removeStart, removeEnd);
const evidenceIndex = removeBlock.indexOf("if (parsed.kind === 'resident-evidence')");
const businessIndex = removeBlock.indexOf("if (parsed.kind === 'business-image')");
assert.ok(evidenceIndex >= 0 && businessIndex > evidenceIndex,
  'resident evidence must remain a distinct non-business lifecycle path');
assert.ok(removeBlock.includes('await readBusinessImageRegistry(auth.sql, parsed.objectKey, requestId)'));

console.log('PASS business image delete guard: referenced product/application images cannot be trashed');
