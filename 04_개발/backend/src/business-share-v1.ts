import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPLEX_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const SHARE_SLUG = /^[a-z0-9][a-z0-9-]{7,63}$/;

function ok(data: unknown, requestId: string): Response {
  return Response.json({ data, requestId }, {
    status: 200,
    headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' }
  });
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return Response.json({ error: { code, message }, requestId }, {
    status,
    headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' }
  });
}

function sqlFor(env: CoreEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

function mapResolver(row: Record<string, unknown>) {
  return {
    businessId: String(row.business_id),
    shareSlug: String(row.share_slug)
  };
}

export async function handleBusinessShareWithSql(
  request: Request,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const byId = path.match(/^\/api\/v1\/complexes\/([^/]+)\/businesses\/([0-9a-fA-F-]+)\/share$/);
  const byShare = path.match(/^\/api\/v1\/complexes\/([^/]+)\/businesses\/share\/([^/]+)$/);
  if (!byId && !byShare) return null;
  if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);

  const complexSlug = decodeURIComponent((byId ?? byShare)![1]).trim();
  if (!COMPLEX_SLUG.test(complexSlug)) {
    return fail('VALIDATION_ERROR', 'Invalid apartment complex', 400, requestId);
  }

  if (byId) {
    const businessId = byId[2].toLowerCase();
    if (!UUID.test(businessId)) return fail('VALIDATION_ERROR', 'Invalid business id', 400, requestId);
    const rows = await sql`
      select r.business_id, r.share_slug
      from business_complex_relations r
      join businesses b on b.id = r.business_id
      join complexes c on c.id = r.complex_id
      where c.slug = ${complexSlug}
        and c.status in ('active','pilot')
        and r.business_id = ${businessId}::uuid
        and r.verification_status = 'verified'
        and b.status = 'approved'
      limit 1
    `;
    if (!rows[0]) return fail('NOT_FOUND', 'Business share link not found', 404, requestId);
    return ok(mapResolver(rows[0] as Record<string, unknown>), requestId);
  }

  const shareSlug = decodeURIComponent(byShare![2]).trim().toLowerCase();
  if (!SHARE_SLUG.test(shareSlug)) return fail('VALIDATION_ERROR', 'Invalid share slug', 400, requestId);
  const rows = await sql`
    select r.business_id, r.share_slug
    from business_complex_relations r
    join businesses b on b.id = r.business_id
    join complexes c on c.id = r.complex_id
    where c.slug = ${complexSlug}
      and c.status in ('active','pilot')
      and r.share_slug = ${shareSlug}
      and r.verification_status = 'verified'
      and b.status = 'approved'
    limit 1
  `;
  if (!rows[0]) return fail('NOT_FOUND', 'Business share link not found', 404, requestId);
  return ok(mapResolver(rows[0] as Record<string, unknown>), requestId);
}

export async function handleBusinessShareRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.includes('/businesses/') || !path.includes('/share')) return null;
  return handleBusinessShareWithSql(request, sqlFor(env), requestId);
}
