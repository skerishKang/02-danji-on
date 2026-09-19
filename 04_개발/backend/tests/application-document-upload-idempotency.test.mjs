import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applicationDocumentUploadRequestFingerprint,
  runTrackedApplicationDocumentUpload,
  reserveIdempotentApplicationDocumentUpload
} from '../src/storage-upload-v2.ts';

const root = new URL('../', import.meta.url);
const uploadSource = await readFile(new URL('src/storage-upload-v2.ts', root), 'utf8');
const migration054 = await readFile(new URL('migrations/054_application_document_upload_idempotency.sql', root), 'utf8');

const uploader = '11111111-1111-4111-8111-111111111111';
const complexId = '22222222-2222-4222-8222-222222222222';
const complexSlug = 'idempotency-complex';
const otherComplexId = '33333333-3333-4333-8333-333333333333';
const otherComplexSlug = 'other-complex';
const key = 'upload-retry-key-0001';
const folderId = 'drive_private_folder_1234567890';
const fileId = 'idem_file_1234567890';
const objectKey = `gdrive/private/application-document/${fileId}`;
const env = {
  STORAGE_MODE: 'drive',
  GOOGLE_DRIVE_CLIENT_ID: 'client-for-test',
  GOOGLE_DRIVE_CLIENT_SECRET: 'secret-for-test',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh-for-test',
  GOOGLE_DRIVE_PRIVATE_RESIDENT_VERIFICATION_FOLDER_ID: folderId
};
const resident = { id: uploader, authUserId: 'auth-user', displayName: 'Resident', complexId, complexSlug };
const file = new File(['same-application-document'], 'contract.pdf', { type: 'application/pdf' });

const fp1 = await applicationDocumentUploadRequestFingerprint(file, complexSlug);
const fp2 = await applicationDocumentUploadRequestFingerprint(
  new File(['same-application-document'], 'contract.pdf', { type: 'application/pdf' }), complexSlug
);
const fpDifferent = await applicationDocumentUploadRequestFingerprint(
  new File(['different-application-document'], 'contract.pdf', { type: 'application/pdf' }), complexSlug
);
assert.equal(fp1, fp2, 'same logical file request must have a stable fingerprint');
assert.notEqual(fp1, fpDifferent, 'different file bytes must change the fingerprint');
assert.match(fp1, /^[0-9a-f]{64}$/);

assert.ok(migration054.includes('uq_application_document_upload_idempotency'));
assert.ok(migration054.includes('(uploader_user_id, upload_idempotency_key)'));
assert.ok(migration054.includes("where kind = 'application-document' and upload_idempotency_key is not null"));
assert.ok(migration054.includes('gdrive/private/application-document/%'));
assert.ok(uploadSource.includes("'IDEMPOTENCY_KEY_REUSED'"));
assert.ok(uploadSource.includes("'APPLICATION_DOCUMENT_UPLOAD_IDEMPOTENCY_SCOPE_CONFLICT'"));
assert.ok(uploadSource.includes("'APPLICATION_DOCUMENT_UPLOAD_IDEMPOTENCY_STATE_CONFLICT'"));
assert.ok(uploadSource.includes("'APPLICATION_DOCUMENT_UPLOAD_RECONCILIATION_PENDING'"));
assert.ok(uploadSource.includes('id: fileId,'), 'reserved Drive ID must be bound to the create request');
assert.ok(uploadSource.includes("danjionVisibility: 'private'"), 'private visibility must be preserved');
assert.ok(uploadSource.includes("state = 'upload_pending'"), 'new uploads must reserve as upload_pending');
assert.ok(uploadSource.includes("state = 'active'"), 'activation must be explicit');
function makeSql({ initialRow = null, hideIdempotencyReads = 0 } = {}) {
  let rows = initialRow ? { [initialRow.object_key]: { ...initialRow } } : {};
  let idempotencyReadCount = 0;
  const sql = async (strings, ...values) => {
    const text = strings.join(' ').replace(/\s+/g, ' ').trim();

    if (text.startsWith('select object_key, uploader_user_id::text, complex_id::text, state, upload_idempotency_key, upload_request_fingerprint from business_image_objects where uploader_user_id =')) {
      idempotencyReadCount += 1;
      if (idempotencyReadCount <= hideIdempotencyReads) return [];
      const [uploaderId, idemKey] = values;
      const found = Object.values(rows).find((row) =>
        row.uploader_user_id === uploaderId && row.upload_idempotency_key === idemKey && row.kind === 'application-document'
      );
      return found ? [found] : [];
    }

    if (text.startsWith('select object_key, uploader_user_id::text, complex_id::text, state from business_image_objects where object_key =')) {
      const [objectKeyVal] = values;
      const row = rows[objectKeyVal];
      return row && row.kind === 'application-document' ? [row] : [];
    }

    if (text.startsWith('insert into business_image_objects')) {
      const [objectKeyVal, uploaderId, complexIdVal, idemKey, fingerprint] = values; const stateVal = 'upload_pending'; const kindVal = 'application-document';
      if (rows[objectKeyVal]) return [];
      if (idemKey) {
        const conflict = Object.values(rows).find((row) =>
          row.uploader_user_id === uploaderId && row.upload_idempotency_key === idemKey && row.kind === 'application-document'
        );
        if (conflict) return [];
      }
      const row = {
        object_key: objectKeyVal,
        uploader_user_id: uploaderId,
        complex_id: complexIdVal,
        state: stateVal,
        kind: kindVal,
        upload_idempotency_key: idemKey ?? null,
        upload_request_fingerprint: fingerprint ?? null
      };
      rows[objectKeyVal] = row;
      return [row];
    }

    if (text.startsWith('update business_image_objects set state = \'active\'')) {
      const [objectKeyVal, uploaderId, complexIdVal] = values;
      const row = rows[objectKeyVal];
      if (!row || row.uploader_user_id !== uploaderId || row.complex_id !== complexIdVal || row.kind !== 'application-document' || row.state !== 'upload_pending') return [];
      row.state = 'active';
      row.reconcile_lease_token = null;
      row.reconcile_lease_expires_at = null;
      row.reconcile_next_attempt_at = null;
      row.reconcile_last_error_code = null;
      return [row];
    }

    throw new Error(`Unexpected SQL in application-document idempotency test: ${text}`);
  };

  return {
    sql,
    rowByKey: (objectKeyVal) => rows[objectKeyVal],
    setState: (objectKeyVal, state) => { if (rows[objectKeyVal]) rows[objectKeyVal].state = state; }
  };
}

function validMetadata(exactId) {
  return {
    id: exactId,
    name: 'contract.pdf',
    mimeType: 'application/pdf',
    size: '24',
    trashed: false,
    parents: [folderId],
    appProperties: {
      danjionKind: 'application-document',
      danjionVisibility: 'private',
      danjionUploaderUserId: uploader,
      danjionComplexSlug: complexSlug
    }
  };
}

function mismatchedMetadata(exactId) {
  const metadata = validMetadata(exactId);
  metadata.appProperties.danjionComplexSlug = 'wrong-complex';
  return metadata;
}

function installFetch({ generatedIds = [fileId], metadataSequence = [], uploadStatus = 200, uploadThrows = false, expectedUploadId = null } = {}) {
  let generated = 0;
  let uploaded = 0;
  let metadataReads = 0;
  const queue = [...metadataSequence];
  globalThis.fetch = async (input, init = {}) => {
    const href = String(input);
    if (href === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'token-for-test', expires_in: 3600 });
    }
    if (href.startsWith('https://www.googleapis.com/drive/v3/files/generateIds')) {
      const id = generatedIds[generated] ?? `generated_${generated}_1234567890`;
      generated += 1;
      return Response.json({ ids: [id] });
    }
    if (href.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      uploaded += 1;
      if (uploadThrows) throw new Error('synthetic network drop after Drive success');
      const exactId = expectedUploadId ?? generatedIds[0] ?? fileId;
      return Response.json(validMetadata(exactId), { status: uploadStatus });
    }
    if (href.startsWith('https://www.googleapis.com/drive/v3/files/')) {
      metadataReads += 1;
      const next = queue.shift();
      if (next instanceof Error) throw next;
      if (next !== undefined) {
        return next === null ? new Response(null, { status: 404 }) : Response.json(next);
      }
      return Response.json(validMetadata(fileId));
    }
    throw new Error(`Unexpected fetch in application-document idempotency test: ${href}`);
  };
  return { generated: () => generated, uploaded: () => uploaded, metadataReads: () => metadataReads };
}
function pendingWinnerRow() {
  return {
    object_key: objectKey,
    uploader_user_id: uploader,
    complex_id: complexId,
    state: 'upload_pending',
    kind: 'application-document',
    upload_idempotency_key: key,
    upload_request_fingerprint: fp1
  };
}

const originalFetch = globalThis.fetch;
try {
  // 1. First keyed request wins the durable binding and uploads exactly one binary.
  let fixture = makeSql();
  let counters = installFetch();
  let result = await runTrackedApplicationDocumentUpload(env, fixture.sql, file, resident, 'req-first', key);
  if (result instanceof Response) { console.error('UNEXPECTED RESPONSE', result.status, await result.clone().text()); }
  assert.equal(result instanceof Response, false);
  assert.equal(result.objectKey, objectKey);
  assert.equal(result.idempotencyReplayed, undefined);
  assert.equal(fixture.rowByKey(objectKey).state, 'active');
  assert.equal(fixture.rowByKey(objectKey).upload_idempotency_key, key);
  assert.equal(fixture.rowByKey(objectKey).upload_request_fingerprint, fp1);
  assert.equal(counters.generated(), 1);
  assert.equal(counters.uploaded(), 1);

  // 2. Lost HTTP success -> same logical retry replays the exact active object.
  const beforeGenerate = counters.generated();
  const beforeUpload = counters.uploaded();
  result = await runTrackedApplicationDocumentUpload(env, fixture.sql, file, resident, 'req-retry', key);
  if (result instanceof Response) { console.error('UNEXPECTED RESPONSE', result.status, await result.clone().text()); }
  assert.equal(result instanceof Response, false);
  assert.equal(result.objectKey, objectKey);
  assert.equal(result.idempotencyReplayed, true);
  assert.equal(counters.generated(), beforeGenerate, 'active replay must not generate another Drive id');
  assert.equal(counters.uploaded(), beforeUpload, 'active replay must not upload another binary');
  assert.equal(counters.metadataReads() >= 2, true, 'active replay must confirm exact Drive metadata');

  // 3. Same key with different bytes is a deterministic 409 before any Drive operation.
  const differentFile = new File(['different-application-document'], 'contract.pdf', { type: 'application/pdf' });
  const generateBeforeConflict = counters.generated();
  const uploadBeforeConflict = counters.uploaded();
  result = await runTrackedApplicationDocumentUpload(env, fixture.sql, differentFile, resident, 'req-conflict', key);
  assert.ok(result instanceof Response);
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(counters.generated(), generateBeforeConflict);
  assert.equal(counters.uploaded(), uploadBeforeConflict);

  // 4. Same key with different scope is a deterministic 409.
  const otherResident = { ...resident, complexId: otherComplexId, complexSlug: otherComplexSlug }; const fpOther = await applicationDocumentUploadRequestFingerprint(file, otherComplexSlug);
  result = await runTrackedApplicationDocumentUpload(env, fixture.sql, file, otherResident, 'req-scope-conflict', key);
  assert.ok(result instanceof Response);
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error.code, 'APPLICATION_DOCUMENT_UPLOAD_IDEMPOTENCY_SCOPE_CONFLICT');
  assert.equal(counters.generated(), generateBeforeConflict, 'scope conflict must not generate a Drive id');
  assert.equal(counters.uploaded(), uploadBeforeConflict, 'scope conflict must not upload');

  // 5. Lifecycle retirement is authoritative: a keyed retry may never resurrect it.
  fixture.setState(objectKey, 'delete_pending');
  result = await runTrackedApplicationDocumentUpload(env, fixture.sql, file, resident, 'req-retired-state', key);
  assert.ok(result instanceof Response);
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error.code, 'APPLICATION_DOCUMENT_UPLOAD_IDEMPOTENCY_STATE_CONFLICT');

  // 6. Direct reservation race: one key may bind only one candidate object.
  fixture = makeSql();
  const candidateA = 'gdrive/private/application-document/idem_candidate_A_1234567890';
  const candidateB = 'gdrive/private/application-document/idem_candidate_B_1234567890';
  let reservation = await reserveIdempotentApplicationDocumentUpload(
    fixture.sql, candidateA, uploader, complexId, key, fp1, 'req-reserve-a'
  );
  assert.equal(reservation instanceof Response, false);
  assert.equal(reservation.reserved, true);
  reservation = await reserveIdempotentApplicationDocumentUpload(
    fixture.sql, candidateB, uploader, complexId, key, fp1, 'req-reserve-b'
  );
  assert.equal(reservation instanceof Response, false);
  assert.equal(reservation.reserved, false);
  assert.equal(reservation.row.object_key, candidateA);

  // 7. Simulated concurrency loser: first lookup misses, unique reservation loses,
  //    candidate id is unused, and only the winner's exact object is reconciled.
  fixture = makeSql({ initialRow: pendingWinnerRow(), hideIdempotencyReads: 1 });
  counters = installFetch({ generatedIds: ['loser_candidate_1234567890'] });
  result = await runTrackedApplicationDocumentUpload(env, fixture.sql, file, resident, 'req-race-loser', key);
  if (result instanceof Response) { console.error('UNEXPECTED RESPONSE', result.status, await result.clone().text()); }
  assert.equal(result instanceof Response, false);
  assert.equal(result.objectKey, objectKey);
  assert.equal(result.idempotencyReplayed, true);
  assert.equal(counters.generated(), 1, 'racing loser may reserve one unused candidate id');
  assert.equal(counters.uploaded(), 0, 'racing loser must never upload its candidate binary when the winner object exists');
  assert.equal(counters.metadataReads(), 1, 'racing loser reconciles only the winner exact id');
  assert.equal(fixture.rowByKey(objectKey).state, 'active');

  // 8. Crash after durable reservation but before binary persistence: exact 404
  //    allows same-file retry to upload to the already reserved ID, never a new ID.
  fixture = makeSql({ initialRow: pendingWinnerRow() });
  counters = installFetch({ metadataSequence: [null, validMetadata(fileId)], expectedUploadId: fileId });
  result = await runTrackedApplicationDocumentUpload(env, fixture.sql, file, resident, 'req-resume-404', key);
  if (result instanceof Response) { console.error('UNEXPECTED RESPONSE', result.status, await result.clone().text()); }
  assert.equal(result instanceof Response, false);
  assert.equal(result.objectKey, objectKey);
  assert.equal(result.idempotencyReplayed, true);
  assert.equal(counters.generated(), 0, 'same-ID resume must never generate a replacement Drive id');
  assert.equal(counters.uploaded(), 1, 'exact 404 should resume one binary upload against the reserved id');
  assert.equal(counters.metadataReads(), 2, 'resume must prove absence then confirm persisted exact metadata');
  assert.equal(fixture.rowByKey(objectKey).state, 'active');

  // 9. Existing but mismatched exact object is an integrity anomaly, not an empty reservation.
  fixture = makeSql({ initialRow: pendingWinnerRow() });
  counters = installFetch({ metadataSequence: [mismatchedMetadata(fileId)] });
  result = await runTrackedApplicationDocumentUpload(env, fixture.sql, file, resident, 'req-resume-mismatch', key);
  assert.ok(result instanceof Response);
  assert.equal(result.status, 503);
  assert.equal(counters.generated(), 0);
  assert.equal(counters.uploaded(), 0, 'metadata mismatch must never trigger resume upload');
  assert.equal(fixture.rowByKey(objectKey).state, 'upload_pending');

  // 10. Metadata outage cannot prove absence, therefore no resume upload is allowed.
  fixture = makeSql({ initialRow: pendingWinnerRow() });
  counters = installFetch({ metadataSequence: [new Error('synthetic metadata outage')] });
  result = await runTrackedApplicationDocumentUpload(env, fixture.sql, file, resident, 'req-resume-read-outage', key);
  assert.ok(result instanceof Response);
  assert.equal(result.status, 503);
  assert.equal(counters.generated(), 0);
  assert.equal(counters.uploaded(), 0, 'metadata read outage must never trigger resume upload');
  assert.equal(fixture.rowByKey(objectKey).state, 'upload_pending');

  // 11. Concurrent original/resume overlap may return Drive 409. Reconcile the same
  //     exact ID and activate it; never generate a second ID.
  fixture = makeSql({ initialRow: pendingWinnerRow() });
  counters = installFetch({
    metadataSequence: [null, validMetadata(fileId)],
    uploadStatus: 409,
    expectedUploadId: fileId
  });
  result = await runTrackedApplicationDocumentUpload(env, fixture.sql, file, resident, 'req-resume-409', key);
  if (result instanceof Response) { console.error('UNEXPECTED RESPONSE', result.status, await result.clone().text()); }
  assert.equal(result instanceof Response, false);
  assert.equal(result.objectKey, objectKey);
  assert.equal(result.idempotencyReplayed, true);
  assert.equal(counters.generated(), 0);
  assert.equal(counters.uploaded(), 1);
  assert.equal(counters.metadataReads(), 2);
  assert.equal(fixture.rowByKey(objectKey).state, 'active');

  // 12. Ambiguous transport failure after same-ID resume also reconciles the exact ID.
  fixture = makeSql({ initialRow: pendingWinnerRow() });
  counters = installFetch({
    metadataSequence: [null, validMetadata(fileId)],
    uploadThrows: true,
    expectedUploadId: fileId
  });
  result = await runTrackedApplicationDocumentUpload(env, fixture.sql, file, resident, 'req-resume-ambiguous', key);
  if (result instanceof Response) { console.error('UNEXPECTED RESPONSE', result.status, await result.clone().text()); }
  assert.equal(result instanceof Response, false);
  assert.equal(result.objectKey, objectKey);
  assert.equal(result.idempotencyReplayed, true);
  assert.equal(counters.generated(), 0);
  assert.equal(counters.uploaded(), 1);
  assert.equal(counters.metadataReads(), 2);
  assert.equal(fixture.rowByKey(objectKey).state, 'active');

  // 13. Registry reservation failure must not leak an active row.
  fixture = makeSql();
  counters = installFetch();
  const brokenSql = async () => { throw new Error('synthetic registry outage'); };
  result = await runTrackedApplicationDocumentUpload(env, brokenSql, file, resident, 'req-registry-fail', key);
  assert.ok(result instanceof Response);
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error.code, 'APPLICATION_DOCUMENT_REGISTRY_UNAVAILABLE');
  assert.equal(counters.generated(), 0, 'registry failure must not generate a Drive id');
  assert.equal(counters.uploaded(), 0, 'registry failure must not upload');

  // 14. Activation failure after Drive success leaves the row pending, not active.
  fixture = makeSql({ initialRow: pendingWinnerRow() });
  counters = installFetch({
    metadataSequence: [null, validMetadata(fileId)],
    uploadStatus: 409,
    expectedUploadId: fileId
  });
  const originalUpdate = fixture.sql;
  fixture.sql = async (strings, ...values) => {
    const text = strings.join(' ').replace(/\s+/g, ' ').trim();
    if (text.startsWith("update business_image_objects set state = 'active'")) {
      throw new Error('synthetic activation failure');
    }
    return originalUpdate(strings, ...values);
  };
  result = await runTrackedApplicationDocumentUpload(env, fixture.sql, file, resident, 'req-activation-fail', key);
  assert.ok(result instanceof Response);
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error.code, 'APPLICATION_DOCUMENT_UPLOAD_ACTIVATION_UNAVAILABLE');
  assert.equal(fixture.rowByKey(objectKey).state, 'upload_pending', 'activation failure must not produce an active row');
  assert.equal(counters.uploaded(), 1, 'Drive upload may have succeeded but activation failed');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('PASS application-document upload idempotency: replay, conflict, scope, race, 404 same-ID resume, mismatch/outage no upload, ambiguous exact-ID reconciliation, registry failure, activation failure');












