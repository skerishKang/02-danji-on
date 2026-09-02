import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import { requireVerifiedResident } from './authorization-v2';
import { requireOperationalAuthority } from './operational-authz-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPLEX_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const MAX_BODY_BYTES = 24 * 1024;
const STATUSES = new Set(['received', 'in_progress', 'answered', 'closed']);

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

function mapSummary(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    inquiryType: String(row.inquiry_type),
    title: String(row.title),
    status: String(row.status),
    answeredAt: row.answered_at ?? null,
    closedAt: row.closed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDetail(row: Record<string, unknown>) {
  return {
    ...mapSummary(row),
    body: String(row.body),
    response: row.response_text ? String(row.response_text) : null
  };
}

async function listMine(request: Request, env: CoreEnv, sql: Sql, requestId: string, complexSlug: string): Promise<Response> {
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  const rows = await sql`
    select id, inquiry_type, title, status, answered_at, closed_at, created_at, updated_at
    from inquiries
    where user_id = ${resident.id}::uuid
      and complex_id = ${resident.complexId}::uuid
    order by created_at desc, id desc
    limit 200
  `;
  return ok({ inquiries: rows.map((row) => mapSummary(row as Record<string, unknown>)) }, requestId);
}

async function createMine(request: Request, env: CoreEnv, sql: Sql, requestId: string): Promise<Response> {
  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const complexSlug = text(payload.complexSlug);
  const inquiryType = text(payload.inquiryType);
  const title = text(payload.title);
  const body = text(payload.body);
  if (!COMPLEX_SLUG.test(complexSlug)) return fail('VALIDATION_ERROR', 'Valid complexSlug is required', 400, requestId);
  if (inquiryType.length < 1 || inquiryType.length > 64) return fail('VALIDATION_ERROR', 'inquiryType must be 1-64 characters', 400, requestId);
  if (title.length < 1 || title.length > 160) return fail('VALIDATION_ERROR', 'title must be 1-160 characters', 400, requestId);
  if (body.length < 1 || body.length > 10000) return fail('VALIDATION_ERROR', 'body must be 1-10000 characters', 400, requestId);
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  const rows = await sql`
    insert into inquiries (complex_id, user_id, inquiry_type, title, body)
    values (${resident.complexId}::uuid, ${resident.id}::uuid, ${inquiryType}, ${title}, ${body})
    returning id, inquiry_type, title, body, status, response_text, answered_at, closed_at, created_at, updated_at
  `;
  return ok(mapDetail(rows[0] as Record<string, unknown>), requestId, 201);
}

async function currentMine(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  inquiryId: string
): Promise<{ residentId: string; complexId: string; complexSlug: string; row: Record<string, unknown> } | Response> {
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;
  const rows = await sql`
    select i.id, i.complex_id, i.user_id, i.inquiry_type, i.title, i.body, i.status,
           i.response_text, i.answered_at, i.closed_at, i.created_at, i.updated_at,
           c.slug as complex_slug
    from inquiries i
    join complexes c on c.id = i.complex_id
    where i.id = ${inquiryId}::uuid
      and i.user_id = ${actor.id}::uuid
    limit 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return fail('NOT_FOUND', 'Inquiry not found', 404, requestId);
  const resident = await requireVerifiedResident(request, env, sql, requestId, String(row.complex_slug));
  if (resident instanceof Response) return resident;
  if (resident.complexId !== String(row.complex_id)) return fail('FORBIDDEN', 'Inquiry access is no longer available', 403, requestId);
  return { residentId: resident.id, complexId: resident.complexId, complexSlug: String(row.complex_slug), row };
}

async function readMine(request: Request, env: CoreEnv, sql: Sql, requestId: string, inquiryId: string): Promise<Response> {
  const current = await currentMine(request, env, sql, requestId, inquiryId);
  if (current instanceof Response) return current;
  return ok(mapDetail(current.row), requestId);
}

async function closeMine(request: Request, env: CoreEnv, sql: Sql, requestId: string, inquiryId: string): Promise<Response> {
  const current = await currentMine(request, env, sql, requestId, inquiryId);
  if (current instanceof Response) return current;
  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  if (text(payload.status) !== 'closed') return fail('VALIDATION_ERROR', 'Only status=closed is accepted', 400, requestId);
  const rows = await sql`
    update inquiries
    set status = 'closed', closed_at = coalesce(closed_at, now())
    where id = ${inquiryId}::uuid
      and user_id = ${current.residentId}::uuid
      and complex_id = ${current.complexId}::uuid
      and status = 'answered'
    returning id, inquiry_type, title, body, status, response_text, answered_at, closed_at, created_at, updated_at
  `;
  if (!rows[0]) {
    if (String(current.row.status) === 'closed') return ok(mapDetail(current.row), requestId);
    return fail('CONFLICT', 'Only an answered inquiry can be closed', 409, requestId);
  }
  return ok(mapDetail(rows[0] as Record<string, unknown>), requestId);
}

async function adminList(request: Request, env: CoreEnv, sql: Sql, requestId: string, complexSlug: string, status: string): Promise<Response> {
  if (!STATUSES.has(status)) return fail('VALIDATION_ERROR', 'Invalid inquiry status', 400, requestId);
  const operator = await requireOperationalAuthority(request, env, sql, requestId, complexSlug, 'inquiry.respond', 'council.inquiry.respond');
  if (operator instanceof Response) return operator;
  const rows = await sql`
    select i.id, i.inquiry_type, i.title, i.status, i.answered_at, i.closed_at, i.created_at, i.updated_at,
           u.display_name as resident_nickname
    from inquiries i
    join app_users u on u.id = i.user_id
    where i.complex_id = ${operator.complexId}::uuid
      and i.status = ${status}
    order by i.created_at asc, i.id asc
    limit 200
  `;
  return ok({
    inquiries: rows.map((row) => ({
      ...mapSummary(row as Record<string, unknown>),
      residentNickname: String(row.resident_nickname)
    }))
  }, requestId);
}

async function adminReview(request: Request, env: CoreEnv, sql: Sql, requestId: string, inquiryId: string): Promise<Response> {
  const targetRows = await sql`
    select i.id, i.complex_id, i.user_id, i.inquiry_type, i.title, i.body, i.status, i.response_text,
           i.answered_at, i.closed_at, i.created_at, i.updated_at, c.slug as complex_slug
    from inquiries i
    join complexes c on c.id = i.complex_id
    where i.id = ${inquiryId}::uuid
    limit 1
  `;
  const target = targetRows[0] as Record<string, unknown> | undefined;
  if (!target) return fail('NOT_FOUND', 'Inquiry not found', 404, requestId);
  const operator = await requireOperationalAuthority(request, env, sql, requestId, String(target.complex_slug), 'inquiry.respond', 'council.inquiry.respond');
  if (operator instanceof Response) return operator;
  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const status = text(payload.status);
  const response = text(payload.response);

  if (status === 'in_progress') {
    const rows = await sql`
      update inquiries
      set status = 'in_progress'
      where id = ${inquiryId}::uuid
        and complex_id = ${operator.complexId}::uuid
        and status = 'received'
      returning id, inquiry_type, title, body, status, response_text, answered_at, closed_at, created_at, updated_at
    `;
    if (rows[0]) return ok(mapDetail(rows[0] as Record<string, unknown>), requestId);
    if (String(target.status) === 'in_progress') return ok(mapDetail(target), requestId);
    return fail('CONFLICT', 'Inquiry can no longer enter in_progress', 409, requestId);
  }

  if (status === 'answered') {
    if (response.length < 1 || response.length > 10000) return fail('VALIDATION_ERROR', 'response must be 1-10000 characters', 400, requestId);
    const results = await sql.transaction([
      sql`
        update inquiries
        set status = 'answered', response_text = ${response}, answered_by = ${operator.id}::uuid,
            answered_at = coalesce(answered_at, now()), closed_at = null
        where id = ${inquiryId}::uuid
          and complex_id = ${operator.complexId}::uuid
          and status in ('received','in_progress')
        returning id, user_id, complex_id, inquiry_type, title, body, status, response_text, answered_at, closed_at, created_at, updated_at
      `,
      sql`
        insert into notifications (
          user_id, complex_id, type, actor_user_id, resource_type, resource_id, source_event_key, title
        )
        select i.user_id, i.complex_id, 'inquiry_answer', ${operator.id}::uuid,
               'inquiry', i.id, 'inquiry-answer:' || i.id::text, '문의 답변이 등록되었습니다'
        from inquiries i
        where i.id = ${inquiryId}::uuid
          and i.complex_id = ${operator.complexId}::uuid
          and i.status = 'answered'
        on conflict (user_id, source_event_key) where source_event_key is not null do nothing
        returning id
      `
    ]);
    const updated = (results[0] as Record<string, unknown>[])[0];
    if (updated) return ok(mapDetail(updated), requestId);
    if (String(target.status) === 'answered') return ok(mapDetail(target), requestId);
    return fail('CONFLICT', 'Inquiry can no longer be answered', 409, requestId);
  }

  if (status === 'closed') {
    const rows = await sql`
      update inquiries
      set status = 'closed', closed_at = coalesce(closed_at, now())
      where id = ${inquiryId}::uuid
        and complex_id = ${operator.complexId}::uuid
        and status = 'answered'
      returning id, inquiry_type, title, body, status, response_text, answered_at, closed_at, created_at, updated_at
    `;
    if (rows[0]) return ok(mapDetail(rows[0] as Record<string, unknown>), requestId);
    if (String(target.status) === 'closed') return ok(mapDetail(target), requestId);
    return fail('CONFLICT', 'Only an answered inquiry can be closed', 409, requestId);
  }

  return fail('VALIDATION_ERROR', 'status must be in_progress, answered or closed', 400, requestId);
}

export async function handleInquiryWithSql(request: Request, env: CoreEnv, sql: Sql, requestId: string): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const mine = path === '/api/v1/me/inquiries';
  const mineItem = path.match(/^\/api\/v1\/me\/inquiries\/([0-9a-fA-F-]+)$/);
  const adminQueue = path.match(/^\/api\/v1\/admin\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/inquiries$/);
  const adminItem = path.match(/^\/api\/v1\/admin\/inquiries\/([0-9a-fA-F-]+)$/);
  if (!mine && !mineItem && !adminQueue && !adminItem) return null;

  if (mine) {
    if (request.method === 'GET') {
      const complexSlug = (url.searchParams.get('complexSlug') || '').trim();
      if (!COMPLEX_SLUG.test(complexSlug)) return fail('VALIDATION_ERROR', 'Valid complexSlug is required', 400, requestId);
      return listMine(request, env, sql, requestId, complexSlug);
    }
    if (request.method === 'POST') return createMine(request, env, sql, requestId);
    return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
  }

  if (mineItem) {
    if (!UUID.test(mineItem[1])) return fail('NOT_FOUND', 'Inquiry not found', 404, requestId);
    if (request.method === 'GET') return readMine(request, env, sql, requestId, mineItem[1].toLowerCase());
    if (request.method === 'PATCH') return closeMine(request, env, sql, requestId, mineItem[1].toLowerCase());
    return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
  }

  if (adminQueue) {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return adminList(request, env, sql, requestId, adminQueue[1], (url.searchParams.get('status') || 'received').trim());
  }

  if (adminItem) {
    if (!UUID.test(adminItem[1])) return fail('NOT_FOUND', 'Inquiry not found', 404, requestId);
    if (request.method !== 'PATCH') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return adminReview(request, env, sql, requestId, adminItem[1].toLowerCase());
  }
  return null;
}

export async function handleInquiryRequest(request: Request, env: CoreEnv, requestId: string): Promise<Response | null> {
  if (!new URL(request.url).pathname.includes('/inquiries')) return null;
  return handleInquiryWithSql(request, env, sqlFor(env), requestId);
}
