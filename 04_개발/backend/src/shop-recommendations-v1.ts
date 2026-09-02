import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import { requireVerifiedResident } from './authorization-v2';
import { requireOperationalAuthority } from './operational-authz-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

type RecommendationInput = {
  complexSlug: string;
  relationType: 'resident_family' | 'neighbor' | 'local';
  businessName: string;
  categoryName: string;
  serviceSummary: string;
  serviceArea: string | null;
  reporterNote: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPLEX_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const RELATIONS = new Set(['resident_family', 'neighbor', 'local']);
const REVIEW_STATES = new Set(['changes_requested', 'approved', 'rejected']);
const MAX_BODY_BYTES = 32 * 1024;

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

function sqlFor(env: CoreEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

async function bodyJson(request: Request, requestId: string): Promise<Record<string, unknown> | Response> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return fail('CONTENT_TYPE_REQUIRED', 'application/json required', 415, requestId);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  }
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fail('INVALID_JSON', 'JSON object required', 400, requestId);
    }
    return parsed as Record<string, unknown>;
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
}

function stringOrNull(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function recommendationInput(payload: Record<string, unknown>, forcedComplexSlug?: string): RecommendationInput | null {
  const complexSlug = (forcedComplexSlug ?? String(payload.complexSlug ?? '')).trim();
  const relationType = String(payload.relationType ?? '').trim();
  const businessName = String(payload.businessName ?? '').trim();
  const categoryName = String(payload.categoryName ?? '').trim();
  const serviceSummary = String(payload.serviceSummary ?? '').trim();
  const serviceArea = stringOrNull(payload.serviceArea);
  const reporterNote = stringOrNull(payload.reporterNote);
  if (!COMPLEX_SLUG.test(complexSlug) || !RELATIONS.has(relationType)) return null;
  if (businessName.length < 1 || businessName.length > 160) return null;
  if (categoryName.length < 1 || categoryName.length > 120) return null;
  if (serviceSummary.length < 1 || serviceSummary.length > 1000) return null;
  if (serviceArea && serviceArea.length > 300) return null;
  if (reporterNote && reporterNote.length > 1000) return null;
  return {
    complexSlug,
    relationType: relationType as RecommendationInput['relationType'],
    businessName,
    categoryName,
    serviceSummary,
    serviceArea,
    reporterNote
  };
}

function mapRecommendation(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    relationType: String(row.relation_type),
    businessName: String(row.business_name),
    categoryName: String(row.category_name),
    serviceSummary: String(row.service_summary),
    serviceArea: row.service_area ? String(row.service_area) : null,
    reporterNote: row.reporter_note ? String(row.reporter_note) : null,
    status: String(row.status),
    reviewNote: row.review_note ? String(row.review_note) : null,
    approvedBusinessId: row.approved_business_id ? String(row.approved_business_id) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listMine(request: Request, env: CoreEnv, sql: Sql, requestId: string, complexSlug: string): Promise<Response> {
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  const rows = await sql`
    select id, relation_type, business_name, category_name, service_summary,
           service_area, reporter_note, status, review_note, approved_business_id,
           created_at, updated_at
    from shop_recommendations
    where reporter_user_id = ${resident.id}::uuid
      and complex_id = ${resident.complexId}::uuid
    order by created_at desc, id desc
  `;
  return ok({ recommendations: rows.map((row) => mapRecommendation(row as Record<string, unknown>)) }, requestId);
}

async function createMine(request: Request, env: CoreEnv, sql: Sql, requestId: string): Promise<Response> {
  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const input = recommendationInput(payload);
  if (!input) return fail('VALIDATION_ERROR', 'Invalid shop recommendation', 400, requestId);
  const resident = await requireVerifiedResident(request, env, sql, requestId, input.complexSlug);
  if (resident instanceof Response) return resident;

  const rows = await sql`
    insert into shop_recommendations (
      complex_id, reporter_user_id, relation_type, business_name, category_name,
      service_summary, service_area, reporter_note
    ) values (
      ${resident.complexId}::uuid, ${resident.id}::uuid, ${input.relationType},
      ${input.businessName}, ${input.categoryName}, ${input.serviceSummary},
      ${input.serviceArea}, ${input.reporterNote}
    )
    returning id, relation_type, business_name, category_name, service_summary,
              service_area, reporter_note, status, review_note, approved_business_id,
              created_at, updated_at
  `;
  return ok(mapRecommendation(rows[0] as Record<string, unknown>), requestId, 201);
}

async function resubmitMine(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  recommendationId: string
): Promise<Response> {
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;
  const currentRows = await sql`
    select r.id, r.status, r.reporter_user_id, c.slug as complex_slug
    from shop_recommendations r
    join complexes c on c.id = r.complex_id
    where r.id = ${recommendationId}::uuid
      and r.reporter_user_id = ${actor.id}::uuid
    limit 1
  `;
  const current = currentRows[0];
  if (!current) return fail('NOT_FOUND', 'Shop recommendation not found', 404, requestId);
  if (String(current.status) !== 'changes_requested') {
    return fail('CONFLICT', 'Only changes_requested recommendations can be resubmitted', 409, requestId);
  }
  const complexSlug = String(current.complex_slug);
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const input = recommendationInput(payload, complexSlug);
  if (!input) return fail('VALIDATION_ERROR', 'Invalid shop recommendation', 400, requestId);
  const rows = await sql`
    update shop_recommendations
    set relation_type = ${input.relationType},
        business_name = ${input.businessName},
        category_name = ${input.categoryName},
        service_summary = ${input.serviceSummary},
        service_area = ${input.serviceArea},
        reporter_note = ${input.reporterNote},
        status = 'pending',
        review_note = null,
        reviewed_by = null,
        reviewed_at = null
    where id = ${recommendationId}::uuid
      and reporter_user_id = ${resident.id}::uuid
      and complex_id = ${resident.complexId}::uuid
      and status = 'changes_requested'
    returning id, relation_type, business_name, category_name, service_summary,
              service_area, reporter_note, status, review_note, approved_business_id,
              created_at, updated_at
  `;
  if (!rows[0]) return fail('CONFLICT', 'Recommendation can no longer be resubmitted', 409, requestId);
  return ok(mapRecommendation(rows[0] as Record<string, unknown>), requestId);
}

async function adminList(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string,
  status: string
): Promise<Response> {
  const operator = await requireOperationalAuthority(
    request, env, sql, requestId, complexSlug, 'business.review', 'council.business.review'
  );
  if (operator instanceof Response) return operator;
  const allowed = new Set(['pending', 'changes_requested', 'approved', 'rejected']);
  if (!allowed.has(status)) return fail('VALIDATION_ERROR', 'Invalid recommendation status', 400, requestId);
  const rows = await sql`
    select r.id, r.relation_type, r.business_name, r.category_name, r.service_summary,
           r.service_area, r.reporter_note, r.status, r.review_note, r.approved_business_id,
           r.created_at, r.updated_at, u.display_name as reporter_nickname
    from shop_recommendations r
    join app_users u on u.id = r.reporter_user_id
    where r.complex_id = ${operator.complexId}::uuid
      and r.status = ${status}
    order by r.created_at asc, r.id asc
    limit 200
  `;
  return ok({
    recommendations: rows.map((row) => ({
      ...mapRecommendation(row as Record<string, unknown>),
      reporterNickname: String(row.reporter_nickname)
    }))
  }, requestId);
}

async function adminReview(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  recommendationId: string
): Promise<Response> {
  const currentRows = await sql`
    select r.id, r.status, r.approved_business_id, c.slug as complex_slug
    from shop_recommendations r
    join complexes c on c.id = r.complex_id
    where r.id = ${recommendationId}::uuid
    limit 1
  `;
  const current = currentRows[0];
  if (!current) return fail('NOT_FOUND', 'Shop recommendation not found', 404, requestId);
  const operator = await requireOperationalAuthority(
    request, env, sql, requestId, String(current.complex_slug), 'business.review', 'council.business.review'
  );
  if (operator instanceof Response) return operator;
  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const status = String(payload.status ?? '').trim();
  const reviewNote = stringOrNull(payload.reviewNote);
  if (!REVIEW_STATES.has(status)) {
    return fail('VALIDATION_ERROR', 'status must be changes_requested, approved or rejected', 400, requestId);
  }
  if (reviewNote && reviewNote.length > 1000) {
    return fail('VALIDATION_ERROR', 'reviewNote must be at most 1000 characters', 400, requestId);
  }

  if (status === 'approved') {
    if (String(current.status) === 'approved' && current.approved_business_id) {
      return ok({ id: recommendationId, status: 'approved', approvedBusinessId: current.approved_business_id, alreadyApproved: true }, requestId);
    }
    const rows = await sql`
      with approved as (
        update shop_recommendations r
        set status = 'approved',
            review_note = ${reviewNote},
            reviewed_by = ${operator.id}::uuid,
            reviewed_at = now(),
            approved_business_id = coalesce(r.approved_business_id, gen_random_uuid())
        where r.id = ${recommendationId}::uuid
          and r.complex_id = ${operator.complexId}::uuid
          and r.status in ('pending','changes_requested')
        returning r.*
      ),
      created_business as (
        insert into businesses (
          id, owner_user_id, category_id, kind, name, summary, description,
          service_area, status
        )
        select a.approved_business_id,
               null,
               (select bc.id from business_categories bc where bc.name = a.category_name and bc.is_active = true limit 1),
               'service', a.business_name, a.service_summary, a.service_summary,
               a.service_area, 'approved'
        from approved a
        on conflict (id) do nothing
        returning id
      ),
      created_relation as (
        insert into business_complex_relations (
          business_id, complex_id, relation_type, verification_status,
          priority, verified_by, verified_at
        )
        select a.approved_business_id, a.complex_id, a.relation_type,
               'verified', 100, ${operator.id}::uuid, now()
        from approved a
        on conflict (business_id, complex_id) do update
          set relation_type = excluded.relation_type,
              verification_status = 'verified',
              verified_by = excluded.verified_by,
              verified_at = excluded.verified_at
        returning id
      )
      select id, status, review_note, approved_business_id, reviewed_at
      from approved
    `;
    if (rows[0]) return ok(rows[0], requestId);
    const latest = await sql`
      select id, status, approved_business_id
      from shop_recommendations
      where id = ${recommendationId}::uuid and complex_id = ${operator.complexId}::uuid
      limit 1
    `;
    if (latest[0] && String(latest[0].status) === 'approved') return ok(latest[0], requestId);
    return fail('CONFLICT', 'Recommendation can no longer be approved', 409, requestId);
  }

  const rows = await sql`
    update shop_recommendations
    set status = ${status}, review_note = ${reviewNote},
        reviewed_by = ${operator.id}::uuid, reviewed_at = now()
    where id = ${recommendationId}::uuid
      and complex_id = ${operator.complexId}::uuid
      and status in ('pending','changes_requested')
    returning id, status, review_note, reviewed_at
  `;
  if (rows[0]) return ok(rows[0], requestId);
  return fail('CONFLICT', 'Recommendation can no longer be reviewed', 409, requestId);
}

export async function handleShopRecommendationWithSql(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const mine = path === '/api/v1/me/shop-recommendations';
  const mineItem = path.match(/^\/api\/v1\/me\/shop-recommendations\/([0-9a-fA-F-]+)$/);
  const adminQueue = path.match(/^\/api\/v1\/admin\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/shop-recommendations$/);
  const adminItem = path.match(/^\/api\/v1\/admin\/shop-recommendations\/([0-9a-fA-F-]+)$/);
  if (!mine && !mineItem && !adminQueue && !adminItem) return null;

  if (mine && request.method === 'GET') {
    const complexSlug = (url.searchParams.get('complexSlug') || '').trim();
    if (!COMPLEX_SLUG.test(complexSlug)) return fail('VALIDATION_ERROR', 'Valid complexSlug is required', 400, requestId);
    return listMine(request, env, sql, requestId, complexSlug);
  }
  if (mine && request.method === 'POST') return createMine(request, env, sql, requestId);
  if (mineItem) {
    if (!UUID.test(mineItem[1])) return fail('NOT_FOUND', 'Shop recommendation not found', 404, requestId);
    if (request.method !== 'PATCH') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return resubmitMine(request, env, sql, requestId, mineItem[1].toLowerCase());
  }
  if (adminQueue) {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return adminList(request, env, sql, requestId, adminQueue[1], (url.searchParams.get('status') || 'pending').trim());
  }
  if (adminItem) {
    if (!UUID.test(adminItem[1])) return fail('NOT_FOUND', 'Shop recommendation not found', 404, requestId);
    if (request.method !== 'PATCH') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return adminReview(request, env, sql, requestId, adminItem[1].toLowerCase());
  }
  return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
}

export async function handleShopRecommendationRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.includes('shop-recommendations')) return null;
  return handleShopRecommendationWithSql(request, env, sqlFor(env), requestId);
}
