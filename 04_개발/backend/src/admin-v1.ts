import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

const REQUEST_ID_HEADER = 'x-danjion-request-id';

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
 * Terminal gate for unowned /api/v1/admin/* routes (#372 D1/D7, #375 F9).
 *
 * The six legacy operational admin handlers (application list/review,
 * official posts, benefits) were provably dead: admin-operational-v2 is
 * dispatched earlier in app.ts and returns non-null for all six
 * method×path combos (see admin-operational-rbac-contract.mjs). The legacy
 * manager-membership authorization generation (D7) went with them —
 * operational authority is operational-authz-v2 only.
 *
 * Live behavior preserved exactly: unauthenticated callers to any
 * /api/v1/admin/* path that no other admin module owns receive requireActor's
 * auth response; authenticated callers receive the terminal 404.
 */
export async function handleAdminRequest(request: Request, env: CoreEnv, requestId: string): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/v1/admin/')) return null;

  const sql: Sql = neon(env.DATABASE_URL);
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  return fail('NOT_FOUND', 'Admin route not found', 404, requestId);
}
