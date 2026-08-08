import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
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

async function requireVerifiedMembership(sql: Sql, actorId: string, complexSlug: string, requestId: string) {
  const rows = await sql`
    select m.id as membership_id, c.id as complex_id, c.slug as complex_slug
    from complex_memberships m
    join complexes c on c.id = m.complex_id
    where m.user_id = ${actorId}::uuid
      and c.slug = ${complexSlug}
      and c.status in ('active','pilot')
      and m.verification_status = 'verified'
    limit 1
  `;
  if (!rows[0]) return fail('RESIDENT_VERIFICATION_REQUIRED', 'Verified resident membership required', 403, requestId);
  return rows[0];
}

export async function handleBenefitWalletRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const listMatch = path === '/api/v1/me/benefits';
  const claimMatch = path.match(/^\/api\/v1\/me\/benefits\/([0-9a-fA-F-]+)\/claim$/);
  const useMatch = path.match(/^\/api\/v1\/me\/benefits\/([0-9a-fA-F-]+)\/use$/);

  if (!(listMatch && request.method === 'GET') && !(claimMatch && request.method === 'POST') && !(useMatch && request.method === 'PATCH')) {
    return null;
  }
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const sql: Sql = neon(env.DATABASE_URL);
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;

  if (listMatch) {
    const rows = await sql`
      select bc.id, bc.benefit_id, bc.claim_code, bc.status, bc.claimed_at, bc.used_at,
             be.title, be.description, be.conditions,
             b.id as business_id, b.name as business_name,
             c.slug as complex_slug, c.name as complex_name
      from benefit_claims bc
      join benefits be on be.id = bc.benefit_id
      join businesses b on b.id = be.business_id
      join complexes c on c.id = bc.complex_id
      where bc.user_id = ${actor.id}::uuid
      order by bc.claimed_at desc
    `;
    return ok(rows, requestId);
  }

  if (claimMatch) {
    const benefitId = claimMatch[1];
    const payload = await bodyJson(request, requestId);
    if (payload instanceof Response) return payload;
    const complexSlug = String(payload.complexSlug ?? '').trim();
    if (!complexSlug) return fail('VALIDATION_ERROR', 'complexSlug is required', 400, requestId);

    const member = await requireVerifiedMembership(sql, actor.id, complexSlug, requestId);
    if (member instanceof Response) return member;

    const benefitRows = await sql`
      select be.id, be.complex_id, be.business_id
      from benefits be
      join businesses b on b.id = be.business_id
      join complexes c on c.id = be.complex_id
      where be.id = ${benefitId}::uuid
        and c.id = ${String(member.complex_id)}::uuid
        and be.status = 'active'
        and b.status = 'approved'
        and (be.starts_at is null or be.starts_at <= now())
        and (be.ends_at is null or be.ends_at >= now())
      limit 1
    `;
    const benefit = benefitRows[0];
    if (!benefit) return fail('NOT_FOUND', 'Active benefit not found for this complex', 404, requestId);

    const inserted = await sql`
      insert into benefit_claims (benefit_id, user_id, complex_id, claim_code, status)
      values (
        ${benefitId}::uuid,
        ${actor.id}::uuid,
        ${String(member.complex_id)}::uuid,
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
      where user_id = ${actor.id}::uuid and benefit_id = ${benefitId}::uuid
      limit 1
    `;
    return ok(existing[0], requestId);
  }

  const benefitId = useMatch![1];
  const updated = await sql`
    update benefit_claims
    set status = 'used', used_at = coalesce(used_at, now())
    where user_id = ${actor.id}::uuid
      and benefit_id = ${benefitId}::uuid
      and status = 'stored'
    returning id, benefit_id, claim_code, status, claimed_at, used_at
  `;
  if (updated[0]) return ok(updated[0], requestId);

  const existing = await sql`
    select id, benefit_id, claim_code, status, claimed_at, used_at
    from benefit_claims
    where user_id = ${actor.id}::uuid and benefit_id = ${benefitId}::uuid
    limit 1
  `;
  if (!existing[0]) return fail('NOT_FOUND', 'Benefit claim not found', 404, requestId);
  return ok(existing[0], requestId);
}
