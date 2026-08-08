import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;
type Actor = { id: string; authUserId: string; displayName: string };

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

export async function handleResidentVerificationRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(/^\/api\/v1\/me\/complexes\/([^/]+)\/resident-verification$/);
  if (!match || !['GET', 'POST'].includes(request.method)) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const complexSlug = decodeURIComponent(match[1]);
  const sql: Sql = neon(env.DATABASE_URL);
  const actorOrResponse = await actorFromRequest(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;

  const membershipRows = await sql`
    select m.id, m.role, m.verification_status, m.building, m.unit,
           c.id as complex_id, c.slug as complex_slug, c.name as complex_name
    from complex_memberships m
    join complexes c on c.id = m.complex_id
    where m.user_id = ${actor.id}::uuid
      and c.slug = ${complexSlug}
    limit 1
  `;
  const membership = membershipRows[0];
  if (!membership) return fail('FORBIDDEN', 'No membership for target complex', 403, requestId);

  if (request.method === 'GET') {
    const verificationRows = await sql`
      select id, status, method, evidence_object_key, requested_at, reviewed_at, reviewed_by, note
      from resident_verifications
      where membership_id = ${String(membership.id)}::uuid
      limit 1
    `;
    return ok({
      membership: {
        id: membership.id,
        role: membership.role,
        verification_status: membership.verification_status,
        building: membership.building,
        unit: membership.unit,
        complex_id: membership.complex_id,
        complex_slug: membership.complex_slug,
        complex_name: membership.complex_name
      },
      verification: verificationRows[0] ?? null
    }, requestId);
  }

  if (String(membership.verification_status) === 'verified') {
    return fail('ALREADY_VERIFIED', 'Resident membership is already verified', 409, requestId);
  }

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const building = String(payload.building ?? '').trim();
  const unit = String(payload.unit ?? '').trim();
  const method = String(payload.method ?? '').trim();
  const evidenceObjectKey = String(payload.evidenceObjectKey ?? '').trim() || null;

  if (!building || !unit) return fail('VALIDATION_ERROR', 'building and unit are required', 400, requestId);
  if (building.length > 20 || unit.length > 20) return fail('VALIDATION_ERROR', 'building and unit must be 20 characters or less', 400, requestId);
  if (!['document', 'management_confirmation', 'manual'].includes(method)) {
    return fail('VALIDATION_ERROR', 'Invalid verification method', 400, requestId);
  }
  if (method === 'document' && !evidenceObjectKey) {
    return fail('VALIDATION_ERROR', 'evidenceObjectKey is required for document verification', 400, requestId);
  }

  const rows = await sql`
    with updated_membership as (
      update complex_memberships
      set building = ${building},
          unit = ${unit},
          verification_status = 'pending'
      where id = ${String(membership.id)}::uuid
      returning id, verification_status, building, unit
    ),
    upserted_verification as (
      insert into resident_verifications (
        membership_id, status, method, evidence_object_key, requested_at,
        reviewed_at, reviewed_by, note
      ) values (
        ${String(membership.id)}::uuid,
        'pending',
        ${method},
        ${evidenceObjectKey},
        now(), null, null, null
      )
      on conflict (membership_id) do update
        set status = 'pending',
            method = excluded.method,
            evidence_object_key = excluded.evidence_object_key,
            requested_at = now(),
            reviewed_at = null,
            reviewed_by = null,
            note = null
      returning id, status, method, evidence_object_key, requested_at, reviewed_at, reviewed_by, note
    )
    select
      um.id as membership_id,
      um.verification_status,
      um.building,
      um.unit,
      uv.id as verification_id,
      uv.status as verification_record_status,
      uv.method,
      uv.evidence_object_key,
      uv.requested_at,
      uv.reviewed_at,
      uv.reviewed_by,
      uv.note
    from updated_membership um
    cross join upserted_verification uv
  `;
  return ok(rows[0], requestId, 201);
}
