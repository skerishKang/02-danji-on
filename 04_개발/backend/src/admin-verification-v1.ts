import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

function fail(code: string, message: string, status: number, requestId: string): Response {
  return Response.json({ error: { code, message }, requestId }, {
    status,
    headers: {
      'x-danjion-request-id': requestId,
      'access-control-expose-headers': 'x-danjion-request-id',
      'cache-control': 'no-store'
    }
  });
}

/**
 * Resident-verification administration is intentionally fail-closed.
 *
 * Product policy #59 has not selected a resident-verification provider or
 * established the legal/data-access basis for exposing resident evidence to
 * PADIEM, the resident council, or any management-office role. Matching
 * private routes therefore authenticate the caller and disclose no resident
 * verification records until that policy gate is explicitly resolved.
 */
export async function handleAdminVerificationRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const listMatch = url.pathname.match(/^\/api\/v1\/admin\/complexes\/([^/]+)\/resident-verifications$/);
  const patchMatch = url.pathname.match(/^\/api\/v1\/admin\/resident-verifications\/([0-9a-fA-F-]+)$/);
  if ((!listMatch || request.method !== 'GET') && (!patchMatch || request.method !== 'PATCH')) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const sql: Sql = neon(env.DATABASE_URL);
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;

  return fail(
    'RESIDENT_VERIFICATION_POLICY_HOLD',
    'Resident verification administration is unavailable until the verification and privacy policy is approved',
    503,
    requestId
  );
}
