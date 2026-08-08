import assert from 'node:assert/strict';
import { safeStorageFileName, validateStorageUpload } from '../src/storage-policy.mjs';

const fake = (name, type, size) => ({ name, type, size });

assert.equal(validateStorageUpload('business-image', [fake('shop.jpg', 'image/jpeg', 1024)]).ok, true);
assert.equal(validateStorageUpload('business-image', [fake('shop.gif', 'image/gif', 1024)]).code, 'UNSUPPORTED_MEDIA_TYPE');
assert.equal(validateStorageUpload('business-image', [fake('huge.jpg', 'image/jpeg', 8 * 1024 * 1024 + 1)]).code, 'FILE_TOO_LARGE');
assert.equal(validateStorageUpload('business-image', []).code, 'INVALID_FILE_COUNT');
assert.equal(validateStorageUpload('business-image', [fake('a.jpg', 'image/jpeg', 1), fake('b.jpg', 'image/jpeg', 1)]).code, 'INVALID_FILE_COUNT');
assert.equal(validateStorageUpload('resident-evidence', [fake('proof.pdf', 'application/pdf', 1024)]).ok, true);
assert.equal(validateStorageUpload('resident-evidence', [fake('proof.pdf', 'application/pdf', 10 * 1024 * 1024 + 1)]).code, 'FILE_TOO_LARGE');
assert.equal(validateStorageUpload('unknown', [fake('x.jpg', 'image/jpeg', 1)]).code, 'INVALID_STORAGE_KIND');
assert.equal(safeStorageFileName('../../동호수 증빙 101동.pdf'), '101-.pdf');

console.log('PASS storage upload policy: MIME, size, count and filename rules');
