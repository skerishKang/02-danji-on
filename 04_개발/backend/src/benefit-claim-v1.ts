import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireVerifiedResident } from './authorization-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

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

// D3-A (#393): bounded owner of POST /api/v1/me/benefits/:id/claim, extracted
// behavior-for-behavior from resident-economy-v2 `claimBenefit`. Household-v2
// verified-resident authority, one-per-user-and-benefit insert with a
// server-issued claim code, and replay of the existing owner row.
export async function handleBenefitClaimRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const benefitClaim = request.method === 'POST'
    ? path.match(/^\/api\/v1\/me\/benefits\/([0-9a-fA-F-]+)\/claim$/)
    : null;
  if (!benefitClaim) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const sql: Sql = neon(env.DATABASE_URL);
  const benefitId = benefitClaim[1];

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
