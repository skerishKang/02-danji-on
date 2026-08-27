import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

function ok(data: unknown, requestId: string, status = 200): Response {
  return Response.json({ data, requestId }, {
    status,
    headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' }
  });
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return Response.json({ error: { code, message }, requestId }, {
    status,
    headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' }
  });
}

export async function handleBenefitWalletRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const listMatch = request.method === 'GET' && path === '/api/v1/me/benefits';
  const useMatch = request.method === 'PATCH'
    ? path.match(/^\/api\/v1\/me\/benefits\/([0-9a-fA-F-]+)\/use$/)
    : null;
  if (!listMatch && !useMatch) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const sql: Sql = neon(env.DATABASE_URL);
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;

  if (listMatch) {
    const rows = await sql`
      select bc.id, bc.benefit_id, bc.claim_code, bc.status, bc.claimed_at, bc.used_at,
             be.title, be.description, be.conditions,
             b.id as business_id, b.name as business_name,
             c.slug as complex_slug, c.name as complex_name
      from benefit_claims bc
      join benefits be on be.id = bc.benefit_id
      join businesses b on b.id = be.business_id
      join complexes c on c.id = bc.complex_id
      where bc.user_id = ${actor.id}::uuid
      order by bc.claimed_at desc
    `;
    return ok(rows, requestId);
  }

  const benefitId = useMatch![1];
  const updated = await sql`
    update benefit_claims
    set status = 'used', used_at = coalesce(used_at, now())
    where user_id = ${actor.id}::uuid
      and benefit_id = ${benefitId}::uuid
      and status = 'stored'
    returning id, benefit_id, claim_code, status, claimed_at, used_at
  `;
  if (updated[0]) return ok(updated[0], requestId);

  const existing = await sql`
    select id, benefit_id, claim_code, status, claimed_at, used_at
    from benefit_claims
    where user_id = ${actor.id}::uuid and benefit_id = ${benefitId}::uuid
    limit 1
  `;
  if (!existing[0]) return fail('NOT_FOUND', 'Benefit claim not found', 404, requestId);
  return ok(existing[0], requestId);
}
