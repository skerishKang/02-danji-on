import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  activateBusinessImageUpload,
  reconcileBusinessImageUploadPending,
  reserveBusinessImageUpload,
  runTrackedBusinessImageUpload
} from '../src/storage-upload-v2.ts';

const root = new URL('../', import.meta.url);
const app = await readFile(new URL('src/app.ts', root), 'utf8');
const uploadV2 = await readFile(new URL('src/storage-upload-v2.ts', root), 'utf8');
const economy = await readFile(new URL('src/resident-economy-v2.ts', root), 'utf8');
const migration020 = await readFile(new URL('migrations/020_business_image_upload_pending.sql', root), 'utf8');
const architecture = await readFile(
  new URL('../docs/BUSINESS_IMAGE_UPLOAD_ORPHAN_ELIMINATION_ARCHITECTURE_20260827.md', root),
  'utf8'
);

const uploader = '11111111-1111-4111-8111-111111111111';
const complexId = '22222222-2222-4222-8222-222222222222';
const complexSlug = 'tracked-upload-complex';
const fileId = 'pregenerated_file_1234567890';
const objectKey = `gdrive/public/business-image/${fileId}`;
const folderId = 'drive_business_folder_1234567890';
const resident = { id: uploader, complexId, complexSlug };
const env = {
  STORAGE_MODE: 'drive',
  GOOGLE_DRIVE_CLIENT_ID: 'client-for-test',
  GOOGLE_DRIVE_CLIENT_SECRET: 'secret-for-test',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh-for-test',
  GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID: folderId
};
const file = new File(['tracked-image'], 'resident-shop.png', { type: 'image/png' });

// Runtime routing contract: v2 POST interception is authoritative before storage-v1.
assert.ok(app.includes("import { handleTrackedStorageUploadRequest } from './storage-upload-v2';"));
const trackedRoute = app.indexOf('await handleTrackedStorageUploadRequest(request, env, id)');
const legacyStorageRoute = app.indexOf('await handleStorageRequest(request, env, id)');
assert.ok(trackedRoute >= 0 && legacyStorageRoute > trackedRoute,
  'tracked upload handler must intercept storage POST before legacy storage-v1');

// Migration 020 is forward-only and keeps old lifecycle states valid.
assert.ok(migration020.includes("state in ('upload_pending', 'active', 'delete_pending', 'retired')"));
assert.ok(migration020.includes("state = 'upload_pending' and delete_requested_at is null and retired_at is null"));
assert.ok(migration020.includes("state = 'active' and delete_requested_at is null and retired_at is null"));
assert.ok(migration020.includes("state = 'delete_pending' and delete_requested_at is not null and retired_at is null"));
assert.ok(migration020.includes("state = 'retired' and delete_requested_at is not null and retired_at is not null"));
assert.equal(migration020.includes('resident-evidence'), false);

// Source-order boundary: generated ID -> durable pending reservation -> Drive upload -> activation -> key return.
const runStart = uploadV2.indexOf('export async function runTrackedBusinessImageUpload(');
const runEnd = uploadV2.indexOf('export async function handleTrackedStorageUploadRequest(', runStart);
const runBlock = uploadV2.slice(runStart, runEnd);
const generateIndex = runBlock.indexOf('await generateDriveFileId(');
const reserveIndex = runBlock.indexOf('await reserveBusinessImageUpload(');
const driveIndex = runBlock.indexOf('await uploadDriveFileWithId(');
const activateIndex = runBlock.indexOf('await activateBusinessImageUpload(');
assert.ok(generateIndex >= 0 && reserveIndex > generateIndex && driveIndex > reserveIndex && activateIndex > driveIndex);
assert.ok(uploadV2.includes('id: fileId'), 'Drive multipart metadata must use the pre-generated file id');
assert.ok(uploadV2.includes("'upload_pending'"));
assert.ok(uploadV2.includes("if (kind === 'resident-evidence')"));
assert.ok(uploadV2.includes("'RESIDENT_VERIFICATION_POLICY_HOLD'"));
assert.ok(economy.includes("bio.state = 'active'"), 'upload_pending must remain non-referenceable by product mutations');
assert.ok(architecture.includes('NO_DURABLE_UPLOAD_PENDING -> NO_BINARY_PERSISTENCE'));
assert.ok(architecture.includes('DRIVE_SUCCESS + ACTIVE_FINALIZATION_FAILURE -> TRACKED_UPLOAD_PENDING'));

function makeStatefulSql(options = {}) {
  const events = options.events || [];
  let row = options.initialRow ? { ...options.initialRow } : null;
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    if (text.includes('insert into business_image_objects')) {
      events.push('db-reserve');
      if (options.reservationThrows) throw new Error('synthetic reservation outage');
      if (row) return [];
      row = {
        object_key: values[0],
        uploader_user_id: values[1],
        complex_id: values[2],
        state: 'upload_pending'
      };
      return [{ object_key: values[0] }];
    }
    if (text.includes("set state = 'active'")) {
      events.push('db-activate');
      if (options.activationThrows) throw new Error('synthetic activation outage');
      if (row && row.object_key === values[0] && row.uploader_user_id === values[1] &&
          row.complex_id === values[2] && row.state === 'upload_pending') {
        row.state = 'active';
        return [{ state: 'active' }];
      }
      return [];
    }
    if (text.includes('select object_key, uploader_user_id::text, complex_id::text, state')) {
      events.push('db-read');
      if (options.readThrows) throw new Error('synthetic read outage');
      return row ? [{ ...row }] : [];
    }
    if (text.includes('select uploader_user_id::text, complex_id::text, state')) {
      events.push('db-read');
      if (options.readThrows) throw new Error('synthetic read outage');
      return row ? [{ ...row }] : [];
    }
    throw new Error(`Unexpected SQL in test: ${text}`);
  };
  return { sql, events, getRow: () => row && ({ ...row }) };
}

function validMetadata(id = fileId) {
  return {
    id,
    name: 'stored.png',
    mimeType: 'image/png',
    size: '13',
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

function installFetchScenario({ events, uploadStatus = 200, metadata = validMetadata(), uploadThrows = false }) {
  let generated = 0;
  let uploads = 0;
  let metadataReads = 0;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('oauth2.googleapis.com/token')) {
      events.push('oauth');
      return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
    }
    if (href.includes('/files/generateIds')) {
      events.push('drive-generate-id');
      generated += 1;
      return Response.json({ ids: [fileId] });
    }
    if (href.includes('upload/drive/v3/files')) {
      events.push('drive-upload');
      uploads += 1;
      if (uploadThrows) throw new Error('synthetic ambiguous upload');
      assert.equal(init.method, 'POST');
      assert.ok(init.body instanceof Blob);
      const multipart = await init.body.text();
      assert.ok(multipart.includes(`\"id\":\"${fileId}\"`), 'multipart metadata must include reserved id');
      return new Response(uploadStatus === 200 ? JSON.stringify(validMetadata()) : '', {
        status: uploadStatus,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (href.includes(`/drive/v3/files/${fileId}?`)) {
      events.push('drive-read-exact-id');
      metadataReads += 1;
      if (metadata instanceof Error) throw metadata;
      if (metadata === null) return new Response('', { status: 404 });
      return Response.json(metadata);
    }
    throw new Error(`Unexpected fetch in test: ${href}`);
  };
  return {
    generated: () => generated,
    uploads: () => uploads,
    metadataReads: () => metadataReads
  };
}

const originalFetch = globalThis.fetch;
try {
  // Executable reservation/activation SQL helpers.
  let fixture = makeStatefulSql();
  assert.equal(await reserveBusinessImageUpload(fixture.sql, objectKey, uploader, complexId, 'req-reserve'), null);
  assert.equal(fixture.getRow().state, 'upload_pending');
  assert.equal(await activateBusinessImageUpload(fixture.sql, objectKey, uploader, complexId, 'req-activate'), null);
  assert.equal(fixture.getRow().state, 'active');

  // Happy path: DB durable reservation happens before Drive binary upload.
  let events = [];
  fixture = makeStatefulSql({ events });
  let counters = installFetchScenario({ events });
  let result = await runTrackedBusinessImageUpload(env, fixture.sql, file, resident, 'req-happy');
  assert.equal(result instanceof Response, false);
  assert.equal(result.objectKey, objectKey);
  assert.equal(fixture.getRow().state, 'active');
  assert.ok(events.indexOf('drive-generate-id') < events.indexOf('db-reserve'));
  assert.ok(events.indexOf('db-reserve') < events.indexOf('drive-upload'));
  assert.ok(events.indexOf('drive-upload') < events.indexOf('db-activate'));
  assert.equal(counters.generated(), 1);
  assert.equal(counters.uploads(), 1);

  // Reservation outage: ID may be generated, but no binary upload is allowed.
  events = [];
  fixture = makeStatefulSql({ events, reservationThrows: true });
  counters = installFetchScenario({ events });
  result = await runTrackedBusinessImageUpload(env, fixture.sql, file, resident, 'req-reserve-down');
  assert.ok(result instanceof Response);
  assert.equal(result.status, 503);
  assert.equal(counters.generated(), 1);
  assert.equal(counters.uploads(), 0);

  // 409 replay: exact-ID metadata reconciliation activates the existing matching object.
  events = [];
  fixture = makeStatefulSql({ events });
  counters = installFetchScenario({ events, uploadStatus: 409 });
  result = await runTrackedBusinessImageUpload(env, fixture.sql, file, resident, 'req-409');
  assert.equal(result instanceof Response, false);
  assert.equal(fixture.getRow().state, 'active');
  assert.equal(counters.generated(), 1, '409 replay must not generate a second id');
  assert.equal(counters.uploads(), 1);
  assert.equal(counters.metadataReads(), 1);

  // Ambiguous transport failure: exact-ID reconciliation, never a second generated object.
  events = [];
  fixture = makeStatefulSql({ events });
  counters = installFetchScenario({ events, uploadThrows: true });
  result = await runTrackedBusinessImageUpload(env, fixture.sql, file, resident, 'req-ambiguous');
  assert.equal(result instanceof Response, false);
  assert.equal(fixture.getRow().state, 'active');
  assert.equal(counters.generated(), 1);
  assert.equal(counters.uploads(), 1);
  assert.equal(counters.metadataReads(), 1);

  // Activation outage after Drive success: key is withheld and durable row stays pending.
  events = [];
  fixture = makeStatefulSql({ events, activationThrows: true });
  counters = installFetchScenario({ events });
  result = await runTrackedBusinessImageUpload(env, fixture.sql, file, resident, 'req-activate-down');
  assert.ok(result instanceof Response);
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error.code, 'BUSINESS_IMAGE_UPLOAD_ACTIVATION_UNAVAILABLE');
  assert.equal(fixture.getRow().state, 'upload_pending');
  assert.equal(counters.generated(), 1);
  assert.equal(counters.uploads(), 1);

  // Server-owned recovery: known exact ID can finalize a valid pending object.
  events = [];
  fixture = makeStatefulSql({
    events,
    initialRow: { object_key: objectKey, uploader_user_id: uploader, complex_id: complexId, state: 'upload_pending' }
  });
  counters = installFetchScenario({ events });
  result = await reconcileBusinessImageUploadPending(
    env, fixture.sql, objectKey, uploader, complexId, complexSlug, 'req-reconcile'
  );
  assert.equal(result instanceof Response, false);
  assert.equal(fixture.getRow().state, 'active');
  assert.equal(counters.generated(), 0, 'reconciliation must use the existing exact id');
  assert.equal(counters.uploads(), 0);
  assert.equal(counters.metadataReads(), 1);

  // Unavailable Drive state stays fail-closed as upload_pending.
  events = [];
  fixture = makeStatefulSql({
    events,
    initialRow: { object_key: objectKey, uploader_user_id: uploader, complex_id: complexId, state: 'upload_pending' }
  });
  counters = installFetchScenario({ events, metadata: new Error('synthetic Drive metadata outage') });
  result = await reconcileBusinessImageUploadPending(
    env, fixture.sql, objectKey, uploader, complexId, complexSlug, 'req-reconcile-down'
  );
  assert.ok(result instanceof Response);
  assert.equal(result.status, 503);
  assert.equal(fixture.getRow().state, 'upload_pending');
  assert.equal(counters.generated(), 0);
  assert.equal(counters.uploads(), 0);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('PASS tracked business-image upload_pending reservation/replay/reconciliation contract');
