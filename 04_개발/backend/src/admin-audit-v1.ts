import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

function ok(data: unknown, requestId: string): Response {
  return Response.json(
    { data, requestId },
    { status: 200, headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' } }
  );
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return Response.json(
    { error: { code, message }, requestId },
    { status, headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' } }
  );
}

async function managerComplex(sql: Sql, actorId: string, complexSlug: string, requestId: string) {
  const rows = await sql`
    select c.id as complex_id
    from complex_memberships m
    join complexes c on c.id = m.complex_id
    where m.user_id = ${actorId}::uuid
      and c.slug = ${complexSlug}
      and m.role in ('manager','admin')
      and m.verification_status = 'verified'
    limit 1
  `;
  if (!rows[0]) return fail('FORBIDDEN', 'Manager or admin membership required', 403, requestId);
  return rows[0];
}

function clampLimit(value: string | null) {
  const parsed = Number(value ?? 100);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(Math.max(Math.trunc(parsed), 1), 200);
}

function validOptionalUuid(value: string | null) {
  return !value || /^[0-9a-fA-F-]{36}$/.test(value);
}

export async function handleAdminAuditRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/v1\/admin\/complexes\/([^/]+)\/application-review-events$/);
  if (!match) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const applicationId = url.searchParams.get('applicationId')?.trim() || null;
  if (!validOptionalUuid(applicationId)) {
    return fail('VALIDATION_ERROR', 'applicationId must be a UUID', 400, requestId);
  }
  const limit = clampLimit(url.searchParams.get('limit'));
  const complexSlug = decodeURIComponent(match[1]);
  const sql: Sql = neon(env.DATABASE_URL);
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;
  const manager = await managerComplex(sql, actor.id, complexSlug, requestId);
  if (manager instanceof Response) return manager;

  const rows = await sql`
    select e.id, e.application_id, e.actor_type,
           coalesce(u.display_name, case e.actor_type when 'system' then '시스템' else '사용자' end) as actor_name,
           e.from_status, e.to_status, e.review_note, e.created_at,
           a.business_name, a.category_name
    from business_application_review_events e
    join business_applications a on a.id = e.application_id
    left join app_users u on u.id = e.actor_user_id
    where e.complex_id = ${String(manager.complex_id)}::uuid
      and (${applicationId}::text is null or e.application_id = ${applicationId}::uuid)
    order by e.created_at desc
    limit ${limit}
  `;
  return ok(rows, requestId);
}
