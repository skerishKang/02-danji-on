import assert from 'node:assert/strict';
import {
  detectStorageMimeType,
  safeStorageFileName,
  validateStorageUpload,
  validateStorageUploadSignature
} from '../src/storage-policy.mjs';

const fake = (name, type, size) => ({ name, type, size });

assert.equal(validateStorageUpload('business-image', [fake('shop.jpg', 'image/jpeg', 1024)]).ok, true);
assert.equal(validateStorageUpload('business-image', [fake('shop.gif', 'image/gif', 1024)]).code, 'UNSUPPORTED_MEDIA_TYPE');
assert.equal(validateStorageUpload('business-image', [fake('huge.jpg', 'image/jpeg', 8 * 1024 * 1024 + 1)]).code, 'FILE_TOO_LARGE');
assert.equal(validateStorageUpload('business-image', []).code, 'INVALID_FILE_COUNT');
assert.equal(validateStorageUpload('business-image', [fake('a.jpg', 'image/jpeg', 1), fake('b.jpg', 'image/jpeg', 1)]).code, 'INVALID_FILE_COUNT');
assert.equal(validateStorageUpload('resident-evidence', [fake('proof.pdf', 'application/pdf', 1024)]).ok, true);
assert.equal(validateStorageUpload('resident-evidence', [fake('proof.pdf', 'application/pdf', 10 * 1024 * 1024 + 1)]).code, 'FILE_TOO_LARGE');
assert.equal(validateStorageUpload('unknown', [fake('x.jpg', 'image/jpeg', 1)]).code, 'INVALID_STORAGE_KIND');

// #844: official apartment-news public image kind — bounded public image envelope.
assert.equal(validateStorageUpload('official-news-image', [fake('news.jpg', 'image/jpeg', 1024)]).ok, true);
assert.equal(validateStorageUpload('official-news-image', [fake('news.webp', 'image/webp', 1024)]).ok, true);
assert.equal(validateStorageUpload('official-news-image', [fake('news.png', 'image/png', 1024)]).ok, true);
const officialNewsPolicy = validateStorageUpload('official-news-image', [fake('news.jpg', 'image/jpeg', 1)]);
assert.equal(officialNewsPolicy.policy.visibility, 'public', 'official-news-image must be a public kind');
assert.equal(officialNewsPolicy.policy.maxFiles, 1, 'official-news-image first slice accepts exactly one file');
assert.equal(validateStorageUpload('official-news-image', [fake('news.pdf', 'application/pdf', 1024)]).code, 'UNSUPPORTED_MEDIA_TYPE');
assert.equal(validateStorageUpload('official-news-image', [fake('huge.jpg', 'image/jpeg', 8 * 1024 * 1024 + 1)]).code, 'FILE_TOO_LARGE');
assert.equal(validateStorageUpload('official-news-image', []).code, 'INVALID_FILE_COUNT');
assert.equal(validateStorageUpload('official-news-image', [fake('a.jpg', 'image/jpeg', 1), fake('b.jpg', 'image/jpeg', 1)]).code, 'INVALID_FILE_COUNT');
assert.equal(safeStorageFileName('../../동호수 증빙 101동.pdf'), '101-.pdf');

const jpeg = new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00])], 'photo.jpg', { type: 'image/jpeg' });
const png = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])], 'photo.png', { type: 'image/png' });
const webp = new File([Uint8Array.from([0x52,0x49,0x46,0x46,0x00,0x00,0x00,0x00,0x57,0x45,0x42,0x50])], 'photo.webp', { type: 'image/webp' });
const pdf = new File([new TextEncoder().encode('%PDF-1.7\n')], 'document.pdf', { type: 'application/pdf' });

assert.equal(await detectStorageMimeType(jpeg), 'image/jpeg');
assert.equal(await detectStorageMimeType(png), 'image/png');
assert.equal(await detectStorageMimeType(webp), 'image/webp');
assert.equal(await detectStorageMimeType(pdf), 'application/pdf');

for (const file of [jpeg, png, webp]) {
  const policy = validateStorageUpload('business-image', [file]).policy;
  assert.equal((await validateStorageUploadSignature(file, policy)).ok, true);
}
assert.equal((await validateStorageUploadSignature(pdf, validateStorageUpload('application-document', [pdf]).policy)).ok, true);

const fakeJpeg = new File(['<html>not an image</html>'], 'fake.jpg', { type: 'image/jpeg' });
assert.equal(
  (await validateStorageUploadSignature(fakeJpeg, validateStorageUpload('business-image', [fakeJpeg]).policy)).code,
  'UNSUPPORTED_MEDIA_SIGNATURE'
);

const pngDeclaredJpeg = new File([await png.arrayBuffer()], 'mismatch.jpg', { type: 'image/jpeg' });
assert.equal(
  (await validateStorageUploadSignature(pngDeclaredJpeg, validateStorageUpload('business-image', [pngDeclaredJpeg]).policy)).code,
  'MEDIA_TYPE_MISMATCH'
);

const pdfDeclaredImage = new File([await pdf.arrayBuffer()], 'mismatch.jpg', { type: 'image/jpeg' });
assert.equal(
  (await validateStorageUploadSignature(pdfDeclaredImage, validateStorageUpload('business-image', [pdfDeclaredImage]).policy)).code,
  'UNSUPPORTED_MEDIA_SIGNATURE'
);


console.log('PASS storage upload policy: declared MIME, byte signature, size, count and filename rules');
