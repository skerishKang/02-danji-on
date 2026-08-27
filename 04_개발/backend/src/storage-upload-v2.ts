import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor as requireCanonicalActor, type Actor } from './auth-v1';
import { requireVerifiedResident } from './authorization-v2';
import type { CoreEnv } from './core-v1';
import { safeStorageFileName, validateStorageUpload } from './storage-policy.mjs';

type Sql = NeonQueryFunction<false, false>;
type DriveEnv = CoreEnv & {
  STORAGE_MODE?: string;
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_REFRESH_TOKEN?: string;
  GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID?: string;
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
        object_key, uploader_user_id, complex_id, state,
        upload_idempotency_key, upload_request_fingerprint
      ) values (
        ${objectKeyValue}, ${uploaderUserId}::uuid, ${complexId}::uuid, 'upload_pending',
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
      set state = 'active', updated_at = now()
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

export async function handleTrackedStorageUploadRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== '/api/v1/storage/objects' || request.method !== 'POST') return null;

  const driveEnv = env as DriveEnv;
  if (driveEnv.STORAGE_MODE !== 'drive') {
    return fail('STORAGE_NOT_CONFIGURED', 'Google Drive storage mode is not enabled', 503, requestId);
  }
  if (!requiredDriveCredentials(driveEnv)) {
    return fail('STORAGE_NOT_CONFIGURED', 'Google Drive OAuth credentials are not configured', 503, requestId);
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
  if (validation.kind !== 'business-image') {
    return fail('VALIDATION_ERROR', 'Only business-image persistence is available on the current upload path', 400, requestId);
  }
  if (!complexSlug) return fail('VALIDATION_ERROR', 'complexSlug is required', 400, requestId);

  const residentOrResponse = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (residentOrResponse instanceof Response) return residentOrResponse;
  const resident = residentOrResponse as TrackedResident;
  const file = files[0];

  const rawIdempotencyKey = request.headers.get('idempotency-key')?.trim() || null;
  if (rawIdempotencyKey && !validBusinessImageUploadIdempotencyKey(rawIdempotencyKey)) {
    return fail(
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key must be 8-80 characters using letters, numbers, dot, underscore, colon or dash',
      400,
      requestId
    );
  }

  const result = await runTrackedBusinessImageUpload(
    env, sql, file, resident, requestId, rawIdempotencyKey
  );
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