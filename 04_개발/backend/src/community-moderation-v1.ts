import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireOperationalAuthority } from './operational-authz-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

type ModerationAction = 'publish' | 'hide' | 'restore' | 'delete';
type ModerationEventAction = 'published' | 'hidden' | 'restored' | 'deleted';
type ReportDecision = 'resolved' | 'dismissed';

const ACTIONS = new Set<ModerationAction>(['publish', 'hide', 'restore', 'delete']);
const REPORT_DECISIONS = new Set<ReportDecision>(['resolved', 'dismissed']);
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

function asDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function eventAction(action: ModerationAction): ModerationEventAction {
  if (action === 'publish') return 'published';
  if (action === 'hide') return 'hidden';
  if (action === 'restore') return 'restored';
  return 'deleted';
}

async function activeComplex(sql: Sql, complexSlug: string) {
  const rows = await sql`
    select id, slug, name
    from complexes
    where slug = ${complexSlug}
      and status in ('active', 'pilot')
    limit 1
  `;
  return rows[0];
}

async function moderatePost(
  sql: Sql,
  complexId: string,
  postId: string,
  operatorId: string,
  action: ModerationAction,
  reasonCode: string | null,
  note: string | null
) {
  const auditAction = eventAction(action);

  if (action === 'publish' || action === 'restore') {
    const rows = await sql`
      with target as (
        update community_posts
        set status = 'published',
            published_at = coalesce(published_at, now()),
            hidden_at = null
        where id = ${postId}::uuid
          and complex_id = ${complexId}::uuid
          and status <> 'deleted'
        returning id, complex_id, status, published_at, hidden_at, deleted_at
      ), event as (
        insert into community_moderation_events (
          complex_id, post_id, actor_kind, operator_user_id, action, reason_code, note
        )
        select complex_id, id, 'operator', ${operatorId}::uuid, ${auditAction}, ${reasonCode}, ${note}
        from target
        returning id
      )
      select target.*, event.id as moderation_event_id
      from target cross join event
    `;
    return rows[0];
  }

  if (action === 'hide') {
    const rows = await sql`
      with target as (
        update community_posts
        set status = 'hidden', hidden_at = now()
        where id = ${postId}::uuid
          and complex_id = ${complexId}::uuid
          and status <> 'deleted'
        returning id, complex_id, status, published_at, hidden_at, deleted_at
      ), event as (
        insert into community_moderation_events (
          complex_id, post_id, actor_kind, operator_user_id, action, reason_code, note
        )
        select complex_id, id, 'operator', ${operatorId}::uuid, ${auditAction}, ${reasonCode}, ${note}
        from target
        returning id
      )
      select target.*, event.id as moderation_event_id
      from target cross join event
    `;
    return rows[0];
  }

  const rows = await sql`
    with target as (
      update community_posts
      set status = 'deleted', deleted_at = coalesce(deleted_at, now())
      where id = ${postId}::uuid
        and complex_id = ${complexId}::uuid
        and status <> 'deleted'
      returning id, complex_id, status, published_at, hidden_at, deleted_at
    ), event as (
      insert into community_moderation_events (
        complex_id, post_id, actor_kind, operator_user_id, action, reason_code, note
      )
      select complex_id, id, 'operator', ${operatorId}::uuid, ${auditAction}, ${reasonCode}, ${note}
      from target
      returning id
    )
    select target.*, event.id as moderation_event_id
    from target cross join event
  `;
  return rows[0];
}

async function moderateComment(
  sql: Sql,
  complexId: string,
  commentId: string,
  operatorId: string,
  action: ModerationAction,
  reasonCode: string | null,
  note: string | null
) {
  const auditAction = eventAction(action);

  if (action === 'publish' || action === 'restore') {
    const rows = await sql`
      with target as (
        update community_comments
        set status = 'published',
            published_at = coalesce(published_at, now()),
            hidden_at = null
        where id = ${commentId}::uuid
          and complex_id = ${complexId}::uuid
          and status <> 'deleted'
        returning id, complex_id, post_id, status, published_at, hidden_at, deleted_at
      ), event as (
        insert into community_moderation_events (
          complex_id, comment_id, actor_kind, operator_user_id, action, reason_code, note
        )
        select complex_id, id, 'operator', ${operatorId}::uuid, ${auditAction}, ${reasonCode}, ${note}
        from target
        returning id
      )
      select target.*, event.id as moderation_event_id
      from target cross join event
    `;
    return rows[0];
  }

  if (action === 'hide') {
    const rows = await sql`
      with target as (
        update community_comments
        set status = 'hidden', hidden_at = now()
        where id = ${commentId}::uuid
          and complex_id = ${complexId}::uuid
          and status <> 'deleted'
        returning id, complex_id, post_id, status, published_at, hidden_at, deleted_at
      ), event as (
        insert into community_moderation_events (
          complex_id, comment_id, actor_kind, operator_user_id, action, reason_code, note
        )
        select complex_id, id, 'operator', ${operatorId}::uuid, ${auditAction}, ${reasonCode}, ${note}
        from target
        returning id
      )
      select target.*, event.id as moderation_event_id
      from target cross join event
    `;
    return rows[0];
  }

  const rows = await sql`
    with target as (
      update community_comments
      set status = 'deleted', deleted_at = coalesce(deleted_at, now())
      where id = ${commentId}::uuid
        and complex_id = ${complexId}::uuid
        and status <> 'deleted'
      returning id, complex_id, post_id, status, published_at, hidden_at, deleted_at
    ), event as (
      insert into community_moderation_events (
        complex_id, comment_id, actor_kind, operator_user_id, action, reason_code, note
      )
      select complex_id, id, 'operator', ${operatorId}::uuid, ${auditAction}, ${reasonCode}, ${note}
      from target
      returning id
    )
    select target.*, event.id as moderation_event_id
    from target cross join event
  `;
  return rows[0];
}

async function resolveReport(
  sql: Sql,
  complexId: string,
  reportId: string,
  operatorId: string,
  decision: ReportDecision,
  reasonCode: string | null,
  note: string | null
) {
  const auditAction = decision === 'resolved' ? 'report_resolved' : 'report_dismissed';
  const rows = await sql`
    with target as (
      update community_reports
      set status = ${decision},
          resolved_by_user_id = ${operatorId}::uuid,
          resolved_at = now()
      where id = ${reportId}::uuid
        and complex_id = ${complexId}::uuid
        and status in ('submitted', 'reviewing')
      returning id, complex_id, post_id, comment_id, status, resolved_at
    ), event as (
      insert into community_moderation_events (
        complex_id, post_id, comment_id, actor_kind, operator_user_id, action, reason_code, note
      )
      select complex_id, post_id, comment_id, 'operator', ${operatorId}::uuid, ${auditAction}, ${reasonCode}, ${note}
      from target
      returning id
    )
    select target.*, event.id as moderation_event_id
    from target cross join event
  `;
  return rows[0];
}

export async function handleCommunityModerationRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const queueMatch = path.match(/^\/api\/v1\/operator\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/community\/moderation$/);
  const postMatch = path.match(/^\/api\/v1\/operator\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/community\/posts\/([0-9a-fA-F-]+)\/moderate$/);
  const commentMatch = path.match(/^\/api\/v1\/operator\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/community\/comments\/([0-9a-fA-F-]+)\/moderate$/);
  const reportMatch = path.match(/^\/api\/v1\/operator\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/community\/reports\/([0-9a-fA-F-]+)\/resolve$/);

  if (!queueMatch && !postMatch && !commentMatch && !reportMatch) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const match = queueMatch || postMatch || commentMatch || reportMatch;
  const complexSlug = match![1];
  const targetId = match?.[2] ?? null;
  if (targetId && !validId(targetId)) return fail('NOT_FOUND', 'Community moderation target not found', 404, requestId);

  const sql: Sql = neon(env.DATABASE_URL);
  const operatorOrResponse = await requireOperationalAuthority(
    request,
    env,
    sql,
    requestId,
    complexSlug,
    'community.moderate',
    'council.community.moderate'
  );
  if (operatorOrResponse instanceof Response) return operatorOrResponse;
  const operator = operatorOrResponse;

  const complex = await activeComplex(sql, complexSlug);
  if (!complex) return fail('NOT_FOUND', 'Apartment complex not found', 404, requestId);
  const complexId = String(complex.id);

  if (queueMatch) {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);

    const [posts, comments, reports] = await Promise.all([
      sql`
        select p.id, p.kind, p.title, p.body, p.status, p.created_at, p.updated_at,
               u.display_name as author_nickname
        from community_posts p
        join app_users u on u.id = p.author_user_id
        where p.complex_id = ${complexId}::uuid
          and p.status in ('pending_review', 'hidden')
        order by p.created_at asc
        limit 100
      `,
      sql`
        select c.id, c.post_id, c.body, c.status, c.created_at, c.updated_at,
               u.display_name as author_nickname
        from community_comments c
        join app_users u on u.id = c.author_user_id
        where c.complex_id = ${complexId}::uuid
          and c.status in ('pending_review', 'hidden')
        order by c.created_at asc
        limit 100
      `,
      sql`
        select r.id, r.reason, r.detail, r.status, r.created_at,
               reporter.display_name as reporter_nickname,
               r.post_id, r.comment_id,
               p.title as post_title,
               c.body as comment_body
        from community_reports r
        join app_users reporter on reporter.id = r.reporter_user_id
        left join community_posts p
          on p.id = r.post_id and p.complex_id = r.complex_id
        left join community_comments c
          on c.id = r.comment_id and c.complex_id = r.complex_id
        where r.complex_id = ${complexId}::uuid
          and r.status in ('submitted', 'reviewing')
        order by r.created_at asc
        limit 100
      `
    ]);

    return ok({
      complex: { slug: String(complex.slug), name: String(complex.name) },
      authority: { kind: operator.authorityKind, scope: operator.grantedScope },
      pendingPosts: posts.map((row) => ({
        id: String(row.id),
        kind: String(row.kind),
        title: String(row.title),
        body: String(row.body),
        status: String(row.status),
        author: { nickname: String(row.author_nickname ?? '') },
        createdAt: asDate(row.created_at),
        updatedAt: asDate(row.updated_at)
      })),
      pendingComments: comments.map((row) => ({
        id: String(row.id),
        postId: String(row.post_id),
        body: String(row.body),
        status: String(row.status),
        author: { nickname: String(row.author_nickname ?? '') },
        createdAt: asDate(row.created_at),
        updatedAt: asDate(row.updated_at)
      })),
      reports: reports.map((row) => ({
        id: String(row.id),
        reason: String(row.reason),
        detail: row.detail == null ? null : String(row.detail),
        status: String(row.status),
        reporter: { nickname: String(row.reporter_nickname ?? '') },
        target: row.post_id
          ? { type: 'post', id: String(row.post_id), preview: String(row.post_title ?? '') }
          : { type: 'comment', id: String(row.comment_id), preview: String(row.comment_body ?? '') },
        createdAt: asDate(row.created_at)
      }))
    }, requestId);
  }

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const reasonCodeRaw = text(payload.reasonCode);
  const noteRaw = text(payload.note);
  const reasonCode = reasonCodeRaw || null;
  const note = noteRaw || null;
  if (reasonCode && reasonCode.length > 120) return fail('VALIDATION_ERROR', 'reasonCode must be at most 120 characters', 400, requestId);
  if (note && note.length > 1000) return fail('VALIDATION_ERROR', 'note must be at most 1000 characters', 400, requestId);

  if (postMatch || commentMatch) {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    const action = text(payload.action) as ModerationAction;
    if (!ACTIONS.has(action)) return fail('VALIDATION_ERROR', 'Invalid moderation action', 400, requestId);

    const result = postMatch
      ? await moderatePost(sql, complexId, postMatch[2], operator.id, action, reasonCode, note)
      : await moderateComment(sql, complexId, commentMatch![2], operator.id, action, reasonCode, note);

    if (!result) return fail('NOT_FOUND', 'Community moderation target not found or transition unavailable', 404, requestId);
    return ok({
      id: String(result.id),
      status: String(result.status),
      moderationEventId: String(result.moderation_event_id),
      authorityKind: operator.authorityKind
    }, requestId);
  }

  if (reportMatch) {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    const decision = text(payload.decision) as ReportDecision;
    if (!REPORT_DECISIONS.has(decision)) return fail('VALIDATION_ERROR', 'Invalid report decision', 400, requestId);
    const result = await resolveReport(sql, complexId, reportMatch[2], operator.id, decision, reasonCode, note);
    if (!result) return fail('NOT_FOUND', 'Community report not found or already resolved', 404, requestId);
    return ok({
      id: String(result.id),
      status: String(result.status),
      moderationEventId: String(result.moderation_event_id),
      resolvedAt: asDate(result.resolved_at),
      authorityKind: operator.authorityKind
    }, requestId);
  }

  return null;
}
