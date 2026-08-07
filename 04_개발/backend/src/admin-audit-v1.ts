import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;
type Actor = { id: string; authUserId: string; displayName: string };

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

async function actorFromRequest(request: Request, env: CoreEnv, sql: Sql, requestId: string): Promise<Actor | Response> {
  if (env.APP_ENV !== 'production' && env.DEV_AUTH_BYPASS === 'true') {
    const subject = request.headers.get('x-danjion-dev-auth-user')?.trim();
    if (subject) {
      const rows = await sql`
        select id, auth_user_id, display_name
        from app_users
        where auth_user_id = ${subject}
        limit 1
      `;
      const row = rows[0];
      if (row) return { id: String(row.id), authUserId: String(row.auth_user_id), displayName: String(row.display_name) };
    }
  }
  if (request.headers.has('authorization')) {
    return fail('AUTH_ADAPTER_PENDING', 'Neon Auth server adapter is not configured yet', 501, requestId);
  }
  return fail('AUTH_REQUIRED', 'Authentication required', 401, requestId);
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
  const actorOrResponse = await actorFromRequest(request, env, sql, requestId);
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
