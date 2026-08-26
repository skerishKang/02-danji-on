import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireVerifiedResident } from './authorization-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

type ApplicationInput = {
  complexSlug: string;
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

function applicationInput(payload: Record<string, unknown>): ApplicationInput {
  return {
    complexSlug: String(payload.complexSlug ?? '').trim(),
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

function validateApplication(input: ApplicationInput, requestId: string): Response | null {
  if (!input.complexSlug) return fail('VALIDATION_ERROR', 'complexSlug is required', 400, requestId);
  if (!['resident', 'resident_family', 'neighbor', 'local'].includes(input.relationType)) {
    return fail('VALIDATION_ERROR', 'Invalid relationType', 400, requestId);
  }
  if (!input.businessName || !input.categoryName || !input.serviceSummary) {
    return fail('VALIDATION_ERROR', 'businessName, categoryName and serviceSummary are required', 400, requestId);
  }
  return null;
}

function validIdempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9._:-]{8,80}$/.test(value);
}

async function fingerprint(input: ApplicationInput): Promise<string> {
  const canonical = JSON.stringify(input);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function createBusinessApplication(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  payload: Record<string, unknown>
): Promise<Response> {
  const input = applicationInput(payload);
  const invalid = validateApplication(input, requestId);
  if (invalid) return invalid;

  const residentOrResponse = await requireVerifiedResident(request, env, sql, requestId, input.complexSlug);
  if (residentOrResponse instanceof Response) return residentOrResponse;
  const resident = residentOrResponse;

  const rawKey = request.headers.get('idempotency-key')?.trim() || null;
  if (rawKey && !validIdempotencyKey(rawKey)) {
    return fail(
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key must be 8-80 characters using letters, numbers, dot, underscore, colon or dash',
      400,
      requestId
    );
  }
  const requestFingerprint = rawKey ? await fingerprint(input) : null;

  const inserted = await sql`
    insert into business_applications (
      complex_id, applicant_user_id, relation_type, business_name, category_name,
      service_summary, price_text, contact_method, service_area, benefit_text,
      availability_text, representative_image_object_key, submission_key,
      submission_fingerprint, status
    ) values (
      ${resident.complexId}::uuid,
      ${resident.id}::uuid,
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
  if (!rawKey || !requestFingerprint) return fail('CONFLICT', 'Application could not be created', 409, requestId);

  const existingRows = await sql`
    select id, relation_type, business_name, category_name, service_summary,
           price_text, contact_method, service_area, benefit_text,
           availability_text, representative_image_object_key, status,
           review_note, approved_business_id, submission_key,
           submission_fingerprint, created_at, updated_at
    from business_applications
    where applicant_user_id = ${resident.id}::uuid
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

async function claimBenefit(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  benefitId: string,
  payload: Record<string, unknown>
): Promise<Response> {
  const complexSlug = String(payload.complexSlug ?? '').trim();
  if (!complexSlug) return fail('VALIDATION_ERROR', 'complexSlug is required', 400, requestId);

  const residentOrResponse = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (residentOrResponse instanceof Response) return residentOrResponse;
  const resident = residentOrResponse;

  const benefitRows = await sql`
    select be.id, be.complex_id, be.business_id
    from benefits be
    join businesses b on b.id = be.business_id
    join complexes c on c.id = be.complex_id
    where be.id = ${benefitId}::uuid
      and c.id = ${resident.complexId}::uuid
      and be.status = 'active'
      and b.status = 'approved'
      and (be.starts_at is null or be.starts_at <= now())
      and (be.ends_at is null or be.ends_at >= now())
    limit 1
  `;
  if (!benefitRows[0]) return fail('NOT_FOUND', 'Active benefit not found for this complex', 404, requestId);

  const inserted = await sql`
    insert into benefit_claims (benefit_id, user_id, complex_id, claim_code, status)
    values (
      ${benefitId}::uuid,
      ${resident.id}::uuid,
      ${resident.complexId}::uuid,
      ('DANJION-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
      'stored'
    )
    on conflict (user_id, benefit_id) do nothing
    returning id, benefit_id, claim_code, status, claimed_at, used_at
  `;
  if (inserted[0]) return ok(inserted[0], requestId, 201);

  const existing = await sql`
    select id, benefit_id, claim_code, status, claimed_at, used_at
    from benefit_claims
    where user_id = ${resident.id}::uuid
      and benefit_id = ${benefitId}::uuid
    limit 1
  `;
  if (!existing[0]) return fail('CONFLICT', 'Benefit claim could not be resolved', 409, requestId);
  return ok(existing[0], requestId);
}

export async function handleResidentEconomyMutationRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'POST') return null;

  const path = new URL(request.url).pathname;
  const applicationCreate = path === '/api/v1/me/business-applications';
  const benefitClaim = path.match(/^\/api\/v1\/me\/benefits\/([0-9a-fA-F-]+)\/claim$/);
  if (!applicationCreate && !benefitClaim) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const sql: Sql = neon(env.DATABASE_URL);

  if (applicationCreate) return createBusinessApplication(request, env, sql, requestId, payload);
  return claimBenefit(request, env, sql, requestId, benefitClaim![1], payload);
}
