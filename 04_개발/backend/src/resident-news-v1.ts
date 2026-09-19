import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireVerifiedResident } from './authorization-v2';
import { requireOperationalAuthority } from './operational-authz-v2';
import type { CoreEnv } from './core-v1';
import { serveActivePrivateApplicationDocumentObject } from './application-docs-core-v1';

type Sql = NeonQueryFunction<false, false>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPLEX_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const MAX_BODY_BYTES = 24 * 1024;
const QUEUE_STATUSES = new Set(['submitted', 'reviewing', 'approved', 'rejected']);
const MAX_SUBMISSION_ATTACHMENTS = 3;
const PRIVATE_ATTACHMENT_OBJECT_KEY = /^gdrive\/private\/application-document\/[A-Za-z0-9_-]{10,200}$/;

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
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return fail('CONTENT_TYPE_REQUIRED', 'application/json required', 415, requestId);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('INVALID_JSON', 'JSON object required', 400, requestId);
    return parsed as Record<string, unknown>;
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function dateValue(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapPost(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    title: String(row.title),
    body: String(row.body),
    publishedAt: dateValue(row.published_at),
    createdAt: dateValue(row.created_at)
  };
}

function mapOwnSubmission(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    title: String(row.title),
    status: String(row.status),
    publishedPostId: row.published_post_id ? String(row.published_post_id) : null,
    attachmentCount: Number(row.attachment_count || 0),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at)
  };
}

async function listResidentNews(request: Request, env: CoreEnv, sql: Sql, requestId: string, complexSlug: string): Promise<Response> {
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  const rows = await sql`
    select id, title, body, published_at, created_at
    from resident_news_posts
    where complex_id = ${resident.complexId}::uuid
      and status = 'published'
    order by published_at desc, id desc
    limit 100
  `;
  return ok({ posts: rows.map((row) => mapPost(row as Record<string, unknown>)) }, requestId);
}

async function readResidentNews(request: Request, env: CoreEnv, sql: Sql, requestId: string, complexSlug: string, postId: string): Promise<Response> {
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  const rows = await sql`
    select id, title, body, published_at, created_at
    from resident_news_posts
    where id = ${postId}::uuid
      and complex_id = ${resident.complexId}::uuid
      and status = 'published'
    limit 1
  `;
  if (!rows[0]) return fail('NOT_FOUND', 'Resident news not found', 404, requestId);
  return ok(mapPost(rows[0] as Record<string, unknown>), requestId);
}

async function createSubmission(request: Request, env: CoreEnv, sql: Sql, requestId: string, complexSlug: string): Promise<Response> {
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const title = text(payload.title);
  const body = text(payload.body);
  if (title.length < 1 || title.length > 160) return fail('VALIDATION_ERROR', 'title must be 1-160 characters', 400, requestId);
  if (body.length < 1 || body.length > 10000) return fail('VALIDATION_ERROR', 'body must be 1-10000 characters', 400, requestId);

  const rawAttachmentKeys = payload.attachmentObjectKeys;
  if (rawAttachmentKeys != null && !Array.isArray(rawAttachmentKeys)) {
    return fail('VALIDATION_ERROR', 'attachmentObjectKeys must be an array', 400, requestId);
  }
  const attachmentObjectKeys = (Array.isArray(rawAttachmentKeys) ? rawAttachmentKeys : [])
    .map((value) => typeof value === 'string' ? value.trim() : '');
  if (attachmentObjectKeys.length > MAX_SUBMISSION_ATTACHMENTS) {
    return fail('VALIDATION_ERROR', 'At most 3 resident-news attachments are allowed', 400, requestId);
  }
  if (attachmentObjectKeys.some((value) => !PRIVATE_ATTACHMENT_OBJECT_KEY.test(value))) {
    return fail('VALIDATION_ERROR', 'Invalid resident-news attachment reference', 400, requestId);
  }
  if (new Set(attachmentObjectKeys).size !== attachmentObjectKeys.length) {
    return fail('VALIDATION_ERROR', 'Duplicate resident-news attachment references are not allowed', 400, requestId);
  }

  const attachmentJson = JSON.stringify(attachmentObjectKeys);
  const rows = await sql`
    with requested as (
      select value::text as object_key, (ordinality - 1)::integer as sort_order
      from jsonb_array_elements_text(${attachmentJson}::jsonb) with ordinality as item(value, ordinality)
    ), eligible as (
      select r.object_key, requested.sort_order
      from requested
      join business_image_objects r on r.object_key = requested.object_key
      where r.uploader_user_id = ${resident.id}::uuid
        and r.complex_id = ${resident.complexId}::uuid
        and r.state = 'active'
        and r.kind = 'application-document'
    ), counts as (
      select
        (select count(*) from requested) as requested_count,
        (select count(*) from eligible) as eligible_count
    ), created as (
      insert into resident_news_submissions (complex_id, submitter_user_id, title, body)
      select ${resident.complexId}::uuid, ${resident.id}::uuid, ${title}, ${body}
      from counts
      where requested_count = eligible_count
      returning id, complex_id, title, status, created_at, updated_at
    ), linked as (
      insert into resident_news_submission_attachments (
        submission_id, complex_id, object_key, sort_order
      )
      select created.id, created.complex_id, eligible.object_key, eligible.sort_order
      from created cross join eligible
      returning id
    )
    select created.id, created.title, created.status, created.created_at, created.updated_at,
           (select count(*)::integer from linked) as attachment_count
    from created
  `;
  if (!rows[0]) {
    return fail(
      'INVALID_RESIDENT_NEWS_ATTACHMENT_REFERENCE',
      'One or more attachments are not active private objects owned by this resident and complex',
      400,
      requestId
    );
  }
  const row = rows[0] as Record<string, unknown>;
  row.published_post_id = null;
  return ok(mapOwnSubmission(row), requestId, 201);
}

async function listOwnSubmissions(request: Request, env: CoreEnv, sql: Sql, requestId: string, complexSlug: string): Promise<Response> {
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  const rows = await sql`
    select s.id, s.title, s.status, s.created_at, s.updated_at, p.id as published_post_id,
           (select count(*) from resident_news_submission_attachments a
            where a.submission_id = s.id and a.complex_id = s.complex_id) as attachment_count
    from resident_news_submissions s
    left join resident_news_posts p on p.source_submission_id = s.id and p.complex_id = s.complex_id
    where s.complex_id = ${resident.complexId}::uuid
      and s.submitter_user_id = ${resident.id}::uuid
    order by s.created_at desc, s.id desc
    limit 100
  `;
  return ok({ submissions: rows.map((row) => mapOwnSubmission(row as Record<string, unknown>)) }, requestId);
}

async function operatorQueue(request: Request, env: CoreEnv, sql: Sql, requestId: string, complexSlug: string, status: string): Promise<Response> {
  if (!QUEUE_STATUSES.has(status)) return fail('VALIDATION_ERROR', 'Invalid resident-news submission status', 400, requestId);
  const operator = await requireOperationalAuthority(request, env, sql, requestId, complexSlug, 'resident_news.review', 'council.resident_news.review');
  if (operator instanceof Response) return operator;
  const rows = await sql`
    select s.id, s.title, s.body, s.status, s.review_note, s.created_at, s.updated_at,
           u.display_name as submitter_nickname, p.id as published_post_id,
           coalesce((
             select jsonb_agg(jsonb_build_object('id', a.id, 'sortOrder', a.sort_order) order by a.sort_order)
             from resident_news_submission_attachments a
             where a.submission_id = s.id and a.complex_id = s.complex_id
           ), '[]'::jsonb) as attachments
    from resident_news_submissions s
    join app_users u on u.id = s.submitter_user_id
    left join resident_news_posts p on p.source_submission_id = s.id and p.complex_id = s.complex_id
    where s.complex_id = ${operator.complexId}::uuid
      and s.status = ${status}
    order by s.created_at asc, s.id asc
    limit 100
  `;
  return ok({
    submissions: rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      body: String(row.body),
      status: String(row.status),
      reviewNote: row.review_note ? String(row.review_note) : null,
      submitterNickname: String(row.submitter_nickname),
      publishedPostId: row.published_post_id ? String(row.published_post_id) : null,
      attachments: (Array.isArray(row.attachments) ? row.attachments : []).map((attachment) => {
        const value = attachment && typeof attachment === 'object' ? attachment as Record<string, unknown> : {};
        const attachmentId = String(value.id || '');
        return {
          id: attachmentId,
          sortOrder: Number(value.sortOrder || 0),
          downloadPath: `/api/v1/operator/complexes/${encodeURIComponent(complexSlug)}/resident-news/submissions/${encodeURIComponent(String(row.id))}/attachments/${encodeURIComponent(attachmentId)}`
        };
      }),
      createdAt: dateValue(row.created_at),
      updatedAt: dateValue(row.updated_at)
    }))
  }, requestId);
}

async function operatorAttachment(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string,
  submissionId: string,
  attachmentId: string
): Promise<Response> {
  const operator = await requireOperationalAuthority(
    request, env, sql, requestId, complexSlug,
    'resident_news.review', 'council.resident_news.review'
  );
  if (operator instanceof Response) return operator;

  const rows = await sql`
    select a.object_key, s.submitter_user_id::text,
           reg.state as registry_state, reg.kind as registry_kind
    from resident_news_submission_attachments a
    join resident_news_submissions s
      on s.id = a.submission_id and s.complex_id = a.complex_id
    left join business_image_objects reg on reg.object_key = a.object_key
    where a.id = ${attachmentId}::uuid
      and a.submission_id = ${submissionId}::uuid
      and a.complex_id = ${operator.complexId}::uuid
    limit 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return fail('NOT_FOUND', 'Resident-news attachment not found', 404, requestId);
  if (String(row.registry_kind || '') !== 'application-document' || String(row.registry_state || '') !== 'active') {
    return fail('ATTACHMENT_NOT_ACTIVE', 'Resident-news attachment is not active', 409, requestId);
  }

  const scope = operator.authorityKind === 'padiem'
    ? 'resident_news.review'
    : 'council.resident_news.review';
  try {
    await sql`
      insert into audit_events (
        request_id, actor_user_id, actor_kind, complex_id, action, scope,
        decision, reason_code, metadata
      ) values (
        ${requestId}, ${operator.id}::uuid, 'operator', ${operator.complexId}::uuid,
        'resident_news_attachment.read', ${scope}, 'allowed',
        'RESIDENT_NEWS_ATTACHMENT_ACCESS_GRANTED',
        ${JSON.stringify({ submission_id: submissionId, attachment_id: attachmentId })}::jsonb
      )
    `;
  } catch {
    return fail('AUDIT_UNAVAILABLE', 'Attachment access could not be audit-logged', 503, requestId);
  }

  return serveActivePrivateApplicationDocumentObject(
    env, String(row.object_key || ''), attachmentId, requestId
  );
}

async function operatorReview(request: Request, env: CoreEnv, sql: Sql, requestId: string, complexSlug: string, submissionId: string): Promise<Response> {
  const operator = await requireOperationalAuthority(request, env, sql, requestId, complexSlug, 'resident_news.review', 'council.resident_news.review');
  if (operator instanceof Response) return operator;
  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const action = text(payload.action);
  const reviewNote = text(payload.reviewNote);
  if (reviewNote.length > 1000) return fail('VALIDATION_ERROR', 'reviewNote must be at most 1000 characters', 400, requestId);

  if (action === 'reviewing') {
    const rows = await sql`
      with updated as (
        update resident_news_submissions
        set status = 'reviewing', review_note = ${reviewNote || null}, reviewed_by_user_id = ${operator.id}::uuid
        where id = ${submissionId}::uuid
          and complex_id = ${operator.complexId}::uuid
          and status = 'submitted'
        returning id, complex_id, status
      ), event as (
        insert into resident_news_review_events (complex_id, submission_id, operator_user_id, action, note)
        select complex_id, id, ${operator.id}::uuid, 'reviewing', ${reviewNote || null} from updated
        returning id
      )
      select updated.id, updated.status from updated
    `;
    if (!rows[0]) return fail('CONFLICT', 'Submission can no longer enter reviewing', 409, requestId);
    return ok({ id: submissionId, status: 'reviewing' }, requestId);
  }

  if (action === 'reject') {
    const rows = await sql`
      with updated as (
        update resident_news_submissions
        set status = 'rejected', review_note = ${reviewNote || null}, reviewed_by_user_id = ${operator.id}::uuid, reviewed_at = now()
        where id = ${submissionId}::uuid
          and complex_id = ${operator.complexId}::uuid
          and status in ('submitted','reviewing')
        returning id, complex_id, status
      ), event as (
        insert into resident_news_review_events (complex_id, submission_id, operator_user_id, action, note)
        select complex_id, id, ${operator.id}::uuid, 'rejected', ${reviewNote || null} from updated
        returning id
      )
      select updated.id, updated.status from updated
    `;
    if (!rows[0]) return fail('CONFLICT', 'Submission can no longer be rejected', 409, requestId);
    return ok({ id: submissionId, status: 'rejected', publishedPostId: null }, requestId);
  }

  if (action === 'approve') {
    const publishedTitle = text(payload.publishedTitle);
    const publishedBody = text(payload.publishedBody);
    if (publishedTitle && publishedTitle.length > 160) return fail('VALIDATION_ERROR', 'publishedTitle must be at most 160 characters', 400, requestId);
    if (publishedBody && publishedBody.length > 10000) return fail('VALIDATION_ERROR', 'publishedBody must be at most 10000 characters', 400, requestId);

    const rows = await sql`
      with target as (
        select id, complex_id,
               case when ${publishedTitle} <> '' then ${publishedTitle} else title end as publish_title,
               case when ${publishedBody} <> '' then ${publishedBody} else body end as publish_body
        from resident_news_submissions
        where id = ${submissionId}::uuid
          and complex_id = ${operator.complexId}::uuid
          and status in ('submitted','reviewing')
        for update
      ), published as (
        insert into resident_news_posts (complex_id, source_submission_id, title, body)
        select complex_id, id, publish_title, publish_body from target
        on conflict (source_submission_id) do nothing
        returning id, source_submission_id
      ), updated as (
        update resident_news_submissions s
        set status = 'approved', review_note = ${reviewNote || null}, reviewed_by_user_id = ${operator.id}::uuid, reviewed_at = now()
        from target t
        where s.id = t.id and s.complex_id = t.complex_id
        returning s.id, s.complex_id
      ), event as (
        insert into resident_news_review_events (complex_id, submission_id, operator_user_id, action, note)
        select complex_id, id, ${operator.id}::uuid, 'approved', ${reviewNote || null} from updated
        returning id
      )
      select p.id as published_post_id
      from resident_news_posts p
      join updated u on u.id = p.source_submission_id and u.complex_id = p.complex_id
      limit 1
    `;
    if (rows[0]) return ok({ id: submissionId, status: 'approved', publishedPostId: String(rows[0].published_post_id) }, requestId);

    const existing = await sql`
      select s.status, p.id as published_post_id
      from resident_news_submissions s
      left join resident_news_posts p on p.source_submission_id = s.id and p.complex_id = s.complex_id
      where s.id = ${submissionId}::uuid and s.complex_id = ${operator.complexId}::uuid
      limit 1
    `;
    if (existing[0]?.status === 'approved' && existing[0]?.published_post_id) {
      return ok({ id: submissionId, status: 'approved', publishedPostId: String(existing[0].published_post_id) }, requestId);
    }
    return fail('CONFLICT', 'Submission can no longer be approved', 409, requestId);
  }

  return fail('VALIDATION_ERROR', 'action must be reviewing, approve or reject', 400, requestId);
}

export async function handleResidentNewsWithSql(request: Request, env: CoreEnv, sql: Sql, requestId: string): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const feed = path.match(/^\/api\/v1\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/resident-news$/);
  const detail = path.match(/^\/api\/v1\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/resident-news\/([0-9a-fA-F-]+)$/);
  const submit = path.match(/^\/api\/v1\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/resident-news\/submissions$/);
  const mine = path === '/api/v1/me/resident-news/submissions';
  const operatorQueueMatch = path.match(/^\/api\/v1\/operator\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/resident-news\/submissions$/);
  const operatorAttachmentMatch = path.match(/^\/api\/v1\/operator\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/resident-news\/submissions\/([0-9a-fA-F-]+)\/attachments\/([0-9a-fA-F-]+)$/);
  const operatorItem = path.match(/^\/api\/v1\/operator\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/resident-news\/submissions\/([0-9a-fA-F-]+)$/);
  if (!feed && !detail && !submit && !mine && !operatorQueueMatch && !operatorAttachmentMatch && !operatorItem) return null;

  if (feed) {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return listResidentNews(request, env, sql, requestId, feed[1]);
  }
  if (detail) {
    if (!UUID.test(detail[2])) return fail('NOT_FOUND', 'Resident news not found', 404, requestId);
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return readResidentNews(request, env, sql, requestId, detail[1], detail[2].toLowerCase());
  }
  if (submit) {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return createSubmission(request, env, sql, requestId, submit[1]);
  }
  if (mine) {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    const complexSlug = (url.searchParams.get('complexSlug') || '').trim();
    if (!COMPLEX_SLUG.test(complexSlug)) return fail('VALIDATION_ERROR', 'Valid complexSlug is required', 400, requestId);
    return listOwnSubmissions(request, env, sql, requestId, complexSlug);
  }
  if (operatorQueueMatch) {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return operatorQueue(request, env, sql, requestId, operatorQueueMatch[1], (url.searchParams.get('status') || 'submitted').trim());
  }
  if (operatorAttachmentMatch) {
    if (!UUID.test(operatorAttachmentMatch[2]) || !UUID.test(operatorAttachmentMatch[3])) {
      return fail('NOT_FOUND', 'Resident-news attachment not found', 404, requestId);
    }
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return operatorAttachment(
      request, env, sql, requestId, operatorAttachmentMatch[1],
      operatorAttachmentMatch[2].toLowerCase(), operatorAttachmentMatch[3].toLowerCase()
    );
  }
  if (operatorItem) {
    if (!UUID.test(operatorItem[2])) return fail('NOT_FOUND', 'Resident-news submission not found', 404, requestId);
    if (request.method !== 'PATCH') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return operatorReview(request, env, sql, requestId, operatorItem[1], operatorItem[2].toLowerCase());
  }
  return null;
}

export async function handleResidentNewsRequest(request: Request, env: CoreEnv, requestId: string): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.includes('/resident-news')) return null;
  return handleResidentNewsWithSql(request, env, sqlFor(env), requestId);
}
