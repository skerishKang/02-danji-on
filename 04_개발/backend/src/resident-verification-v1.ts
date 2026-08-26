import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

function fail(code: string, message: string, status: number, requestId: string): Response {
  return Response.json({ error: { code, message }, requestId }, {
    status,
    headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' }
  });
}

/**
 * Self-service resident verification is intentionally fail-closed while
 * Issue #59 remains unresolved.
 *
 * The historical endpoint used legacy complex_memberships state, accepted
 * provider-like verification methods, collected exact building/unit data and
 * evidence object keys, and mutated verification status. None of those are
 * current authorization or verification-policy authority.
 *
 * We keep only the account-authentication boundary so an anonymous caller does
 * not receive policy-state information through a protected route. After a
 * valid DanjiOn account is resolved, both GET and POST disclose/mutate nothing
 * and return the same explicit policy HOLD response.
 */
export async function handleResidentVerificationRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(/^\/api\/v1\/me\/complexes\/([^/]+)\/resident-verification$/);
  if (!match || !['GET', 'POST'].includes(request.method)) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const sql: Sql = neon(env.DATABASE_URL);
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;

  return fail(
    'RESIDENT_VERIFICATION_POLICY_HOLD',
    'Resident verification is unavailable until the verification and privacy policy is approved',
    503,
    requestId
  );
}
