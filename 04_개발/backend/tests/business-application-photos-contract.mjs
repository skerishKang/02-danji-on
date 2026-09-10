import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// GAP-4: application multi-photo (0..3) persistence contract.
// Static source + migration assertions only; no database required.
// Postgres lifecycle is covered separately by
// tests/business-application-photos-044-postgres-lifecycle.sh.

const root = new URL('../', import.meta.url);
const economy = await readFile(new URL('src/resident-economy-v2.ts', root), 'utf8');
const storage = await readFile(new URL('src/storage-v1.ts', root), 'utf8');
const migration = await readFile(new URL('migrations/044_application_photos.sql', root), 'utf8');

// ---------------------------------------------------------------- migration
assert.ok(migration.includes('create table if not exists business_application_photos'),
  '044 must create business_application_photos idempotently');
assert.ok(migration.includes('application_id uuid not null references business_applications(id) on delete cascade'),
  'gallery rows must cascade with their application');
assert.ok(migration.includes("object_key text not null check (object_key like 'gdrive/public/business-image/%')"),
  'gallery keys must stay inside the public business-image namespace');
assert.ok(migration.includes('sort_order integer not null check (sort_order between 0 and 2)'),
  'DB must enforce 0..2 sort order (max 3 photos)');
assert.ok(migration.includes('unique (application_id, sort_order)'),
  'DB must enforce one key per gallery slot');
assert.ok(migration.includes('unique (object_key)'),
  'DB must forbid the same object landing in two galleries');
assert.ok(migration.includes('idx_business_application_photos_application'),
  '044 must index the application lookup');
assert.ok(migration.includes('representative_image_object_key'),
  '044 must document the representative mirror strategy');
assert.equal(migration.includes('alter table business_applications'), false,
  '044 must not ALTER the existing application table');
assert.equal(migration.includes('drop column'), false,
  '044 must not drop the legacy representative column');

// ------------------------------------------------------------- request shape
assert.ok(economy.includes('MAX_APPLICATION_PHOTOS = 3'),
  'gallery limit must be a named constant, not a magic number');
assert.ok(economy.includes('function parsePhotoObjectKeys('),
  'photoObjectKeys parsing must be centralized and fail-closed');
assert.ok(economy.includes("'PHOTO_LIMIT_EXCEEDED'"),
  '4+ photos must reject with PHOTO_LIMIT_EXCEEDED');
assert.ok(economy.includes("'DUPLICATE_PHOTO_KEYS'"),
  'duplicate keys in one request must reject');
assert.ok(economy.includes("'INVALID_PHOTO_KEY'"),
  'non business-image keys must reject before any ownership lookup');
assert.ok(economy.includes('function photoContractAgreement('),
  'legacy representative + gallery disagreement must never resolve silently');
assert.ok(economy.includes("'PHOTO_CONTRACT_MISMATCH'"),
  'representativeImageObjectKey must equal photoObjectKeys[0] when both arrive');

// ------------------------------------------------------- ownership boundary
assert.ok(economy.includes('function validateGalleryOwnership('),
  'every gallery key needs a registry ownership check');
assert.ok(economy.includes("'PHOTO_NOT_ACTIVE'"),
  'inactive/retired objects must reject with PHOTO_NOT_ACTIVE');
assert.ok(economy.includes("'PHOTO_OWNER_MISMATCH'"),
  'foreign-uploader keys must reject with PHOTO_OWNER_MISMATCH (403)');
assert.ok(economy.includes("'PHOTO_COMPLEX_MISMATCH'"),
  'cross-complex keys must reject with PHOTO_COMPLEX_MISMATCH (403)');
assert.ok(economy.includes('validateGalleryOwnership(sql, galleryKeys'),
  'ownership must be verified before any Drive call');
const ownershipIndex = economy.indexOf('validateGalleryOwnership(sql, galleryKeys');
const driveIndex = economy.indexOf('await validateBusinessImageReference(', ownershipIndex);
assert.ok(ownershipIndex >= 0 && driveIndex > ownershipIndex,
  'DB ownership must precede external Drive revalidation');

// --------------------------------------------------- representative mirror
assert.ok(economy.includes('photoKeys !== null'),
  'gallery-present requests must take the authoritative branch');
assert.ok(economy.includes('photoKeys.length > 0 ? photoKeys[0] : null'),
  'representative must mirror photoObjectKeys[0] (null when emptied)');
assert.ok(economy.includes('representative_image_object_key'),
  'legacy representative column must be preserved, never dropped');
assert.equal(economy.includes('drop column'), false,
  'economy handler must not drop any column');

// ------------------------------------------------------------- resubmit
assert.ok(economy.includes('async function resubmitWithGallery('),
  'gallery resubmits need a dedicated atomic path');
assert.ok(economy.includes('delete from business_application_photos'),
  'resubmit with gallery must replace rows (REPLACE ALL, never append)');
assert.ok(economy.includes('on conflict') || economy.includes('delete from business_application_photos\n    where application_id'),
  'gallery replacement must be deterministic per application');
const preserveBranch = economy.indexOf('Legacy preserve path (photoObjectKeys omitted)');
assert.ok(preserveBranch >= 0,
  'omitted photoObjectKeys on PATCH must preserve the existing gallery');
assert.ok(economy.includes("Only changes_requested applications can be resubmitted"),
  'resubmit must stay changes_requested-only with galleries');

// ---------------------------------------------------------------- response
assert.ok(economy.includes('photoObjectKeys: [...photoKeys]') || economy.includes('withGallery('),
  'create/resubmit responses must carry additive photoObjectKeys');
assert.ok(economy.includes('function withGallery('),
  'gallery enrichment must be centralized');
assert.ok(economy.includes("'PHOTO_ALREADY_USED'"),
  'cross-application object reuse must reject, never silently share');

// -------------------------------------------------------------- idempotency
assert.ok(economy.includes('await fingerprint(input)'),
  'idempotency fingerprint must cover the gallery (input includes photoObjectKeys)');
assert.ok(economy.includes('IDEMPOTENCY_KEY_REUSED'),
  'same key with different photos must replay-reject, not fork rows');

// ------------------------------------------------- delete/reconciliation
assert.ok(storage.includes('from business_application_photos ap'),
  'delete guards must see gallery references as in-use');
assert.ok(storage.includes('application_photos_in_use'),
  'delete intent must carry the gallery usage bit');
assert.ok(storage.includes('not u.application_photos_in_use'),
  'delete intent must block while any live application gallery references the object');
assert.ok(storage.includes("a.status in ('draft', 'pending', 'changes_requested', 'approved')"),
  'gallery guard must share the live-status set (rejected stays non-blocking)');

// ------------------------------------------------------- out of scope guard
assert.equal(economy.includes('application-document'), false,
  'GAP-4 must not invent the GAP-5 document kind');
assert.equal(economy.includes('resident-evidence'), false,
  'GAP-4 must not touch the policy-HOLD evidence path');

console.log('PASS business application photos GAP-4 contract: 0..3 gallery, mirror, resubmit REPLACE_ALL, delete guard');
