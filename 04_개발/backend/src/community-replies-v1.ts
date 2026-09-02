import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireVerifiedResident } from './authorization-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;
type CommunityReplyEnv = CoreEnv & { COMMUNITY_PUBLISH_MODE?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_COMMENT_CHARS = 300;

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

function validUuid(value: string | undefined): value is string {
  return typeof value === 'string' && UUID.test(value);
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

function publication(env: CommunityReplyEnv): { status: 'published' | 'pending_review'; publishedAt: Date | null } {
  return env.COMMUNITY_PUBLISH_MODE === 'immediate'
    ? { status: 'published', publishedAt: new Date() }
    : { status: 'pending_review', publishedAt: null };
}

function asDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapReply(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    postId: String(row.post_id),
    parentCommentId: String(row.parent_comment_id),
    body: String(row.body),
    status: String(row.status),
    author: { nickname: String(row.author_nickname ?? '') },
    publishedAt: asDate(row.published_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at)
  };
}

async function visibleParent(
  sql: Sql,
  complexId: string,
  postId: string,
  parentCommentId: string,
  actorId: string
) {
  const rows = await sql`
    select c.id
    from community_comments c
    join community_posts p on p.id = c.post_id and p.complex_id = c.complex_id
    where c.id = ${parentCommentId}::uuid
      and c.post_id = ${postId}::uuid
      and c.complex_id = ${complexId}::uuid
      and c.status <> 'deleted'
      and (c.status = 'published' or c.author_user_id = ${actorId}::uuid)
      and p.status <> 'deleted'
      and (p.status = 'published' or p.author_user_id = ${actorId}::uuid)
    limit 1
  `;
  return rows[0] ?? null;
}

export async function handleCommunityReplyWithSql(
  request: Request,
  env: CommunityReplyEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const match = path.match(/^\/api\/v1\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/community\/posts\/([0-9a-fA-F-]+)\/comments\/([0-9a-fA-F-]+)\/replies$/);
  if (!match) return null;

  const complexSlug = match[1];
  const postId = match[2];
  const parentCommentId = match[3];
  if (!validUuid(postId) || !validUuid(parentCommentId)) {
    return fail('NOT_FOUND', 'Community comment not found', 404, requestId);
  }

  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  const parent = await visibleParent(sql, resident.complexId, postId, parentCommentId, resident.id);
  if (!parent) return fail('NOT_FOUND', 'Community comment not found', 404, requestId);

  if (request.method === 'GET') {
    const rows = await sql`
      select c.id, c.post_id, c.parent_comment_id, c.body, c.status,
             c.published_at, c.created_at, c.updated_at,
             u.display_name as author_nickname
      from community_comments c
      join app_users u on u.id = c.author_user_id and u.account_status = 'active'
      where c.parent_comment_id = ${parentCommentId}::uuid
        and c.post_id = ${postId}::uuid
        and c.complex_id = ${resident.complexId}::uuid
        and c.status <> 'deleted'
        and (c.status = 'published' or c.author_user_id = ${resident.id}::uuid)
      order by c.created_at asc, c.id asc
      limit 100
    `;
    return ok(rows.map((row) => mapReply(row as Record<string, unknown>)), requestId);
  }

  if (request.method === 'POST') {
    const payload = await bodyJson(request, requestId);
    if (payload instanceof Response) return payload;
    const body = typeof payload.body === 'string' ? payload.body.trim() : '';
    if (!body || body.length > MAX_COMMENT_CHARS) {
      return fail('VALIDATION_ERROR', `Comment must be 1-${MAX_COMMENT_CHARS} characters`, 400, requestId);
    }
    const next = publication(env);
    const rows = await sql`
      insert into community_comments (
        complex_id, post_id, parent_comment_id, author_user_id, body, status, published_at
      ) values (
        ${resident.complexId}::uuid,
        ${postId}::uuid,
        ${parentCommentId}::uuid,
        ${resident.id}::uuid,
        ${body},
        ${next.status},
        ${next.publishedAt}
      )
      returning id, post_id, parent_comment_id, body, status, published_at, created_at, updated_at
    `;
    const row = rows[0] as Record<string, unknown>;
    row.author_nickname = resident.displayName;
    return ok(mapReply(row), requestId, 201);
  }

  return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
}

export async function handleCommunityReplyRequest(
  request: Request,
  env: CommunityReplyEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.includes('/community/posts/') || !path.endsWith('/replies')) return null;
  return handleCommunityReplyWithSql(request, env, sqlFor(env), requestId);
}
