import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

type NotificationActor = { id: string };

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(data: unknown, status: number, requestId: string): Response {
  return Response.json(data, {
    status,
    headers: {
      [REQUEST_ID_HEADER]: requestId,
      'access-control-expose-headers': REQUEST_ID_HEADER,
      'cache-control': 'no-store'
    }
  });
}

function ok(data: unknown, requestId: string, status = 200): Response {
  return json({ data, requestId }, status, requestId);
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}

function sqlFor(env: CoreEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

function canonicalUuid(value: string | undefined): string | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return UUID.test(text) ? text : null;
}

async function requireNotificationActor(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<NotificationActor | Response> {
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;
  const rows = await sql`
    select 1
    from app_users u
    where u.id = ${actor.id}::uuid
      and u.account_status = 'active'
      and exists (
        select 1
        from household_memberships hm
        join households h on h.id = hm.household_id and h.complex_id = hm.complex_id
        join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
        where hm.user_id = u.id
          and hm.status = 'verified'
          and h.status = 'active'
          and cu.status = 'active'
      )
    limit 1
  `;
  if (!rows[0]) return fail('RESIDENT_REQUIRED', 'Verified resident access required', 403, requestId);
  return { id: String(actor.id) };
}

async function listNotifications(request: Request, env: CoreEnv, sql: Sql, requestId: string): Promise<Response> {
  const actor = await requireNotificationActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  const rows = await sql`
    select
      n.id,
      n.type,
      n.title,
      n.actor_user_id,
      actor_user.display_name as actor_nickname,
      n.resource_type,
      n.resource_id,
      n.read_at,
      n.created_at
    from notifications n
    left join app_users actor_user on actor_user.id = n.actor_user_id
    where n.user_id = ${actor.id}::uuid
      and (
        n.complex_id is null
        or exists (
          select 1
          from household_memberships hm
          join households h on h.id = hm.household_id and h.complex_id = hm.complex_id
          join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
          where hm.user_id = ${actor.id}::uuid
            and hm.complex_id = n.complex_id
            and hm.status = 'verified'
            and h.status = 'active'
            and cu.status = 'active'
        )
      )
    order by n.created_at desc, n.id desc
    limit 100
  `;
  const unreadRows = await sql`
    select count(*)::int as unread_count
    from notifications n
    where n.user_id = ${actor.id}::uuid
      and n.read_at is null
      and (
        n.complex_id is null
        or exists (
          select 1
          from household_memberships hm
          join households h on h.id = hm.household_id and h.complex_id = hm.complex_id
          join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
          where hm.user_id = ${actor.id}::uuid
            and hm.complex_id = n.complex_id
            and hm.status = 'verified'
            and h.status = 'active'
            and cu.status = 'active'
        )
      )
  `;

  return ok({
    unreadCount: Number(unreadRows[0]?.unread_count || 0),
    notifications: rows.map((row) => ({
      id: String(row.id),
      type: String(row.type),
      title: String(row.title),
      actor: row.actor_user_id
        ? { userId: String(row.actor_user_id), nickname: row.actor_nickname ? String(row.actor_nickname) : null }
        : null,
      resource: row.resource_type && row.resource_id
        ? { type: String(row.resource_type), id: String(row.resource_id) }
        : null,
      readAt: row.read_at ?? null,
      createdAt: row.created_at
    }))
  }, requestId);
}

async function markNotificationRead(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  notificationId: string
): Promise<Response> {
  const actor = await requireNotificationActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;
  const rows = await sql`
    update notifications n
    set read_at = coalesce(n.read_at, now())
    where n.id = ${notificationId}::uuid
      and n.user_id = ${actor.id}::uuid
      and (
        n.complex_id is null
        or exists (
          select 1
          from household_memberships hm
          join households h on h.id = hm.household_id and h.complex_id = hm.complex_id
          join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
          where hm.user_id = ${actor.id}::uuid
            and hm.complex_id = n.complex_id
            and hm.status = 'verified'
            and h.status = 'active'
            and cu.status = 'active'
        )
      )
    returning n.id, n.read_at
  `;
  if (!rows[0]) return fail('NOTIFICATION_NOT_FOUND', 'Notification not found', 404, requestId);
  return ok({ id: String(rows[0].id), readAt: rows[0].read_at }, requestId);
}

async function markAllNotificationsRead(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response> {
  const actor = await requireNotificationActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;
  const rows = await sql`
    update notifications n
    set read_at = now()
    where n.user_id = ${actor.id}::uuid
      and n.read_at is null
      and (
        n.complex_id is null
        or exists (
          select 1
          from household_memberships hm
          join households h on h.id = hm.household_id and h.complex_id = hm.complex_id
          join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
          where hm.user_id = ${actor.id}::uuid
            and hm.complex_id = n.complex_id
            and hm.status = 'verified'
            and h.status = 'active'
            and cu.status = 'active'
        )
      )
    returning n.id
  `;
  return ok({ updatedCount: rows.length }, requestId);
}

export async function handleResidentNotificationWithSql(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/api/v1/me/notifications') {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return listNotifications(request, env, sql, requestId);
  }
  if (path === '/api/v1/me/notifications/read-all') {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return markAllNotificationsRead(request, env, sql, requestId);
  }
  const match = path.match(/^\/api\/v1\/me\/notifications\/([0-9a-fA-F-]+)\/read$/);
  if (match) {
    const notificationId = canonicalUuid(match[1]);
    if (!notificationId) return fail('VALIDATION_ERROR', 'Invalid notification id', 400, requestId);
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return markNotificationRead(request, env, sql, requestId, notificationId);
  }
  return null;
}

export async function handleResidentNotificationRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/v1/me/notifications')) return null;
  return handleResidentNotificationWithSql(request, env, sqlFor(env), requestId);
}
