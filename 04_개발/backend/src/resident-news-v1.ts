import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireVerifiedResident } from './authorization-v2';
import { requireOperationalAuthority } from './operational-authz-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPLEX_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const MAX_BODY_BYTES = 24 * 1024;
const QUEUE_STATUSES = new Set(['submitted', 'reviewing', 'approved', 'rejected']);

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
  const rows = await sql`
    insert into resident_news_submissions (complex_id, submitter_user_id, title, body)
    values (${resident.complexId}::uuid, ${resident.id}::uuid, ${title}, ${body})
    returning id, title, status, created_at, updated_at
  `;
  const row = rows[0] as Record<string, unknown>;
  row.published_post_id = null;
  return ok(mapOwnSubmission(row), requestId, 201);
}

async function listOwnSubmissions(request: Request, env: CoreEnv, sql: Sql, requestId: string, complexSlug: string): Promise<Response> {
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  const rows = await sql`
    select s.id, s.title, s.status, s.created_at, s.updated_at, p.id as published_post_id
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
             select json_agg(json_build_object(
               'id', a.id, 'fileName', a.file_name, 'contentType', a.content_type,
               'byteSize', a.byte_size, 'sortOrder', a.sort_order
             ) order by a.sort_order)
             from resident_news_submission_attachments a
             where a.submission_id = s.id
           ), '[]'::json) as attachments
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
      createdAt: dateValue(row.created_at),
      updatedAt: dateValue(row.updated_at),
      attachments: Array.isArray(row.attachments) ? row.attachments : []
    }))
  }, requestId);
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
  const submissionAttachments = path.match(/^\/api\/v1\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/resident-news\/submissions\/([0-9a-fA-F-]+)\/attachments$/);
  const mineAttachment = path.match(/^\/api\/v1\/me\/resident-news\/submission-attachments\/([0-9a-fA-F-]+)$/);
  const operatorAttachment = path.match(/^\/api\/v1\/operator\/resident-news\/submission-attachments\/([0-9a-fA-F-]+)$/);
  const mine = path === '/api/v1/me/resident-news/submissions';
  const operatorQueueMatch = path.match(/^\/api\/v1\/operator\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/resident-news\/submissions$/);
  const operatorItem = path.match(/^\/api\/v1\/operator\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/resident-news\/submissions\/([0-9a-fA-F-]+)$/);
  if (!feed && !detail && !submit && !submissionAttachments && !mineAttachment && !operatorAttachment && !mine && !operatorQueueMatch && !operatorItem) return null;

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
  if (submissionAttachments) {
    const complexSlug = submissionAttachments[1];
    const submissionId = submissionAttachments[2].toLowerCase();
    if (!UUID.test(submissionId)) return fail('NOT_FOUND', 'Resident-news submission not found', 404, requestId);
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
    if (resident instanceof Response) return resident;
    const owned = await sql`
      select id from resident_news_submissions
      where id = ${submissionId}::uuid
        and complex_id = ${resident.complexId}::uuid
        and submitter_user_id = ${resident.id}::uuid
        and status in ('submitted','reviewing')
      limit 1
    `;
    if (!owned[0]) return fail('NOT_FOUND', 'Resident-news submission not found', 404, requestId);
    const payload = await bodyJson(request, requestId);
    if (payload instanceof Response) return payload;
    const fileName = text(payload.fileName);
    const contentType = text(payload.contentType) || 'application/octet-stream';
    const dataBase64 = text(payload.dataBase64).replace(/\s+/g, '');
    const sortOrder = Number(payload.sortOrder);
    if (!fileName || fileName.length > 200) return fail('VALIDATION_ERROR', 'fileName must be 1-200 characters', 400, requestId);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 2) return fail('VALIDATION_ERROR', 'sortOrder must be 0-2', 400, requestId);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64) || dataBase64.length > 7_200_000) {
      return fail('VALIDATION_ERROR', 'Invalid or oversized attachment payload', 400, requestId);
    }
    const byteSize = Math.floor(dataBase64.length * 3 / 4) - (dataBase64.endsWith('==') ? 2 : dataBase64.endsWith('=') ? 1 : 0);
    if (byteSize < 1 || byteSize > 5_242_880) return fail('PAYLOAD_TOO_LARGE', 'Attachment must be at most 5 MiB', 413, requestId);
    try {
      const rows = await sql`
        insert into resident_news_submission_attachments (
          submission_id, uploader_user_id, sort_order, file_name, content_type, byte_size, content_bytes
        ) values (
          ${submissionId}::uuid, ${resident.id}::uuid, ${sortOrder}, ${fileName}, ${contentType},
          ${byteSize}, decode(${dataBase64}, 'base64')
        )
        returning id, file_name, content_type, byte_size, sort_order, created_at
      `;
      return ok({
        id: String(rows[0].id), fileName: String(rows[0].file_name), contentType: String(rows[0].content_type),
        byteSize: Number(rows[0].byte_size), sortOrder: Number(rows[0].sort_order), createdAt: dateValue(rows[0].created_at)
      }, requestId, 201);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : '';
      if (code === '23505') return fail('ATTACHMENT_SLOT_CONFLICT', 'Attachment slot is already used', 409, requestId);
      throw error;
    }
  }
  if (mineAttachment) {
    const attachmentId = mineAttachment[1].toLowerCase();
    if (!UUID.test(attachmentId)) return fail('NOT_FOUND', 'Attachment not found', 404, requestId);
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    const actor = await requireVerifiedResident(request, env, sql, requestId, 'banglim-myeongji-roadhill');
    if (actor instanceof Response) return actor;
    const rows = await sql`
      select a.content_type, a.byte_size, encode(a.content_bytes,'base64') as data_base64
      from resident_news_submission_attachments a
      join resident_news_submissions s on s.id = a.submission_id
      where a.id = ${attachmentId}::uuid
        and s.complex_id = ${actor.complexId}::uuid
        and s.submitter_user_id = ${actor.id}::uuid
      limit 1
    `;
    if (!rows[0]) return fail('NOT_FOUND', 'Attachment not found', 404, requestId);
    const binary = Uint8Array.from(atob(String(rows[0].data_base64)), (ch) => ch.charCodeAt(0));
    return new Response(binary, { status: 200, headers: {
      'content-type': String(rows[0].content_type), 'content-length': String(rows[0].byte_size),
      'content-disposition': 'inline', 'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff', 'x-danjion-request-id': requestId
    }});
  }
  if (operatorAttachment) {
    const attachmentId = operatorAttachment[1].toLowerCase();
    if (!UUID.test(attachmentId)) return fail('NOT_FOUND', 'Attachment not found', 404, requestId);
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    const target = await sql`
      select a.content_type, a.byte_size, encode(a.content_bytes,'base64') as data_base64, c.slug as complex_slug
      from resident_news_submission_attachments a
      join resident_news_submissions s on s.id = a.submission_id
      join complexes c on c.id = s.complex_id
      where a.id = ${attachmentId}::uuid
      limit 1
    `;
    if (!target[0]) return fail('NOT_FOUND', 'Attachment not found', 404, requestId);
    const operator = await requireOperationalAuthority(request, env, sql, requestId, String(target[0].complex_slug), 'resident_news.review', 'council.resident_news.review');
    if (operator instanceof Response) return operator;
    const binary = Uint8Array.from(atob(String(target[0].data_base64)), (ch) => ch.charCodeAt(0));
    return new Response(binary, { status: 200, headers: {
      'content-type': String(target[0].content_type), 'content-length': String(target[0].byte_size),
      'content-disposition': 'inline', 'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff', 'x-danjion-request-id': requestId
    }});
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
