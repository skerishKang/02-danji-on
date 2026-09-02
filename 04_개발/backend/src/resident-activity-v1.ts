import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireVerifiedResident } from './authorization-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

type ActivityCursor = {
  at: string;
  type: 'post' | 'comment' | 'reply' | 'reaction' | 'review';
  id: string;
};

type CursorParseResult =
  | { ok: true; cursor: ActivityCursor | null }
  | { ok: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILTERS = new Set(['all', 'posts', 'comments', 'reactions', 'reviews']);
const CURSOR_TYPES = new Set(['post', 'comment', 'reply', 'reaction', 'review']);
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_CURSOR_LENGTH = 512;

function ok(data: unknown, requestId: string): Response {
  return Response.json({ data, requestId }, {
    status: 200,
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

function base64UrlEncode(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

function encodeCursor(row: Record<string, unknown>): string {
  return base64UrlEncode(JSON.stringify({
    at: new Date(String(row.occurred_at)).toISOString(),
    type: String(row.activity_type),
    id: String(row.id).toLowerCase()
  }));
}

function parseCursor(value: string | null): CursorParseResult {
  if (!value) return { ok: true, cursor: null };
  if (value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) return { ok: false };
  try {
    const parsed = JSON.parse(base64UrlDecode(value)) as Record<string, unknown>;
    const at = typeof parsed.at === 'string' ? parsed.at : '';
    const type = typeof parsed.type === 'string' ? parsed.type : '';
    const id = typeof parsed.id === 'string' ? parsed.id.toLowerCase() : '';
    const date = new Date(at);
    if (!at || Number.isNaN(date.getTime()) || !CURSOR_TYPES.has(type) || !UUID.test(id)) return { ok: false };
    return {
      ok: true,
      cursor: {
        at: date.toISOString(),
        type: type as ActivityCursor['type'],
        id
      }
    };
  } catch {
    return { ok: false };
  }
}

function parseLimit(value: string | null): number | null {
  if (!value) return DEFAULT_LIMIT;
  if (!/^[0-9]{1,3}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_LIMIT ? parsed : null;
}

function mapActivity(row: Record<string, unknown>) {
  return {
    type: String(row.activity_type),
    id: String(row.id),
    occurredAt: row.occurred_at,
    status: String(row.status),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    parentCommentId: row.parent_comment_id ? String(row.parent_comment_id) : null,
    title: row.title ? String(row.title) : null,
    bodyPreview: row.body_preview ? String(row.body_preview) : null
  };
}

export async function handleResidentActivityWithSql(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/v1/me/activity') return null;
  if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);

  const complexSlug = (url.searchParams.get('complexSlug') || '').trim();
  if (!complexSlug) return fail('VALIDATION_ERROR', 'complexSlug is required', 400, requestId);

  const filter = (url.searchParams.get('type') || 'all').trim();
  if (!FILTERS.has(filter)) {
    return fail('VALIDATION_ERROR', 'type must be all, posts, comments, reactions or reviews', 400, requestId);
  }

  const limit = parseLimit(url.searchParams.get('limit'));
  if (!limit) return fail('VALIDATION_ERROR', `limit must be an integer from 1 to ${MAX_LIMIT}`, 400, requestId);

  const cursorResult = parseCursor(url.searchParams.get('cursor'));
  if (!cursorResult.ok) return fail('VALIDATION_ERROR', 'Invalid activity cursor', 400, requestId);

  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;

  const cursorAt = cursorResult.cursor?.at ?? null;
  const cursorType = cursorResult.cursor?.type ?? null;
  const cursorId = cursorResult.cursor?.id ?? null;
  const fetchLimit = limit + 1;

  const rows = await sql`
    with activity as (
      select
        'post'::text as activity_type,
        p.id,
        p.created_at as occurred_at,
        p.status,
        'community_post'::text as target_type,
        p.id as target_id,
        null::uuid as parent_comment_id,
        case when p.status in ('pending_review','published') then p.title else null end as title,
        case when p.status in ('pending_review','published') then left(p.body, 280) else null end as body_preview
      from community_posts p
      where p.complex_id = ${resident.complexId}::uuid
        and p.author_user_id = ${resident.id}::uuid

      union all

      select
        case when c.parent_comment_id is null then 'comment'::text else 'reply'::text end as activity_type,
        c.id,
        c.created_at as occurred_at,
        c.status,
        'community_post'::text as target_type,
        c.post_id as target_id,
        c.parent_comment_id,
        case when p.status in ('pending_review','published') then p.title else null end as title,
        case when c.status in ('pending_review','published') then left(c.body, 280) else null end as body_preview
      from community_comments c
      join community_posts p
        on p.id = c.post_id
       and p.complex_id = c.complex_id
      where c.complex_id = ${resident.complexId}::uuid
        and c.author_user_id = ${resident.id}::uuid

      union all

      select
        'reaction'::text as activity_type,
        r.id,
        r.created_at as occurred_at,
        p.status,
        'community_post'::text as target_type,
        r.post_id as target_id,
        null::uuid as parent_comment_id,
        case when p.status = 'published' then p.title else null end as title,
        null::text as body_preview
      from community_reactions r
      join community_posts p
        on p.id = r.post_id
       and p.complex_id = r.complex_id
      where r.complex_id = ${resident.complexId}::uuid
        and r.user_id = ${resident.id}::uuid

      union all

      select
        'review'::text as activity_type,
        br.id,
        br.created_at as occurred_at,
        br.status,
        'business'::text as target_type,
        br.business_id as target_id,
        null::uuid as parent_comment_id,
        b.name as title,
        case when br.status = 'active' then left(br.body, 280) else null end as body_preview
      from business_reviews br
      join businesses b on b.id = br.business_id
      where br.complex_id = ${resident.complexId}::uuid
        and br.author_user_id = ${resident.id}::uuid
    )
    select activity_type, id, occurred_at, status, target_type, target_id,
           parent_comment_id, title, body_preview
    from activity
    where (
      ${filter} = 'all'
      or (${filter} = 'posts' and activity_type = 'post')
      or (${filter} = 'comments' and activity_type in ('comment','reply'))
      or (${filter} = 'reactions' and activity_type = 'reaction')
      or (${filter} = 'reviews' and activity_type = 'review')
    )
      and (
        ${cursorAt}::text is null
        or (occurred_at, activity_type, id::text) <
           (${cursorAt}::timestamptz, ${cursorType}::text, ${cursorId}::text)
      )
    order by occurred_at desc, activity_type desc, id::text desc
    limit ${fetchLimit}
  `;

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1] as Record<string, unknown> | undefined;

  return ok({
    items: pageRows.map((row) => mapActivity(row as Record<string, unknown>)),
    nextCursor: hasMore && last ? encodeCursor(last) : null
  }, requestId);
}

export async function handleResidentActivityRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/v1/me/activity') return null;
  return handleResidentActivityWithSql(request, env, sqlFor(env), requestId);
}
