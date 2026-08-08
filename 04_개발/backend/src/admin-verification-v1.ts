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

async function requireManager(sql: Sql, actorId: string, complexSlug: string, requestId: string) {
  const rows = await sql`
    select c.id as complex_id, c.slug, c.name, m.role
    from complex_memberships m
    join complexes c on c.id = m.complex_id
    where m.user_id = ${actorId}::uuid
      and c.slug = ${complexSlug}
      and m.role in ('manager','admin')
      and m.verification_status = 'verified'
    limit 1
  `;
  if (!rows[0]) return fail('FORBIDDEN', 'Manager or admin membership required', 403, requestId);
  return rows[0];
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

function clampLimit(value: string | null) {
  const parsed = Number(value ?? 100);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(Math.max(Math.trunc(parsed), 1), 200);
}

export async function handleAdminVerificationRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const listMatch = url.pathname.match(/^\/api\/v1\/admin\/complexes\/([^/]+)\/resident-verifications$/);
  const patchMatch = url.pathname.match(/^\/api\/v1\/admin\/resident-verifications\/([0-9a-fA-F-]+)$/);
  if ((!listMatch || request.method !== 'GET') && (!patchMatch || request.method !== 'PATCH')) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const sql: Sql = neon(env.DATABASE_URL);
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;

  if (listMatch) {
    const complexSlug = decodeURIComponent(listMatch[1]);
    const manager = await requireManager(sql, actor.id, complexSlug, requestId);
    if (manager instanceof Response) return manager;

    const status = url.searchParams.get('status')?.trim() || 'pending';
    if (!['all','unverified','pending','verified','rejected'].includes(status)) {
      return fail('VALIDATION_ERROR', 'Invalid resident verification status filter', 400, requestId);
    }
    const limit = clampLimit(url.searchParams.get('limit'));
    const rows = await sql`
      select rv.id, rv.membership_id, rv.status as verification_record_status,
             rv.method, rv.evidence_object_key,
             rv.requested_at, rv.reviewed_at, rv.reviewed_by, rv.note,
             m.verification_status, m.building, m.unit,
             u.display_name, u.auth_user_id
      from resident_verifications rv
      join complex_memberships m on m.id = rv.membership_id
      join app_users u on u.id = m.user_id
      where m.complex_id = ${String(manager.complex_id)}::uuid
        and (${status} = 'all' or m.verification_status = ${status})
      order by case m.verification_status when 'pending' then 0 else 1 end,
               rv.requested_at asc
      limit ${limit}
    `;
    return ok(rows, requestId);
  }

  const verificationId = patchMatch![1];
  const contextRows = await sql`
    select rv.id, rv.membership_id, c.slug as complex_slug, m.verification_status
    from resident_verifications rv
    join complex_memberships m on m.id = rv.membership_id
    join complexes c on c.id = m.complex_id
    where rv.id = ${verificationId}::uuid
    limit 1
  `;
  const context = contextRows[0];
  if (!context) return fail('NOT_FOUND', 'Resident verification not found', 404, requestId);
  const manager = await requireManager(sql, actor.id, String(context.complex_slug), requestId);
  if (manager instanceof Response) return manager;

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const status = String(payload.status ?? '').trim();
  const note = String(payload.note ?? '').trim() || null;
  if (!['verified','rejected'].includes(status)) {
    return fail('VALIDATION_ERROR', 'status must be verified or rejected', 400, requestId);
  }
  if (note && note.length > 1000) return fail('VALIDATION_ERROR', 'note must be 1000 characters or less', 400, requestId);
  if (!['pending','rejected'].includes(String(context.verification_status))) {
    return fail('CONFLICT', 'Resident verification can no longer be reviewed from its current state', 409, requestId);
  }

  const rows = await sql`
    with updated_membership as (
      update complex_memberships
      set verification_status = ${status}
      where id = ${String(context.membership_id)}::uuid
        and verification_status in ('pending','rejected')
      returning id, verification_status, building, unit
    ),
    updated_verification as (
      update resident_verifications
      set status = ${status},
          reviewed_at = now(),
          reviewed_by = ${actor.id}::uuid,
          note = ${note}
      where id = ${verificationId}::uuid
      returning id, membership_id, status, method, evidence_object_key,
                requested_at, reviewed_at, reviewed_by, note
    )
    select um.id as membership_id, um.verification_status,
           um.building, um.unit,
           uv.id as verification_id,
           uv.status as verification_record_status,
           uv.method, uv.evidence_object_key,
           uv.requested_at, uv.reviewed_at, uv.reviewed_by, uv.note
    from updated_membership um
    cross join updated_verification uv
  `;
  if (!rows[0]) return fail('CONFLICT', 'Resident verification review could not be applied', 409, requestId);
  return ok(rows[0], requestId);
}
