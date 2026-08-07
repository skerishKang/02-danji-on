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
      if (row) {
        return {
          id: String(row.id),
          authUserId: String(row.auth_user_id),
          displayName: String(row.display_name)
        };
      }
    }
  }
  if (request.headers.has('authorization')) {
    return fail('AUTH_ADAPTER_PENDING', 'Neon Auth server adapter is not configured yet', 501, requestId);
  }
  return fail('AUTH_REQUIRED', 'Authentication required', 401, requestId);
}

async function bodyJson(request: Request, requestId: string): Promise<Record<string, unknown> | Response> {
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return fail('INVALID_JSON', 'JSON object required', 400, requestId);
    }
    return payload as Record<string, unknown>;
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
}

export async function handleResidentApplicationRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'PATCH') return null;
  const match = new URL(request.url).pathname.match(/^\/api\/v1\/me\/business-applications\/([0-9a-fA-F-]+)$/);
  if (!match) return null;

  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
  const sql: Sql = neon(env.DATABASE_URL);
  const actorOrResponse = await actorFromRequest(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;

  const relationType = String(payload.relationType ?? '').trim();
  const businessName = String(payload.businessName ?? '').trim();
  const categoryName = String(payload.categoryName ?? '').trim();
  const serviceSummary = String(payload.serviceSummary ?? '').trim();
  if (!['resident', 'resident_family', 'neighbor', 'local'].includes(relationType)) {
    return fail('VALIDATION_ERROR', 'Invalid relationType', 400, requestId);
  }
  if (!businessName || !categoryName || !serviceSummary) {
    return fail('VALIDATION_ERROR', 'businessName, categoryName and serviceSummary are required', 400, requestId);
  }

  const applicationId = match[1];
  const rows = await sql`
    update business_applications a
    set relation_type = ${relationType},
        business_name = ${businessName},
        category_name = ${categoryName},
        service_summary = ${serviceSummary},
        price_text = ${String(payload.priceText ?? '').trim() || null},
        contact_method = ${String(payload.contactMethod ?? '').trim() || null},
        service_area = ${String(payload.serviceArea ?? '').trim() || null},
        benefit_text = ${String(payload.benefitText ?? '').trim() || null},
        availability_text = ${String(payload.availabilityText ?? '').trim() || null},
        representative_image_object_key = ${String(payload.representativeImageObjectKey ?? '').trim() || null},
        status = 'pending',
        reviewed_by = null,
        reviewed_at = null
    where a.id = ${applicationId}::uuid
      and a.applicant_user_id = ${actor.id}::uuid
      and a.status = 'changes_requested'
    returning a.id, a.relation_type, a.business_name, a.category_name,
              a.service_summary, a.status, a.review_note,
              a.approved_business_id, a.created_at, a.updated_at
  `;
  if (rows[0]) return ok(rows[0], requestId);

  const current = await sql`
    select id, applicant_user_id, status
    from business_applications
    where id = ${applicationId}::uuid
    limit 1
  `;
  if (!current[0]) return fail('NOT_FOUND', 'Business application not found', 404, requestId);
  if (String(current[0].applicant_user_id) !== actor.id) {
    return fail('FORBIDDEN', 'Only the applicant can resubmit this application', 403, requestId);
  }
  return fail('CONFLICT', 'Only changes_requested applications can be resubmitted', 409, requestId);
}
