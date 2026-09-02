import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import { requireVerifiedResident, type VerifiedResident } from './authorization-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_MESSAGE_CHARS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ResidentConversationAccess = {
  resident: VerifiedResident;
  conversationId: string;
  complexId: string;
  complexSlug: string;
};

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

function canonicalUuid(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return UUID.test(text) ? text : null;
}

function residentPairKey(left: string, right: string): string {
  return [left.toLowerCase(), right.toLowerCase()].sort().join(':');
}

async function bodyJson(request: Request, requestId: string): Promise<Record<string, unknown> | Response> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return fail('CONTENT_TYPE_REQUIRED', 'application/json required', 415, requestId);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text || '{}');
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('INVALID_JSON', 'JSON object required', 400, requestId);
  }
  return parsed as Record<string, unknown>;
}

async function isBlocked(sql: Sql, leftUserId: string, rightUserId: string): Promise<boolean> {
  const rows = await sql`
    select 1 from blocks
    where (blocker_user_id = ${leftUserId}::uuid and blocked_user_id = ${rightUserId}::uuid)
       or (blocker_user_id = ${rightUserId}::uuid and blocked_user_id = ${leftUserId}::uuid)
    limit 1
  `;
  return Boolean(rows[0]);
}

async function verifiedTargetInComplex(sql: Sql, userId: string, complexId: string): Promise<boolean> {
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

async function requireResidentConversation(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  conversationId: string
): Promise<ResidentConversationAccess | Response> {
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;
  const rows = await sql`
    select c.id, c.complex_id, c.type, cx.slug as complex_slug
    from conversation_members cm
    join conversations c on c.id = cm.conversation_id
    join complexes cx on cx.id = c.complex_id
    where cm.conversation_id = ${conversationId}::uuid
      and cm.user_id = ${actor.id}::uuid
    limit 1
  `;
  const row = rows[0];
  if (!row) return fail('CONVERSATION_NOT_FOUND', 'Conversation not found', 404, requestId);
  if (String(row.type) !== 'resident') {
    return fail('CONVERSATION_TYPE_UNSUPPORTED', 'Conversation type is not supported by this endpoint', 409, requestId);
  }
  const resident = await requireVerifiedResident(request, env, sql, requestId, String(row.complex_slug));
  if (resident instanceof Response) return resident;
  if (resident.complexId !== String(row.complex_id)) {
    return fail('CONVERSATION_FORBIDDEN', 'Conversation access is no longer available', 403, requestId);
  }
  return {
    resident,
    conversationId: String(row.id),
    complexId: String(row.complex_id),
    complexSlug: String(row.complex_slug)
  };
}

async function otherResidentId(sql: Sql, conversationId: string, actorUserId: string): Promise<string | null> {
  const rows = await sql`
    select user_id
    from conversation_members
    where conversation_id = ${conversationId}::uuid
      and user_id <> ${actorUserId}::uuid
    order by user_id
    limit 2
  `;
  return rows.length === 1 ? String(rows[0].user_id) : null;
}

async function listConversations(request: Request, env: CoreEnv, sql: Sql, requestId: string): Promise<Response> {
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;
  const rows = await sql`
    select
      c.id,
      cx.slug as complex_slug,
      other.user_id as participant_user_id,
      other_user.display_name as participant_nickname,
      latest.body as latest_message_body,
      latest.created_at as latest_message_at,
      coalesce(unread.unread_count, 0)::int as unread_count,
      c.created_at,
      c.updated_at
    from conversation_members mine
    join conversations c on c.id = mine.conversation_id
    join complexes cx on cx.id = c.complex_id
    join conversation_members other on other.conversation_id = c.id and other.user_id <> mine.user_id
    join app_users other_user on other_user.id = other.user_id and other_user.account_status = 'active'
    left join lateral (
      select m.body, m.created_at
      from messages m
      where m.conversation_id = c.id and m.deleted_at is null
      order by m.created_at desc, m.id desc
      limit 1
    ) latest on true
    left join lateral (
      select count(*)::int as unread_count
      from messages m
      where m.conversation_id = c.id
        and m.sender_user_id <> mine.user_id
        and m.deleted_at is null
        and (mine.last_read_at is null or m.created_at > mine.last_read_at)
    ) unread on true
    where mine.user_id = ${actor.id}::uuid
      and c.type = 'resident'
      and exists (
        select 1
        from household_memberships hm
        join households h on h.id = hm.household_id and h.complex_id = hm.complex_id
        join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
        where hm.user_id = ${actor.id}::uuid
          and hm.complex_id = c.complex_id
          and hm.status = 'verified'
          and h.status = 'active'
          and cu.status = 'active'
      )
    order by latest.created_at desc nulls last, c.updated_at desc, c.created_at desc
  `;
  return ok({
    conversations: rows.map((row) => ({
      id: String(row.id),
      complexSlug: String(row.complex_slug),
      participant: { userId: String(row.participant_user_id), nickname: String(row.participant_nickname) },
      latestMessage: row.latest_message_at ? { body: String(row.latest_message_body ?? ''), createdAt: row.latest_message_at } : null,
      unreadCount: Number(row.unread_count || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }, requestId);
}

async function startConversation(request: Request, env: CoreEnv, sql: Sql, requestId: string): Promise<Response> {
  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const complexSlug = typeof payload.complexSlug === 'string' ? payload.complexSlug.trim() : '';
  const participantUserId = canonicalUuid(payload.participantUserId);
  if (!complexSlug || !participantUserId) {
    return fail('VALIDATION_ERROR', 'complexSlug and participantUserId are required', 400, requestId);
  }
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  if (participantUserId === resident.id.toLowerCase()) {
    return fail('VALIDATION_ERROR', 'Cannot start a conversation with yourself', 400, requestId);
  }
  if (!(await verifiedTargetInComplex(sql, participantUserId, resident.complexId))) {
    return fail('RECIPIENT_UNAVAILABLE', 'Recipient is not available for resident messaging', 404, requestId);
  }
  if (await isBlocked(sql, resident.id, participantUserId)) {
    return fail('MESSAGE_BLOCKED', 'Messaging is unavailable for this relationship', 403, requestId);
  }

  const pairKey = residentPairKey(resident.id, participantUserId);
  const candidateId = crypto.randomUUID();
  const [createdRows] = await sql.transaction([
    sql`
      insert into conversations (id, complex_id, type, resident_pair_key)
      values (${candidateId}::uuid, ${resident.complexId}::uuid, 'resident', ${pairKey})
      on conflict (complex_id, resident_pair_key) where type = 'resident' do nothing
      returning id
    `,
    sql`
      insert into conversation_members (conversation_id, user_id, last_read_at)
      select id, ${resident.id}::uuid, now()
      from conversations
      where complex_id = ${resident.complexId}::uuid and type = 'resident' and resident_pair_key = ${pairKey}
      on conflict (conversation_id, user_id) do nothing
    `,
    sql`
      insert into conversation_members (conversation_id, user_id)
      select id, ${participantUserId}::uuid
      from conversations
      where complex_id = ${resident.complexId}::uuid and type = 'resident' and resident_pair_key = ${pairKey}
      on conflict (conversation_id, user_id) do nothing
    `
  ]);
  const rows = await sql`
    select id, created_at, updated_at
    from conversations
    where complex_id = ${resident.complexId}::uuid and type = 'resident' and resident_pair_key = ${pairKey}
    limit 1
  `;
  const row = rows[0];
  if (!row) return fail('CONVERSATION_CREATE_FAILED', 'Conversation could not be created', 500, requestId);
  const created = Array.isArray(createdRows) && createdRows.length > 0;
  return ok({
    id: String(row.id), participantUserId, created, createdAt: row.created_at, updatedAt: row.updated_at
  }, requestId, created ? 201 : 200);
}

async function listMessages(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  conversationId: string
): Promise<Response> {
  const access = await requireResidentConversation(request, env, sql, requestId, conversationId);
  if (access instanceof Response) return access;
  const rows = await sql`
    select id, sender_user_id, body, created_at, deleted_at
    from messages
    where conversation_id = ${conversationId}::uuid
    order by created_at asc, id asc
    limit 100
  `;
  return ok({
    conversationId,
    messages: rows.map((row) => ({
      id: String(row.id),
      senderUserId: String(row.sender_user_id),
      body: row.deleted_at ? null : String(row.body),
      createdAt: row.created_at,
      deletedAt: row.deleted_at ?? null
    }))
  }, requestId);
}

async function sendMessage(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  conversationId: string
): Promise<Response> {
  const access = await requireResidentConversation(request, env, sql, requestId, conversationId);
  if (access instanceof Response) return access;
  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!body || body.length > MAX_MESSAGE_CHARS) {
    return fail('VALIDATION_ERROR', `body must be 1-${MAX_MESSAGE_CHARS} characters`, 400, requestId);
  }
  const otherUserId = await otherResidentId(sql, conversationId, access.resident.id);
  if (!otherUserId) return fail('CONVERSATION_INVALID', 'Resident conversation participant state is invalid', 409, requestId);
  if (!(await verifiedTargetInComplex(sql, otherUserId, access.complexId))) {
    return fail('RECIPIENT_UNAVAILABLE', 'Recipient is no longer available for resident messaging', 409, requestId);
  }
  if (await isBlocked(sql, access.resident.id, otherUserId)) {
    return fail('MESSAGE_BLOCKED', 'Messaging is unavailable for this relationship', 403, requestId);
  }
  const [inserted] = await sql.transaction([
    sql`
      insert into messages (conversation_id, sender_user_id, body)
      values (${conversationId}::uuid, ${access.resident.id}::uuid, ${body})
      returning id, sender_user_id, body, created_at
    `,
    sql`
      update conversation_members set last_read_at = now()
      where conversation_id = ${conversationId}::uuid and user_id = ${access.resident.id}::uuid
    `,
    sql`update conversations set updated_at = now() where id = ${conversationId}::uuid`
  ]);
  const row = Array.isArray(inserted) ? inserted[0] : null;
  if (!row) return fail('MESSAGE_SEND_FAILED', 'Message could not be sent', 500, requestId);
  return ok({
    id: String(row.id), conversationId, senderUserId: String(row.sender_user_id), body: String(row.body), createdAt: row.created_at
  }, requestId, 201);
}

async function markRead(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  conversationId: string
): Promise<Response> {
  const access = await requireResidentConversation(request, env, sql, requestId, conversationId);
  if (access instanceof Response) return access;
  const rows = await sql`
    update conversation_members set last_read_at = now()
    where conversation_id = ${conversationId}::uuid and user_id = ${access.resident.id}::uuid
    returning last_read_at
  `;
  if (!rows[0]) return fail('CONVERSATION_NOT_FOUND', 'Conversation not found', 404, requestId);
  return ok({ conversationId, readAt: rows[0].last_read_at }, requestId);
}

export async function handleResidentMessageWithSql(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/api/v1/me/conversations') {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return listConversations(request, env, sql, requestId);
  }
  if (path === '/api/v1/conversations') {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return startConversation(request, env, sql, requestId);
  }
  let match = path.match(/^\/api\/v1\/conversations\/([0-9a-fA-F-]+)\/messages$/);
  if (match) {
    const conversationId = canonicalUuid(match[1]);
    if (!conversationId) return fail('VALIDATION_ERROR', 'Invalid conversation id', 400, requestId);
    if (request.method === 'GET') return listMessages(request, env, sql, requestId, conversationId);
    if (request.method === 'POST') return sendMessage(request, env, sql, requestId, conversationId);
    return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
  }
  match = path.match(/^\/api\/v1\/conversations\/([0-9a-fA-F-]+)\/read$/);
  if (match) {
    const conversationId = canonicalUuid(match[1]);
    if (!conversationId) return fail('VALIDATION_ERROR', 'Invalid conversation id', 400, requestId);
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return markRead(request, env, sql, requestId, conversationId);
  }
  return null;
}

export async function handleResidentMessageRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== '/api/v1/me/conversations' && !path.startsWith('/api/v1/conversations')) return null;
  return handleResidentMessageWithSql(request, env, sqlFor(env), requestId);
}
