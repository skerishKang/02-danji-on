// Domain-neutral application-document serving core (#372 B1 / #375 F11).
//
// The application-document byte surface is owned by two lanes:
//   resident-application-docs-v1.ts — applicant authority (GET /api/v1/me/...)
//   admin-application-docs-v1.ts    — reviewer authority (GET /api/v1/admin/...)
// This module owns only what is genuinely lane-neutral: the exact
// documentId -> application -> complex -> registry lookup, actor resolution,
// registry integrity guards, the registry-bound object-key parse and the
// server-side Drive proxy. Lane authority is injected through the policy
// callback so the fail-closed stage order below stays single-sourced.
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { CoreEnv } from './core-v1';
import { requireActor, type Actor } from './auth-v1';

export type Sql = NeonQueryFunction<false, false>;

export type DriveEnv = CoreEnv & {
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_REFRESH_TOKEN?: string;
};

export type ApplicationDocumentEnv = CoreEnv & DriveEnv;

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const OBJECT_KEY_PREFIX = 'gdrive/private/application-document/';

// Malformed ids fail closed with the same non-disclosing 404 as a missing
// document, before any query runs (raw ids must never reach ::uuid casts).
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DocumentRow = {
  object_key: string;
  complex_slug: string;
  applicant_user_id: string;
  application_status: string;
  registry_state: string | null;
  registry_kind: string | null;
};

export type ApplicationDocumentAuthorizeInput = {
  request: Request;
  env: ApplicationDocumentEnv;
  sql: Sql;
  requestId: string;
  actor: Actor;
  row: DocumentRow;
  applicationId: string;
  documentId: string;
};

export type ApplicationDocumentAuthorization = {
  // A non-null reviewer scope marks the read as an audited reviewer access;
  // applicant lanes always answer with a null scope and no audit gate.
  reviewerScope: string | null;
  auditRead: (() => Promise<Response | null>) | null;
};

export type ApplicationDocumentLanePolicy = {
  // Denials are returned as Responses; an authorized read returns the audit
  // wiring for the shared pipeline.
  authorize(input: ApplicationDocumentAuthorizeInput): Promise<ApplicationDocumentAuthorization | Response>;
};

export function json(data: unknown, status: number, requestId: string, extraHeaders: HeadersInit = {}): Response {
  const headers = new Headers(extraHeaders);
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set('cache-control', 'no-store');
  headers.set('access-control-expose-headers', REQUEST_ID_HEADER);
  return Response.json(data, { status, headers });
}

export function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}

// The object key is resolved exclusively from the
// documentId -> application -> complex -> registry lookup below. Caller
// supplied object keys are never trusted: no query param is read.
function parseFileId(objectKey: string): string | null {
  if (!objectKey.startsWith(OBJECT_KEY_PREFIX)) return null;
  const suffix = objectKey.slice(OBJECT_KEY_PREFIX.length);
  const match = suffix.match(/^([A-Za-z0-9_-]{10,200})$/);
  return match ? match[1] : null;
}

let cachedAccessToken: { value: string; expiresAt: number } | null = null;

async function accessToken(env: DriveEnv): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60_000) return cachedAccessToken.value;
  const clientId = env.GOOGLE_DRIVE_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() ?? '';
  const refreshToken = env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim() ?? '';
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Drive OAuth credentials are not configured');
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status})`);
  const data = await response.json() as { access_token: string; expires_in: number };
  cachedAccessToken = { value: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return data.access_token;
}

async function streamDriveFile(
  env: DriveEnv,
  fileId: string,
  documentId: string,
  requestId: string
): Promise<Response> {
  const token = await accessToken(env);
  const metadataResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=mimeType,size`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (metadataResponse.status === 404) return fail('NOT_FOUND', 'Storage object not found', 404, requestId);
  if (!metadataResponse.ok) throw new Error(`Google Drive metadata fetch failed (${metadataResponse.status})`);
  const metadata = await metadataResponse.json() as { mimeType?: string; size?: string };
  const mimeType = metadata.mimeType ?? 'application/octet-stream';
  const isImage = mimeType.startsWith('image/');

  const fileResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (fileResponse.status === 404) return fail('NOT_FOUND', 'Storage object not found', 404, requestId);
  if (!fileResponse.ok || !fileResponse.body) throw new Error(`Google Drive file read failed (${fileResponse.status})`);

  const headers = new Headers({
    'content-type': mimeType,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-disposition': isImage
      ? `inline; filename="application-document-${documentId}"`
      : `attachment; filename="application-document-${documentId}.pdf"`,
    'x-danjion-request-id': requestId
  });
  if (metadata.size) headers.set('content-length', metadata.size);
  return new Response(fileResponse.body, { status: 200, headers });
}

export async function serveApplicationDocument(
  request: Request,
  env: ApplicationDocumentEnv,
  sql: Sql,
  requestId: string,
  policy: ApplicationDocumentLanePolicy,
  applicationId: string,
  documentId: string
): Promise<Response> {
  // Exact documentId -> application -> complex -> registry lookup. The
  // application_id predicate binds the document to the URL application so a
  // documentId from another application never resolves here.
  const rows = await sql`
    select bad.object_key, c.slug as complex_slug, a.applicant_user_id, a.status as application_status,
           reg.state as registry_state, reg.kind as registry_kind
    from business_application_documents bad
    join business_applications a on a.id = bad.application_id
    join complexes c on c.id = a.complex_id
    left join business_image_objects reg on reg.object_key = bad.object_key
    where bad.id = ${documentId}::uuid
      and bad.application_id = ${applicationId}::uuid
    limit 1
  `;
  const row = rows[0] as DocumentRow | undefined;
  if (!row) return fail('NOT_FOUND', 'Application document not found', 404, requestId);

  const objectKey = String(row.object_key ?? '');

  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  const authorization = await policy.authorize({ request, env, sql, requestId, actor, row, applicationId, documentId });
  if (authorization instanceof Response) return authorization;

  // Registry guard runs after authorization so denial precedence stays
  // auth-first: unauthenticated callers learn nothing about registry state.
  if (String(row.registry_kind ?? '') !== 'application-document') {
    return fail(
      'DOCUMENT_KIND_INVALID',
      'Registry row is not an application-document',
      400,
      requestId
    );
  }
  if (String(row.registry_state ?? '') !== 'active') {
    return fail(
      'DOCUMENT_NOT_ACTIVE',
      'Application document is not active',
      409,
      requestId
    );
  }

  // The registry-bound file id is parsed only after kind/state/binding
  // authority is established.
  const fileId = parseFileId(objectKey);
  if (!fileId) return fail('INVALID_OBJECT_KEY', 'Invalid storage object key', 400, requestId);

  // Reviewer document.read audit is the last gate before streaming: a failed
  // audit fails closed and no bytes are served. Applicant reads stay
  // unaudited for MVP.
  if (authorization.auditRead) {
    const auditError = await authorization.auditRead();
    if (auditError) return auditError;
  }

  return streamDriveFile(env, fileId, documentId, requestId);
}
