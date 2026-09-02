import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import { requireVerifiedResident } from './authorization-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_TEXT_CHARS = 2000;

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

function canonicalUuid(value: string | undefined): string | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return UUID.test(text) ? text : null;
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
  try {
    const parsed = JSON.parse(text || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fail('INVALID_JSON', 'JSON object required', 400, requestId);
    }
    return parsed as Record<string, unknown>;
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
}

function reviewText(payload: Record<string, unknown>, requestId: string): string | Response {
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!body || body.length > MAX_TEXT_CHARS) {
    return fail('VALIDATION_ERROR', `body must be 1-${MAX_TEXT_CHARS} characters`, 400, requestId);
  }
  return body;
}

async function businessInComplex(sql: Sql, complexSlug: string, businessId: string) {
  const rows = await sql`
    select b.id, b.owner_user_id, c.id as complex_id
    from businesses b
    join business_complex_relations r on r.business_id = b.id
    join complexes c on c.id = r.complex_id
    where b.id = ${businessId}::uuid
      and c.slug = ${complexSlug}
      and c.status in ('active','pilot')
      and b.status = 'approved'
      and r.verification_status = 'verified'
    limit 1
  `;
  return rows[0] ?? null;
}

async function listReviews(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string,
  businessId: string
): Promise<Response> {
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  const business = await businessInComplex(sql, complexSlug, businessId);
  if (!business || String(business.complex_id) !== resident.complexId) {
    return fail('BUSINESS_NOT_FOUND', 'Business not found', 404, requestId);
  }

  const rows = await sql`
    select
      r.id,
      r.body,
      r.created_at,
      r.updated_at,
      author.id as author_user_id,
      author.display_name as author_nickname,
      author.avatar_url as author_avatar_url,
      reply.body as reply_body,
      reply.created_at as reply_created_at,
      reply.updated_at as reply_updated_at
    from business_reviews r
    join app_users author on author.id = r.author_user_id and author.account_status = 'active'
    left join business_review_replies reply on reply.review_id = r.id
    where r.complex_id = ${resident.complexId}::uuid
      and r.business_id = ${businessId}::uuid
      and r.status = 'active'
    order by r.created_at desc, r.id desc
    limit 100
  `;

  return ok({
    businessId,
    reviews: rows.map((row) => ({
      id: String(row.id),
      body: String(row.body),
      author: {
        userId: String(row.author_user_id),
        nickname: String(row.author_nickname),
        avatarUrl: row.author_avatar_url ? String(row.author_avatar_url) : null
      },
      reply: row.reply_body ? {
        body: String(row.reply_body),
        createdAt: row.reply_created_at,
        updatedAt: row.reply_updated_at
      } : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }, requestId);
}

async function createReview(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string,
  businessId: string
): Promise<Response> {
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  const business = await businessInComplex(sql, complexSlug, businessId);
  if (!business || String(business.complex_id) !== resident.complexId) {
    return fail('BUSINESS_NOT_FOUND', 'Business not found', 404, requestId);
  }
  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const body = reviewText(payload, requestId);
  if (body instanceof Response) return body;

  const rows = await sql`
    insert into business_reviews (complex_id, business_id, author_user_id, body)
    values (${resident.complexId}::uuid, ${businessId}::uuid, ${resident.id}::uuid, ${body})
    returning id, body, created_at, updated_at
  `;
  const row = rows[0];
  if (!row) return fail('REVIEW_CREATE_FAILED', 'Review could not be created', 500, requestId);
  return ok({
    id: String(row.id),
    businessId,
    body: String(row.body),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }, requestId, 201);
}

async function upsertOwnerReply(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string,
  businessId: string,
  reviewId: string
): Promise<Response> {
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;
  const business = await businessInComplex(sql, complexSlug, businessId);
  if (!business || String(business.owner_user_id ?? '') !== actor.id) {
    return fail('BUSINESS_OWNER_REQUIRED', 'Business owner authorization required', 403, requestId);
  }

  const reviewRows = await sql`
    select id
    from business_reviews
    where id = ${reviewId}::uuid
      and business_id = ${businessId}::uuid
      and complex_id = ${String(business.complex_id)}::uuid
      and status = 'active'
    limit 1
  `;
  if (!reviewRows[0]) return fail('REVIEW_NOT_FOUND', 'Review not found', 404, requestId);

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const body = reviewText(payload, requestId);
  if (body instanceof Response) return body;

  const rows = await sql`
    insert into business_review_replies (
      review_id, business_id, complex_id, owner_user_id, body
    ) values (
      ${reviewId}::uuid,
      ${businessId}::uuid,
      ${String(business.complex_id)}::uuid,
      ${actor.id}::uuid,
      ${body}
    )
    on conflict (review_id) do update
    set body = excluded.body,
        owner_user_id = excluded.owner_user_id
    returning review_id, body, created_at, updated_at
  `;
  const row = rows[0];
  if (!row) return fail('REVIEW_REPLY_FAILED', 'Review reply could not be saved', 500, requestId);
  return ok({
    reviewId: String(row.review_id),
    businessId,
    body: String(row.body),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }, requestId);
}

export async function handleBusinessReviewWithSql(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  let match = path.match(/^\/api\/v1\/complexes\/([^/]+)\/businesses\/([0-9a-fA-F-]+)\/reviews$/);
  if (match) {
    const complexSlug = decodeURIComponent(match[1]);
    const businessId = canonicalUuid(match[2]);
    if (!businessId) return fail('VALIDATION_ERROR', 'Invalid business id', 400, requestId);
    if (request.method === 'GET') return listReviews(request, env, sql, requestId, complexSlug, businessId);
    if (request.method === 'POST') return createReview(request, env, sql, requestId, complexSlug, businessId);
    return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
  }

  match = path.match(/^\/api\/v1\/complexes\/([^/]+)\/businesses\/([0-9a-fA-F-]+)\/reviews\/([0-9a-fA-F-]+)\/reply$/);
  if (match) {
    const complexSlug = decodeURIComponent(match[1]);
    const businessId = canonicalUuid(match[2]);
    const reviewId = canonicalUuid(match[3]);
    if (!businessId || !reviewId) return fail('VALIDATION_ERROR', 'Invalid business or review id', 400, requestId);
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return upsertOwnerReply(request, env, sql, requestId, complexSlug, businessId, reviewId);
  }
  return null;
}

export async function handleBusinessReviewRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.includes('/businesses/') || !path.includes('/reviews')) return null;
  return handleBusinessReviewWithSql(request, env, sqlFor(env), requestId);
}
