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
  'unreferenced business image must remain deletable by its authorized uploader'
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
const helperEnd = storage.indexOf('async function uploadDriveFile(', helperStart);
const helperBlock = storage.slice(helperStart, helperEnd);
assert.ok(helperStart >= 0 && helperEnd > helperStart);
assert.ok(helperBlock.includes('business_media'));
assert.ok(helperBlock.includes('business_applications'));
assert.ok(helperBlock.includes("a.status in ('draft', 'pending', 'changes_requested', 'approved')"));
assert.equal(helperBlock.includes("'rejected'"), false);
assert.ok(helperBlock.includes("'BUSINESS_IMAGE_IN_USE'"));
assert.ok(helperBlock.includes("'BUSINESS_IMAGE_REFERENCE_CHECK_UNAVAILABLE'"));

const removeStart = storage.indexOf('async function removeObject(');
const removeEnd = storage.indexOf('export async function handleStorageRequest', removeStart);
const removeBlock = storage.slice(removeStart, removeEnd);
const authorizeIndex = removeBlock.indexOf('await authorizeObject(auth.actor, metadata, requestId)');
const kindGuardIndex = removeBlock.indexOf("if (parsed.kind === 'business-image')");
const referenceIndex = removeBlock.indexOf('await businessImageDeleteConflict(auth.sql, parsed.objectKey, requestId)');
const trashIndex = removeBlock.indexOf("body: JSON.stringify({ trashed: true })");
assert.ok(authorizeIndex >= 0 && kindGuardIndex > authorizeIndex,
  'uploader/object authorization must precede product-reference disclosure/check');
assert.ok(referenceIndex > kindGuardIndex,
  'only business-image deletion must enter the product reference check');
assert.ok(trashIndex > referenceIndex,
  'Drive trash mutation must occur only after the business-image reference check');
assert.ok(removeBlock.includes('if (conflict) return conflict;'));
assert.equal(removeBlock.includes("parsed.kind === 'resident-evidence'"), false,
  'resident-evidence self-delete must stay separate from business product-reference policy');

console.log('PASS business image delete guard: referenced product/application images cannot be trashed');
