import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor as requireCanonicalActor, type Actor } from './auth-v1';
import { requireOperationalAuthority } from './operational-authz-v2';
import { requireVerifiedResident } from './authorization-v2';
import type { CoreEnv } from './core-v1';
import { safeStorageFileName, validateStorageUpload } from './storage-policy.mjs';
import { r2Enabled, r2Put, type R2StorageEnv } from './storage-r2-v1';

type Sql = NeonQueryFunction<false, false>;
type DriveEnv = CoreEnv & {
  STORAGE_MODE?: string;
  DANJION_STORAGE?: R2Bucket;
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_REFRESH_TOKEN?: string;
  GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID?: string;
  GOOGLE_DRIVE_PRIVATE_RESIDENT_VERIFICATION_FOLDER_ID?: string;
};
type DriveMetadata = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  trashed?: boolean;
  parents?: string[];
  appProperties?: Record<string, string>;
};
type RegistryRow = {
  object_key?: string;
  uploader_user_id?: string;
  complex_id?: string;
  state?: string;
  upload_idempotency_key?: string | null;
  upload_request_fingerprint?: string | null;
};
type TrackedResident = Actor & {
  complexId: string;
  complexSlug: string;
};
type UploadSuccess = {
  objectKey: string;
  metadata: DriveMetadata;
  idempotencyReplayed?: boolean;
};
type IdempotentReservation = {
  reserved: boolean;
  row: RegistryRow;
};

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const MAX_UPLOAD_REQUEST_BYTES = 12 * 1024 * 1024;
const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const UPLOAD_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,80}$/;
type StorageKind = 'business-image' | 'application-document' | 'official-news-image';
let cachedAccessToken: { value: string; expiresAt: number } | null = null;

function json(data: unknown, status: number, requestId: string): Response {
  return Response.json(data, {
    status,
    headers: {
      'x-danjion-request-id': requestId,
      'cache-control': 'no-store'
    }
  });
}

function ok(data: unknown, requestId: string, status = 200): Response {
  return json({ data, requestId }, status, requestId);
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}

function randomObjectId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

async function runR2TrackedUpload(
  env: DriveEnv,
  sql: Sql,
  file: File,
  uploader: TrackedResident,
  kind: StorageKind,
  requestId: string,
  idempotencyKey: string | null
): Promise<UploadSuccess | Response> {
  const fingerprint = kind === 'business-image'
    ? await businessImageUploadRequestFingerprint(file, uploader.complexSlug)
    : kind === 'application-document'
      ? await applicationDocumentUploadRequestFingerprint(file, uploader.complexSlug)
      : await officialNewsImageUploadRequestFingerprint(file, uploader.complexSlug);
  let objectKeyValue: string | null = null;
  if (idempotencyKey) {
    const rows = await sql`
      select object_key, uploader_user_id::text, complex_id::text, state,
             upload_idempotency_key, upload_request_fingerprint
      from business_image_objects
      where uploader_user_id = ${uploader.id}::uuid
        and kind = ${kind}
        and upload_idempotency_key = ${idempotencyKey}
      limit 1
    `;
    const existing = rows[0] as RegistryRow | undefined;
    if (existing) {
      if (existing.upload_request_fingerprint !== fingerprint) {
        return fail('IDEMPOTENCY_KEY_REUSED', 'The Idempotency-Key was already used with different file content', 409, requestId);
      }
      objectKeyValue = String(existing.object_key || '');
      if (existing.state === 'active') {
        const fileId = objectKeyValue.split('/').pop() || '';
        const metadata = await import('./storage-r2-v1').then(({ r2Head }) => r2Head(env as R2StorageEnv, kind, fileId));
        if (!metadata) return fail('UPLOAD_RECONCILIATION_PENDING', 'The existing R2 object could not be confirmed', 503, requestId);
        return { objectKey: objectKeyValue, metadata, idempotencyReplayed: true };
      }
      if (existing.state !== 'upload_pending') return fail('IDEMPOTENCY_STATE_CONFLICT', 'The existing upload is no longer replayable', 409, requestId);
    }
  }
  if (!objectKeyValue) {
    const fileId = randomObjectId();
    objectKeyValue = `gdrive/${kind === 'application-document' ? 'private' : 'public'}/${kind}/${fileId}`;
    const rows = await sql`
      insert into business_image_objects (
        object_key, uploader_user_id, complex_id, state, kind,
        upload_idempotency_key, upload_request_fingerprint
      ) values (
        ${objectKeyValue}, ${uploader.id}::uuid, ${uploader.complexId}::uuid,
        'upload_pending', ${kind}, ${idempotencyKey}, ${fingerprint}
      ) on conflict (object_key) do nothing
      returning object_key
    `;
    if (!rows[0]) return fail('UPLOAD_RESERVATION_CONFLICT', 'Storage upload reservation conflicted', 409, requestId);
  }
  const fileId = objectKeyValue.split('/').pop() || '';
  let metadata;
  try {
    metadata = await r2Put(env as R2StorageEnv, kind, fileId, file, {
      danjionKind: kind,
      danjionVisibility: kind === 'application-document' ? 'private' : 'public',
      danjionUploaderUserId: uploader.id,
      danjionComplexSlug: uploader.complexSlug
    });
  } catch {
    return fail('UPLOAD_RECONCILIATION_PENDING', 'R2 object could not be persisted or confirmed', 503, requestId);
  }
  const activated = await sql`
    update business_image_objects
    set state = 'active', updated_at = now()
    where object_key = ${objectKeyValue}
      and uploader_user_id = ${uploader.id}::uuid
      and complex_id = ${uploader.complexId}::uuid
      and kind = ${kind}
      and state = 'upload_pending'
    returning object_key
  `;
  if (!activated[0]) return fail('UPLOAD_ACTIVATION_UNAVAILABLE', 'R2 upload could not be activated safely', 503, requestId);
  return { objectKey: objectKeyValue, metadata, idempotencyReplayed: Boolean(idempotencyKey) };
}

function requiredDriveCredentials(env: DriveEnv): { clientId: string; clientSecret: string; refreshToken: string } | null {
  const clientId = env.GOOGLE_DRIVE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET?.trim();
  const refreshToken = env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

async function accessToken(env: DriveEnv): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60_000) return cachedAccessToken.value;
  const credentials = requiredDriveCredentials(env);
  if (!credentials) throw new Error('Google Drive OAuth credentials are not configured');

  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token'
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const payload = await response.json().catch(() => ({})) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(`Google OAuth refresh failed${payload.error ? `: ${payload.error}` : ''}`);
  }
  cachedAccessToken = {
    value: payload.access_token,
    expiresAt: now + Math.max(300, Number(payload.expires_in || 3600)) * 1000
  };
  return cachedAccessToken.value;
}

async function googleFetch(env: DriveEnv, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken(env);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

function businessImageObjectKey(fileId: string): string {
  return `gdrive/public/business-image/${fileId}`;
}

function fileIdFromBusinessImageObjectKey(value: string): string | null {
  const prefix = 'gdrive/public/business-image/';
  if (!value.startsWith(prefix)) return null;
  const fileId = value.slice(prefix.length);
  return DRIVE_FILE_ID.test(fileId) ? fileId : null;
}

function applicationDocumentObjectKey(fileId: string): string {
  return `gdrive/private/application-document/${fileId}`;
}

function fileIdFromApplicationDocumentObjectKey(value: string): string | null {
  const prefix = 'gdrive/private/application-document/';
  if (!value.startsWith(prefix)) return null;
  const fileId = value.slice(prefix.length);
  return DRIVE_FILE_ID.test(fileId) ? fileId : null;
}


async function generateDriveFileId(env: DriveEnv): Promise<string> {
  const response = await googleFetch(env, `${DRIVE_API}/files/generateIds?count=1&space=drive&type=files`);
  const payload = await response.json().catch(() => ({})) as { ids?: string[] };
  const fileId = payload.ids?.[0]?.trim() || '';
  if (!response.ok || !DRIVE_FILE_ID.test(fileId)) {
    throw new Error(`Google Drive id generation failed (${response.status})`);
  }
  return fileId;
}

function businessImageMetadataMatches(
  env: DriveEnv,
  metadata: DriveMetadata,
  fileId: string,
  uploaderUserId: string,
  complexSlug: string
): boolean {
  const folderId = env.GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID?.trim();
  const props = metadata.appProperties || {};
  return Boolean(folderId) &&
    metadata.id === fileId &&
    metadata.trashed !== true &&
    metadata.parents?.includes(folderId!) === true &&
    props.danjionKind === 'business-image' &&
    props.danjionVisibility === 'public' &&
    props.danjionUploaderUserId === uploaderUserId &&
    props.danjionComplexSlug === complexSlug;
}

async function readDriveMetadata(env: DriveEnv, fileId: string): Promise<DriveMetadata | null> {
  const response = await googleFetch(
    env,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,trashed,parents,appProperties&supportsAllDrives=true`
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Google Drive metadata read failed (${response.status})`);
  return response.json() as Promise<DriveMetadata>;
}

async function uploadDriveFileWithId(
  env: DriveEnv,
  fileId: string,
  file: File,
  resident: TrackedResident
): Promise<Response> {
  const folderId = env.GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID?.trim();
  if (!folderId) throw new Error('Google Drive business-image folder is not configured');
  const boundary = `danjion-${crypto.randomUUID()}`;
  const metadata = {
    id: fileId,
    name: `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}-${safeStorageFileName(file.name)}`,
    parents: [folderId],
    appProperties: {
      danjionKind: 'business-image',
      danjionVisibility: 'public',
      danjionUploaderUserId: resident.id,
      danjionComplexSlug: resident.complexSlug
    }
  };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`,
    file,
    `\r\n--${boundary}--\r\n`
  ]);
  return googleFetch(
    env,
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,trashed,parents,appProperties&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body
    }
  );
}

function hexDigest(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validBusinessImageUploadIdempotencyKey(value: string): boolean {
  return UPLOAD_IDEMPOTENCY_KEY.test(value);
}

export async function businessImageUploadRequestFingerprint(file: File, complexSlug: string): Promise<string> {
  const fileHash = hexDigest(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  const canonical = JSON.stringify({
    kind: 'business-image',
    complexSlug,
    fileName: file.name,
    contentType: file.type,
    size: file.size,
    fileSha256: fileHash
  });
  return hexDigest(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
}

export async function reserveBusinessImageUpload(
  sql: Sql,
  objectKeyValue: string,
  uploaderUserId: string,
  complexId: string,
  requestId: string
): Promise<Response | null> {
  try {
    const rows = await sql`
      insert into business_image_objects (
        object_key, uploader_user_id, complex_id, state
      ) values (
        ${objectKeyValue}, ${uploaderUserId}::uuid, ${complexId}::uuid, 'upload_pending'
      )
      on conflict (object_key) do nothing
      returning object_key
    `;
    if (rows[0]) return null;
    return fail(
      'BUSINESS_IMAGE_UPLOAD_RESERVATION_CONFLICT',
      'Business image upload id is already reserved',
      409,
      requestId
    );
  } catch {
    return fail(
      'BUSINESS_IMAGE_REGISTRY_UNAVAILABLE',
      'Business image lifecycle registry is unavailable before upload',
      503,
      requestId
    );
  }
}

async function readIdempotentRegistryRow(
  sql: Sql,
  uploaderUserId: string,
  idempotencyKey: string,
  requestId: string
): Promise<RegistryRow | Response | null> {
  try {
    const rows = await sql`
      select object_key, uploader_user_id::text, complex_id::text, state,
             upload_idempotency_key, upload_request_fingerprint
      from business_image_objects
      where uploader_user_id = ${uploaderUserId}::uuid
        and upload_idempotency_key = ${idempotencyKey}
        and kind = 'business-image'
      limit 1
    `;
    return (rows[0] as RegistryRow | undefined) ?? null;
  } catch {
    return fail(
      'BUSINESS_IMAGE_REGISTRY_UNAVAILABLE',
      'Business image upload idempotency registry could not be read',
      503,
      requestId
    );
  }
}

export async function reserveIdempotentBusinessImageUpload(
  sql: Sql,
  objectKeyValue: string,
  uploaderUserId: string,
  complexId: string,
  idempotencyKey: string,
  requestFingerprint: string,
  requestId: string
): Promise<IdempotentReservation | Response> {
  try {
    const rows = await sql`
      insert into business_image_objects (
        object_key, uploader_user_id, complex_id, state, kind,
        upload_idempotency_key, upload_request_fingerprint
      ) values (
        ${objectKeyValue}, ${uploaderUserId}::uuid, ${complexId}::uuid, 'upload_pending', 'business-image',
        ${idempotencyKey}, ${requestFingerprint}
      )
      on conflict do nothing
      returning object_key, uploader_user_id::text, complex_id::text, state,
                upload_idempotency_key, upload_request_fingerprint
    `;
    if (rows[0]) {
      return { reserved: true, row: rows[0] as RegistryRow };
    }

    const existing = await sql`
      select object_key, uploader_user_id::text, complex_id::text, state,
             upload_idempotency_key, upload_request_fingerprint
      from business_image_objects
      where uploader_user_id = ${uploaderUserId}::uuid
        and upload_idempotency_key = ${idempotencyKey}
        and kind = 'business-image'
      limit 1
    `;
    const row = existing[0] as RegistryRow | undefined;
    if (row) return { reserved: false, row };

    return fail(
      'BUSINESS_IMAGE_UPLOAD_RESERVATION_CONFLICT',
      'Business image upload id could not be reserved safely',
      409,
      requestId
    );
  } catch {
    return fail(
      'BUSINESS_IMAGE_REGISTRY_UNAVAILABLE',
      'Business image upload idempotency reservation is unavailable',
      503,
      requestId
    );
  }
}

export async function activateBusinessImageUpload(
  sql: Sql,
  objectKeyValue: string,
  uploaderUserId: string,
  complexId: string,
  requestId: string
): Promise<Response | null> {
  try {
    const rows = await sql`
      update business_image_objects
      set state = 'active',
          reconcile_lease_token = null,
          reconcile_lease_expires_at = null,
          reconcile_next_attempt_at = null,
          reconcile_last_error_code = null,
          updated_at = now()
      where object_key = ${objectKeyValue}
        and uploader_user_id = ${uploaderUserId}::uuid
        and complex_id = ${complexId}::uuid
        and state = 'upload_pending'
      returning state
    `;
    if (rows[0]) return null;

    const current = await sql`
      select uploader_user_id::text, complex_id::text, state
      from business_image_objects
      where object_key = ${objectKeyValue}
      limit 1
    `;
    const row = current[0] as RegistryRow | undefined;
    if (row && row.state === 'active' &&
        row.uploader_user_id === uploaderUserId && row.complex_id === complexId) {
      return null;
    }
    return fail(
      'BUSINESS_IMAGE_UPLOAD_STATE_CONFLICT',
      'Business image upload could not be activated from its reserved state',
      409,
      requestId
    );
  } catch {
    return fail(
      'BUSINESS_IMAGE_UPLOAD_ACTIVATION_UNAVAILABLE',
      'Business image is durably reserved but activation could not be confirmed',
      503,
      requestId
    );
  }
}

async function readRegistryRow(
  sql: Sql,
  objectKeyValue: string,
  requestId: string
): Promise<RegistryRow | Response | null> {
  try {
    const rows = await sql`
      select object_key, uploader_user_id::text, complex_id::text, state
      from business_image_objects
      where object_key = ${objectKeyValue}
      limit 1
    `;
    return (rows[0] as RegistryRow | undefined) ?? null;
  } catch {
    return fail(
      'BUSINESS_IMAGE_REGISTRY_UNAVAILABLE',
      'Business image lifecycle registry could not be read for upload reconciliation',
      503,
      requestId
    );
  }
}

export async function reconcileBusinessImageUploadPending(
  env: CoreEnv,
  sql: Sql,
  objectKeyValue: string,
  uploaderUserId: string,
  complexId: string,
  complexSlug: string,
  requestId: string
): Promise<UploadSuccess | Response> {
  const driveEnv = env as DriveEnv;
  const fileId = fileIdFromBusinessImageObjectKey(objectKeyValue);
  if (!fileId) {
    return fail('INVALID_BUSINESS_IMAGE_REFERENCE', 'Reserved business image object key is invalid', 400, requestId);
  }

  const registry = await readRegistryRow(sql, objectKeyValue, requestId);
  if (registry instanceof Response) return registry;
  if (!registry) {
    return fail('BUSINESS_IMAGE_NOT_REGISTERED', 'Reserved business image lifecycle row is missing', 503, requestId);
  }
  if (registry.uploader_user_id !== uploaderUserId || registry.complex_id !== complexId) {
    return fail('BUSINESS_IMAGE_UPLOAD_STATE_CONFLICT', 'Reserved business image owner or complex does not match', 409, requestId);
  }
  if (registry.state === 'active') {
    let activeMetadata: DriveMetadata | null;
    try {
      activeMetadata = await readDriveMetadata(driveEnv, fileId);
    } catch {
      return fail('BUSINESS_IMAGE_UPLOAD_RECONCILIATION_PENDING', 'Active upload metadata could not be confirmed', 503, requestId);
    }
    if (!activeMetadata || !businessImageMetadataMatches(driveEnv, activeMetadata, fileId, uploaderUserId, complexSlug)) {
      return fail('BUSINESS_IMAGE_UPLOAD_RECONCILIATION_PENDING', 'Active upload metadata could not be confirmed safely', 503, requestId);
    }
    return { objectKey: objectKeyValue, metadata: activeMetadata };
  }
  if (registry.state !== 'upload_pending') {
    return fail('BUSINESS_IMAGE_UPLOAD_STATE_CONFLICT', 'Business image is not in an upload-reconcilable state', 409, requestId);
  }

  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(driveEnv, fileId);
  } catch {
    return fail(
      'BUSINESS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
      'Reserved business image remains pending because Google Drive state is unavailable',
      503,
      requestId
    );
  }
  if (!metadata || !businessImageMetadataMatches(driveEnv, metadata, fileId, uploaderUserId, complexSlug)) {
    return fail(
      'BUSINESS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
      'Reserved business image remains pending until exact Google Drive state can be confirmed',
      503,
      requestId
    );
  }

  const activationError = await activateBusinessImageUpload(
    sql, objectKeyValue, uploaderUserId, complexId, requestId
  );
  if (activationError) return activationError;
  return { objectKey: objectKeyValue, metadata };
}

async function idempotentReplay(
  env: CoreEnv,
  sql: Sql,
  file: File,
  row: RegistryRow,
  resident: TrackedResident,
  requestFingerprint: string,
  requestId: string
): Promise<UploadSuccess | Response> {
  if (row.upload_request_fingerprint !== requestFingerprint) {
    return fail(
      'IDEMPOTENCY_KEY_REUSED',
      'The Idempotency-Key was already used with a different business image upload',
      409,
      requestId
    );
  }
  if (row.uploader_user_id !== resident.id || row.complex_id !== resident.complexId) {
    return fail(
      'BUSINESS_IMAGE_UPLOAD_IDEMPOTENCY_SCOPE_CONFLICT',
      'The Idempotency-Key is bound to a different business image scope',
      409,
      requestId
    );
  }
  const objectKeyValue = String(row.object_key || '');
  if (row.state !== 'upload_pending' && row.state !== 'active') {
    return fail(
      'BUSINESS_IMAGE_UPLOAD_IDEMPOTENCY_STATE_CONFLICT',
      'The original idempotent business image upload is no longer replayable',
      409,
      requestId
    );
  }

  const replay = row.state === 'upload_pending'
    ? await resumeIdempotentBusinessImageUploadPending(
        env, sql, file, resident, objectKeyValue, requestId
      )
    : await reconcileBusinessImageUploadPending(
        env, sql, objectKeyValue, resident.id, resident.complexId, resident.complexSlug, requestId
      );
  if (replay instanceof Response) return replay;
  return { ...replay, idempotencyReplayed: true };
}

async function persistIdempotentReservedBusinessImageUpload(
  env: CoreEnv,
  sql: Sql,
  file: File,
  resident: TrackedResident,
  objectKeyValue: string,
  requestId: string
): Promise<UploadSuccess | Response> {
  const driveEnv = env as DriveEnv;
  const fileId = fileIdFromBusinessImageObjectKey(objectKeyValue);
  if (!fileId) {
    return fail('INVALID_BUSINESS_IMAGE_REFERENCE', 'Reserved business image object key is invalid', 400, requestId);
  }

  let uploadResponse: Response;
  try {
    uploadResponse = await uploadDriveFileWithId(driveEnv, fileId, file, resident);
  } catch {
    return reconcileBusinessImageUploadPending(
      env, sql, objectKeyValue, resident.id, resident.complexId, resident.complexSlug, requestId
    );
  }

  if (!uploadResponse.ok) {
    if (uploadResponse.status === 409 || uploadResponse.status >= 500) {
      return reconcileBusinessImageUploadPending(
        env, sql, objectKeyValue, resident.id, resident.complexId, resident.complexSlug, requestId
      );
    }
    return fail(
      'BUSINESS_IMAGE_UPLOAD_FAILED',
      'Business image remains durably reserved but Google Drive rejected the upload',
      502,
      requestId
    );
  }

  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(driveEnv, fileId);
  } catch {
    return fail(
      'BUSINESS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
      'Business image remains reserved because persisted metadata could not be confirmed',
      503,
      requestId
    );
  }
  if (!metadata || !businessImageMetadataMatches(driveEnv, metadata, fileId, resident.id, resident.complexSlug)) {
    return fail(
      'BUSINESS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
      'Business image remains reserved because persisted metadata does not match the reservation',
      503,
      requestId
    );
  }

  const activationError = await activateBusinessImageUpload(
    sql, objectKeyValue, resident.id, resident.complexId, requestId
  );
  if (activationError) return activationError;
  return { objectKey: objectKeyValue, metadata };
}

async function resumeIdempotentBusinessImageUploadPending(
  env: CoreEnv,
  sql: Sql,
  file: File,
  resident: TrackedResident,
  objectKeyValue: string,
  requestId: string
): Promise<UploadSuccess | Response> {
  const driveEnv = env as DriveEnv;
  const fileId = fileIdFromBusinessImageObjectKey(objectKeyValue);
  if (!fileId) {
    return fail('INVALID_BUSINESS_IMAGE_REFERENCE', 'Reserved business image object key is invalid', 400, requestId);
  }

  const registry = await readRegistryRow(sql, objectKeyValue, requestId);
  if (registry instanceof Response) return registry;
  if (!registry) {
    return fail('BUSINESS_IMAGE_NOT_REGISTERED', 'Reserved business image lifecycle row is missing', 503, requestId);
  }
  if (registry.uploader_user_id !== resident.id || registry.complex_id !== resident.complexId) {
    return fail(
      'BUSINESS_IMAGE_UPLOAD_IDEMPOTENCY_SCOPE_CONFLICT',
      'The idempotent business image reservation no longer matches the verified resident scope',
      409,
      requestId
    );
  }
  if (registry.state === 'active') {
    return reconcileBusinessImageUploadPending(
      env, sql, objectKeyValue, resident.id, resident.complexId, resident.complexSlug, requestId
    );
  }
  if (registry.state !== 'upload_pending') {
    return fail(
      'BUSINESS_IMAGE_UPLOAD_IDEMPOTENCY_STATE_CONFLICT',
      'The original idempotent business image upload is no longer resumable',
      409,
      requestId
    );
  }

  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(driveEnv, fileId);
  } catch {
    return fail(
      'BUSINESS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
      'Reserved business image could not prove exact Google Drive absence for safe resume',
      503,
      requestId
    );
  }

  if (metadata) {
    if (!businessImageMetadataMatches(driveEnv, metadata, fileId, resident.id, resident.complexSlug)) {
      return fail(
        'BUSINESS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
        'An object exists at the reserved Drive id but does not match the DanjiOn reservation',
        503,
        requestId
      );
    }
    const activationError = await activateBusinessImageUpload(
      sql, objectKeyValue, resident.id, resident.complexId, requestId
    );
    if (activationError) return activationError;
    return { objectKey: objectKeyValue, metadata };
  }

  // The exact reserved ID returned 404. Re-read lifecycle state before I/O;
  // no database lock is held across the subsequent Google Drive request.
  const freshRegistry = await readRegistryRow(sql, objectKeyValue, requestId);
  if (freshRegistry instanceof Response) return freshRegistry;
  if (!freshRegistry) {
    return fail('BUSINESS_IMAGE_NOT_REGISTERED', 'Reserved business image lifecycle row is missing', 503, requestId);
  }
  if (freshRegistry.uploader_user_id !== resident.id || freshRegistry.complex_id !== resident.complexId) {
    return fail(
      'BUSINESS_IMAGE_UPLOAD_IDEMPOTENCY_SCOPE_CONFLICT',
      'The idempotent business image reservation changed scope before resume',
      409,
      requestId
    );
  }
  if (freshRegistry.state === 'active') {
    return reconcileBusinessImageUploadPending(
      env, sql, objectKeyValue, resident.id, resident.complexId, resident.complexSlug, requestId
    );
  }
  if (freshRegistry.state !== 'upload_pending') {
    return fail(
      'BUSINESS_IMAGE_UPLOAD_IDEMPOTENCY_STATE_CONFLICT',
      'The original idempotent business image upload changed lifecycle before resume',
      409,
      requestId
    );
  }

  return persistIdempotentReservedBusinessImageUpload(
    env, sql, file, resident, objectKeyValue, requestId
  );
}

async function runIdempotentTrackedBusinessImageUpload(
  env: CoreEnv,
  sql: Sql,
  file: File,
  resident: TrackedResident,
  requestId: string,
  idempotencyKey: string
): Promise<UploadSuccess | Response> {
  let requestFingerprint: string;
  try {
    requestFingerprint = await businessImageUploadRequestFingerprint(file, resident.complexSlug);
  } catch {
    return fail(
      'BUSINESS_IMAGE_UPLOAD_FINGERPRINT_UNAVAILABLE',
      'Business image upload fingerprint could not be calculated',
      503,
      requestId
    );
  }

  const existing = await readIdempotentRegistryRow(sql, resident.id, idempotencyKey, requestId);
  if (existing instanceof Response) return existing;
  if (existing) {
    return idempotentReplay(env, sql, file, existing, resident, requestFingerprint, requestId);
  }

  let fileId: string;
  try {
    fileId = await generateDriveFileId(env as DriveEnv);
  } catch {
    return fail('BUSINESS_IMAGE_ID_RESERVATION_UNAVAILABLE', 'Google Drive could not reserve an upload id', 503, requestId);
  }
  const candidateObjectKey = businessImageObjectKey(fileId);
  const reservation = await reserveIdempotentBusinessImageUpload(
    sql,
    candidateObjectKey,
    resident.id,
    resident.complexId,
    idempotencyKey,
    requestFingerprint,
    requestId
  );
  if (reservation instanceof Response) return reservation;
  if (!reservation.reserved) {
    return idempotentReplay(env, sql, file, reservation.row, resident, requestFingerprint, requestId);
  }

  return persistIdempotentReservedBusinessImageUpload(
    env, sql, file, resident, candidateObjectKey, requestId
  );
}

export async function runTrackedBusinessImageUpload(
  env: CoreEnv,
  sql: Sql,
  file: File,
  resident: TrackedResident,
  requestId: string,
  idempotencyKey: string | null = null
): Promise<UploadSuccess | Response> {
  if (idempotencyKey) {
    if (!validBusinessImageUploadIdempotencyKey(idempotencyKey)) {
      return fail(
        'INVALID_IDEMPOTENCY_KEY',
        'Idempotency-Key must be 8-80 characters using letters, numbers, dot, underscore, colon or dash',
        400,
        requestId
      );
    }
    return runIdempotentTrackedBusinessImageUpload(
      env, sql, file, resident, requestId, idempotencyKey
    );
  }

  const driveEnv = env as DriveEnv;
  let fileId: string;
  try {
    fileId = await generateDriveFileId(driveEnv);
  } catch {
    return fail('BUSINESS_IMAGE_ID_RESERVATION_UNAVAILABLE', 'Google Drive could not reserve an upload id', 503, requestId);
  }

  const objectKeyValue = businessImageObjectKey(fileId);
  const reservationError = await reserveBusinessImageUpload(
    sql, objectKeyValue, resident.id, resident.complexId, requestId
  );
  if (reservationError) return reservationError;

  let uploadResponse: Response;
  try {
    uploadResponse = await uploadDriveFileWithId(driveEnv, fileId, file, resident);
  } catch {
    return reconcileBusinessImageUploadPending(
      env, sql, objectKeyValue, resident.id, resident.complexId, resident.complexSlug, requestId
    );
  }

  if (!uploadResponse.ok) {
    if (uploadResponse.status === 409 || uploadResponse.status >= 500) {
      return reconcileBusinessImageUploadPending(
        env, sql, objectKeyValue, resident.id, resident.complexId, resident.complexSlug, requestId
      );
    }
    return fail(
      'BUSINESS_IMAGE_UPLOAD_FAILED',
      'Business image remains durably reserved but Google Drive rejected the upload',
      502,
      requestId
    );
  }

  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(driveEnv, fileId);
  } catch {
    return fail(
      'BUSINESS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
      'Business image remains reserved because persisted metadata could not be confirmed',
      503,
      requestId
    );
  }
  if (!metadata || !businessImageMetadataMatches(driveEnv, metadata, fileId, resident.id, resident.complexSlug)) {
    return fail(
      'BUSINESS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
      'Business image remains reserved because persisted metadata does not match the reservation',
      503,
      requestId
    );
  }

   const activationError = await activateBusinessImageUpload(
     sql, objectKeyValue, resident.id, resident.complexId, requestId
   );
   if (activationError) return activationError;
   return { objectKey: objectKeyValue, metadata };
 }

export async function applicationDocumentUploadRequestFingerprint(
  file: File,
  complexSlug: string
): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const contentSha256 = hexDigest(digest);
  const canonical = [
    'application-document',
    complexSlug,
    file.name,
    file.type,
    String(file.size),
    contentSha256
  ].join('\n');
  const fingerprintDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return hexDigest(fingerprintDigest);
}

function applicationDocumentMetadataMatches(
  env: DriveEnv,
  metadata: DriveMetadata,
  fileId: string,
  uploaderUserId: string,
  complexSlug: string
): boolean {
  const folderId = env.GOOGLE_DRIVE_PRIVATE_RESIDENT_VERIFICATION_FOLDER_ID?.trim();
  const props = metadata.appProperties || {};
  return Boolean(folderId) &&
    metadata.id === fileId &&
    metadata.trashed !== true &&
    metadata.parents?.includes(folderId!) === true &&
    props.danjionKind === 'application-document' &&
    props.danjionVisibility === 'private' &&
    props.danjionUploaderUserId === uploaderUserId &&
    props.danjionComplexSlug === complexSlug;
}

async function uploadApplicationDocumentFile(
  env: DriveEnv,
  file: File,
  fileId: string,
  uploaderUserId: string,
  complexSlug: string
): Promise<Response> {
  const folderId = env.GOOGLE_DRIVE_PRIVATE_RESIDENT_VERIFICATION_FOLDER_ID?.trim();
  if (!folderId) throw new Error('Google Drive private folder is not configured for application documents');
  const boundary = `danjion-${crypto.randomUUID()}`;
  const metadata = {
    id: fileId,
    name: `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}-${safeStorageFileName(file.name)}`,
    parents: [folderId],
    appProperties: {
      danjionKind: 'application-document',
      danjionVisibility: 'private',
      danjionUploaderUserId: uploaderUserId,
      danjionComplexSlug: complexSlug
    }
  };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`,
    file,
    `\r\n--${boundary}--\r\n`
  ]);
  return googleFetch(
    env,
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,trashed,parents,appProperties&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body
    }
  );
}
async function readApplicationDocumentRegistryRow(
  sql: Sql,
  objectKeyValue: string,
  requestId: string
): Promise<RegistryRow | Response | null> {
  try {
    const rows = await sql`
      select object_key, uploader_user_id::text, complex_id::text, state
      from business_image_objects
      where object_key = ${objectKeyValue}
        and kind = 'application-document'
      limit 1
    `;
    return (rows[0] as RegistryRow | undefined) ?? null;
  } catch {
    return fail(
      'APPLICATION_DOCUMENT_REGISTRY_UNAVAILABLE',
      'Application document lifecycle registry could not be read',
      503,
      requestId
    );
  }
}

async function readIdempotentApplicationDocumentRegistryRow(
  sql: Sql,
  uploaderUserId: string,
  idempotencyKey: string,
  requestId: string
): Promise<RegistryRow | Response | null> {
  try {
    const rows = await sql`
      select object_key, uploader_user_id::text, complex_id::text, state,
             upload_idempotency_key, upload_request_fingerprint
      from business_image_objects
      where uploader_user_id = ${uploaderUserId}::uuid
        and upload_idempotency_key = ${idempotencyKey}
        and kind = 'application-document'
      limit 1
    `;
    return (rows[0] as RegistryRow | undefined) ?? null;
  } catch {
    return fail(
      'APPLICATION_DOCUMENT_REGISTRY_UNAVAILABLE',
      'Application document upload idempotency registry could not be read',
      503,
      requestId
    );
  }
}

export async function reserveApplicationDocumentUpload(
  sql: Sql,
  objectKeyValue: string,
  uploaderUserId: string,
  complexId: string,
  requestId: string
): Promise<Response | null> {
  try {
    const rows = await sql`
      insert into business_image_objects (
        object_key, uploader_user_id, complex_id, state, kind
      ) values (
        ${objectKeyValue}, ${uploaderUserId}::uuid, ${complexId}::uuid, 'upload_pending', 'application-document'
      )
      on conflict (object_key) do nothing
      returning object_key
    `;
    if (rows[0]) return null;
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_RESERVATION_CONFLICT',
      'Application document upload id is already reserved',
      409,
      requestId
    );
  } catch {
    return fail(
      'APPLICATION_DOCUMENT_REGISTRY_UNAVAILABLE',
      'Application document lifecycle registry is unavailable before upload',
      503,
      requestId
    );
  }
}

export async function reserveIdempotentApplicationDocumentUpload(
  sql: Sql,
  objectKeyValue: string,
  uploaderUserId: string,
  complexId: string,
  idempotencyKey: string,
  requestFingerprint: string,
  requestId: string
): Promise<IdempotentReservation | Response> {
  try {
    const rows = await sql`
      insert into business_image_objects (
        object_key, uploader_user_id, complex_id, state, kind,
        upload_idempotency_key, upload_request_fingerprint
      ) values (
        ${objectKeyValue}, ${uploaderUserId}::uuid, ${complexId}::uuid, 'upload_pending', 'application-document',
        ${idempotencyKey}, ${requestFingerprint}
      )
      on conflict do nothing
      returning object_key, uploader_user_id::text, complex_id::text, state,
                upload_idempotency_key, upload_request_fingerprint
    `;
    if (rows[0]) {
      return { reserved: true, row: rows[0] as RegistryRow };
    }

    const existing = await sql`
      select object_key, uploader_user_id::text, complex_id::text, state,
             upload_idempotency_key, upload_request_fingerprint
      from business_image_objects
      where uploader_user_id = ${uploaderUserId}::uuid
        and upload_idempotency_key = ${idempotencyKey}
        and kind = 'application-document'
      limit 1
    `;
    const row = existing[0] as RegistryRow | undefined;
    if (row) return { reserved: false, row };

    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_RESERVATION_CONFLICT',
      'Application document upload id could not be reserved safely',
      409,
      requestId
    );
  } catch {
    return fail(
      'APPLICATION_DOCUMENT_REGISTRY_UNAVAILABLE',
      'Application document upload idempotency reservation is unavailable',
      503,
      requestId
    );
  }
}

export async function activateApplicationDocumentUpload(
  sql: Sql,
  objectKeyValue: string,
  uploaderUserId: string,
  complexId: string,
  requestId: string
): Promise<Response | null> {
  try {
    const rows = await sql`
      update business_image_objects
      set state = 'active',
          reconcile_lease_token = null,
          reconcile_lease_expires_at = null,
          reconcile_next_attempt_at = null,
          reconcile_last_error_code = null,
          updated_at = now()
      where object_key = ${objectKeyValue}
        and uploader_user_id = ${uploaderUserId}::uuid
        and complex_id = ${complexId}::uuid
        and kind = 'application-document'
        and state = 'upload_pending'
      returning state
    `;
    if (rows[0]) return null;

    const current = await sql`
      select uploader_user_id::text, complex_id::text, state
      from business_image_objects
      where object_key = ${objectKeyValue}
        and kind = 'application-document'
      limit 1
    `;
    const row = current[0] as RegistryRow | undefined;
    if (row && row.state === 'active' &&
        row.uploader_user_id === uploaderUserId && row.complex_id === complexId) {
      return null;
    }
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_STATE_CONFLICT',
      'Application document upload could not be activated from its reserved state',
      409,
      requestId
    );
  } catch {
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_ACTIVATION_UNAVAILABLE',
      'Application document is durably reserved but activation could not be confirmed',
      503,
      requestId
    );
  }
}


export async function reconcileApplicationDocumentUploadPending(
  env: CoreEnv,
  sql: Sql,
  objectKeyValue: string,
  uploaderUserId: string,
  complexId: string,
  complexSlug: string,
  requestId: string
): Promise<UploadSuccess | Response> {
  const driveEnv = env as DriveEnv;
  const fileId = fileIdFromApplicationDocumentObjectKey(objectKeyValue);
  if (!fileId) {
    return fail('INVALID_APPLICATION_DOCUMENT_REFERENCE', 'Reserved application document object key is invalid', 400, requestId);
  }

  const registry = await readApplicationDocumentRegistryRow(sql, objectKeyValue, requestId);
  if (registry instanceof Response) return registry;
  if (!registry) {
    return fail('APPLICATION_DOCUMENT_NOT_REGISTERED', 'Reserved application document lifecycle row is missing', 503, requestId);
  }
  if (registry.uploader_user_id !== uploaderUserId || registry.complex_id !== complexId) {
    return fail('APPLICATION_DOCUMENT_UPLOAD_STATE_CONFLICT', 'Reserved application document owner or complex does not match', 409, requestId);
  }
  if (registry.state === 'active') {
    let activeMetadata: DriveMetadata | null;
    try {
      activeMetadata = await readDriveMetadata(driveEnv, fileId);
    } catch {
      return fail('APPLICATION_DOCUMENT_UPLOAD_RECONCILIATION_PENDING', 'Active upload metadata could not be confirmed', 503, requestId);
    }
    if (!activeMetadata || !applicationDocumentMetadataMatches(driveEnv, activeMetadata, fileId, uploaderUserId, complexSlug)) {
      return fail('APPLICATION_DOCUMENT_UPLOAD_RECONCILIATION_PENDING', 'Active upload metadata could not be confirmed safely', 503, requestId);
    }
    return { objectKey: objectKeyValue, metadata: activeMetadata };
  }
  if (registry.state !== 'upload_pending') {
    return fail('APPLICATION_DOCUMENT_UPLOAD_STATE_CONFLICT', 'Application document is not in an upload-reconcilable state', 409, requestId);
  }

  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(driveEnv, fileId);
  } catch {
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_RECONCILIATION_PENDING',
      'Reserved application document remains pending because Google Drive state is unavailable',
      503,
      requestId
    );
  }
  if (!metadata || !applicationDocumentMetadataMatches(driveEnv, metadata, fileId, uploaderUserId, complexSlug)) {
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_RECONCILIATION_PENDING',
      'Reserved application document remains pending until exact Google Drive state can be confirmed',
      503,
      requestId
    );
  }

  const activationError = await activateApplicationDocumentUpload(
    sql, objectKeyValue, uploaderUserId, complexId, requestId
  );
  if (activationError) return activationError;
  return { objectKey: objectKeyValue, metadata };
}

async function persistIdempotentReservedApplicationDocumentUpload(
  env: CoreEnv,
  sql: Sql,
  file: File,
  resident: TrackedResident,
  objectKeyValue: string,
  requestId: string
): Promise<UploadSuccess | Response> {
  const driveEnv = env as DriveEnv;
  const fileId = fileIdFromApplicationDocumentObjectKey(objectKeyValue);
  if (!fileId) {
    return fail('INVALID_APPLICATION_DOCUMENT_REFERENCE', 'Reserved application document object key is invalid', 400, requestId);
  }

  let uploadResponse: Response;
  try {
    uploadResponse = await uploadApplicationDocumentFile(
      driveEnv, file, fileId, resident.id, resident.complexSlug
    );
  } catch {
    return reconcileApplicationDocumentUploadPending(
      env, sql, objectKeyValue, resident.id, resident.complexId, resident.complexSlug, requestId
    );
  }

  if (!uploadResponse.ok) {
    if (uploadResponse.status === 409 || uploadResponse.status >= 500) {
      return reconcileApplicationDocumentUploadPending(
        env, sql, objectKeyValue, resident.id, resident.complexId, resident.complexSlug, requestId
      );
    }
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_FAILED',
      'Application document remains durably reserved but Google Drive rejected the upload',
      502,
      requestId
    );
  }

  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(driveEnv, fileId);
  } catch {
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_RECONCILIATION_PENDING',
      'Application document remains reserved because persisted metadata could not be confirmed',
      503,
      requestId
    );
  }
  if (!metadata || !applicationDocumentMetadataMatches(driveEnv, metadata, fileId, resident.id, resident.complexSlug)) {
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_RECONCILIATION_PENDING',
      'Application document remains reserved because persisted metadata does not match the reservation',
      503,
      requestId
    );
  }

  const activationError = await activateApplicationDocumentUpload(
    sql, objectKeyValue, resident.id, resident.complexId, requestId
  );
  if (activationError) return activationError;
  return { objectKey: objectKeyValue, metadata };
}
async function resumeIdempotentApplicationDocumentUploadPending(
  env: CoreEnv,
  sql: Sql,
  file: File,
  resident: TrackedResident,
  objectKeyValue: string,
  requestId: string
): Promise<UploadSuccess | Response> {
  const driveEnv = env as DriveEnv;
  const fileId = fileIdFromApplicationDocumentObjectKey(objectKeyValue);
  if (!fileId) {
    return fail('INVALID_APPLICATION_DOCUMENT_REFERENCE', 'Reserved application document object key is invalid', 400, requestId);
  }

  const registry = await readApplicationDocumentRegistryRow(sql, objectKeyValue, requestId);
  if (registry instanceof Response) return registry;
  if (!registry) {
    return fail('APPLICATION_DOCUMENT_NOT_REGISTERED', 'Reserved application document lifecycle row is missing', 503, requestId);
  }
  if (registry.uploader_user_id !== resident.id || registry.complex_id !== resident.complexId) {
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_IDEMPOTENCY_SCOPE_CONFLICT',
      'The idempotent application document reservation no longer matches the verified resident scope',
      409,
      requestId
    );
  }
  if (registry.state === 'active') {
    return reconcileApplicationDocumentUploadPending(
      env, sql, objectKeyValue, resident.id, resident.complexId, resident.complexSlug, requestId
    );
  }
  if (registry.state !== 'upload_pending') {
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_IDEMPOTENCY_STATE_CONFLICT',
      'The original idempotent application document upload is no longer resumable',
      409,
      requestId
    );
  }

  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(driveEnv, fileId);
  } catch {
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_RECONCILIATION_PENDING',
      'Reserved application document could not prove exact Google Drive absence for safe resume',
      503,
      requestId
    );
  }

  if (metadata) {
    if (!applicationDocumentMetadataMatches(driveEnv, metadata, fileId, resident.id, resident.complexSlug)) {
      return fail(
        'APPLICATION_DOCUMENT_UPLOAD_RECONCILIATION_PENDING',
        'An object exists at the reserved Drive id but does not match the DanjiOn reservation',
        503,
        requestId
      );
    }
    const activationError = await activateApplicationDocumentUpload(
      sql, objectKeyValue, resident.id, resident.complexId, requestId
    );
    if (activationError) return activationError;
    return { objectKey: objectKeyValue, metadata };
  }

  // The exact reserved ID returned 404. Re-read lifecycle state before I/O;
  // no database lock is held across the subsequent Google Drive request.
  const freshRegistry = await readApplicationDocumentRegistryRow(sql, objectKeyValue, requestId);
  if (freshRegistry instanceof Response) return freshRegistry;
  if (!freshRegistry) {
    return fail('APPLICATION_DOCUMENT_NOT_REGISTERED', 'Reserved application document lifecycle row is missing', 503, requestId);
  }
  if (freshRegistry.uploader_user_id !== resident.id || freshRegistry.complex_id !== resident.complexId) {
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_IDEMPOTENCY_SCOPE_CONFLICT',
      'The idempotent application document reservation changed scope before resume',
      409,
      requestId
    );
  }
  if (freshRegistry.state === 'active') {
    return reconcileApplicationDocumentUploadPending(
      env, sql, objectKeyValue, resident.id, resident.complexId, resident.complexSlug, requestId
    );
  }
  if (freshRegistry.state !== 'upload_pending') {
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_IDEMPOTENCY_STATE_CONFLICT',
      'The original idempotent application document upload changed lifecycle before resume',
      409,
      requestId
    );
  }

  return persistIdempotentReservedApplicationDocumentUpload(
    env, sql, file, resident, objectKeyValue, requestId
  );
}
async function idempotentApplicationDocumentReplay(
  env: CoreEnv,
  sql: Sql,
  file: File,
  row: RegistryRow,
  resident: TrackedResident,
  requestFingerprint: string,
  requestId: string
): Promise<UploadSuccess | Response> {
  const objectKeyValue = String(row.object_key || '');
  if (!objectKeyValue) {
    return fail('APPLICATION_DOCUMENT_UPLOAD_STATE_CONFLICT', 'The idempotent application document reservation is malformed', 409, requestId);
  }
  if (row.uploader_user_id !== resident.id || row.complex_id !== resident.complexId) {
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_IDEMPOTENCY_SCOPE_CONFLICT',
      'The Idempotency-Key was already used for a different application document upload scope',
      409,
      requestId
    );
  }
  if (row.upload_request_fingerprint !== requestFingerprint) {
    return fail(
      'IDEMPOTENCY_KEY_REUSED',
      'The Idempotency-Key was already used with a different application document upload',
      409,
      requestId
    );
  }
  if (row.state !== 'upload_pending' && row.state !== 'active') {
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_IDEMPOTENCY_STATE_CONFLICT',
      'The original idempotent application document upload is no longer replayable',
      409,
      requestId
    );
  }

  const replay = row.state === 'upload_pending'
    ? await resumeIdempotentApplicationDocumentUploadPending(
        env, sql, file, resident, objectKeyValue, requestId
      )
    : await reconcileApplicationDocumentUploadPending(
        env, sql, objectKeyValue, resident.id, resident.complexId, resident.complexSlug, requestId
      );
  if (replay instanceof Response) return replay;
  return { ...replay, idempotencyReplayed: true };
}

async function runIdempotentTrackedApplicationDocumentUpload(
  env: CoreEnv,
  sql: Sql,
  file: File,
  resident: TrackedResident,
  requestId: string,
  idempotencyKey: string
): Promise<UploadSuccess | Response> {
  let requestFingerprint: string;
  try {
    requestFingerprint = await applicationDocumentUploadRequestFingerprint(file, resident.complexSlug);
  } catch {
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_FINGERPRINT_UNAVAILABLE',
      'Application document upload fingerprint could not be calculated',
      503,
      requestId
    );
  }

  const existing = await readIdempotentApplicationDocumentRegistryRow(
    sql, resident.id, idempotencyKey, requestId
  );
  if (existing instanceof Response) return existing;
  if (existing) {
    return idempotentApplicationDocumentReplay(
      env, sql, file, existing, resident, requestFingerprint, requestId
    );
  }

  let fileId: string;
  try {
    fileId = await generateDriveFileId(env as DriveEnv);
  } catch {
    return fail('APPLICATION_DOCUMENT_ID_RESERVATION_UNAVAILABLE', 'Google Drive could not reserve an upload id', 503, requestId);
  }
  const candidateObjectKey = applicationDocumentObjectKey(fileId);
  const reservation = await reserveIdempotentApplicationDocumentUpload(
    sql,
    candidateObjectKey,
    resident.id,
    resident.complexId,
    idempotencyKey,
    requestFingerprint,
    requestId
  );
  if (reservation instanceof Response) return reservation;
  if (!reservation.reserved) {
    return idempotentApplicationDocumentReplay(
      env, sql, file, reservation.row, resident, requestFingerprint, requestId
    );
  }

  return persistIdempotentReservedApplicationDocumentUpload(
    env, sql, file, resident, candidateObjectKey, requestId
  );
}
export async function runTrackedApplicationDocumentUpload(
  env: CoreEnv,
  sql: Sql,
  file: File,
  resident: TrackedResident,
  requestId: string,
  idempotencyKey: string | null = null
): Promise<UploadSuccess | Response> {
  if (idempotencyKey) {
    if (!validBusinessImageUploadIdempotencyKey(idempotencyKey)) {
      return fail(
        'INVALID_IDEMPOTENCY_KEY',
        'Idempotency-Key must be 8-80 characters using letters, numbers, dot, underscore, colon or dash',
        400,
        requestId
      );
    }
    return runIdempotentTrackedApplicationDocumentUpload(
      env, sql, file, resident, requestId, idempotencyKey
    );
  }

  const driveEnv = env as DriveEnv;
  let fileId: string;
  try {
    fileId = await generateDriveFileId(driveEnv);
  } catch {
    return fail('APPLICATION_DOCUMENT_ID_RESERVATION_UNAVAILABLE', 'Google Drive could not reserve an upload id', 503, requestId);
  }

  const objectKeyValue = applicationDocumentObjectKey(fileId);
  const reservationError = await reserveApplicationDocumentUpload(
    sql, objectKeyValue, resident.id, resident.complexId, requestId
  );
  if (reservationError) return reservationError;

  let uploadResponse: Response;
  try {
    uploadResponse = await uploadApplicationDocumentFile(
      driveEnv, file, fileId, resident.id, resident.complexSlug
    );
  } catch {
    return reconcileApplicationDocumentUploadPending(
      env, sql, objectKeyValue, resident.id, resident.complexId, resident.complexSlug, requestId
    );
  }

  if (!uploadResponse.ok) {
    if (uploadResponse.status === 409 || uploadResponse.status >= 500) {
      return reconcileApplicationDocumentUploadPending(
        env, sql, objectKeyValue, resident.id, resident.complexId, resident.complexSlug, requestId
      );
    }
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_FAILED',
      'Application document remains durably reserved but Google Drive rejected the upload',
      502,
      requestId
    );
  }

  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(driveEnv, fileId);
  } catch {
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_RECONCILIATION_PENDING',
      'Application document remains reserved because persisted metadata could not be confirmed',
      503,
      requestId
    );
  }
  if (!metadata || !applicationDocumentMetadataMatches(driveEnv, metadata, fileId, resident.id, resident.complexSlug)) {
    return fail(
      'APPLICATION_DOCUMENT_UPLOAD_RECONCILIATION_PENDING',
      'Application document remains reserved because persisted metadata does not match the reservation',
      503,
      requestId
    );
  }

  const activationError = await activateApplicationDocumentUpload(
    sql, objectKeyValue, resident.id, resident.complexId, requestId
  );
  if (activationError) return activationError;
  return { objectKey: objectKeyValue, metadata };
}
export async function officialNewsImageUploadRequestFingerprint(
  file: File,
  complexSlug: string
): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const contentSha256 = hexDigest(digest);
  const canonical = [
    'official-news-image',
    complexSlug,
    file.name,
    file.type,
    String(file.size),
    contentSha256
  ].join('\n');
  const fingerprintDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return hexDigest(fingerprintDigest);
}

// ---------------------------------------------------------------------------
// #844: official apartment-news public image lane.
//
// Mirrors the application-document lane (reserve -> Drive upload -> activate) on the shared
// business_image_objects registry, as a distinct PUBLIC kind. Amendment A: no dedicated Drive
// folder/binding is introduced; the existing public business folder is reused and separation is
// enforced by kind + objectKey namespace + Drive appProperties.
// ---------------------------------------------------------------------------

function officialNewsImageObjectKey(fileId: string): string {
  return `gdrive/public/official-news-image/${fileId}`;
}

function fileIdFromOfficialNewsImageObjectKey(value: string): string | null {
  const prefix = 'gdrive/public/official-news-image/';
  if (!value.startsWith(prefix)) return null;
  const fileId = value.slice(prefix.length);
  return DRIVE_FILE_ID.test(fileId) ? fileId : null;
}

function officialNewsImageMetadataMatches(
  env: DriveEnv,
  metadata: DriveMetadata,
  fileId: string,
  uploaderUserId: string,
  complexSlug: string
): boolean {
  const folderId = env.GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID?.trim();
  const props = metadata.appProperties || {};
  return Boolean(folderId) &&
    metadata.id === fileId &&
    metadata.trashed !== true &&
    metadata.parents?.includes(folderId!) === true &&
    props.danjionKind === 'official-news-image' &&
    props.danjionVisibility === 'public' &&
    props.danjionUploaderUserId === uploaderUserId &&
    props.danjionComplexSlug === complexSlug;
}

async function uploadOfficialNewsImageFile(
  env: DriveEnv,
  file: File,
  fileId: string,
  uploaderUserId: string,
  complexSlug: string
): Promise<Response> {
  const folderId = env.GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID?.trim();
  if (!folderId) throw new Error('Google Drive public folder is not configured for official news images');
  const boundary = `danjion-${crypto.randomUUID()}`;
  const metadata = {
    id: fileId,
    name: `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}-${safeStorageFileName(file.name)}`,
    parents: [folderId],
    appProperties: {
      danjionKind: 'official-news-image',
      danjionVisibility: 'public',
      danjionUploaderUserId: uploaderUserId,
      danjionComplexSlug: complexSlug
    }
  };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`,
    file,
    `\r\n--${boundary}--\r\n`
  ]);
  return googleFetch(
    env,
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,trashed,parents,appProperties&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body
    }
  );
}

export async function reserveOfficialNewsImageUpload(
  sql: Sql,
  objectKeyValue: string,
  uploaderUserId: string,
  complexId: string,
  requestId: string
): Promise<Response | null> {
  try {
    const rows = await sql`
      insert into business_image_objects (
        object_key, uploader_user_id, complex_id, state, kind
      ) values (
        ${objectKeyValue}, ${uploaderUserId}::uuid, ${complexId}::uuid, 'upload_pending', 'official-news-image'
      )
      on conflict (object_key) do nothing
      returning object_key
    `;
    if (rows[0]) return null;
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_RESERVATION_CONFLICT',
      'Official news image upload id is already reserved',
      409,
      requestId
    );
  } catch {
    return fail(
      'OFFICIAL_NEWS_IMAGE_REGISTRY_UNAVAILABLE',
      'Official news image lifecycle registry is unavailable before upload',
      503,
      requestId
    );
  }
}

async function readOfficialNewsImageRegistryRow(
  sql: Sql,
  objectKeyValue: string,
  requestId: string
): Promise<RegistryRow | Response | null> {
  try {
    const rows = await sql`
      select object_key, uploader_user_id::text, complex_id::text, state
      from business_image_objects
      where object_key = ${objectKeyValue}
        and kind = 'official-news-image'
      limit 1
    `;
    return (rows[0] as RegistryRow | undefined) ?? null;
  } catch {
    return fail(
      'OFFICIAL_NEWS_IMAGE_REGISTRY_UNAVAILABLE',
      'Official news image lifecycle registry could not be read',
      503,
      requestId
    );
  }
}

async function readIdempotentOfficialNewsImageRegistryRow(
  sql: Sql,
  uploaderUserId: string,
  idempotencyKey: string,
  requestId: string
): Promise<RegistryRow | Response | null> {
  try {
    const rows = await sql`
      select object_key, uploader_user_id::text, complex_id::text, state,
             upload_idempotency_key, upload_request_fingerprint
      from business_image_objects
      where uploader_user_id = ${uploaderUserId}::uuid
        and upload_idempotency_key = ${idempotencyKey}
        and kind = 'official-news-image'
      limit 1
    `;
    return (rows[0] as RegistryRow | undefined) ?? null;
  } catch {
    return fail(
      'OFFICIAL_NEWS_IMAGE_REGISTRY_UNAVAILABLE',
      'Official news image upload idempotency registry could not be read',
      503,
      requestId
    );
  }
}

export async function reserveIdempotentOfficialNewsImageUpload(
  sql: Sql,
  objectKeyValue: string,
  uploaderUserId: string,
  complexId: string,
  idempotencyKey: string,
  requestFingerprint: string,
  requestId: string
): Promise<IdempotentReservation | Response> {
  try {
    const rows = await sql`
      insert into business_image_objects (
        object_key, uploader_user_id, complex_id, state, kind,
        upload_idempotency_key, upload_request_fingerprint
      ) values (
        ${objectKeyValue}, ${uploaderUserId}::uuid, ${complexId}::uuid, 'upload_pending', 'official-news-image',
        ${idempotencyKey}, ${requestFingerprint}
      )
      on conflict do nothing
      returning object_key, uploader_user_id::text, complex_id::text, state,
                upload_idempotency_key, upload_request_fingerprint
    `;
    if (rows[0]) {
      return { reserved: true, row: rows[0] as RegistryRow };
    }

    const existing = await sql`
      select object_key, uploader_user_id::text, complex_id::text, state,
             upload_idempotency_key, upload_request_fingerprint
      from business_image_objects
      where uploader_user_id = ${uploaderUserId}::uuid
        and upload_idempotency_key = ${idempotencyKey}
        and kind = 'official-news-image'
      limit 1
    `;
    const row = existing[0] as RegistryRow | undefined;
    if (row) return { reserved: false, row };

    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_RESERVATION_CONFLICT',
      'Official news image upload id could not be reserved safely',
      409,
      requestId
    );
  } catch {
    return fail(
      'OFFICIAL_NEWS_IMAGE_REGISTRY_UNAVAILABLE',
      'Official news image upload idempotency reservation is unavailable',
      503,
      requestId
    );
  }
}

export async function activateOfficialNewsImageUpload(
  sql: Sql,
  objectKeyValue: string,
  uploaderUserId: string,
  complexId: string,
  requestId: string
): Promise<Response | null> {
  try {
    const rows = await sql`
      update business_image_objects
      set state = 'active',
          reconcile_lease_token = null,
          reconcile_lease_expires_at = null,
          reconcile_next_attempt_at = null,
          reconcile_last_error_code = null,
          updated_at = now()
      where object_key = ${objectKeyValue}
        and uploader_user_id = ${uploaderUserId}::uuid
        and complex_id = ${complexId}::uuid
        and kind = 'official-news-image'
        and state = 'upload_pending'
      returning state
    `;
    if (rows[0]) return null;

    const current = await sql`
      select uploader_user_id::text, complex_id::text, state
      from business_image_objects
      where object_key = ${objectKeyValue}
        and kind = 'official-news-image'
      limit 1
    `;
    const row = current[0] as RegistryRow | undefined;
    if (row && row.state === 'active' &&
        row.uploader_user_id === uploaderUserId && row.complex_id === complexId) {
      return null;
    }
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_STATE_CONFLICT',
      'Official news image upload could not be activated from its reserved state',
      409,
      requestId
    );
  } catch {
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_ACTIVATION_UNAVAILABLE',
      'Official news image is durably reserved but activation could not be confirmed',
      503,
      requestId
    );
  }
}

export async function reconcileOfficialNewsImageUploadPending(
  env: CoreEnv,
  sql: Sql,
  objectKeyValue: string,
  uploaderUserId: string,
  complexId: string,
  complexSlug: string,
  requestId: string
): Promise<UploadSuccess | Response> {
  const driveEnv = env as DriveEnv;
  const fileId = fileIdFromOfficialNewsImageObjectKey(objectKeyValue);
  if (!fileId) {
    return fail('INVALID_OFFICIAL_NEWS_IMAGE_REFERENCE', 'Reserved official news image object key is invalid', 400, requestId);
  }

  const registry = await readOfficialNewsImageRegistryRow(sql, objectKeyValue, requestId);
  if (registry instanceof Response) return registry;
  if (!registry) {
    return fail('OFFICIAL_NEWS_IMAGE_NOT_REGISTERED', 'Reserved official news image lifecycle row is missing', 503, requestId);
  }
  if (registry.uploader_user_id !== uploaderUserId || registry.complex_id !== complexId) {
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_STATE_CONFLICT',
      'Reserved official news image owner or complex does not match',
      409,
      requestId
    );
  }
  if (registry.state === 'active') {
    let activeMetadata: DriveMetadata | null;
    try {
      activeMetadata = await readDriveMetadata(driveEnv, fileId);
    } catch {
      return fail(
        'OFFICIAL_NEWS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
        'Official news image remains active but storage could not be confirmed',
        503,
        requestId
      );
    }
    if (!activeMetadata || !officialNewsImageMetadataMatches(driveEnv, activeMetadata, fileId, uploaderUserId, complexSlug)) {
      return fail(
        'OFFICIAL_NEWS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
        'Active official news image no longer matches the DanjiOn reservation',
        503,
        requestId
      );
    }
    return { objectKey: objectKeyValue, metadata: activeMetadata };
  }
  if (registry.state !== 'upload_pending') {
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_STATE_CONFLICT',
      'Reserved official news image is no longer reconcilable',
      409,
      requestId
    );
  }

  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(driveEnv, fileId);
  } catch {
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
      'Official news image remains reserved because persisted metadata could not be confirmed',
      503,
      requestId
    );
  }
  if (!metadata || !officialNewsImageMetadataMatches(driveEnv, metadata, fileId, uploaderUserId, complexSlug)) {
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
      'Official news image remains reserved because persisted metadata does not match the reservation',
      503,
      requestId
    );
  }

  const activationError = await activateOfficialNewsImageUpload(
    sql, objectKeyValue, uploaderUserId, complexId, requestId
  );
  if (activationError) return activationError;
  return { objectKey: objectKeyValue, metadata };
}

async function persistIdempotentReservedOfficialNewsImageUpload(
  env: CoreEnv,
  sql: Sql,
  file: File,
  uploader: TrackedResident,
  objectKeyValue: string,
  requestId: string
): Promise<UploadSuccess | Response> {
  const driveEnv = env as DriveEnv;
  const fileId = fileIdFromOfficialNewsImageObjectKey(objectKeyValue);
  if (!fileId) {
    return fail('INVALID_OFFICIAL_NEWS_IMAGE_REFERENCE', 'Reserved official news image object key is invalid', 400, requestId);
  }

  let uploadResponse: Response;
  try {
    uploadResponse = await uploadOfficialNewsImageFile(driveEnv, file, fileId, uploader.id, uploader.complexSlug);
  } catch {
    return reconcileOfficialNewsImageUploadPending(
      env, sql, objectKeyValue, uploader.id, uploader.complexId, uploader.complexSlug, requestId
    );
  }

  if (!uploadResponse.ok) {
    if (uploadResponse.status === 409 || uploadResponse.status >= 500) {
      return reconcileOfficialNewsImageUploadPending(
        env, sql, objectKeyValue, uploader.id, uploader.complexId, uploader.complexSlug, requestId
      );
    }
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_FAILED',
      'Official news image remains durably reserved but Google Drive rejected the upload',
      502,
      requestId
    );
  }

  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(driveEnv, fileId);
  } catch {
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
      'Official news image remains reserved because persisted metadata could not be confirmed',
      503,
      requestId
    );
  }
  if (!metadata || !officialNewsImageMetadataMatches(driveEnv, metadata, fileId, uploader.id, uploader.complexSlug)) {
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
      'Official news image remains reserved because persisted metadata does not match the reservation',
      503,
      requestId
    );
  }

  const activationError = await activateOfficialNewsImageUpload(
    sql, objectKeyValue, uploader.id, uploader.complexId, requestId
  );
  if (activationError) return activationError;
  return { objectKey: objectKeyValue, metadata };
}

async function resumeIdempotentOfficialNewsImageUploadPending(
  env: CoreEnv,
  sql: Sql,
  file: File,
  uploader: TrackedResident,
  objectKeyValue: string,
  requestId: string
): Promise<UploadSuccess | Response> {
  const driveEnv = env as DriveEnv;
  const fileId = fileIdFromOfficialNewsImageObjectKey(objectKeyValue);
  if (!fileId) {
    return fail('INVALID_OFFICIAL_NEWS_IMAGE_REFERENCE', 'Reserved official news image object key is invalid', 400, requestId);
  }

  const registry = await readOfficialNewsImageRegistryRow(sql, objectKeyValue, requestId);
  if (registry instanceof Response) return registry;
  if (!registry) {
    return fail('OFFICIAL_NEWS_IMAGE_NOT_REGISTERED', 'Reserved official news image lifecycle row is missing', 503, requestId);
  }
  if (registry.uploader_user_id !== uploader.id || registry.complex_id !== uploader.complexId) {
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_IDEMPOTENCY_SCOPE_CONFLICT',
      'The idempotent official news image reservation no longer matches the caller scope',
      409,
      requestId
    );
  }
  if (registry.state === 'active') {
    return reconcileOfficialNewsImageUploadPending(
      env, sql, objectKeyValue, uploader.id, uploader.complexId, uploader.complexSlug, requestId
    );
  }
  if (registry.state !== 'upload_pending') {
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_IDEMPOTENCY_STATE_CONFLICT',
      'The original idempotent official news image upload is no longer resumable',
      409,
      requestId
    );
  }

  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(driveEnv, fileId);
  } catch {
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
      'Reserved official news image could not prove exact Google Drive absence for safe resume',
      503,
      requestId
    );
  }

  if (metadata) {
    if (!officialNewsImageMetadataMatches(driveEnv, metadata, fileId, uploader.id, uploader.complexSlug)) {
      return fail(
        'OFFICIAL_NEWS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
        'An object exists at the reserved Drive id but does not match the DanjiOn reservation',
        503,
        requestId
      );
    }
    const activationError = await activateOfficialNewsImageUpload(
      sql, objectKeyValue, uploader.id, uploader.complexId, requestId
    );
    if (activationError) return activationError;
    return { objectKey: objectKeyValue, metadata };
  }

  return persistIdempotentReservedOfficialNewsImageUpload(
    env, sql, file, uploader, objectKeyValue, requestId
  );
}

async function idempotentOfficialNewsImageReplay(
  env: CoreEnv,
  sql: Sql,
  file: File,
  row: RegistryRow,
  uploader: TrackedResident,
  requestFingerprint: string,
  requestId: string
): Promise<UploadSuccess | Response> {
  const objectKeyValue = String(row.object_key || '');
  if (!objectKeyValue) {
    return fail('OFFICIAL_NEWS_IMAGE_UPLOAD_STATE_CONFLICT', 'The idempotent official news image reservation is malformed', 409, requestId);
  }
  if (row.uploader_user_id !== uploader.id || row.complex_id !== uploader.complexId) {
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_IDEMPOTENCY_SCOPE_CONFLICT',
      'The Idempotency-Key was already used for a different official news image upload scope',
      409,
      requestId
    );
  }
  if (row.upload_request_fingerprint !== requestFingerprint) {
    return fail(
      'IDEMPOTENCY_KEY_REUSED',
      'The Idempotency-Key was already used with a different official news image upload',
      409,
      requestId
    );
  }
  if (row.state !== 'upload_pending' && row.state !== 'active') {
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_IDEMPOTENCY_STATE_CONFLICT',
      'The original idempotent official news image upload is no longer replayable',
      409,
      requestId
    );
  }

  const replay = row.state === 'upload_pending'
    ? await resumeIdempotentOfficialNewsImageUploadPending(env, sql, file, uploader, objectKeyValue, requestId)
    : await reconcileOfficialNewsImageUploadPending(
        env, sql, objectKeyValue, uploader.id, uploader.complexId, uploader.complexSlug, requestId
      );
  if (replay instanceof Response) return replay;
  return { ...replay, idempotencyReplayed: true };
}

async function runIdempotentTrackedOfficialNewsImageUpload(
  env: CoreEnv,
  sql: Sql,
  file: File,
  uploader: TrackedResident,
  requestId: string,
  idempotencyKey: string
): Promise<UploadSuccess | Response> {
  let requestFingerprint: string;
  try {
    requestFingerprint = await officialNewsImageUploadRequestFingerprint(file, uploader.complexSlug);
  } catch {
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_FINGERPRINT_UNAVAILABLE',
      'Official news image upload fingerprint could not be calculated',
      503,
      requestId
    );
  }

  const existing = await readIdempotentOfficialNewsImageRegistryRow(sql, uploader.id, idempotencyKey, requestId);
  if (existing instanceof Response) return existing;
  if (existing) {
    return idempotentOfficialNewsImageReplay(env, sql, file, existing, uploader, requestFingerprint, requestId);
  }

  let fileId: string;
  try {
    fileId = await generateDriveFileId(env as DriveEnv);
  } catch {
    return fail('OFFICIAL_NEWS_IMAGE_ID_RESERVATION_UNAVAILABLE', 'Google Drive could not reserve an upload id', 503, requestId);
  }
  const candidateObjectKey = officialNewsImageObjectKey(fileId);
  const reservation = await reserveIdempotentOfficialNewsImageUpload(
    sql, candidateObjectKey, uploader.id, uploader.complexId, idempotencyKey, requestFingerprint, requestId
  );
  if (reservation instanceof Response) return reservation;
  if (!reservation.reserved) {
    return idempotentOfficialNewsImageReplay(env, sql, file, reservation.row, uploader, requestFingerprint, requestId);
  }

  return persistIdempotentReservedOfficialNewsImageUpload(env, sql, file, uploader, candidateObjectKey, requestId);
}

export async function runTrackedOfficialNewsImageUpload(
  env: CoreEnv,
  sql: Sql,
  file: File,
  uploader: TrackedResident,
  requestId: string,
  idempotencyKey: string | null = null
): Promise<UploadSuccess | Response> {
  if (idempotencyKey) {
    if (!validBusinessImageUploadIdempotencyKey(idempotencyKey)) {
      return fail(
        'INVALID_IDEMPOTENCY_KEY',
        'Idempotency-Key must be 8-80 characters using letters, numbers, dot, underscore, colon or dash',
        400,
        requestId
      );
    }
    return runIdempotentTrackedOfficialNewsImageUpload(env, sql, file, uploader, requestId, idempotencyKey);
  }

  const driveEnv = env as DriveEnv;
  let fileId: string;
  try {
    fileId = await generateDriveFileId(driveEnv);
  } catch {
    return fail('OFFICIAL_NEWS_IMAGE_ID_RESERVATION_UNAVAILABLE', 'Google Drive could not reserve an upload id', 503, requestId);
  }

  const objectKeyValue = officialNewsImageObjectKey(fileId);
  const reservationError = await reserveOfficialNewsImageUpload(
    sql, objectKeyValue, uploader.id, uploader.complexId, requestId
  );
  if (reservationError) return reservationError;

  let uploadResponse: Response;
  try {
    uploadResponse = await uploadOfficialNewsImageFile(driveEnv, file, fileId, uploader.id, uploader.complexSlug);
  } catch {
    return reconcileOfficialNewsImageUploadPending(
      env, sql, objectKeyValue, uploader.id, uploader.complexId, uploader.complexSlug, requestId
    );
  }

  if (!uploadResponse.ok) {
    if (uploadResponse.status === 409 || uploadResponse.status >= 500) {
      return reconcileOfficialNewsImageUploadPending(
        env, sql, objectKeyValue, uploader.id, uploader.complexId, uploader.complexSlug, requestId
      );
    }
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_FAILED',
      'Official news image remains durably reserved but Google Drive rejected the upload',
      502,
      requestId
    );
  }

  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(driveEnv, fileId);
  } catch {
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
      'Official news image remains reserved because persisted metadata could not be confirmed',
      503,
      requestId
    );
  }
  if (!metadata || !officialNewsImageMetadataMatches(driveEnv, metadata, fileId, uploader.id, uploader.complexSlug)) {
    return fail(
      'OFFICIAL_NEWS_IMAGE_UPLOAD_RECONCILIATION_PENDING',
      'Official news image remains reserved because persisted metadata does not match the reservation',
      503,
      requestId
    );
  }

  const activationError = await activateOfficialNewsImageUpload(
    sql, objectKeyValue, uploader.id, uploader.complexId, requestId
  );
  if (activationError) return activationError;
  return { objectKey: objectKeyValue, metadata };
}

 export async function handleTrackedStorageUploadRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== '/api/v1/storage/objects' || request.method !== 'POST') return null;

  const driveEnv = env as DriveEnv;
  if (driveEnv.STORAGE_MODE !== 'drive' && driveEnv.STORAGE_MODE !== 'r2') {
    return fail('STORAGE_NOT_CONFIGURED', 'Google Drive storage mode is not enabled', 503, requestId);
  }
  if (driveEnv.STORAGE_MODE === 'drive' && !requiredDriveCredentials(driveEnv)) {
    return fail('STORAGE_NOT_CONFIGURED', 'Google Drive OAuth credentials are not configured', 503, requestId);
  }
  if (driveEnv.STORAGE_MODE === 'r2' && !r2Enabled(driveEnv)) {
    return fail('STORAGE_NOT_CONFIGURED', 'R2 storage binding is not configured', 503, requestId);
  }
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const sql: Sql = neon(env.DATABASE_URL);
  const actorOrResponse = await requireCanonicalActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_UPLOAD_REQUEST_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 'Upload request is too large', 413, requestId);
  }
  const form = await request.formData();
  const kind = String(form.get('kind') || '').trim();
  const complexSlug = String(form.get('complexSlug') || '').trim();

   if (kind === 'resident-evidence') {
    return fail(
      'RESIDENT_VERIFICATION_POLICY_HOLD',
      'Resident verification evidence upload is unavailable until the verification and privacy policy is approved',
      503,
      requestId
    );
  }

  const files = form.getAll('file').filter((value): value is File => value instanceof File);
  const validation = validateStorageUpload(kind, files);
  if (!validation.ok) {
    const status = validation.code === 'UNSUPPORTED_MEDIA_TYPE' ? 415 : validation.code === 'FILE_TOO_LARGE' ? 413 : 400;
    return fail(validation.code, validation.message, status, requestId);
  }
  if (validation.kind !== 'business-image' && validation.kind !== 'application-document' && validation.kind !== 'official-news-image') {
    return fail('VALIDATION_ERROR', 'Only business-image, application-document and official-news-image persistence is available on the current upload path', 400, requestId);
  }
  if (!complexSlug) return fail('VALIDATION_ERROR', 'complexSlug is required', 400, requestId);

  // #844 Amendment B: the official-news lane is authorized by official-content authority
  // (PADIEM operator or granted resident council), never by resident verification.
  const file = files[0];
  let uploader: TrackedResident;
  if (validation.kind === 'official-news-image') {
    const authority = await requireOperationalAuthority(
      request,
      env,
      sql,
      requestId,
      complexSlug,
      'official-content.manage',
      'council.official-content.manage'
    );
    if (authority instanceof Response) return authority;
    uploader = authority;
  } else {
    const residentOrResponse = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
    if (residentOrResponse instanceof Response) return residentOrResponse;
    uploader = residentOrResponse as TrackedResident;
  }

  const rawIdempotencyKey = request.headers.get('idempotency-key')?.trim() || null;
  if (rawIdempotencyKey && !validBusinessImageUploadIdempotencyKey(rawIdempotencyKey)) {
    return fail(
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key must be 8-80 characters using letters, numbers, dot, underscore, colon or dash',
      400,
      requestId
    );
  }

    let result: UploadSuccess | Response;
    if (driveEnv.STORAGE_MODE === 'r2') {
      result = await runR2TrackedUpload(
        driveEnv,
        sql,
        file,
        uploader,
        validation.kind,
        requestId,
        rawIdempotencyKey
      );
    } else if (validation.kind === 'business-image') {
      result = await runTrackedBusinessImageUpload(
       env, sql, file, uploader, requestId, rawIdempotencyKey
     );
    } else if (validation.kind === 'official-news-image') {
     result = await runTrackedOfficialNewsImageUpload(
       env, sql, file, uploader, requestId, rawIdempotencyKey
     );
   } else {
     result = await runTrackedApplicationDocumentUpload(
       env, sql, file, uploader, requestId, rawIdempotencyKey
     );
   }
   if (result instanceof Response) return result;

   return ok({
     objectKey: result.objectKey,
     fileName: file.name,
     contentType: file.type,
     size: file.size,
     visibility: validation.policy.visibility,
     idempotencyReplayed: result.idempotencyReplayed === true
   }, requestId, 201);
 }
