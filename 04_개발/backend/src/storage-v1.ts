import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor as requireCanonicalActor, type Actor } from './auth-v1';
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
  return payload.access_token;
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

async function membershipFor(sql: Sql, userId: string, complexSlug: string) {
  const rows = await sql`
    select m.role, m.verification_status
    from complex_memberships m
    join complexes c on c.id = m.complex_id
    where m.user_id = ${userId}::uuid and c.slug = ${complexSlug}
    limit 1
  `;
  return rows[0] ?? null;
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
  sql: Sql,
  actor: Actor,
  metadata: DriveMetadata,
  requestId: string
): Promise<Response | null> {
  const props = metadata.appProperties || {};
  if (props.danjionUploaderUserId === actor.id) return null;
  const complexSlug = props.danjionComplexSlug?.trim();
  if (!complexSlug) return fail('FORBIDDEN', 'Storage object is missing complex scope', 403, requestId);
  const membership = await membershipFor(sql, actor.id, complexSlug);
  if (!membership || !['manager', 'admin'].includes(String(membership.role)) || String(membership.verification_status) !== 'verified') {
    return fail('FORBIDDEN', 'Storage object access is not allowed', 403, requestId);
  }
  return null;
}

async function upload(request: Request, env: DriveEnv, requestId: string): Promise<Response> {
  const auth = await requireStorageActor(request, env, requestId);
  if (auth instanceof Response) return auth;
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_UPLOAD_REQUEST_BYTES) return fail('PAYLOAD_TOO_LARGE', 'Upload request is too large', 413, requestId);
  const form = await request.formData();
  const kind = String(form.get('kind') || '').trim();
  const complexSlug = String(form.get('complexSlug') || '').trim();
  const files = form.getAll('file').filter((value): value is File => value instanceof File);
  const validation = validateStorageUpload(kind, files);
  if (!validation.ok) {
    const status = validation.code === 'UNSUPPORTED_MEDIA_TYPE' ? 415 : validation.code === 'FILE_TOO_LARGE' ? 413 : 400;
    return fail(validation.code, validation.message, status, requestId);
  }
  if (!complexSlug || complexSlug.length > 160) return fail('VALIDATION_ERROR', 'complexSlug is required', 400, requestId);
  const membership = await membershipFor(auth.sql, auth.actor.id, complexSlug);
  if (!membership) return fail('FORBIDDEN', 'No membership for target complex', 403, requestId);

  const file = files[0];
  const uploaded = await uploadDriveFile(env, validation.kind, file, auth.actor, complexSlug);
  if (!uploaded.id) throw new Error('Google Drive upload returned no file id');
  return ok({
    objectKey: objectKey(validation.kind, uploaded.id),
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
    const denied = await authorizeObject(auth.sql, auth.actor, metadata, requestId);
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

async function removeObject(request: Request, env: DriveEnv, requestId: string): Promise<Response> {
  const auth = await requireStorageActor(request, env, requestId);
  if (auth instanceof Response) return auth;
  const parsed = parseObjectKey(new URL(request.url).searchParams.get('objectKey') || '');
  if (!parsed) return fail('INVALID_OBJECT_KEY', 'Invalid storage object key', 400, requestId);
  const metadata = await readDriveMetadata(env, parsed);
  if (!metadata || !metadataMatches(env, parsed, metadata)) return fail('NOT_FOUND', 'Storage object not found', 404, requestId);
  const denied = await authorizeObject(auth.sql, auth.actor, metadata, requestId);
  if (denied) return denied;

  const response = await googleFetch(env, `${DRIVE_API}/files/${encodeURIComponent(parsed.fileId)}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trashed: true })
  });
  if (!response.ok) throw new Error(`Google Drive delete failed (${response.status})`);
  return ok({ objectKey: parsed.objectKey, deleted: true }, requestId);
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
