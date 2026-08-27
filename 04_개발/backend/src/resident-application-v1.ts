import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

function ok(data: unknown, requestId: string, status = 200): Response {
  return Response.json(
    { data, requestId },
    { status, headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' } }
  );
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return Response.json(
    { error: { code, message }, requestId },
    { status, headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' } }
  );
}

async function applicationSelect(sql: Sql, applicationId: string, actorId: string) {
  return sql`
    select a.id, c.slug as complex_slug, a.relation_type, a.business_name,
           a.category_name, a.service_summary, a.price_text, a.contact_method,
           a.service_area, a.benefit_text, a.availability_text,
           a.representative_image_object_key, a.status, a.review_note,
           a.approved_business_id, a.submission_key, a.created_at, a.updated_at
    from business_applications a
    join complexes c on c.id = a.complex_id
    where a.id = ${applicationId}::uuid
      and a.applicant_user_id = ${actorId}::uuid
    limit 1
  `;
}

export async function handleResidentApplicationRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const detailMatch = request.method === 'GET'
    ? path.match(/^\/api\/v1\/me\/business-applications\/([0-9a-fA-F-]+)$/)
    : null;
  if (!detailMatch) return null;

  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
  const sql: Sql = neon(env.DATABASE_URL);
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;

  const rows = await applicationSelect(sql, detailMatch[1], actorOrResponse.id);
  if (!rows[0]) return fail('NOT_FOUND', 'Business application not found', 404, requestId);
  return ok(rows[0], requestId);
}
