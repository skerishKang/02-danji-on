import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireVerifiedResident } from './authorization-v2';
import { requireOperationalAuthority } from './operational-authz-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;
type ReportReason = 'abuse' | 'threat' | 'privacy' | 'defamation_risk' | 'spam' | 'other';
type ReportTargetType = 'post' | 'comment' | 'resident' | 'message' | 'review';
type ReportDecision = 'resolved' | 'dismissed';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPORT_REASONS = new Set<ReportReason>(['abuse', 'threat', 'privacy', 'defamation_risk', 'spam', 'other']);
const TARGET_TYPES = new Set<ReportTargetType>(['post', 'comment', 'resident', 'message', 'review']);
const MAX_BODY_BYTES = 8 * 1024;
const MAX_DETAIL_CHARS = 1000;
const PREVIEW_CHARS = 240;
const PADIEM_REVIEW_SCOPE = 'safety.report.review';
const COUNCIL_REVIEW_SCOPE = 'council.safety.report.review';

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

async function bodyJson(request: Request, requestId: string): Promise<Record<string, unknown> | Response> {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
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

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function targetTypeForRow(row: Record<string, unknown>): 'resident' | 'message' | 'review' {
  if (row.resident_user_id) return 'resident';
  if (row.message_id) return 'message';
  return 'review';
}

async function submitCommunityReport(
  sql: Sql,
  complexId: string,
  reporterId: string,
  targetType: 'post' | 'comment',
  targetId: string,
  reason: ReportReason,
  detail: string | null,
  requestId: string
): Promise<Response> {
  const targetRows = targetType === 'post'
    ? await sql`
        select id
        from community_posts
        where id = ${targetId}::uuid
          and complex_id = ${complexId}::uuid
          and status = 'published'
        limit 1
      `
    : await sql`
        select c.id
        from community_comments c
        join community_posts p on p.id = c.post_id and p.complex_id = c.complex_id
        where c.id = ${targetId}::uuid
          and c.complex_id = ${complexId}::uuid
          and c.status = 'published'
          and p.status = 'published'
        limit 1
      `;
  if (!targetRows[0]) return fail('REPORT_TARGET_NOT_FOUND', 'Report target not found', 404, requestId);

  const postId = targetType === 'post' ? targetId : null;
  const commentId = targetType === 'comment' ? targetId : null;
  try {
    const rows = await sql`
      insert into community_reports (
        complex_id, reporter_user_id, post_id, comment_id, reason, detail
      ) values (
        ${complexId}::uuid, ${reporterId}::uuid, ${postId}::uuid, ${commentId}::uuid, ${reason}, ${detail}
      )
      returning id, status, created_at
    `;
    return ok({
      id: String(rows[0].id),
      targetType,
      targetId,
      status: String(rows[0].status),
      createdAt: asDate(rows[0].created_at)
    }, requestId, 201);
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
    if (code === '23505') return ok({ targetType, targetId, status: 'already_reported' }, requestId);
    throw error;
  }
}

async function nonCommunityTargetExists(
  sql: Sql,
  complexId: string,
  reporterId: string,
  targetType: 'resident' | 'message' | 'review',
  targetId: string
): Promise<boolean> {
  if (targetType === 'resident') {
    if (targetId.toLowerCase() === reporterId.toLowerCase()) return false;
    const rows = await sql`
      select u.id
      from app_users u
      join household_memberships hm on hm.user_id = u.id
      join households h on h.id = hm.household_id and h.complex_id = hm.complex_id
      join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
      where u.id = ${targetId}::uuid
        and u.account_status = 'active'
        and hm.complex_id = ${complexId}::uuid
        and hm.status = 'verified'
        and h.status = 'active'
        and cu.status = 'active'
      limit 1
    `;
    return Boolean(rows[0]);
  }

  if (targetType === 'message') {
    const rows = await sql`
      select m.id
      from messages m
      join conversations c on c.id = m.conversation_id
      join conversation_members cm
        on cm.conversation_id = c.id
       and cm.user_id = ${reporterId}::uuid
      where m.id = ${targetId}::uuid
        and c.complex_id = ${complexId}::uuid
        and m.sender_user_id <> ${reporterId}::uuid
        and m.deleted_at is null
      limit 1
    `;
    return Boolean(rows[0]);
  }

  const rows = await sql`
    select r.id
    from business_reviews r
    where r.id = ${targetId}::uuid
      and r.complex_id = ${complexId}::uuid
      and r.status = 'active'
      and r.author_user_id <> ${reporterId}::uuid
    limit 1
  `;
  return Boolean(rows[0]);
}

async function submitNonCommunityReport(
  sql: Sql,
  complexId: string,
  reporterId: string,
  targetType: 'resident' | 'message' | 'review',
  targetId: string,
  reason: ReportReason,
  detail: string | null,
  requestId: string
): Promise<Response> {
  if (!await nonCommunityTargetExists(sql, complexId, reporterId, targetType, targetId)) {
    return fail('REPORT_TARGET_NOT_FOUND', 'Report target not found', 404, requestId);
  }

  const residentUserId = targetType === 'resident' ? targetId : null;
  const messageId = targetType === 'message' ? targetId : null;
  const reviewId = targetType === 'review' ? targetId : null;
  try {
    const rows = await sql`
      insert into resident_safety_reports (
        complex_id, reporter_user_id, resident_user_id, message_id, review_id, reason, detail
      ) values (
        ${complexId}::uuid,
        ${reporterId}::uuid,
        ${residentUserId}::uuid,
        ${messageId}::uuid,
        ${reviewId}::uuid,
        ${reason},
        ${detail}
      )
      returning id, status, created_at
    `;
    return ok({
      id: String(rows[0].id),
      targetType,
      targetId,
      status: String(rows[0].status),
      createdAt: asDate(rows[0].created_at)
    }, requestId, 201);
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
    if (code === '23505') return ok({ targetType, targetId, status: 'already_reported' }, requestId);
    throw error;
  }
}

async function submitReport(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response> {
  const url = new URL(request.url);
  const complexSlug = url.searchParams.get('complexSlug')?.trim() || '';
  if (!complexSlug) return fail('VALIDATION_ERROR', 'complexSlug is required', 400, requestId);
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const allowed = new Set(['targetType', 'targetId', 'reason', 'detail']);
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    return fail('VALIDATION_ERROR', 'Only targetType, targetId, reason and detail are accepted', 400, requestId);
  }

  const targetType = text(payload.targetType) as ReportTargetType;
  const targetId = text(payload.targetId).toLowerCase();
  const reason = text(payload.reason) as ReportReason;
  const detailText = text(payload.detail);
  const detail = detailText || null;
  if (!TARGET_TYPES.has(targetType) || !UUID_RE.test(targetId)) {
    return fail('VALIDATION_ERROR', 'Valid targetType and targetId are required', 400, requestId);
  }
  if (!REPORT_REASONS.has(reason)) return fail('VALIDATION_ERROR', 'Invalid report reason', 400, requestId);
  if (detailText.length > MAX_DETAIL_CHARS) {
    return fail('VALIDATION_ERROR', `Report detail must be at most ${MAX_DETAIL_CHARS} characters`, 400, requestId);
  }

  if (targetType === 'post' || targetType === 'comment') {
    return submitCommunityReport(sql, resident.complexId, resident.id, targetType, targetId, reason, detail, requestId);
  }
  return submitNonCommunityReport(sql, resident.complexId, resident.id, targetType, targetId, reason, detail, requestId);
}

async function operatorQueue(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string
): Promise<Response> {
  const operator = await requireOperationalAuthority(
    request,
    env,
    sql,
    requestId,
    complexSlug,
    PADIEM_REVIEW_SCOPE,
    COUNCIL_REVIEW_SCOPE
  );
  if (operator instanceof Response) return operator;

  const rows = await sql`
    select
      r.id, r.reason, r.detail, r.status, r.created_at,
      r.resident_user_id, r.message_id, r.review_id,
      reporter.display_name as reporter_nickname,
      target_user.display_name as target_resident_nickname,
      message_sender.display_name as message_sender_nickname,
      left(m.body, ${PREVIEW_CHARS}) as message_preview,
      review_author.display_name as review_author_nickname,
      left(br.body, ${PREVIEW_CHARS}) as review_preview,
      br.status as review_status
    from resident_safety_reports r
    join app_users reporter on reporter.id = r.reporter_user_id
    left join app_users target_user on target_user.id = r.resident_user_id
    left join messages m on m.id = r.message_id
    left join app_users message_sender on message_sender.id = m.sender_user_id
    left join business_reviews br on br.id = r.review_id
    left join app_users review_author on review_author.id = br.author_user_id
    where r.complex_id = ${operator.complexId}::uuid
      and r.status in ('submitted','reviewing')
    order by r.created_at asc
    limit 100
  `;

  return ok({
    authority: { kind: operator.authorityKind, scope: operator.grantedScope },
    reports: rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      const targetType = targetTypeForRow(row);
      const targetId = targetType === 'resident'
        ? String(row.resident_user_id)
        : targetType === 'message'
          ? String(row.message_id)
          : String(row.review_id);
      const target = targetType === 'resident'
        ? { type: targetType, id: targetId, nickname: row.target_resident_nickname ? String(row.target_resident_nickname) : null }
        : targetType === 'message'
          ? {
              type: targetType,
              id: targetId,
              senderNickname: row.message_sender_nickname ? String(row.message_sender_nickname) : null,
              preview: row.message_preview == null ? null : String(row.message_preview)
            }
          : {
              type: targetType,
              id: targetId,
              authorNickname: row.review_author_nickname ? String(row.review_author_nickname) : null,
              preview: row.review_preview == null ? null : String(row.review_preview),
              currentStatus: row.review_status == null ? null : String(row.review_status)
            };
      return {
        id: String(row.id),
        reason: String(row.reason),
        detail: row.detail == null ? null : String(row.detail),
        status: String(row.status),
        reporter: { nickname: String(row.reporter_nickname ?? '') },
        target,
        createdAt: asDate(row.created_at)
      };
    })
  }, requestId);
}

async function resolveSafetyReport(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string,
  reportId: string
): Promise<Response> {
  const operator = await requireOperationalAuthority(
    request,
    env,
    sql,
    requestId,
    complexSlug,
    PADIEM_REVIEW_SCOPE,
    COUNCIL_REVIEW_SCOPE
  );
  if (operator instanceof Response) return operator;

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const allowed = new Set(['decision', 'reasonCode', 'note']);
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    return fail('VALIDATION_ERROR', 'Only decision, reasonCode and note are accepted', 400, requestId);
  }
  const decision = text(payload.decision) as ReportDecision;
  const reasonCode = text(payload.reasonCode);
  const note = text(payload.note);
  if (decision !== 'resolved' && decision !== 'dismissed') {
    return fail('VALIDATION_ERROR', 'decision must be resolved or dismissed', 400, requestId);
  }
  if (reasonCode.length > 120 || note.length > 1000) {
    return fail('VALIDATION_ERROR', 'reasonCode/note is too long', 400, requestId);
  }

  const rows = await sql`
    with target as (
      update resident_safety_reports
      set status = ${decision},
          resolved_by_user_id = ${operator.id}::uuid,
          resolved_at = now()
      where id = ${reportId}::uuid
        and complex_id = ${operator.complexId}::uuid
        and status in ('submitted','reviewing')
      returning id, resident_user_id, message_id, review_id, status, resolved_at
    ), audited as (
      insert into audit_events (
        request_id, actor_user_id, actor_kind, complex_id,
        action, scope, resource_type, resource_id, decision, reason_code, metadata
      )
      select
        ${requestId},
        ${operator.id}::uuid,
        'operator',
        ${operator.complexId}::uuid,
        'safety.report.resolve',
        ${operator.grantedScope},
        'resident_safety_report',
        target.id::text,
        'recorded',
        ${reasonCode || (decision === 'resolved' ? 'SAFETY_REPORT_RESOLVED' : 'SAFETY_REPORT_DISMISSED')},
        jsonb_build_object(
          'decision', ${decision},
          'targetType', case
            when target.resident_user_id is not null then 'resident'
            when target.message_id is not null then 'message'
            else 'review'
          end,
          'notePresent', ${Boolean(note)}
        )
      from target
      returning id
    )
    select target.*
    from target
    where exists (select 1 from audited)
  `;
  if (!rows[0]) return fail('REPORT_NOT_FOUND', 'Open safety report not found', 404, requestId);
  return ok({
    id: String(rows[0].id),
    status: String(rows[0].status),
    resolvedAt: asDate(rows[0].resolved_at)
  }, requestId);
}

export async function handleResidentSafetyReportWithSql(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/api/v1/me/reports') {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return submitReport(request, env, sql, requestId);
  }

  const queueMatch = path.match(/^\/api\/v1\/operator\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/safety\/reports$/);
  const resolveMatch = path.match(/^\/api\/v1\/operator\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/safety\/reports\/([0-9a-fA-F-]+)\/resolve$/);
  if (!queueMatch && !resolveMatch) return null;

  if (queueMatch) {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return operatorQueue(request, env, sql, requestId, queueMatch[1]);
  }

  const reportId = resolveMatch![2].toLowerCase();
  if (!UUID_RE.test(reportId)) return fail('REPORT_NOT_FOUND', 'Safety report not found', 404, requestId);
  if (request.method !== 'PATCH' && request.method !== 'POST') {
    return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
  }
  return resolveSafetyReport(request, env, sql, requestId, resolveMatch![1], reportId);
}

export async function handleResidentSafetyReportRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== '/api/v1/me/reports' && !path.includes('/safety/reports')) return null;
  return handleResidentSafetyReportWithSql(request, env, sqlFor(env), requestId);
}
