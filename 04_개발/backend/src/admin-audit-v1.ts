import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { CoreEnv } from './core-v1';
import { requireOperationalAuthority } from './operational-authz-v2';

type Sql = NeonQueryFunction<false, false>;

const BUSINESS_REVIEW_SCOPE = 'business.review';
const COUNCIL_BUSINESS_REVIEW_SCOPE = 'council.business.review';

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
  const operator = await requireOperationalAuthority(
    request,
    env,
    sql,
    requestId,
    complexSlug,
    BUSINESS_REVIEW_SCOPE,
    COUNCIL_BUSINESS_REVIEW_SCOPE
  );
  if (operator instanceof Response) return operator;

  const rows = await sql`
    select e.id, e.application_id, e.actor_type,
           coalesce(u.display_name, case e.actor_type when 'system' then '시스템' else '사용자' end) as actor_name,
           e.from_status, e.to_status, e.review_note, e.created_at,
           a.business_name, a.category_name
    from business_application_review_events e
    join business_applications a on a.id = e.application_id
    left join app_users u on u.id = e.actor_user_id
    where e.complex_id = ${operator.complexId}::uuid
      and (${applicationId}::text is null or e.application_id = ${applicationId}::uuid)
    order by e.created_at desc
    limit ${limit}
  `;
  return ok(rows, requestId);
}
