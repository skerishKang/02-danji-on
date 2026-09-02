import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireVerifiedResident } from './authorization-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;
type CommunityEnv = CoreEnv & {
  COMMUNITY_PUBLISH_MODE?: string;
};

type PostKind = 'question' | 'together' | 'resident_story' | 'life_report';
type ReportReason = 'abuse' | 'threat' | 'privacy' | 'defamation_risk' | 'spam' | 'other';

const POST_KINDS = new Set<PostKind>(['question', 'together', 'resident_story', 'life_report']);
const REPORT_REASONS = new Set<ReportReason>(['abuse', 'threat', 'privacy', 'defamation_risk', 'spam', 'other']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validId(value: string): boolean {
  return UUID_RE.test(value);
}

function publishMode(env: CommunityEnv): 'immediate' | 'review' {
  return env.COMMUNITY_PUBLISH_MODE === 'immediate' ? 'immediate' : 'review';
}

function publication(mode: 'immediate' | 'review'): { status: 'published' | 'pending_review'; publishedAt: Date | null } {
  return mode === 'immediate'
    ? { status: 'published', publishedAt: new Date() }
    : { status: 'pending_review', publishedAt: null };
}

function asDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapPost(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    kind: String(row.kind),
    title: String(row.title),
    body: String(row.body),
    status: String(row.status),
    author: { nickname: String(row.author_nickname ?? '') },
    reactionCount: Number(row.reaction_count ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    viewerLiked: Boolean(row.viewer_liked),
    publishedAt: asDate(row.published_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at)
  };
}

function mapComment(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    postId: String(row.post_id),
    body: String(row.body),
    status: String(row.status),
    author: { nickname: String(row.author_nickname ?? '') },
    publishedAt: asDate(row.published_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at)
  };
}

async function postExistsForResident(sql: Sql, complexId: string, postId: string, actorId: string) {
  const rows = await sql`
    select id, author_user_id, status
    from community_posts
    where id = ${postId}::uuid
      and complex_id = ${complexId}::uuid
      and status <> 'deleted'
      and (status = 'published' or author_user_id = ${actorId}::uuid)
    limit 1
  `;
  return rows[0];
}

export async function handleCommunityResidentRequest(
  request: Request,
  env: CommunityEnv,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const feedMatch = path.match(/^\/api\/v1\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/community\/posts$/);
  const postMatch = path.match(/^\/api\/v1\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/community\/posts\/([0-9a-fA-F-]+)$/);
  const commentsMatch = path.match(/^\/api\/v1\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/community\/posts\/([0-9a-fA-F-]+)\/comments$/);
  const commentMatch = path.match(/^\/api\/v1\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/community\/comments\/([0-9a-fA-F-]+)$/);
  const reactionsMatch = path.match(/^\/api\/v1\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/community\/posts\/([0-9a-fA-F-]+)\/reactions$/);
  const reportsMatch = path.match(/^\/api\/v1\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/community\/reports$/);

  if (!feedMatch && !postMatch && !commentsMatch && !commentMatch && !reactionsMatch && !reportsMatch) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const match = feedMatch || postMatch || commentsMatch || commentMatch || reactionsMatch || reportsMatch;
  const complexSlug = match![1];
  const sql: Sql = neon(env.DATABASE_URL);
  const residentOrResponse = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (residentOrResponse instanceof Response) return residentOrResponse;
  const resident = residentOrResponse;

  if (feedMatch && request.method === 'GET') {
    const rawKind = text(url.searchParams.get('kind'));
    const kind = rawKind && POST_KINDS.has(rawKind as PostKind) ? rawKind as PostKind : null;
    if (rawKind && !kind) return fail('VALIDATION_ERROR', 'Invalid community post kind', 400, requestId);
    const rawLimit = Number(url.searchParams.get('limit') || '20');
    const limit = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 50 ? rawLimit : 20;

    const rows = kind
      ? await sql`
          select p.id, p.kind, p.title, p.body, p.status, p.published_at, p.created_at, p.updated_at,
                 u.display_name as author_nickname,
                 (select count(*) from community_reactions r where r.post_id = p.id and r.reaction_type = 'like')::int as reaction_count,
                 (select count(*) from community_comments c where c.post_id = p.id and c.status = 'published')::int as comment_count,
                 exists(select 1 from community_reactions vr where vr.post_id = p.id and vr.user_id = ${resident.id}::uuid and vr.reaction_type = 'like') as viewer_liked
          from community_posts p
          join app_users u on u.id = p.author_user_id
          where p.complex_id = ${resident.complexId}::uuid
            and p.status = 'published'
            and p.visibility = 'verified_residents'
            and p.kind = ${kind}
          order by p.published_at desc, p.created_at desc
          limit ${limit}
        `
      : await sql`
          select p.id, p.kind, p.title, p.body, p.status, p.published_at, p.created_at, p.updated_at,
                 u.display_name as author_nickname,
                 (select count(*) from community_reactions r where r.post_id = p.id and r.reaction_type = 'like')::int as reaction_count,
                 (select count(*) from community_comments c where c.post_id = p.id and c.status = 'published')::int as comment_count,
                 exists(select 1 from community_reactions vr where vr.post_id = p.id and vr.user_id = ${resident.id}::uuid and vr.reaction_type = 'like') as viewer_liked
          from community_posts p
          join app_users u on u.id = p.author_user_id
          where p.complex_id = ${resident.complexId}::uuid
            and p.status = 'published'
            and p.visibility = 'verified_residents'
          order by p.published_at desc, p.created_at desc
          limit ${limit}
        `;
    return ok(rows.map((row) => mapPost(row as Record<string, unknown>)), requestId);
  }

  if (feedMatch && request.method === 'POST') {
    const payload = await bodyJson(request, requestId);
    if (payload instanceof Response) return payload;
    const kind = text(payload.kind) as PostKind;
    const title = text(payload.title);
    const body = text(payload.body);
    if (!POST_KINDS.has(kind)) return fail('VALIDATION_ERROR', 'Invalid community post kind', 400, requestId);
    if (title.length < 1 || title.length > 160) return fail('VALIDATION_ERROR', 'Title must be 1-160 characters', 400, requestId);
    if (body.length < 1 || body.length > 10000) return fail('VALIDATION_ERROR', 'Body must be 1-10000 characters', 400, requestId);

    const mode = publishMode(env);
    const next = publication(mode);
    const rows = await sql`
      insert into community_posts (complex_id, author_user_id, kind, title, body, status, published_at)
      values (${resident.complexId}::uuid, ${resident.id}::uuid, ${kind}, ${title}, ${body}, ${next.status}, ${next.publishedAt})
      returning id, kind, title, body, status, published_at, created_at, updated_at
    `;
    const row = rows[0] as Record<string, unknown>;
    row.author_nickname = resident.displayName;
    row.reaction_count = 0;
    row.comment_count = 0;
    row.viewer_liked = false;
    return ok(mapPost(row), requestId, 201);
  }

  if (postMatch) {
    const postId = postMatch[2];
    if (!validId(postId)) return fail('NOT_FOUND', 'Community post not found', 404, requestId);

    if (request.method === 'GET') {
      const rows = await sql`
        select p.id, p.kind, p.title, p.body, p.status, p.published_at, p.created_at, p.updated_at,
               u.display_name as author_nickname,
               (select count(*) from community_reactions r where r.post_id = p.id and r.reaction_type = 'like')::int as reaction_count,
               (select count(*) from community_comments c where c.post_id = p.id and c.status = 'published')::int as comment_count,
               exists(select 1 from community_reactions vr where vr.post_id = p.id and vr.user_id = ${resident.id}::uuid and vr.reaction_type = 'like') as viewer_liked
        from community_posts p
        join app_users u on u.id = p.author_user_id
        where p.id = ${postId}::uuid
          and p.complex_id = ${resident.complexId}::uuid
          and p.visibility = 'verified_residents'
          and p.status <> 'deleted'
          and (p.status = 'published' or p.author_user_id = ${resident.id}::uuid)
        limit 1
      `;
      if (!rows[0]) return fail('NOT_FOUND', 'Community post not found', 404, requestId);
      return ok(mapPost(rows[0] as Record<string, unknown>), requestId);
    }

    if (request.method === 'PATCH') {
      const payload = await bodyJson(request, requestId);
      if (payload instanceof Response) return payload;
      const title = text(payload.title);
      const body = text(payload.body);
      if (title.length < 1 || title.length > 160) return fail('VALIDATION_ERROR', 'Title must be 1-160 characters', 400, requestId);
      if (body.length < 1 || body.length > 10000) return fail('VALIDATION_ERROR', 'Body must be 1-10000 characters', 400, requestId);
      const mode = publishMode(env);
      const next = publication(mode);
      const rows = await sql`
        update community_posts
        set title = ${title}, body = ${body}, status = ${next.status}, published_at = ${next.publishedAt}, hidden_at = null
        where id = ${postId}::uuid
          and complex_id = ${resident.complexId}::uuid
          and author_user_id = ${resident.id}::uuid
          and status <> 'deleted'
        returning id, kind, title, body, status, published_at, created_at, updated_at
      `;
      if (!rows[0]) return fail('NOT_FOUND', 'Community post not found', 404, requestId);
      const row = rows[0] as Record<string, unknown>;
      row.author_nickname = resident.displayName;
      row.reaction_count = 0;
      row.comment_count = 0;
      row.viewer_liked = false;
      return ok(mapPost(row), requestId);
    }

    if (request.method === 'DELETE') {
      const rows = await sql`
        update community_posts
        set status = 'deleted', deleted_at = coalesce(deleted_at, now())
        where id = ${postId}::uuid
          and complex_id = ${resident.complexId}::uuid
          and author_user_id = ${resident.id}::uuid
          and status <> 'deleted'
        returning id
      `;
      if (!rows[0]) return fail('NOT_FOUND', 'Community post not found', 404, requestId);
      return ok({ id: postId, status: 'deleted' }, requestId);
    }
  }

  if (commentsMatch) {
    const postId = commentsMatch[2];
    if (!validId(postId)) return fail('NOT_FOUND', 'Community post not found', 404, requestId);
    const post = await postExistsForResident(sql, resident.complexId, postId, resident.id);
    if (!post) return fail('NOT_FOUND', 'Community post not found', 404, requestId);

    if (request.method === 'GET') {
      const rows = await sql`
        select c.id, c.post_id, c.body, c.status, c.published_at, c.created_at, c.updated_at,
               u.display_name as author_nickname
        from community_comments c
        join app_users u on u.id = c.author_user_id
        where c.post_id = ${postId}::uuid
          and c.complex_id = ${resident.complexId}::uuid
          and c.parent_comment_id is null
          and c.status <> 'deleted'
          and (c.status = 'published' or c.author_user_id = ${resident.id}::uuid)
        order by c.created_at asc
      `;
      return ok(rows.map((row) => mapComment(row as Record<string, unknown>)), requestId);
    }

    if (request.method === 'POST') {
      const payload = await bodyJson(request, requestId);
      if (payload instanceof Response) return payload;
      const body = text(payload.body);
      if (body.length < 1 || body.length > 300) return fail('VALIDATION_ERROR', 'Comment must be 1-300 characters', 400, requestId);
      const mode = publishMode(env);
      const next = publication(mode);
      const rows = await sql`
        insert into community_comments (complex_id, post_id, author_user_id, body, status, published_at)
        values (${resident.complexId}::uuid, ${postId}::uuid, ${resident.id}::uuid, ${body}, ${next.status}, ${next.publishedAt})
        returning id, post_id, body, status, published_at, created_at, updated_at
      `;
      const row = rows[0] as Record<string, unknown>;
      row.author_nickname = resident.displayName;
      return ok(mapComment(row), requestId, 201);
    }
  }

  if (commentMatch && request.method === 'DELETE') {
    const commentId = commentMatch[2];
    if (!validId(commentId)) return fail('NOT_FOUND', 'Community comment not found', 404, requestId);
    const rows = await sql`
      update community_comments
      set status = 'deleted', deleted_at = coalesce(deleted_at, now())
      where id = ${commentId}::uuid
        and complex_id = ${resident.complexId}::uuid
        and author_user_id = ${resident.id}::uuid
        and status <> 'deleted'
      returning id
    `;
    if (!rows[0]) return fail('NOT_FOUND', 'Community comment not found', 404, requestId);
    return ok({ id: commentId, status: 'deleted' }, requestId);
  }

  if (reactionsMatch) {
    const postId = reactionsMatch[2];
    if (!validId(postId)) return fail('NOT_FOUND', 'Community post not found', 404, requestId);
    const post = await postExistsForResident(sql, resident.complexId, postId, resident.id);
    if (!post || String(post.status) !== 'published') return fail('NOT_FOUND', 'Community post not found', 404, requestId);

    if (request.method === 'POST') {
      await sql`
        insert into community_reactions (complex_id, post_id, user_id, reaction_type)
        values (${resident.complexId}::uuid, ${postId}::uuid, ${resident.id}::uuid, 'like')
        on conflict (post_id, user_id, reaction_type) do nothing
      `;
      return ok({ postId, reactionType: 'like', active: true }, requestId);
    }

    if (request.method === 'DELETE') {
      await sql`
        delete from community_reactions
        where complex_id = ${resident.complexId}::uuid
          and post_id = ${postId}::uuid
          and user_id = ${resident.id}::uuid
          and reaction_type = 'like'
      `;
      return ok({ postId, reactionType: 'like', active: false }, requestId);
    }
  }

  if (reportsMatch && request.method === 'POST') {
    const payload = await bodyJson(request, requestId);
    if (payload instanceof Response) return payload;
    const targetType = text(payload.targetType);
    const targetId = text(payload.targetId);
    const reason = text(payload.reason) as ReportReason;
    const detail = text(payload.detail);
    if ((targetType !== 'post' && targetType !== 'comment') || !validId(targetId)) {
      return fail('VALIDATION_ERROR', 'Valid targetType and targetId are required', 400, requestId);
    }
    if (!REPORT_REASONS.has(reason)) return fail('VALIDATION_ERROR', 'Invalid report reason', 400, requestId);
    if (detail.length > 1000) return fail('VALIDATION_ERROR', 'Report detail must be at most 1000 characters', 400, requestId);

    const targetRows = targetType === 'post'
      ? await sql`
          select id from community_posts
          where id = ${targetId}::uuid and complex_id = ${resident.complexId}::uuid and status = 'published'
          limit 1
        `
      : await sql`
          select c.id
          from community_comments c
          join community_posts p on p.id = c.post_id and p.complex_id = c.complex_id
          where c.id = ${targetId}::uuid
            and c.complex_id = ${resident.complexId}::uuid
            and c.status = 'published'
            and p.status = 'published'
          limit 1
        `;
    if (!targetRows[0]) return fail('NOT_FOUND', 'Report target not found', 404, requestId);

    const postId = targetType === 'post' ? targetId : null;
    const commentId = targetType === 'comment' ? targetId : null;
    try {
      const rows = await sql`
        insert into community_reports (complex_id, reporter_user_id, post_id, comment_id, reason, detail)
        values (${resident.complexId}::uuid, ${resident.id}::uuid, ${postId}::uuid, ${commentId}::uuid, ${reason}, ${detail || null})
        returning id, status, created_at
      `;
      return ok({ id: String(rows[0].id), status: String(rows[0].status), createdAt: asDate(rows[0].created_at) }, requestId, 201);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : '';
      if (code === '23505') return ok({ status: 'already_reported' }, requestId);
      throw error;
    }
  }

  return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
}
