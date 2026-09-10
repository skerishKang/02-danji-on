import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import { requireVerifiedResident } from './authorization-v2';
import { requireOperationalAuthority } from './operational-authz-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

type ReportRelation = 'resident_family' | 'neighbor' | 'local';

// Report R-B intake shape. The reporter may arrive without a canonical
// category or a resolvable relation: categoryName is optional and the raw
// relation text is always preserved in reportedRelationRaw.
export type RecommendationInput = {
  complexSlug: string;
  reportedRelationRaw: string;
  businessName: string;
  categoryName: string | null;
  serviceSummary: string;
  serviceArea: string | null;
  reporterNote: string | null;
  relationDetail: string | null;
  reportPrice: string | null;
  reportHours: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPLEX_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
// Report R-B pre-resolution: only family -> resident_family and
// neighbor -> neighbor may be auto-pre-resolved at intake. nearby is
// DELIBERATELY absent: nearby -> local auto-resolve is FORBIDDEN, so a
// nearby report stays raw with resolved_relation_type NULL. etc and any
// other raw text also stays raw with resolved NULL.
const REPORT_RB_PRE_RESOLVE: Record<string, ReportRelation> = {
  family: 'resident_family',
  resident_family: 'resident_family',
  neighbor: 'neighbor',
  local: 'local'
};
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

// Report R-B intake resolution. The raw relation is always preserved by the
// caller; only family -> resident_family and neighbor -> neighbor are
// pre-resolved. Legacy relation_type mirrors the resolved value and stays
// NULL while unresolved (it is not an approval authority).
export function preResolveRelation(raw: string): ReportRelation | null {
  return REPORT_RB_PRE_RESOLVE[raw.trim().toLowerCase()] ?? null;
}

// Report intake category is NOT required. When the reporter supplies one,
// resolve it to the canonical id with an exact active-name match; otherwise
// resolved_category_id stays NULL and approval fails closed. The raw text is
// kept in legacy category_name either way.
async function resolveReportCategory(sql: Sql, categoryName: string | null): Promise<string | null> {
  if (!categoryName) return null;
  const rows = await sql`
    select bc.id
    from business_categories bc
    where bc.name = ${categoryName}
      and bc.is_active = true
    limit 1
  `;
  return rows[0] ? String(rows[0].id) : null;
}

// Fail-closed approval authority: ONLY resolved_category_id +
// resolved_relation_type approve a report. Legacy category_name /
// relation_type are never read. No heuristic matching and no category
// auto-creation.
async function resolveApprovalAuthority(
  sql: Sql,
  resolvedCategoryId: string | null,
  resolvedRelationType: string | null
) {
  if (!resolvedCategoryId || !resolvedRelationType) {
    return { code: 'REPORT_RB_UNRESOLVED', message: 'Recommendation is missing resolved category or relation' };
  }
  const rows = await sql`
    select bc.id, bc.is_active
    from business_categories bc
    where bc.id = ${resolvedCategoryId}::uuid
    limit 1
  `;
  const row = rows[0];
  if (!row) {
    return { code: 'CATEGORY_NOT_RESOLVED', message: 'Resolved category does not match a canonical category' };
  }
  if (!row.is_active) {
    return { code: 'CATEGORY_NOT_ACTIVE', message: 'Resolved category is not active' };
  }
  return null;
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

export function recommendationInput(payload: Record<string, unknown>, forcedComplexSlug?: string): RecommendationInput | null {
  const complexSlug = (forcedComplexSlug ?? String(payload.complexSlug ?? '')).trim();
  // relationType keeps the legacy field name for intake compatibility; the
  // value is treated as raw R-B text and always preserved verbatim.
  const reportedRelationRaw = String(payload.relationRaw ?? payload.relationType ?? '').trim();
  const businessName = String(payload.businessName ?? '').trim();
  const categoryName = stringOrNull(payload.categoryName);
  const serviceSummary = String(payload.serviceSummary ?? '').trim();
  const serviceArea = stringOrNull(payload.serviceArea);
  const reporterNote = stringOrNull(payload.reporterNote);
  const relationDetail = stringOrNull(payload.relationDetail);
  const reportPrice = stringOrNull(payload.reportPrice);
  const reportHours = stringOrNull(payload.reportHours);
  if (!COMPLEX_SLUG.test(complexSlug)) return null;
  if (reportedRelationRaw.length < 1 || reportedRelationRaw.length > 120) return null;
  if (businessName.length < 1 || businessName.length > 160) return null;
  if (categoryName && categoryName.length > 120) return null;
  if (serviceSummary.length < 1 || serviceSummary.length > 1000) return null;
  if (serviceArea && serviceArea.length > 300) return null;
  if (reporterNote && reporterNote.length > 1000) return null;
  if (relationDetail && relationDetail.length > 1000) return null;
  if (reportPrice && reportPrice.length > 120) return null;
  if (reportHours && reportHours.length > 120) return null;
  return {
    complexSlug,
    reportedRelationRaw,
    businessName,
    categoryName,
    serviceSummary,
    serviceArea,
    reporterNote,
    relationDetail,
    reportPrice,
    reportHours
  };
}

function mapRecommendation(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    relationType: row.relation_type ? String(row.relation_type) : null,
    reportedRelationRaw: row.reported_relation_raw ? String(row.reported_relation_raw) : null,
    resolvedRelationType: row.resolved_relation_type ? String(row.resolved_relation_type) : null,
    relationDetail: row.relation_detail ? String(row.relation_detail) : null,
    businessName: String(row.business_name),
    categoryName: row.category_name ? String(row.category_name) : null,
    resolvedCategoryId: row.resolved_category_id ? String(row.resolved_category_id) : null,
    serviceSummary: String(row.service_summary),
    serviceArea: row.service_area ? String(row.service_area) : null,
    reporterNote: row.reporter_note ? String(row.reporter_note) : null,
    reportPrice: row.report_price ? String(row.report_price) : null,
    reportHours: row.report_hours ? String(row.report_hours) : null,
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
    select id, relation_type, reported_relation_raw, resolved_relation_type,
           relation_detail, business_name, category_name, resolved_category_id,
           service_summary, service_area, reporter_note, report_price,
           report_hours, status, review_note, approved_business_id,
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

  const resolvedRelationType = preResolveRelation(input.reportedRelationRaw);
  const resolvedCategoryId = await resolveReportCategory(sql, input.categoryName);
  const rows = await sql`
    insert into shop_recommendations (
      complex_id, reporter_user_id, relation_type, reported_relation_raw,
      resolved_relation_type, relation_detail, business_name, category_name,
      resolved_category_id, service_summary, service_area, reporter_note,
      report_price, report_hours
    ) values (
      ${resident.complexId}::uuid, ${resident.id}::uuid, ${resolvedRelationType},
      ${input.reportedRelationRaw}, ${resolvedRelationType}, ${input.relationDetail},
      ${input.businessName}, ${input.categoryName}, ${resolvedCategoryId},
      ${input.serviceSummary}, ${input.serviceArea}, ${input.reporterNote},
      ${input.reportPrice}, ${input.reportHours}
    )
    returning id, relation_type, reported_relation_raw, resolved_relation_type,
              relation_detail, business_name, category_name, resolved_category_id,
              service_summary, service_area, reporter_note, report_price,
              report_hours, status, review_note, approved_business_id,
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
  const resolvedRelationType = preResolveRelation(input.reportedRelationRaw);
  const resolvedCategoryId = await resolveReportCategory(sql, input.categoryName);
  const rows = await sql`
    update shop_recommendations
    set relation_type = ${resolvedRelationType},
        reported_relation_raw = ${input.reportedRelationRaw},
        resolved_relation_type = ${resolvedRelationType},
        relation_detail = ${input.relationDetail},
        business_name = ${input.businessName},
        category_name = ${input.categoryName},
        resolved_category_id = ${resolvedCategoryId},
        service_summary = ${input.serviceSummary},
        service_area = ${input.serviceArea},
        reporter_note = ${input.reporterNote},
        report_price = ${input.reportPrice},
        report_hours = ${input.reportHours},
        status = 'pending',
        review_note = null,
        reviewed_by = null,
        reviewed_at = null
    where id = ${recommendationId}::uuid
      and reporter_user_id = ${resident.id}::uuid
      and complex_id = ${resident.complexId}::uuid
      and status = 'changes_requested'
    returning id, relation_type, reported_relation_raw, resolved_relation_type,
              relation_detail, business_name, category_name, resolved_category_id,
              service_summary, service_area, reporter_note, report_price,
              report_hours, status, review_note, approved_business_id,
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
    select r.id, r.relation_type, r.reported_relation_raw, r.resolved_relation_type,
           r.relation_detail, r.business_name, r.category_name, r.resolved_category_id,
           r.service_summary, r.service_area, r.reporter_note, r.report_price,
           r.report_hours, r.status, r.review_note, r.approved_business_id,
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
    select r.id, r.status, r.approved_business_id, r.resolved_category_id,
           r.resolved_relation_type, c.slug as complex_slug
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
    const authorityError = await resolveApprovalAuthority(
      sql,
      current.resolved_category_id ? String(current.resolved_category_id) : null,
      current.resolved_relation_type ? String(current.resolved_relation_type) : null
    );
    if (authorityError) {
      // Domain-consistent fail-closed: legacy category_name / relation_type
      // are NOT approval authorities, so an unresolved report can never
      // approve. The reporter can repair via the existing
      // changes_requested -> resubmit flow (category optional at intake,
      // family/neighbor auto-pre-resolved, raw always preserved), so return
      // the recommendation to changes_requested instead of approving a
      // business with unresolved authority. Falls back to fail-closed when
      // the row is no longer reviewable.
      const note = reviewNote ?? '카테고리 또는 관계를 확인할 수 없어 승인이 보류되었습니다. 확인 후 다시 제출해 주세요.';
      const transitioned = await sql`
        update shop_recommendations
        set status = 'changes_requested',
            review_note = ${note},
            reviewed_by = ${operator.id}::uuid,
            reviewed_at = now()
        where id = ${recommendationId}::uuid
          and complex_id = ${operator.complexId}::uuid
          and status in ('pending','changes_requested')
        returning id, status, review_note, reviewed_at
      `;
      if (transitioned[0]) {
        return ok({ ...transitioned[0], categoryUnresolved: authorityError.code }, requestId);
      }
      return fail(authorityError.code, authorityError.message, 409, requestId);
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
          and r.resolved_category_id is not null
          and r.resolved_relation_type is not null
          and exists (
            select 1 from business_categories bc
            where bc.id = r.resolved_category_id
              and bc.is_active = true
          )
        returning r.*
      ),
      created_business as (
        insert into businesses (
          id, owner_user_id, category_id, kind, name, summary, description,
          service_area, status
        )
        select a.approved_business_id,
               null,
               a.resolved_category_id,
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
        select a.approved_business_id, a.complex_id, a.resolved_relation_type,
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
