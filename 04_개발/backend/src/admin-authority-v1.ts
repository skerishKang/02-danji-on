import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import type { CoreEnv } from './core-v1';
import { padiemAuthorityResponseData, recordAuthorityDecision, resolvePadiemAuthority } from './padiem-authority-v1';

type Sql = NeonQueryFunction<false, false>;

const REQUEST_ID_HEADER = 'x-danjion-request-id';

const AUTHORITY_READ_SCOPE = 'admin.authority.read';

function ok(data: unknown, requestId: string): Response {
  return Response.json(
    { data, requestId },
    {
      status: 200,
      headers: {
        [REQUEST_ID_HEADER]: requestId,
        'access-control-expose-headers': REQUEST_ID_HEADER,
        'cache-control': 'no-store'
      }
    }
  );
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return Response.json(
    { error: { code, message }, requestId },
    {
      status,
      headers: {
        [REQUEST_ID_HEADER]: requestId,
        'access-control-expose-headers': REQUEST_ID_HEADER,
        'cache-control': 'no-store'
      }
    }
  );
}

/**
 * Read-only PADIEM authority profile for the admin console (#411, consumed by #412).
 *
 * GET /api/v1/admin/authority ->
 *   { data: { level: 'admin' | 'operator', label: '최고관리자 | 일반관리자',
 *             scopes: string[], wildcard: boolean }, requestId }
 *
 * Unauthenticated callers receive requireActor's 401 response. Authenticated
 * callers without any active PADIEM grant are denied (403, fail-closed). The
 * response never contains contact addresses or grant identifiers.
 */
export async function resolveAdminAuthorityResponse(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response> {
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  try {
    const authority = await resolvePadiemAuthority(sql, actor.id);
    if (authority.level === 'none') {
      await recordAuthorityDecision(sql, actor, requestId, AUTHORITY_READ_SCOPE, 'denied', 'NO_ACTIVE_PADIEM_GRANT', null);
      return fail('ADMIN_AUTHORITY_REQUIRED', 'Active PADIEM operator grant required', 403, requestId);
    }
    await recordAuthorityDecision(
      sql,
      actor,
      requestId,
      AUTHORITY_READ_SCOPE,
      'allowed',
      authority.wildcard ? 'AUTHORITY_SUPER_ADMIN' : 'AUTHORITY_OPERATOR',
      authority.wildcard ? '*' : null
    );
    return ok(padiemAuthorityResponseData(authority), requestId);
  } catch {
    await recordAuthorityDecision(sql, actor, requestId, AUTHORITY_READ_SCOPE, 'denied', 'AUTHORITY_DATABASE_ERROR', null).catch(() => {});
    return fail('AUTHORITY_DB_ERROR', 'Authorization could not be verified', 503, requestId);
  }
}

export async function handleAdminAuthorityRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.pathname !== '/api/v1/admin/authority') return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const sql: Sql = neon(env.DATABASE_URL);
  return resolveAdminAuthorityResponse(request, env, sql, requestId);
}
