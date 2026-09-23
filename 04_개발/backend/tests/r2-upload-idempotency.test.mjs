/**
 * R2 upload idempotency replay semantics (CENTRAL review finding on #910).
 *
 * Locks the R2 lane to the existing Drive idempotency contract:
 *   FIRST_REQUEST_WITH_IDEMPOTENCY_KEY -> idempotencyReplayed=false
 *   SAME_KEY_REPLAY (active row reuse or upload_pending resume) -> idempotencyReplayed=true
 *   SAME_KEY_DIFFERENT_FINGERPRINT -> 409 IDEMPOTENCY_KEY_REUSED
 *
 * Drive-path semantics are covered by business-image-upload-idempotency.test.mjs
 * and are intentionally untouched here.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  businessImageUploadRequestFingerprint,
  runR2TrackedUpload
} from '../src/storage-upload-v2.ts';

const root = new URL('../', import.meta.url);
const uploadSource = await readFile(new URL('src/storage-upload-v2.ts', root), 'utf8');

const uploader = '11111111-1111-4111-8111-111111111111';
const complexId = '22222222-2222-4222-8222-222222222222';
const complexSlug = 'r2-idempotency-complex';
const key = 'r2-upload-retry-key-0001';
const resident = { id: uploader, authUserId: 'auth-user', displayName: 'Resident', complexId, complexSlug };
const file = new File(['same-r2-image-bytes'], 'shop.png', { type: 'image/png' });
const fingerprint = await businessImageUploadRequestFingerprint(file, complexSlug);

// Drift guard: the replay flag must never fall back to "key was present".
assert.equal(
  uploadSource.includes('idempotencyReplayed: Boolean(idempotencyKey)'),
  false,
  'R2 path must not derive idempotencyReplayed from key presence alone'
);

function makeBucket() {
  const objects = new Map();
  let puts = 0;
  return {
    puts: () => puts,
    seed(objectKey, size = file.size) {
      objects.set(objectKey, {
        size,
        httpMetadata: { contentType: 'image/png' },
        customMetadata: { originalFileName: 'shop.png', danjionKind: 'business-image' }
      });
    },
    async put(objectKey, body, options = {}) {
      puts += 1;
      objects.set(objectKey, {
        size: typeof body?.size === 'number' ? body.size : 0,
        httpMetadata: options.httpMetadata || {},
        customMetadata: options.customMetadata || {}
      });
    },
    async head(objectKey) {
      return objects.get(objectKey) || null;
    },
    async get() {
      return null;
    },
    async delete(objectKey) {
      objects.delete(objectKey);
    }
  };
}

function makeSql(options = {}) {
  const rows = new Map();
  if (options.initialRow) rows.set(options.initialRow.object_key, { ...options.initialRow });

  const sql = async (strings, ...values) => {
    const text = strings.join('?');

    if (text.includes('from business_image_objects') && text.includes('upload_idempotency_key =') && text.includes('where uploader_user_id')) {
      const [userId, kind, idemKey] = values;
      const row = [...rows.values()].find(
        (candidate) => candidate.uploader_user_id === userId && candidate.kind === kind && candidate.upload_idempotency_key === idemKey
      );
      return row ? [{ ...row }] : [];
    }

    if (text.includes('insert into business_image_objects') && text.includes('on conflict (object_key) do nothing')) {
      // state is a SQL literal ('upload_pending'), not a bound value.
      const [objectKey, userId, targetComplexId, kind, idemKey, requestFingerprint] = values;
      if (rows.has(objectKey)) return [];
      const row = {
        object_key: objectKey,
        uploader_user_id: userId,
        complex_id: targetComplexId,
        state: 'upload_pending',
        kind,
        upload_idempotency_key: idemKey,
        upload_request_fingerprint: requestFingerprint
      };
      rows.set(objectKey, row);
      return [{ object_key: objectKey }];
    }

    if (text.includes("set state = 'active'") && text.includes("and state = 'upload_pending'")) {
      const [objectKey, userId, targetComplexId, kind] = values;
      const row = rows.get(objectKey);
      if (row && row.uploader_user_id === userId && row.complex_id === targetComplexId && row.kind === kind && row.state === 'upload_pending') {
        row.state = 'active';
        return [{ object_key: objectKey }];
      }
      return [];
    }

    throw new Error(`Unexpected SQL in R2 idempotency test: ${text}`);
  };

  return {
    sql,
    rowByKey: (objectKey) => (rows.has(objectKey) ? { ...rows.get(objectKey) } : null)
  };
}

function makeEnv(bucket) {
  return { STORAGE_MODE: 'r2', DANJION_STORAGE: bucket };
}

// CASE_1: first request carrying an Idempotency-Key is NOT a replay.
{
  const bucket = makeBucket();
  const fixture = makeSql();
  const result = await runR2TrackedUpload(makeEnv(bucket), fixture.sql, file, resident, 'business-image', 'req-r2-first', key);
  assert.equal(result instanceof Response, false, 'first R2 upload must succeed');
  assert.equal(result.idempotencyReplayed, false, 'R2_FIRST_IDEMPOTENT_UPLOAD_REPLAYED_FALSE');
  assert.match(result.objectKey, /^gdrive\/public\/business-image\/[0-9a-f]{32}$/);
  assert.equal(bucket.puts(), 1, 'first upload persists one R2 object');
  assert.equal(fixture.rowByKey(result.objectKey).state, 'active');
}

// CASE_0 guard: upload without any Idempotency-Key is also not a replay.
{
  const bucket = makeBucket();
  const fixture = makeSql();
  const result = await runR2TrackedUpload(makeEnv(bucket), fixture.sql, file, resident, 'business-image', 'req-r2-no-key', null);
  assert.equal(result instanceof Response, false);
  assert.equal(result.idempotencyReplayed, false);
  assert.equal(bucket.puts(), 1);
}

// CASE_2: same uploader + kind + key + fingerprint against an existing ACTIVE object
// replays onto the same objectKey without a new R2 put.
{
  const existingKey = `gdrive/public/business-image/${'a'.repeat(32)}`;
  const bucket = makeBucket();
  bucket.seed(existingKey);
  const fixture = makeSql({
    initialRow: {
      object_key: existingKey,
      uploader_user_id: uploader,
      complex_id: complexId,
      state: 'active',
      kind: 'business-image',
      upload_idempotency_key: key,
      upload_request_fingerprint: fingerprint
    }
  });
  const result = await runR2TrackedUpload(makeEnv(bucket), fixture.sql, file, resident, 'business-image', 'req-r2-active-replay', key);
  assert.equal(result instanceof Response, false, 'active replay must succeed');
  assert.equal(result.objectKey, existingKey, 'R2_ACTIVE_REPLAY_TRUE: same objectKey');
  assert.equal(result.idempotencyReplayed, true, 'R2_ACTIVE_REPLAY_TRUE');
  assert.equal(bucket.puts(), 0, 'active replay must never re-put the object');
}

// CASE_3: same key with a different fingerprint is rejected.
{
  const existingKey = `gdrive/public/business-image/${'c'.repeat(32)}`;
  const bucket = makeBucket();
  const fixture = makeSql({
    initialRow: {
      object_key: existingKey,
      uploader_user_id: uploader,
      complex_id: complexId,
      state: 'active',
      kind: 'business-image',
      upload_idempotency_key: key,
      upload_request_fingerprint: 'f'.repeat(64)
    }
  });
  const result = await runR2TrackedUpload(makeEnv(bucket), fixture.sql, file, resident, 'business-image', 'req-r2-key-reuse', key);
  assert.ok(result instanceof Response, 'R2_KEY_REUSE_DIFFERENT_FINGERPRINT_409');
  assert.equal(result.status, 409, 'R2_KEY_REUSE_DIFFERENT_FINGERPRINT_409');
  const body = await result.json();
  assert.equal(body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(bucket.puts(), 0, 'key reuse must never write to R2');
}

// CASE_4: same key + fingerprint against an upload_pending row resumes the same
// reservation, uploads once, activates, and reports a replay.
{
  const pendingKey = `gdrive/public/business-image/${'b'.repeat(32)}`;
  const bucket = makeBucket();
  const fixture = makeSql({
    initialRow: {
      object_key: pendingKey,
      uploader_user_id: uploader,
      complex_id: complexId,
      state: 'upload_pending',
      kind: 'business-image',
      upload_idempotency_key: key,
      upload_request_fingerprint: fingerprint
    }
  });
  const result = await runR2TrackedUpload(makeEnv(bucket), fixture.sql, file, resident, 'business-image', 'req-r2-pending-resume', key);
  assert.equal(result instanceof Response, false, 'pending resume must succeed');
  assert.equal(result.objectKey, pendingKey, 'resume keeps the reserved objectKey');
  assert.equal(result.idempotencyReplayed, true, 'R2_PENDING_REPLAY_TRUE');
  assert.equal(bucket.puts(), 1, 'resume uploads the binary exactly once');
  assert.equal(fixture.rowByKey(pendingKey).state, 'active');
}

console.log('PASS R2 upload idempotency replay semantics: first=false, no-key=false, active replay=true (same key, no re-put), key reuse 409, pending resume=true');

