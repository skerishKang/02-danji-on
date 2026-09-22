import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type AuthEnv } from './auth-v1';

// Issue #861 [회원 탈퇴 mock 제거 / Backend API].
// The settings screen used to answer 회원 탈퇴 with a demo toast. This endpoint
// accepts a real deletion *request* and records it as 'pending'.
//
// Boundary (intentionally narrow):
//   * authenticated caller only; the stored user id is always the actor's own id
//   * insert-only into account_deletion_requests
//   * it never deletes, closes, or anonymizes an account or app_users row
//   * at most one pending request per user

type Sql = NeonQueryFunction<false, false>;
export type AccountDeletionRequestEnv = AuthEnv;

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const MAX_BODY_BYTES = 8 * 1024;
const MAX_REASON_LENGTH = 500;
const DELETION_REQUEST_PATH = '/api/v1/me/account-deletion-request';
const PENDING_STATUS = 'pending';
const DUPLICATE_CODE = 'DELETION_REQUEST_ALREADY_PENDING';
const DUPLICATE_MESSAGE = 'A pending account deletion request already exists';

function json(data: unknown, status: number, requestId: string): Response {
  return Response.json(data, {
    status,
    headers: {
      [REQUEST_ID_HEADER]: requestId,
      'access-control-expose-headers': REQUEST_ID_HEADER,
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

function sqlFor(env: AccountDeletionRequestEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return code === '23505';
}

// The body is optional. Only an optional `reason` string is accepted; every other
// field is rejected so a caller can never smuggle a user id or a status override.
async function readOptionalReason(request: Request, requestId: string): Promise<string | null | Response> {
  const text = await request.text();
  if (!text) return null;

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return fail('CONTENT_TYPE_REQUIRED', 'application/json required', 415, requestId);
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('INVALID_JSON', 'JSON object required', 400, requestId);
  }

  const body = parsed as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== 'reason')) {
    return fail('VALIDATION_ERROR', 'Only reason is accepted', 400, requestId);
  }
  if (body.reason === undefined || body.reason === null) return null;
  if (typeof body.reason !== 'string') {
    return fail('VALIDATION_ERROR', 'reason must be a string', 400, requestId);
  }
  const reason = body.reason.trim();
  if (reason.length > MAX_REASON_LENGTH) {
    return fail('VALIDATION_ERROR', `reason must be ${MAX_REASON_LENGTH} characters or fewer`, 400, requestId);
  }
  return reason || null;
}

async function createDeletionRequest(
  request: Request,
  sql: Sql,
  userId: string,
  requestId: string
): Promise<Response> {
  const reasonOrResponse = await readOptionalReason(request, requestId);
  if (reasonOrResponse instanceof Response) return reasonOrResponse;
  const reason = reasonOrResponse;

  // Insert-only. The partial unique index from migration 059 is the race guard and
  // the not-exists guard turns the ordinary duplicate case into a clean 409.
  try {
    const rows = await sql`
      insert into account_deletion_requests (user_id, status, requested_at, reason)
      select ${userId}::uuid, ${PENDING_STATUS}, now(), ${reason}
      where not exists (
        select 1 from account_deletion_requests
        where user_id = ${userId}::uuid and status = ${PENDING_STATUS}
      )
      returning id, status, requested_at
    `;
    const row = rows[0];
    if (!row) return fail(DUPLICATE_CODE, DUPLICATE_MESSAGE, 409, requestId);

    return ok({
      request: {
        id: String(row.id),
        status: String(row.status),
        requestedAt: row.requested_at,
        reason
      }
    }, requestId, 201);
  } catch (error) {
    if (isUniqueViolation(error)) return fail(DUPLICATE_CODE, DUPLICATE_MESSAGE, 409, requestId);
    throw error;
  }
}

export async function handleAccountDeletionRequestWithSql(
  request: Request,
  env: AccountDeletionRequestEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  if (new URL(request.url).pathname !== DELETION_REQUEST_PATH) return null;
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);

  // Authentication boundary: only the authenticated caller's own id is ever used.
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;

  return createDeletionRequest(request, sql, actor.id, requestId);
}

export async function handleAccountDeletionRequest(
  request: Request,
  env: AccountDeletionRequestEnv,
  requestId: string
): Promise<Response | null> {
  if (new URL(request.url).pathname !== DELETION_REQUEST_PATH) return null;
  return handleAccountDeletionRequestWithSql(request, env, sqlFor(env), requestId);
}
