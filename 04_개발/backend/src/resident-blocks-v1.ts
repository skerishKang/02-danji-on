import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireVerifiedResident } from './authorization-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 8 * 1024;

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

function canonicalUuid(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return UUID.test(text) ? text : null;
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

async function targetVerifiedInComplex(sql: Sql, userId: string, complexId: string): Promise<boolean> {
  const rows = await sql`
    select 1
    from app_users u
    where u.id = ${userId}::uuid
      and u.account_status = 'active'
      and exists (
        select 1
        from household_memberships hm
        join households h on h.id = hm.household_id and h.complex_id = hm.complex_id
        join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
        where hm.user_id = u.id
          and hm.complex_id = ${complexId}::uuid
          and hm.status = 'verified'
          and h.status = 'active'
          and cu.status = 'active'
      )
    limit 1
  `;
  return Boolean(rows[0]);
}

export async function handleResidentBlockWithSql(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const listPath = path === '/api/v1/me/blocks';
  const deleteMatch = path.match(/^\/api\/v1\/me\/blocks\/([0-9a-fA-F-]+)$/);
  if (!listPath && !deleteMatch) return null;

  const complexSlug = (url.searchParams.get('complexSlug') || '').trim();
  if (!complexSlug) return fail('VALIDATION_ERROR', 'complexSlug is required', 400, requestId);
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;

  if (listPath && request.method === 'GET') {
    const rows = await sql`
      select b.blocked_user_id, b.created_at,
             u.display_name as nickname, u.avatar_url
      from blocks b
      join app_users u on u.id = b.blocked_user_id
      where b.blocker_user_id = ${resident.id}::uuid
      order by b.created_at desc, b.blocked_user_id
    `;
    return ok({
      blocks: rows.map((row) => ({
        userId: String(row.blocked_user_id),
        nickname: String(row.nickname),
        avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
        blockedAt: row.created_at
      }))
    }, requestId);
  }

  if (listPath && request.method === 'POST') {
    const payload = await bodyJson(request, requestId);
    if (payload instanceof Response) return payload;
    const targetUserId = canonicalUuid(payload.userId);
    if (!targetUserId) return fail('VALIDATION_ERROR', 'Valid userId is required', 400, requestId);
    if (targetUserId === resident.id.toLowerCase()) {
      return fail('VALIDATION_ERROR', 'Cannot block yourself', 400, requestId);
    }
    if (!(await targetVerifiedInComplex(sql, targetUserId, resident.complexId))) {
      return fail('RESIDENT_NOT_FOUND', 'Resident not found', 404, requestId);
    }
    const rows = await sql`
      insert into blocks (blocker_user_id, blocked_user_id)
      values (${resident.id}::uuid, ${targetUserId}::uuid)
      on conflict (blocker_user_id, blocked_user_id) do update
      set blocker_user_id = excluded.blocker_user_id
      returning blocker_user_id, blocked_user_id, created_at
    `;
    const row = rows[0];
    return ok({
      userId: String(row.blocked_user_id),
      blockedAt: row.created_at
    }, requestId, 201);
  }

  if (deleteMatch) {
    const targetUserId = canonicalUuid(deleteMatch[1]);
    if (!targetUserId) return fail('VALIDATION_ERROR', 'Invalid user id', 400, requestId);
    if (request.method !== 'DELETE') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    const rows = await sql`
      delete from blocks
      where blocker_user_id = ${resident.id}::uuid
        and blocked_user_id = ${targetUserId}::uuid
      returning blocked_user_id
    `;
    return ok({ userId: targetUserId, removed: Boolean(rows[0]) }, requestId);
  }

  return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
}

export async function handleResidentBlockRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== '/api/v1/me/blocks' && !path.startsWith('/api/v1/me/blocks/')) return null;
  return handleResidentBlockWithSql(request, env, sqlFor(env), requestId);
}
