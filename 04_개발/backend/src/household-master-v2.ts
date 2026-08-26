import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type AuthEnv } from './auth-v1';

type Sql = NeonQueryFunction<false, false>;
export type HouseholdMasterEnv = AuthEnv;

const REQUEST_ID_HEADER = 'x-danjion-request-id';

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

function ok(data: unknown, requestId: string): Response {
  return json({ data, requestId }, 200, requestId);
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}

function sqlFor(env: HouseholdMasterEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

function decodeSlug(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw).trim();
    return decoded.length >= 1 && decoded.length <= 120 && /^[a-z0-9][a-z0-9-]*$/.test(decoded)
      ? decoded
      : null;
  } catch {
    return null;
  }
}

export async function handleHouseholdUnitMasterWithSql(
  request: Request,
  env: HouseholdMasterEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/v1\/complexes\/([^/]+)\/household\/units$/);
  if (!match) return null;
  if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);

  const complexSlug = decodeSlug(match[1]);
  if (!complexSlug) return fail('INVALID_COMPLEX_SLUG', 'Invalid complex slug', 400, requestId);

  // Pre-verification onboarding read: authenticated account only. This endpoint
  // deliberately does not infer or grant resident status from dong/unit selection.
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;

  const complexes = await sql`
    select id, slug, name
    from complexes
    where slug = ${complexSlug}
      and status in ('active', 'pilot')
    limit 1
  `;
  const complex = complexes[0];
  if (!complex) return fail('NOT_FOUND', 'Complex not found', 404, requestId);

  const rows = await sql`
    select id, building_code, unit_code
    from complex_units
    where complex_id = ${String(complex.id)}::uuid
      and status = 'active'
    order by building_code asc, unit_code asc
  `;

  return ok({
    complex: { slug: String(complex.slug), name: String(complex.name) },
    units: rows.map((row) => ({
      id: String(row.id),
      buildingCode: String(row.building_code),
      unitCode: String(row.unit_code)
    }))
  }, requestId);
}

export async function handleHouseholdUnitMasterRequest(
  request: Request,
  env: HouseholdMasterEnv,
  requestId: string
): Promise<Response | null> {
  if (!/^\/api\/v1\/complexes\/[^/]+\/household\/units$/.test(new URL(request.url).pathname)) return null;
  return handleHouseholdUnitMasterWithSql(request, env, sqlFor(env), requestId);
}
