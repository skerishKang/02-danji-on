import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { CoreEnv } from './core-v1';
import { requireActor, type Actor } from './auth-v1';
import { requireOperationalAuthority } from './operational-authz-v2';

type Sql = NeonQueryFunction<false, false>;

type DriveEnv = CoreEnv & {
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_REFRESH_TOKEN?: string;
};

type Env = CoreEnv & DriveEnv;

const BUSINESS_REVIEW_SCOPE = 'business.review';
const COUNCIL_BUSINESS_REVIEW_SCOPE = 'council.business.review';
const REQUEST_ID_HEADER = 'x-danjion-request-id';
const OBJECT_KEY_PREFIX = 'gdrive/private/application-document/';

// APPLICANT (GET /api/v1/me/...): owner may re-open their own evidence in every
// terminal and non-terminal state, including rejected.
const APPLICANT_ALLOWED_STATUSES = ['pending', 'changes_requested', 'approved', 'rejected'];
// REVIEWER (GET /api/v1/admin/...): rejected applications are out of review
// scope, so reviewers are denied even with a valid grant.
const REVIEWER_ALLOWED_STATUSES = ['pending', 'changes_requested', 'approved'];

const ME_DOCUMENT_ROUTE =
  /^\/api\/v1\/me\/business-applications\/([0-9a-fA-F-]+)\/documents\/([0-9a-fA-F-]+)$/;
const ADMIN_DOCUMENT_ROUTE =
  /^\/api\/v1\/admin\/business-applications\/([0-9a-fA-F-]+)\/documents\/([0-9a-fA-F-]+)$/;
// Malformed ids fail closed with the same non-disclosing 404 as a missing
// document, before any query runs (raw ids must never reach ::uuid casts).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DocumentRow = {
  object_key: string;
  complex_slug: string;
  applicant_user_id: string;
  application_status: string;
  registry_state: string | null;
  registry_kind: string | null;
};

function json(data: unknown, status: number, requestId: string, extraHeaders: HeadersInit = {}): Response {
  const headers = new Headers(extraHeaders);
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set('cache-control', 'no-store');
  headers.set('access-control-expose-headers', REQUEST_ID_HEADER);
  return Response.json(data, { status, headers });
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}

// Reviewer access must be audit-logged with action='document.read'. Audit
// failure fails closed: the document is not served without a durable record.
// Applicant access is intentionally unaudited for MVP (optional).
async function auditReviewerDocumentRead(
  sql: Sql,
  actor: Actor,
  requestId: string,
  complexSlug: string,
  applicationId: string,
  documentId: string,
  actorRole: string
): Promise<Response | null> {
  try {
    await sql`
      insert into audit_events (
        request_id, actor_user_id, actor_kind, complex_id, action, scope, decision, reason_code, metadata
      ) values (
        ${requestId},
        ${actor.id},
        'operator',
        (select id from complexes where slug = ${complexSlug} limit 1),
        'document.read',
        ${actorRole},
        'allowed',
        'DOCUMENT_ACCESS_GRANTED',
        ${JSON.stringify({ application_id: applicationId, document_id: documentId, actor_role: actorRole })}::jsonb
      )
    `;
  } catch {
    return fail(
      'AUDIT_UNAVAILABLE',
      'Document access could not be audit-logged',
      503,
      requestId
    );
  }
  return null;
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

async function serveDocument(
  request: Request,
  env: Env,
  sql: Sql,
  requestId: string,
  routeScope: 'me' | 'admin',
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

  const complexSlug = String(row.complex_slug);
  const applicantUserId = String(row.applicant_user_id);
  const applicationStatus = String(row.application_status ?? '');

  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  let reviewerScope: string | null = null;
  if (routeScope === 'me') {
    // Unrelated applicants get a non-disclosing 404, identical to a missing
    // document, so document existence is never oracle-able across owners.
    if (actor.id !== applicantUserId) {
      return fail('NOT_FOUND', 'Application document not found', 404, requestId);
    }
    if (!APPLICANT_ALLOWED_STATUSES.includes(applicationStatus)) {
      return fail('DOCUMENT_ACCESS_DENIED', 'Document is not accessible in current application state', 403, requestId);
    }
  } else {
    if (!REVIEWER_ALLOWED_STATUSES.includes(applicationStatus)) {
      return fail('DOCUMENT_ACCESS_DENIED', 'Document is not available for review in current application state', 403, requestId);
    }
    // Complex binding is enforced inside requireOperationalAuthority: a grant
    // for another complex denies access here (cross-complex denial).
    const authority = await requireOperationalAuthority(
      request,
      env,
      sql,
      requestId,
      complexSlug,
      BUSINESS_REVIEW_SCOPE,
      COUNCIL_BUSINESS_REVIEW_SCOPE
    );
    if (authority instanceof Response) return authority;
    reviewerScope = authority.authorityKind === 'padiem' ? 'business.review' : 'council.business.review';
  }

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
  if (reviewerScope !== null) {
    const auditError = await auditReviewerDocumentRead(
      sql, actor, requestId, complexSlug, applicationId, documentId, reviewerScope
    );
    if (auditError) return auditError;
  }

  return streamDriveFile(env, fileId, documentId, requestId);
}

export async function handleResidentApplicationDocumentWithSql(
  request: Request,
  env: Env,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const match = new URL(request.url).pathname.match(ME_DOCUMENT_ROUTE);
  if (!match) return null;
  if (!UUID.test(match[1]) || !UUID.test(match[2])) {
    return fail('NOT_FOUND', 'Application document not found', 404, requestId);
  }
  return serveDocument(request, env, sql, requestId, 'me', match[1].toLowerCase(), match[2].toLowerCase());
}

export async function handleResidentApplicationDocumentRequest(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const match = new URL(request.url).pathname.match(ME_DOCUMENT_ROUTE);
  if (!match) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
  return handleResidentApplicationDocumentWithSql(request, env, neon(env.DATABASE_URL), requestId);
}

export async function handleAdminApplicationDocumentWithSql(
  request: Request,
  env: Env,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const match = new URL(request.url).pathname.match(ADMIN_DOCUMENT_ROUTE);
  if (!match) return null;
  if (!UUID.test(match[1]) || !UUID.test(match[2])) {
    return fail('NOT_FOUND', 'Application document not found', 404, requestId);
  }
  return serveDocument(request, env, sql, requestId, 'admin', match[1].toLowerCase(), match[2].toLowerCase());
}

export async function handleAdminApplicationDocumentRequest(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const match = new URL(request.url).pathname.match(ADMIN_DOCUMENT_ROUTE);
  if (!match) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
  return handleAdminApplicationDocumentWithSql(request, env, neon(env.DATABASE_URL), requestId);
}
