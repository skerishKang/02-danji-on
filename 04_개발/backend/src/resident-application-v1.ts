import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;
type Actor = { id: string; authUserId: string; displayName: string };

type NormalizedApplicationInput = {
  complexSlug?: string;
  relationType: string;
  businessName: string;
  categoryName: string;
  serviceSummary: string;
  priceText: string | null;
  contactMethod: string | null;
  serviceArea: string | null;
  benefitText: string | null;
  availabilityText: string | null;
  representativeImageObjectKey: string | null;
};

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

function normalizeInput(payload: Record<string, unknown>, includeComplex: boolean): NormalizedApplicationInput {
  return {
    ...(includeComplex ? { complexSlug: String(payload.complexSlug ?? '').trim() } : {}),
    relationType: String(payload.relationType ?? '').trim(),
    businessName: String(payload.businessName ?? '').trim(),
    categoryName: String(payload.categoryName ?? '').trim(),
    serviceSummary: String(payload.serviceSummary ?? '').trim(),
    priceText: String(payload.priceText ?? '').trim() || null,
    contactMethod: String(payload.contactMethod ?? '').trim() || null,
    serviceArea: String(payload.serviceArea ?? '').trim() || null,
    benefitText: String(payload.benefitText ?? '').trim() || null,
    availabilityText: String(payload.availabilityText ?? '').trim() || null,
    representativeImageObjectKey: String(payload.representativeImageObjectKey ?? '').trim() || null
  };
}

function validateInput(input: NormalizedApplicationInput, requireComplex: boolean, requestId: string): Response | null {
  if (requireComplex && !input.complexSlug) {
    return fail('VALIDATION_ERROR', 'complexSlug is required', 400, requestId);
  }
  if (!['resident', 'resident_family', 'neighbor', 'local'].includes(input.relationType)) {
    return fail('VALIDATION_ERROR', 'Invalid relationType', 400, requestId);
  }
  if (!input.businessName || !input.categoryName || !input.serviceSummary) {
    return fail('VALIDATION_ERROR', 'businessName, categoryName and serviceSummary are required', 400, requestId);
  }
  return null;
}

async function fingerprint(input: NormalizedApplicationInput): Promise<string> {
  const canonical = JSON.stringify({
    complexSlug: input.complexSlug ?? null,
    relationType: input.relationType,
    businessName: input.businessName,
    categoryName: input.categoryName,
    serviceSummary: input.serviceSummary,
    priceText: input.priceText,
    contactMethod: input.contactMethod,
    serviceArea: input.serviceArea,
    benefitText: input.benefitText,
    availabilityText: input.availabilityText,
    representativeImageObjectKey: input.representativeImageObjectKey
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validIdempotencyKey(value: string) {
  return /^[A-Za-z0-9._:-]{8,80}$/.test(value);
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

async function createApplication(
  request: Request,
  sql: Sql,
  actor: Actor,
  requestId: string,
  payload: Record<string, unknown>
): Promise<Response> {
  const input = normalizeInput(payload, true);
  const invalid = validateInput(input, true, requestId);
  if (invalid) return invalid;

  const memberships = await sql`
    select c.id as complex_id
    from complex_memberships m
    join complexes c on c.id = m.complex_id
    where m.user_id = ${actor.id}::uuid
      and c.slug = ${input.complexSlug as string}
    limit 1
  `;
  const membership = memberships[0];
  if (!membership) return fail('FORBIDDEN', 'No membership for target complex', 403, requestId);

  const rawKey = request.headers.get('idempotency-key')?.trim() || null;
  if (rawKey && !validIdempotencyKey(rawKey)) {
    return fail('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 8-80 characters using letters, numbers, dot, underscore, colon or dash', 400, requestId);
  }
  const requestFingerprint = rawKey ? await fingerprint(input) : null;

  const inserted = await sql`
    insert into business_applications (
      complex_id, applicant_user_id, relation_type, business_name, category_name,
      service_summary, price_text, contact_method, service_area, benefit_text,
      availability_text, representative_image_object_key, submission_key,
      submission_fingerprint, status
    ) values (
      ${String(membership.complex_id)}::uuid,
      ${actor.id}::uuid,
      ${input.relationType},
      ${input.businessName},
      ${input.categoryName},
      ${input.serviceSummary},
      ${input.priceText},
      ${input.contactMethod},
      ${input.serviceArea},
      ${input.benefitText},
      ${input.availabilityText},
      ${input.representativeImageObjectKey},
      ${rawKey},
      ${requestFingerprint},
      'pending'
    )
    on conflict (applicant_user_id, submission_key)
      where submission_key is not null
    do nothing
    returning id, relation_type, business_name, category_name, service_summary,
              price_text, contact_method, service_area, benefit_text,
              availability_text, representative_image_object_key, status,
              review_note, approved_business_id, submission_key, created_at, updated_at
  `;
  if (inserted[0]) return ok({ ...inserted[0], idempotency_replayed: false }, requestId, 201);

  if (!rawKey || !requestFingerprint) {
    return fail('CONFLICT', 'Application could not be created', 409, requestId);
  }

  const existingRows = await sql`
    select id, relation_type, business_name, category_name, service_summary,
           price_text, contact_method, service_area, benefit_text,
           availability_text, representative_image_object_key, status,
           review_note, approved_business_id, submission_key,
           submission_fingerprint, created_at, updated_at
    from business_applications
    where applicant_user_id = ${actor.id}::uuid
      and submission_key = ${rawKey}
    limit 1
  `;
  const existing = existingRows[0];
  if (!existing) return fail('CONFLICT', 'Idempotent application could not be resolved', 409, requestId);
  if (String(existing.submission_fingerprint) !== requestFingerprint) {
    return fail('IDEMPOTENCY_KEY_REUSED', 'The Idempotency-Key was already used with a different request body', 409, requestId);
  }
  return ok({ ...existing, idempotency_replayed: true }, requestId);
}

export async function handleResidentApplicationRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const isCollectionCreate = request.method === 'POST' && path === '/api/v1/me/business-applications';
  const detailMatch = path.match(/^\/api\/v1\/me\/business-applications\/([0-9a-fA-F-]+)$/);
  if (!isCollectionCreate && (!detailMatch || !['GET', 'PATCH'].includes(request.method))) return null;

  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
  const sql: Sql = neon(env.DATABASE_URL);
  const actorOrResponse = await actorFromRequest(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;

  if (isCollectionCreate) {
    const payload = await bodyJson(request, requestId);
    if (payload instanceof Response) return payload;
    return createApplication(request, sql, actor, requestId, payload);
  }

  const applicationId = detailMatch![1];
  if (request.method === 'GET') {
    const rows = await applicationSelect(sql, applicationId, actor.id);
    if (!rows[0]) return fail('NOT_FOUND', 'Business application not found', 404, requestId);
    return ok(rows[0], requestId);
  }

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const input = normalizeInput(payload, false);
  const invalid = validateInput(input, false, requestId);
  if (invalid) return invalid;

  const rows = await sql`
    update business_applications a
    set relation_type = ${input.relationType},
        business_name = ${input.businessName},
        category_name = ${input.categoryName},
        service_summary = ${input.serviceSummary},
        price_text = ${input.priceText},
        contact_method = ${input.contactMethod},
        service_area = ${input.serviceArea},
        benefit_text = ${input.benefitText},
        availability_text = ${input.availabilityText},
        representative_image_object_key = ${input.representativeImageObjectKey},
        status = 'pending',
        reviewed_by = null,
        reviewed_at = null
    where a.id = ${applicationId}::uuid
      and a.applicant_user_id = ${actor.id}::uuid
      and a.status = 'changes_requested'
    returning a.id, a.relation_type, a.business_name, a.category_name,
              a.service_summary, a.price_text, a.contact_method, a.service_area,
              a.benefit_text, a.availability_text, a.representative_image_object_key,
              a.status, a.review_note, a.approved_business_id, a.created_at, a.updated_at
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
