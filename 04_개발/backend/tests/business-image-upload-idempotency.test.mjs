import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  businessImageUploadRequestFingerprint,
  reserveIdempotentBusinessImageUpload,
  runTrackedBusinessImageUpload,
  validBusinessImageUploadIdempotencyKey
} from '../src/storage-upload-v2.ts';

const root = new URL('../', import.meta.url);
const uploadSource = await readFile(new URL('src/storage-upload-v2.ts', root), 'utf8');
const migration022 = await readFile(new URL('migrations/022_business_image_upload_idempotency.sql', root), 'utf8');
const architecture = await readFile(
  new URL('../docs/BUSINESS_IMAGE_UPLOAD_IDEMPOTENCY_ARCHITECTURE_20260827.md', root),
  'utf8'
);
const resumeArchitecture = await readFile(
  new URL('../docs/BUSINESS_IMAGE_IDEMPOTENT_RESUME_ARCHITECTURE_20260827.md', root),
  'utf8'
);

const uploader = '11111111-1111-4111-8111-111111111111';
const complexId = '22222222-2222-4222-8222-222222222222';
const complexSlug = 'idempotency-complex';
const key = 'upload-retry-key-0001';
const folderId = 'drive_business_folder_1234567890';
const fileId = 'idem_file_1234567890';
const objectKey = `gdrive/public/business-image/${fileId}`;
const env = {
  STORAGE_MODE: 'drive',
  GOOGLE_DRIVE_CLIENT_ID: 'client-for-test',
  GOOGLE_DRIVE_CLIENT_SECRET: 'secret-for-test',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh-for-test',
  GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID: folderId
};
const resident = { id: uploader, authUserId: 'auth-user', displayName: 'Resident', complexId, complexSlug };
const file = new File(['same-business-image'], 'shop.png', { type: 'image/png' });

assert.equal(validBusinessImageUploadIdempotencyKey(key), true);
assert.equal(validBusinessImageUploadIdempotencyKey('short'), false);
assert.equal(validBusinessImageUploadIdempotencyKey('bad key with spaces'), false);

const fp1 = await businessImageUploadRequestFingerprint(file, complexSlug);
const fp2 = await businessImageUploadRequestFingerprint(
  new File(['same-business-image'], 'shop.png', { type: 'image/png' }), complexSlug
);
const fpDifferent = await businessImageUploadRequestFingerprint(
  new File(['different-business-image'], 'shop.png', { type: 'image/png' }), complexSlug
);
assert.equal(fp1, fp2, 'same logical file request must have a stable fingerprint');
assert.notEqual(fp1, fpDifferent, 'different file bytes must change the fingerprint');
assert.match(fp1, /^[0-9a-f]{64}$/);

assert.ok(migration022.includes('upload_idempotency_key text'));
assert.ok(migration022.includes('upload_request_fingerprint text'));
assert.ok(migration022.includes('uq_business_image_upload_idempotency'));
assert.ok(migration022.includes('(uploader_user_id, upload_idempotency_key)'));
assert.ok(migration022.includes('where upload_idempotency_key is not null'));
assert.ok(migration022.includes('chk_business_image_upload_idempotency_pair'));
assert.ok(migration022.includes("upload_request_fingerprint ~ '^[0-9a-f]{64}$'"));
assert.ok(uploadSource.includes("request.headers.get('idempotency-key')"));
assert.ok(uploadSource.includes("'IDEMPOTENCY_KEY_REUSED'"));
assert.ok(uploadSource.includes("'BUSINESS_IMAGE_UPLOAD_IDEMPOTENCY_STATE_CONFLICT'"));
assert.ok(architecture.includes('BACKEND_IDEMPOTENCY_CAPABILITY_READY != CLIENT_RETRY_DEDUPLICATION_ACTIVE'));
assert.ok(resumeArchitecture.includes('EXACT_404 + VERIFIED_RETRY_FILE -> SAME_ID_RESUME_ALLOWED'));
assert.ok(resumeArchitecture.includes('EXACT_OBJECT_MISMATCH -> NO_DRIVE_MUTATION'));

const keyedStart = uploadSource.indexOf('async function runIdempotentTrackedBusinessImageUpload(');
const keyedEnd = uploadSource.indexOf('export async function runTrackedBusinessImageUpload(', keyedStart);
const keyedBlock = uploadSource.slice(keyedStart, keyedEnd);
const existingLookupIndex = keyedBlock.indexOf('await readIdempotentRegistryRow(');
const generateIndex = keyedBlock.indexOf('await generateDriveFileId(');
const reserveIndex = keyedBlock.indexOf('await reserveIdempotentBusinessImageUpload(');
const loserReplayIndex = keyedBlock.indexOf('if (!reservation.reserved)');
const persistIndex = keyedBlock.indexOf('return persistIdempotentReservedBusinessImageUpload(');
assert.ok(existingLookupIndex >= 0 && generateIndex > existingLookupIndex);
assert.ok(reserveIndex > generateIndex && loserReplayIndex > reserveIndex && persistIndex > loserReplayIndex);

const resumeStart = uploadSource.indexOf('async function resumeIdempotentBusinessImageUploadPending(');
const resumeEnd = uploadSource.indexOf('async function runIdempotentTrackedBusinessImageUpload(', resumeStart);
assert.ok(resumeStart >= 0 && resumeEnd > resumeStart, 'same-ID resume helper must exist before keyed upload runner');
const resumeBlock = uploadSource.slice(resumeStart, resumeEnd);
assert.equal(resumeBlock.includes('generateDriveFileId('), false, 'same-ID resume must never generate a replacement Drive id');
assert.ok(resumeBlock.includes('await readDriveMetadata('), 'resume must prove exact Drive state before binary upload');
assert.ok(resumeBlock.includes('await persistIdempotentReservedBusinessImageUpload('), '404 resume must persist using the existing reserved object key');

function cloneRow(row) {
  return row ? { ...row } : null;
}

function makeSql(options = {}) {
  const rows = new Map();
  let hideIdempotencyReads = Number(options.hideIdempotencyReads || 0);
  if (options.initialRow) rows.set(options.initialRow.object_key, { ...options.initialRow });

  const sql = async (strings, ...values) => {
    const text = strings.join('?');

    if (text.includes('insert into business_image_objects') && text.includes('upload_idempotency_key')) {
      const [candidateKey, userId, targetComplexId, idemKey, fingerprint] = values;
      const sameIdempotency = [...rows.values()].find(
        (row) => row.uploader_user_id === userId && row.upload_idempotency_key === idemKey
      );
      if (rows.has(candidateKey) || sameIdempotency) return [];
      const row = {
        object_key: candidateKey,
        uploader_user_id: userId,
        complex_id: targetComplexId,
        state: 'upload_pending',
        upload_idempotency_key: idemKey,
        upload_request_fingerprint: fingerprint
      };
      rows.set(candidateKey, row);
      return [cloneRow(row)];
    }

    if (text.includes('upload_idempotency_key =') && text.includes('where uploader_user_id')) {
      if (hideIdempotencyReads > 0) {
        hideIdempotencyReads -= 1;
        return [];
      }
      const [userId, idemKey] = values;
      const row = [...rows.values()].find(
        (candidate) => candidate.uploader_user_id === userId && candidate.upload_idempotency_key === idemKey
      );
      return row ? [cloneRow(row)] : [];
    }

    if (text.includes("set state = 'active'")) {
      const [targetKey, userId, targetComplexId] = values;
      const row = rows.get(targetKey);
      if (row && row.uploader_user_id === userId && row.complex_id === targetComplexId && row.state === 'upload_pending') {
        row.state = 'active';
        return [{ state: 'active' }];
      }
      return [];
    }

    if (text.includes('select object_key, uploader_user_id::text, complex_id::text, state') &&
        text.includes('where object_key =')) {
      const row = rows.get(values[0]);
      return row ? [cloneRow(row)] : [];
    }

    if (text.includes('select uploader_user_id::text, complex_id::text, state') &&
        text.includes('where object_key =')) {
      const row = rows.get(values[0]);
      return row ? [cloneRow(row)] : [];
    }

    throw new Error(`Unexpected SQL in idempotency test: ${text}`);
  };

  return {
    sql,
    rowByKey: (targetKey) => cloneRow(rows.get(targetKey)),
    setState: (targetKey, state) => {
      const row = rows.get(targetKey);
      if (!row) throw new Error(`Missing row ${targetKey}`);
      row.state = state;
    }
  };
}

function validMetadata(id = fileId) {
  return {
    id,
    name: 'stored.png',
    mimeType: 'image/png',
    size: String(file.size),
    trashed: false,
    parents: [folderId],
    appProperties: {
      danjionKind: 'business-image',
      danjionVisibility: 'public',
      danjionUploaderUserId: uploader,
      danjionComplexSlug: complexSlug
    }
  };
}

function mismatchedMetadata(id = fileId) {
  return {
    ...validMetadata(id),
    parents: ['wrong-folder']
  };
}

function installFetch(options = {}) {
  const generatedIds = options.generatedIds || [fileId];
  const metadataSequence = [...(options.metadataSequence || [])];
  let generated = 0;
  let uploaded = 0;
  let metadataReads = 0;

  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('oauth2.googleapis.com/token')) {
      return Response.json({ access_token: 'idempotency-test-token', expires_in: 3600 });
    }
    if (href.includes('/files/generateIds')) {
      const id = generatedIds[Math.min(generated, generatedIds.length - 1)];
      generated += 1;
      return Response.json({ ids: [id] });
    }
    if (href.includes('upload/drive/v3/files')) {
      uploaded += 1;
      assert.equal(init.method, 'POST');
      if (options.expectedUploadId) {
        assert.ok(init.body instanceof Blob);
        const multipart = await init.body.text();
        assert.ok(multipart.includes(`\"id\":\"${options.expectedUploadId}\"`), 'resume upload must target the stored exact Drive id');
      }
      if (options.uploadThrows) throw new Error('synthetic ambiguous resume upload');
      const uploadStatus = Number(options.uploadStatus || 200);
      return new Response(uploadStatus === 200 ? JSON.stringify(validMetadata(options.expectedUploadId || generatedIds[Math.max(0, generated - 1)])) : '', {
        status: uploadStatus,
        headers: { 'content-type': 'application/json' }
      });
    }
    const exactIdMatch = href.match(/\/drive\/v3\/files\/([^?]+)/);
    if (exactIdMatch) {
      metadataReads += 1;
      const exactId = decodeURIComponent(exactIdMatch[1]);
      let next = metadataSequence.length ? metadataSequence.shift() : undefined;
      if (next instanceof Error) throw next;
      if (typeof next === 'function') next = next(exactId);
      if (next === null || (next === undefined && options.metadata404)) {
        return new Response('', { status: 404 });
      }
      return Response.json(next ?? validMetadata(exactId));
    }
    throw new Error(`Unexpected fetch in idempotency test: ${href}`);
  };

  return {
    generated: () => generated,
    uploaded: () => uploaded,
    metadataReads: () => metadataReads
  };
}

function pendingWinnerRow() {
  return {
    object_key: objectKey,
    uploader_user_id: uploader,
    complex_id: complexId,
    state: 'upload_pending',
    upload_idempotency_key: key,
    upload_request_fingerprint: fp1
  };
}

const originalFetch = globalThis.fetch;
try {
  // First keyed request wins the durable binding and uploads exactly one binary.
  let fixture = makeSql();
  let counters = installFetch();
  let result = await runTrackedBusinessImageUpload(env, fixture.sql, file, resident, 'req-first', key);
  assert.equal(result instanceof Response, false);
  assert.equal(result.objectKey, objectKey);
  assert.equal(result.idempotencyReplayed, undefined);
  assert.equal(fixture.rowByKey(objectKey).state, 'active');
  assert.equal(fixture.rowByKey(objectKey).upload_idempotency_key, key);
  assert.equal(fixture.rowByKey(objectKey).upload_request_fingerprint, fp1);
  assert.equal(counters.generated(), 1);
  assert.equal(counters.uploaded(), 1);

  // Lost HTTP success -> same logical retry replays the exact active object.
  const beforeGenerate = counters.generated();
  const beforeUpload = counters.uploaded();
  result = await runTrackedBusinessImageUpload(env, fixture.sql, file, resident, 'req-retry', key);
  assert.equal(result instanceof Response, false);
  assert.equal(result.objectKey, objectKey);
  assert.equal(result.idempotencyReplayed, true);
  assert.equal(counters.generated(), beforeGenerate, 'active replay must not generate another Drive id');
  assert.equal(counters.uploaded(), beforeUpload, 'active replay must not upload another binary');
  assert.equal(counters.metadataReads() >= 2, true, 'active replay must confirm exact Drive metadata');

  // Same key with different bytes is a deterministic 409 before any Drive operation.
  const differentFile = new File(['different-business-image'], 'shop.png', { type: 'image/png' });
  const generateBeforeConflict = counters.generated();
  const uploadBeforeConflict = counters.uploaded();
  result = await runTrackedBusinessImageUpload(env, fixture.sql, differentFile, resident, 'req-conflict', key);
  assert.ok(result instanceof Response);
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(counters.generated(), generateBeforeConflict);
  assert.equal(counters.uploaded(), uploadBeforeConflict);

  // Lifecycle retirement is authoritative: a keyed retry may never resurrect it.
  fixture.setState(objectKey, 'delete_pending');
  result = await runTrackedBusinessImageUpload(env, fixture.sql, file, resident, 'req-retired-state', key);
  assert.ok(result instanceof Response);
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error.code, 'BUSINESS_IMAGE_UPLOAD_IDEMPOTENCY_STATE_CONFLICT');

  // Direct reservation race: one key may bind only one candidate object.
  fixture = makeSql();
  const candidateA = 'gdrive/public/business-image/idem_candidate_A_1234567890';
  const candidateB = 'gdrive/public/business-image/idem_candidate_B_1234567890';
  let reservation = await reserveIdempotentBusinessImageUpload(
    fixture.sql, candidateA, uploader, complexId, key, fp1, 'req-reserve-a'
  );
  assert.equal(reservation instanceof Response, false);
  assert.equal(reservation.reserved, true);
  reservation = await reserveIdempotentBusinessImageUpload(
    fixture.sql, candidateB, uploader, complexId, key, fp1, 'req-reserve-b'
  );
  assert.equal(reservation instanceof Response, false);
  assert.equal(reservation.reserved, false);
  assert.equal(reservation.row.object_key, candidateA);

  // Simulated concurrency loser: first lookup misses, unique reservation loses,
  // candidate id is unused, and only the winner's exact object is reconciled.
  fixture = makeSql({ initialRow: pendingWinnerRow(), hideIdempotencyReads: 1 });
  counters = installFetch({ generatedIds: ['loser_candidate_1234567890'] });
  result = await runTrackedBusinessImageUpload(env, fixture.sql, file, resident, 'req-race-loser', key);
  assert.equal(result instanceof Response, false);
  assert.equal(result.objectKey, objectKey);
  assert.equal(result.idempotencyReplayed, true);
  assert.equal(counters.generated(), 1, 'racing loser may reserve one unused candidate id');
  assert.equal(counters.uploaded(), 0, 'racing loser must never upload its candidate binary when the winner object exists');
  assert.equal(counters.metadataReads(), 1, 'racing loser reconciles only the winner exact id');
  assert.equal(fixture.rowByKey(objectKey).state, 'active');

  // Crash after durable reservation but before binary persistence: exact 404
  // allows same-file retry to upload to the already reserved ID, never a new ID.
  fixture = makeSql({ initialRow: pendingWinnerRow() });
  counters = installFetch({
    metadataSequence: [null, validMetadata(fileId)],
    expectedUploadId: fileId
  });
  result = await runTrackedBusinessImageUpload(env, fixture.sql, file, resident, 'req-resume-404', key);
  assert.equal(result instanceof Response, false);
  assert.equal(result.objectKey, objectKey);
  assert.equal(result.idempotencyReplayed, true);
  assert.equal(counters.generated(), 0, 'same-ID resume must never generate a replacement Drive id');
  assert.equal(counters.uploaded(), 1, 'exact 404 should resume one binary upload against the reserved id');
  assert.equal(counters.metadataReads(), 2, 'resume must prove absence then confirm persisted exact metadata');
  assert.equal(fixture.rowByKey(objectKey).state, 'active');

  // Existing but mismatched exact object is an integrity anomaly, not an empty reservation.
  fixture = makeSql({ initialRow: pendingWinnerRow() });
  counters = installFetch({ metadataSequence: [mismatchedMetadata(fileId)] });
  result = await runTrackedBusinessImageUpload(env, fixture.sql, file, resident, 'req-resume-mismatch', key);
  assert.ok(result instanceof Response);
  assert.equal(result.status, 503);
  assert.equal(counters.generated(), 0);
  assert.equal(counters.uploaded(), 0, 'metadata mismatch must never trigger resume upload');
  assert.equal(fixture.rowByKey(objectKey).state, 'upload_pending');

  // Metadata outage cannot prove absence, therefore no resume upload is allowed.
  fixture = makeSql({ initialRow: pendingWinnerRow() });
  counters = installFetch({ metadataSequence: [new Error('synthetic metadata outage')] });
  result = await runTrackedBusinessImageUpload(env, fixture.sql, file, resident, 'req-resume-read-outage', key);
  assert.ok(result instanceof Response);
  assert.equal(result.status, 503);
  assert.equal(counters.generated(), 0);
  assert.equal(counters.uploaded(), 0, 'metadata read outage must never trigger resume upload');
  assert.equal(fixture.rowByKey(objectKey).state, 'upload_pending');

  // Concurrent original/resume overlap may return Drive 409. Reconcile the same
  // exact ID and activate it; never generate a second ID.
  fixture = makeSql({ initialRow: pendingWinnerRow() });
  counters = installFetch({
    metadataSequence: [null, validMetadata(fileId)],
    uploadStatus: 409,
    expectedUploadId: fileId
  });
  result = await runTrackedBusinessImageUpload(env, fixture.sql, file, resident, 'req-resume-409', key);
  assert.equal(result instanceof Response, false);
  assert.equal(result.objectKey, objectKey);
  assert.equal(result.idempotencyReplayed, true);
  assert.equal(counters.generated(), 0);
  assert.equal(counters.uploaded(), 1);
  assert.equal(counters.metadataReads(), 2);
  assert.equal(fixture.rowByKey(objectKey).state, 'active');

  // Ambiguous transport failure after same-ID resume also reconciles the exact ID.
  fixture = makeSql({ initialRow: pendingWinnerRow() });
  counters = installFetch({
    metadataSequence: [null, validMetadata(fileId)],
    uploadThrows: true,
    expectedUploadId: fileId
  });
  result = await runTrackedBusinessImageUpload(env, fixture.sql, file, resident, 'req-resume-ambiguous', key);
  assert.equal(result instanceof Response, false);
  assert.equal(result.objectKey, objectKey);
  assert.equal(result.idempotencyReplayed, true);
  assert.equal(counters.generated(), 0);
  assert.equal(counters.uploaded(), 1);
  assert.equal(counters.metadataReads(), 2);
  assert.equal(fixture.rowByKey(objectKey).state, 'active');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('PASS business-image upload idempotency + exact-ID resume: replay, conflict, no resurrection, 404 same-ID resume, mismatch/outage no upload, ambiguous exact-ID reconciliation');
