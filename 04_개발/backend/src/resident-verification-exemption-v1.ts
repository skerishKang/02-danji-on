import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import type { CoreEnv } from './core-v1';
import { resolvePadiemAuthority } from './padiem-authority-v1';
import { resolveOrdinaryTestResidentExemption } from './resident-verification-ordinary-exemption-v1';

type Sql = NeonQueryFunction<false, false>;

const REQUEST_ID_HEADER = 'x-danjion-request-id';
export const RESIDENT_VERIFICATION_EXEMPTION_PATH = '/api/v1/me/resident-verification-exemption';
export const RESIDENT_VERIFICATION_EXEMPT_SCOPE = 'resident.verification.exempt';

function ok(exempt: boolean, requestId: string): Response {
  return Response.json(
    { data: { exempt }, requestId },
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
 * Self-only, read-only resident-verification exemption probe (#656).
 *
 * This endpoint intentionally does NOT use the audited administrator-authority
 * decision path. My Info needs one boolean for the signed-in actor; it does not
 * need the actor's administrator tier or scope list. Ordinary residents therefore
 * receive { exempt:false } without creating an audit_events row from routine page
 * navigation.
 *
 * Exemption remains fail-closed and server-derived: wildcard '*' alone is never
 * sufficient. Only the actor's exact active resident.verification.exempt grant
 * returns true.
 */
export async function resolveResidentVerificationExemptionResponse(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response> {
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  try {
    const authority = await resolvePadiemAuthority(sql, actor.id);
    if (authority.scopes.includes(RESIDENT_VERIFICATION_EXEMPT_SCOPE)) {
      return ok(true, requestId);
    }
    // #823: the ordinary test-resident allowlist is a fallback of the same
    // exact-scope decision, never a new authority source.
    return ok(await resolveOrdinaryTestResidentExemption(sql, actor), requestId);
  } catch {
    return fail(
      'RESIDENT_VERIFICATION_EXEMPTION_DB_ERROR',
      'Resident-verification exemption could not be verified',
      503,
      requestId
    );
  }
}

export async function handleResidentVerificationExemptionRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  if (new URL(request.url).pathname !== RESIDENT_VERIFICATION_EXEMPTION_PATH) return null;
  if (!env.DATABASE_URL) {
    return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
  }

  const sql: Sql = neon(env.DATABASE_URL);
  return resolveResidentVerificationExemptionResponse(request, env, sql, requestId);
}
