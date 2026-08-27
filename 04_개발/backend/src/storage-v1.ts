import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor as requireCanonicalActor, type Actor } from './auth-v1';
import { requireVerifiedResident } from './authorization-v2';
import type { CoreEnv } from './core-v1';
import {
  safeStorageFileName,
  validateStorageUpload,
  type StorageKind,
  type StorageVisibility
} from './storage-policy.mjs';

type Sql = NeonQueryFunction<false, false>;
type DriveEnv = CoreEnv & {
  STORAGE_MODE?: string;
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_REFRESH_TOKEN?: string;
  GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID?: string;
  GOOGLE_DRIVE_PRIVATE_RESIDENT_VERIFICATION_FOLDER_ID?: string;
};
type DriveMetadata = {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  trashed?: boolean;
  parents?: string[];
  appProperties?: Record<string, string>;
};
type ParsedObjectKey = {
  objectKey: string;
  visibility: StorageVisibility;
  kind: StorageKind;
  fileId: string;
};
type BusinessImageRegistryRow = {
  object_key?: string;
  uploader_user_id?: string;
  complex_id?: string;
  state?: string;
};
type DeleteIntentDecision = {
  state?: string;
  uploader_user_id?: string;
  business_media_in_use?: boolean;
  application_in_use?: boolean;
  delete_intent_acquired?: boolean;
};

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const MAX_UPLOAD_REQUEST_BYTES = 12 * 1024 * 1024;
const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;
let cachedAccessToken: { value: string; expiresAt: number } | null = null;

function json(data: unknown, status: number, requestId: string, extraHeaders: HeadersInit = {}): Response {
  const headers = new Headers(extraHeaders);
  headers.set('x-danjion-request-id', requestId);
  headers.set('cache-control', 'no-store');
  return Response.json(data, { status, headers });
}

function ok(data: unknown, requestId: string, status = 200): Response {
  return json({ data, requestId }, status, requestId);
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}

function driveConfigured(env: DriveEnv): boolean {
  return env.STORAGE_MODE === 'drive';
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
  const payload = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
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

function folderFor(env: DriveEnv, kind: StorageKind): string | null {
  return kind === 'business-image'
    ? env.GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID?.trim() || null
    : env.GOOGLE_DRIVE_PRIVATE_RESIDENT_VERIFICATION_FOLDER_ID?.trim() || null;
}

function storageVisibility(kind: StorageKind): StorageVisibility {
  return kind === 'business-image' ? 'public' : 'private';
}

function opaquePrivateName(contentType: string): string {
  const extension = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf'
  }[contentType] || 'bin';
  return `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}.${extension}`;
}

function driveFileNameForUpload(kind: StorageKind, file: File): string {
  return kind === 'resident-evidence'
    ? opaquePrivateName(file.type)
    : `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}-${safeStorageFileName(file.name)}`;
}

function objectKey(kind: StorageKind, fileId: string): string {
  return `gdrive/${storageVisibility(kind)}/${kind}/${fileId}`;
}

function parseObjectKey(value: string): ParsedObjectKey | null {
  const parts = value.trim().split('/');
  if (parts.length !== 4 || parts[0] !== 'gdrive') return null;
  const visibility = parts[1];
  const kind = parts[2];
  const fileId = parts[3];
  if ((visibility !== 'public' && visibility !== 'private') ||
      (kind !== 'business-image' && kind !== 'resident-evidence') ||
      !DRIVE_FILE_ID.test(fileId)) return null;
  if (storageVisibility(kind) !== visibility) return null;
  return { objectKey: value.trim(), visibility, kind, fileId };
}

async function requireStorageActor(
  request: Request,
  env: DriveEnv,
  requestId: string
): Promise<{ actor: Actor; sql: Sql } | Response> {
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
  const sql: Sql = neon(env.DATABASE_URL);
  const actorOrResponse = await requireCanonicalActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  return { actor: actorOrResponse, sql };
}

async function readDriveMetadata(env: DriveEnv, parsed: ParsedObjectKey): Promise<DriveMetadata | null> {
  const response = await googleFetch(
    env,
    `${DRIVE_API}/files/${encodeURIComponent(parsed.fileId)}?fields=id,name,mimeType,size,trashed,parents,appProperties&supportsAllDrives=true`
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Google Drive metadata read failed (${response.status})`);
  return response.json() as Promise<DriveMetadata>;
}

function metadataMatches(env: DriveEnv, parsed: ParsedObjectKey, metadata: DriveMetadata): boolean {
  const expectedFolder = folderFor(env, parsed.kind);
  if (!expectedFolder || metadata.trashed || !metadata.parents?.includes(expectedFolder)) return false;
  const props = metadata.appProperties || {};
  return props.danjionKind === parsed.kind && props.danjionVisibility === parsed.visibility;
}

function retirementMetadataMatches(
  env: DriveEnv,
  parsed: ParsedObjectKey,
  metadata: DriveMetadata,
  expectedUploaderUserId: string
): boolean {
  const expectedFolder = folderFor(env, parsed.kind);
  const props = metadata.appProperties || {};
  return Boolean(expectedFolder) && metadata.parents?.includes(expectedFolder!) === true &&
    props.danjionKind === 'business-image' &&
    props.danjionVisibility === 'public' &&
    props.danjionUploaderUserId === expectedUploaderUserId;
}

export async function validateBusinessImageReference(
  env: CoreEnv,
  objectKeyValue: string,
  expectedUploaderUserId: string,
  expectedComplexSlug: string,
  requestId: string
): Promise<Response | null> {
  const driveEnv = env as DriveEnv;
  if (!driveConfigured(driveEnv) || !requiredDriveCredentials(driveEnv)) {
    return fail('STORAGE_NOT_CONFIGURED', 'Google Drive storage is not configured for business image verification', 503, requestId);
  }

  const parsed = parseObjectKey(objectKeyValue);
  if (!parsed || parsed.visibility !== 'public' || parsed.kind !== 'business-image') {
    return fail(
      'INVALID_BUSINESS_IMAGE_REFERENCE',
      'Representative image must reference a DanjiOn public business image',
      400,
      requestId
    );
  }

  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(driveEnv, parsed);
  } catch {
    return fail(
      'BUSINESS_IMAGE_REFERENCE_UNAVAILABLE',
      'Representative image could not be verified against storage',
      503,
      requestId
    );
  }
  if (!metadata || !metadataMatches(driveEnv, parsed, metadata)) {
    return fail(
      'INVALID_BUSINESS_IMAGE_REFERENCE',
      'Representative image is missing or no longer a valid DanjiOn business image',
      400,
      requestId
    );
  }

  const props = metadata.appProperties || {};
  if (props.danjionUploaderUserId !== expectedUploaderUserId || props.danjionComplexSlug !== expectedComplexSlug) {
    return fail(
      'BUSINESS_IMAGE_REFERENCE_FORBIDDEN',
      'Representative image does not belong to this resident and complex',
      403,
      requestId
    );
  }
  return null;
}

export async function businessImageDeleteConflict(
  sql: Sql,
  objectKeyValue: string,
  requestId: string
): Promise<Response | null> {
  let rows;
  try {
    rows = await sql`
      select
        exists (
          select 1
          from business_media bm
          where bm.object_key = ${objectKeyValue}
        ) as business_media_in_use,
        exists (
          select 1
          from business_applications a
          where a.representative_image_object_key = ${objectKeyValue}
            and a.status in ('draft', 'pending', 'changes_requested', 'approved')
        ) as application_in_use
    `;
  } catch {
    return fail(
      'BUSINESS_IMAGE_REFERENCE_CHECK_UNAVAILABLE',
      'Business image usage could not be verified before deletion',
      503,
      requestId
    );
  }

  const usage = rows[0] as { business_media_in_use?: boolean; application_in_use?: boolean } | undefined;
  if (usage?.business_media_in_use || usage?.application_in_use) {
    return fail(
      'BUSINESS_IMAGE_IN_USE',
      'Business image is still referenced by an active application or business record',
      409,
      requestId
    );
  }
  return null;
}

export async function registerBusinessImageObject(
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
        ${objectKeyValue}, ${uploaderUserId}::uuid, ${complexId}::uuid, 'active'
      )
      on conflict (object_key) do nothing
      returning object_key
    `;
    if (rows[0]) return null;
    return fail(
      'BUSINESS_IMAGE_REGISTRY_CONFLICT',
      'Business image object key is already registered',
      409,
      requestId
    );
  } catch {
    return fail(
      'BUSINESS_IMAGE_REGISTRY_UNAVAILABLE',
      'Business image lifecycle registry is unavailable',
      503,
      requestId
    );
  }
}

async function readBusinessImageRegistry(
  sql: Sql,
  objectKeyValue: string,
  requestId: string
): Promise<BusinessImageRegistryRow | Response | null> {
  try {
    const rows = await sql`
      select object_key, uploader_user_id, complex_id, state
      from business_image_objects
      where object_key = ${objectKeyValue}
      limit 1
    `;
    return (rows[0] as BusinessImageRegistryRow | undefined) ?? null;
  } catch {
    return fail(
      'BUSINESS_IMAGE_REGISTRY_UNAVAILABLE',
      'Business image lifecycle registry is unavailable',
      503,
      requestId
    );
  }
}

export async function acquireBusinessImageDeleteIntent(
  sql: Sql,
  objectKeyValue: string,
  uploaderUserId: string,
  requestId: string
): Promise<{ acquired: boolean; state: string } | Response> {
  let lockedRows;
  let decisionRows;
  try {
    [lockedRows, decisionRows] = await sql.transaction([
      sql`
        select object_key, uploader_user_id, complex_id, state
        from business_image_objects
        where object_key = ${objectKeyValue}
        for update
      `,
      sql`
        with usage as (
          select
            exists (
              select 1 from business_media bm
              where bm.object_key = ${objectKeyValue}
            ) as business_media_in_use,
            exists (
              select 1 from business_applications a
              where a.representative_image_object_key = ${objectKeyValue}
                and a.status in ('draft', 'pending', 'changes_requested', 'approved')
            ) as application_in_use
        ),
        updated as (
          update business_image_objects bio
          set state = 'delete_pending',
              delete_requested_at = coalesce(bio.delete_requested_at, now()),
              updated_at = now()
          from usage u
          where bio.object_key = ${objectKeyValue}
            and bio.uploader_user_id = ${uploaderUserId}::uuid
            and bio.state = 'active'
            and not u.business_media_in_use
            and not u.application_in_use
          returning bio.object_key
        )
        select
          (select state from business_image_objects where object_key = ${objectKeyValue}) as state,
          (select uploader_user_id::text from business_image_objects where object_key = ${objectKeyValue}) as uploader_user_id,
          u.business_media_in_use,
          u.application_in_use,
          exists (select 1 from updated) as delete_intent_acquired
        from usage u
      `
    ]);
  } catch {
    return fail(
      'BUSINESS_IMAGE_REFERENCE_CHECK_UNAVAILABLE',
      'Business image lifecycle/reference state could not be verified before deletion',
      503,
      requestId
    );
  }

  const locked = (lockedRows as BusinessImageRegistryRow[])[0];
  if (!locked) {
    return fail('BUSINESS_IMAGE_NOT_REGISTERED', 'Business image is not registered for lifecycle mutation', 409, requestId);
  }
  if (String(locked.uploader_user_id ?? '') !== uploaderUserId) {
    return fail('FORBIDDEN', 'Only the storage uploader may mutate this business image', 403, requestId);
  }

  const decision = (decisionRows as DeleteIntentDecision[])[0];
  if (decision?.business_media_in_use || decision?.application_in_use) {
    return fail(
      'BUSINESS_IMAGE_IN_USE',
      'Business image is still referenced by an active application or business record',
      409,
      requestId
    );
  }
  if (decision?.delete_intent_acquired) return { acquired: true, state: 'delete_pending' };
  return { acquired: false, state: String(decision?.state ?? locked.state ?? '') };
}

async function finalizeBusinessImageRetired(
  sql: Sql,
  objectKeyValue: string,
  requestId: string
): Promise<Response | null> {
  try {
    const rows = await sql`
      update business_image_objects
      set state = 'retired',
          retired_at = coalesce(retired_at, now()),
          reconcile_lease_token = null,
          reconcile_lease_expires_at = null,
          reconcile_next_attempt_at = null,
          reconcile_last_error_code = null,
          updated_at = now()
      where object_key = ${objectKeyValue}
        and state = 'delete_pending'
      returning state
    `;
    if (rows[0]) return null;
    const current = await sql`
      select state from business_image_objects
      where object_key = ${objectKeyValue}
      limit 1
    `;
    if (String(current[0]?.state ?? '') === 'retired') return null;
    return fail(
      'BUSINESS_IMAGE_RETIREMENT_STATE_UNAVAILABLE',
      'Business image retirement could not be finalized safely',
      503,
      requestId
    );
  } catch {
    return fail(
      'BUSINESS_IMAGE_REGISTRY_UNAVAILABLE',
      'Business image lifecycle registry is unavailable',
      503,
      requestId
    );
  }
}

async function uploadDriveFile(
  env: DriveEnv,
  kind: StorageKind,
  file: File,
  actor: Actor,
  complexSlug: string
): Promise<DriveMetadata> {
  const folderId = folderFor(env, kind);
  if (!folderId) throw new Error(`Google Drive folder is not configured for ${kind}`);
  const boundary = `danjion-${crypto.randomUUID()}`;
  const metadata = {
    name: driveFileNameForUpload(kind, file),
    parents: [folderId],
    appProperties: {
      danjionKind: kind,
      danjionVisibility: storageVisibility(kind),
      danjionUploaderUserId: actor.id,
      danjionComplexSlug: complexSlug
    }
  };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`,
    file,
    `\r\n--${boundary}--\r\n`
  ]);
  const response = await googleFetch(
    env,
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,parents,appProperties&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Google Drive upload failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ''}`);
  }
  return response.json() as Promise<DriveMetadata>;
}

async function authorizeObject(
  actor: Actor,
  metadata: DriveMetadata,
  requestId: string
): Promise<Response | null> {
  const props = metadata.appProperties || {};
  if (props.danjionUploaderUserId === actor.id) return null;

  // Issue #59 keeps resident-verification evidence administration on HOLD.
  // No non-uploader actor class receives evidence-original access by role.
  if (props.danjionKind === 'resident-evidence' || props.danjionVisibility === 'private') {
    return fail(
      'RESIDENT_VERIFICATION_POLICY_HOLD',
      'Resident verification evidence access is unavailable until the verification and privacy policy is approved',
      503,
      requestId
    );
  }

  // Public readability is not mutation authority. Historical apartment
  // manager/admin membership is not current business-media deletion authority,
  // and no operator media-delete scope is invented in this bounded repair.
  return fail(
    'FORBIDDEN',
    'Only the storage uploader may mutate this business image until explicit media moderation authority is defined',
    403,
    requestId
  );
}

async function upload(request: Request, env: DriveEnv, requestId: string): Promise<Response> {
  const auth = await requireStorageActor(request, env, requestId);
  if (auth instanceof Response) return auth;
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_UPLOAD_REQUEST_BYTES) return fail('PAYLOAD_TOO_LARGE', 'Upload request is too large', 413, requestId);
  const form = await request.formData();
  const kind = String(form.get('kind') || '').trim();
  const complexSlug = String(form.get('complexSlug') || '').trim();

  // Issue #59 leaves the resident-verification provider, evidence collection,
  // retention and review authority unresolved. A direct generic-storage call
  // must not become an alternate evidence-collection workflow while held.
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
  if (!complexSlug) return fail('VALIDATION_ERROR', 'complexSlug is required', 400, requestId);

  // Business media is consumed by the Household-v2 resident-economy flow, so
  // its upload uses the same verified-resident authority rather than legacy
  // complex_memberships existence or role fields.
  const residentOrResponse = await requireVerifiedResident(request, env, auth.sql, requestId, complexSlug);
  if (residentOrResponse instanceof Response) return residentOrResponse;
  const resident = residentOrResponse;

  const file = files[0];
  const uploaded = await uploadDriveFile(env, validation.kind, file, resident, resident.complexSlug);
  if (!uploaded.id) throw new Error('Google Drive upload returned no file id');
  const uploadedObjectKey = objectKey(validation.kind, uploaded.id);

  // An uploaded business image is not referenceable until PostgreSQL owns an
  // active lifecycle row. If registration fails, do not return the key; the
  // Drive object is an orphan candidate rather than a product reference.
  if (validation.kind === 'business-image') {
    const registrationError = await registerBusinessImageObject(
      auth.sql,
      uploadedObjectKey,
      resident.id,
      resident.complexId,
      requestId
    );
    if (registrationError) return registrationError;
  }

  return ok({
    objectKey: uploadedObjectKey,
    fileName: file.name,
    contentType: file.type,
    size: file.size,
    visibility: validation.policy.visibility
  }, requestId, 201);
}

async function streamObject(request: Request, env: DriveEnv, requestId: string, privateRoute: boolean): Promise<Response> {
  const parsed = parseObjectKey(new URL(request.url).searchParams.get('objectKey') || '');
  if (!parsed) return fail('INVALID_OBJECT_KEY', 'Invalid storage object key', 400, requestId);
  if (privateRoute) {
    if (parsed.visibility !== 'private' || parsed.kind !== 'resident-evidence') {
      return fail('FORBIDDEN', 'Private storage route only serves resident evidence', 403, requestId);
    }
  } else if (parsed.visibility !== 'public' || parsed.kind !== 'business-image') {
    return fail('NOT_FOUND', 'Public storage object not found', 404, requestId);
  }

  const metadata = await readDriveMetadata(env, parsed);
  if (!metadata || !metadataMatches(env, parsed, metadata)) return fail('NOT_FOUND', 'Storage object not found', 404, requestId);

  if (privateRoute) {
    const auth = await requireStorageActor(request, env, requestId);
    if (auth instanceof Response) return auth;
    const denied = await authorizeObject(auth.actor, metadata, requestId);
    if (denied) return denied;
  }

  const response = await googleFetch(env, `${DRIVE_API}/files/${encodeURIComponent(parsed.fileId)}?alt=media&supportsAllDrives=true`);
  if (response.status === 404) return fail('NOT_FOUND', 'Storage object not found', 404, requestId);
  if (!response.ok || !response.body) throw new Error(`Google Drive file read failed (${response.status})`);
  const headers = new Headers({
    'content-type': metadata.mimeType || 'application/octet-stream',
    'cache-control': privateRoute ? 'private, no-store' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
    'x-danjion-request-id': requestId
  });
  if (metadata.size) headers.set('content-length', metadata.size);
  return new Response(response.body, { status: 200, headers });
}

async function trashBusinessImageAndFinalize(
  env: DriveEnv,
  sql: Sql,
  parsed: ParsedObjectKey,
  requestId: string
): Promise<Response> {
  let response: Response;
  try {
    response = await googleFetch(env, `${DRIVE_API}/files/${encodeURIComponent(parsed.fileId)}?supportsAllDrives=true`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    });
  } catch {
    return fail(
      'BUSINESS_IMAGE_RETIREMENT_PENDING',
      'Business image delete intent is recorded but Google Drive retirement is not yet confirmed',
      503,
      requestId
    );
  }

  if (!response.ok && response.status !== 404) {
    return fail(
      'BUSINESS_IMAGE_RETIREMENT_PENDING',
      'Business image delete intent is recorded but Google Drive retirement is not yet confirmed',
      503,
      requestId
    );
  }

  const finalizeError = await finalizeBusinessImageRetired(sql, parsed.objectKey, requestId);
  if (finalizeError) return finalizeError;
  return ok({ objectKey: parsed.objectKey, deleted: true, retired: true }, requestId);
}

async function reconcileBusinessImageRetirement(
  env: DriveEnv,
  sql: Sql,
  actor: Actor,
  parsed: ParsedObjectKey,
  requestId: string
): Promise<Response> {
  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(env, parsed);
  } catch {
    return fail(
      'BUSINESS_IMAGE_RETIREMENT_PENDING',
      'Business image retirement state could not be reconciled with Google Drive',
      503,
      requestId
    );
  }

  if (!metadata) {
    const finalizeError = await finalizeBusinessImageRetired(sql, parsed.objectKey, requestId);
    if (finalizeError) return finalizeError;
    return ok({ objectKey: parsed.objectKey, deleted: true, retired: true, reconciled: true }, requestId);
  }

  if (!retirementMetadataMatches(env, parsed, metadata, actor.id)) {
    return fail(
      'BUSINESS_IMAGE_RETIREMENT_PENDING',
      'Business image retirement metadata could not be verified safely',
      503,
      requestId
    );
  }

  if (metadata.trashed) {
    const finalizeError = await finalizeBusinessImageRetired(sql, parsed.objectKey, requestId);
    if (finalizeError) return finalizeError;
    return ok({ objectKey: parsed.objectKey, deleted: true, retired: true, reconciled: true }, requestId);
  }

  return trashBusinessImageAndFinalize(env, sql, parsed, requestId);
}

async function removeRegisteredBusinessImage(
  auth: { actor: Actor; sql: Sql },
  env: DriveEnv,
  parsed: ParsedObjectKey,
  registry: BusinessImageRegistryRow,
  requestId: string
): Promise<Response> {
  if (String(registry.uploader_user_id ?? '') !== auth.actor.id) {
    return fail('FORBIDDEN', 'Only the storage uploader may mutate this business image', 403, requestId);
  }

  const state = String(registry.state ?? '');
  if (state === 'retired') {
    return ok({ objectKey: parsed.objectKey, deleted: true, retired: true, alreadyRetired: true }, requestId);
  }
  if (state === 'delete_pending') {
    return reconcileBusinessImageRetirement(env, auth.sql, auth.actor, parsed, requestId);
  }
  if (state !== 'active') {
    return fail('BUSINESS_IMAGE_NOT_ACTIVE', 'Business image is not active for lifecycle mutation', 409, requestId);
  }

  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(env, parsed);
  } catch {
    return fail('BUSINESS_IMAGE_REFERENCE_UNAVAILABLE', 'Business image could not be verified against storage', 503, requestId);
  }
  if (!metadata || !metadataMatches(env, parsed, metadata)) return fail('NOT_FOUND', 'Storage object not found', 404, requestId);
  const denied = await authorizeObject(auth.actor, metadata, requestId);
  if (denied) return denied;

  const intent = await acquireBusinessImageDeleteIntent(auth.sql, parsed.objectKey, auth.actor.id, requestId);
  if (intent instanceof Response) return intent;
  if (!intent.acquired) {
    if (intent.state === 'delete_pending') {
      return reconcileBusinessImageRetirement(env, auth.sql, auth.actor, parsed, requestId);
    }
    if (intent.state === 'retired') {
      return ok({ objectKey: parsed.objectKey, deleted: true, retired: true, alreadyRetired: true }, requestId);
    }
    return fail('BUSINESS_IMAGE_NOT_ACTIVE', 'Business image is not active for deletion', 409, requestId);
  }

  // The DB delete intent is committed before this external Drive side effect.
  return trashBusinessImageAndFinalize(env, auth.sql, parsed, requestId);
}

async function removeLegacyUnregisteredBusinessImage(
  auth: { actor: Actor; sql: Sql },
  env: DriveEnv,
  parsed: ParsedObjectKey,
  requestId: string
): Promise<Response> {
  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(env, parsed);
  } catch {
    return fail('BUSINESS_IMAGE_REFERENCE_UNAVAILABLE', 'Business image could not be verified against storage', 503, requestId);
  }
  if (!metadata || !metadataMatches(env, parsed, metadata)) return fail('NOT_FOUND', 'Storage object not found', 404, requestId);
  const denied = await authorizeObject(auth.actor, metadata, requestId);
  if (denied) return denied;

  // Compatibility only for pre-registry objects. New reference acquisition now
  // requires an active registry row, so an unregistered key cannot enter the
  // current product reference workflow while this legacy delete completes.
  const conflict = await businessImageDeleteConflict(auth.sql, parsed.objectKey, requestId);
  if (conflict) return conflict;

  let response: Response;
  try {
    response = await googleFetch(env, `${DRIVE_API}/files/${encodeURIComponent(parsed.fileId)}?supportsAllDrives=true`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    });
  } catch {
    return fail('BUSINESS_IMAGE_RETIREMENT_PENDING', 'Google Drive retirement could not be confirmed', 503, requestId);
  }
  if (!response.ok && response.status !== 404) {
    return fail('BUSINESS_IMAGE_RETIREMENT_PENDING', 'Google Drive retirement could not be confirmed', 503, requestId);
  }
  return ok({ objectKey: parsed.objectKey, deleted: true, legacyUnregistered: true }, requestId);
}

async function removeObject(request: Request, env: DriveEnv, requestId: string): Promise<Response> {
  const auth = await requireStorageActor(request, env, requestId);
  if (auth instanceof Response) return auth;
  const parsed = parseObjectKey(new URL(request.url).searchParams.get('objectKey') || '');
  if (!parsed) return fail('INVALID_OBJECT_KEY', 'Invalid storage object key', 400, requestId);

  // Resident evidence remains exactly on its existing uploader/HOLD path and
  // never enters the business-image lifecycle registry.
  if (parsed.kind === 'resident-evidence') {
    let metadata: DriveMetadata | null;
    try {
      metadata = await readDriveMetadata(env, parsed);
    } catch {
      return fail('STORAGE_UNAVAILABLE', 'Storage object could not be verified', 503, requestId);
    }
    if (!metadata || !metadataMatches(env, parsed, metadata)) return fail('NOT_FOUND', 'Storage object not found', 404, requestId);
    const denied = await authorizeObject(auth.actor, metadata, requestId);
    if (denied) return denied;
    const response = await googleFetch(env, `${DRIVE_API}/files/${encodeURIComponent(parsed.fileId)}?supportsAllDrives=true`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    });
    if (!response.ok) throw new Error(`Google Drive delete failed (${response.status})`);
    return ok({ objectKey: parsed.objectKey, deleted: true }, requestId);
  }

  if (parsed.kind === 'business-image') {
    const registry = await readBusinessImageRegistry(auth.sql, parsed.objectKey, requestId);
    if (registry instanceof Response) return registry;
    if (registry) return removeRegisteredBusinessImage(auth, env, parsed, registry, requestId);
    return removeLegacyUnregisteredBusinessImage(auth, env, parsed, requestId);
  }

  return fail('INVALID_OBJECT_KEY', 'Invalid storage object key', 400, requestId);
}

export async function handleStorageRequest(request: Request, env: CoreEnv, requestId: string): Promise<Response | null> {
  const driveEnv = env as DriveEnv;
  const path = new URL(request.url).pathname;
  const matchesStorageRoute = path === '/api/v1/storage/objects' ||
    path === '/api/v1/storage/public' || path === '/api/v1/storage/private';
  if (!matchesStorageRoute) return null;
  if (!driveConfigured(driveEnv)) return fail('STORAGE_NOT_CONFIGURED', 'Google Drive storage mode is not enabled', 503, requestId);
  if (!requiredDriveCredentials(driveEnv)) return fail('STORAGE_NOT_CONFIGURED', 'Google Drive OAuth credentials are not configured', 503, requestId);

  if (path === '/api/v1/storage/objects' && request.method === 'POST') return upload(request, driveEnv, requestId);
  if (path === '/api/v1/storage/objects' && request.method === 'DELETE') return removeObject(request, driveEnv, requestId);
  if (path === '/api/v1/storage/public' && request.method === 'GET') return streamObject(request, driveEnv, requestId, false);
  if (path === '/api/v1/storage/private' && request.method === 'GET') return streamObject(request, driveEnv, requestId, true);
  return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
}