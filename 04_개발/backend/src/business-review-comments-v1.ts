import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireVerifiedResident } from './authorization-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

// GAP-1 resident review comments (parent #278).
// SEPARATE resource from the canonical single business-owner reply
// (business_review_replies in business-reviews-v1.ts, migration 027).
// BUSINESS_REVIEW_COMMENT != BUSINESS_REVIEW_OWNER_REPLY.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_COMMENT_CHARS = 500;

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

function commentText(payload: Record<string, unknown>, requestId: string): string | Response {
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!body || body.length > MAX_COMMENT_CHARS) {
    return fail('VALIDATION_ERROR', `body must be 1-${MAX_COMMENT_CHARS} characters`, 400, requestId);
  }
  return body;
}

async function businessInComplex(sql: Sql, complexSlug: string, businessId: string) {
  const rows = await sql`
    select b.id, c.id as complex_id
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

async function activeReviewInBusiness(sql: Sql, complexId: string, businessId: string, reviewId: string) {
  const rows = await sql`
    select id
    from business_reviews
    where id = ${reviewId}::uuid
      and business_id = ${businessId}::uuid
      and complex_id = ${complexId}::uuid
      and status = 'active'
    limit 1
  `;
  return rows[0] ?? null;
}

function mapComment(row: Record<string, unknown>, residentId: string, businessId: string, reviewId: string) {
  return {
    id: String(row.id),
    businessId,
    reviewId,
    body: String(row.body),
    isMine: String(row.author_user_id) === residentId,
    author: {
      userId: String(row.author_user_id),
      nickname: String(row.author_nickname),
      avatarUrl: row.author_avatar_url ? String(row.author_avatar_url) : null
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listComments(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string,
  businessId: string,
  reviewId: string
): Promise<Response> {
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  const business = await businessInComplex(sql, complexSlug, businessId);
  if (!business || String(business.complex_id) !== resident.complexId) {
    return fail('BUSINESS_NOT_FOUND', 'Business not found', 404, requestId);
  }
  const review = await activeReviewInBusiness(sql, resident.complexId, businessId, reviewId);
  if (!review) return fail('REVIEW_NOT_FOUND', 'Review not found', 404, requestId);

  const rows = await sql`
    select
      c.id,
      c.body,
      c.created_at,
      c.updated_at,
      author.id as author_user_id,
      author.display_name as author_nickname,
      author.avatar_url as author_avatar_url
    from business_review_comments c
    join app_users author on author.id = c.author_user_id and author.account_status = 'active'
    where c.complex_id = ${resident.complexId}::uuid
      and c.business_id = ${businessId}::uuid
      and c.review_id = ${reviewId}::uuid
      and c.status = 'active'
    order by c.created_at asc, c.id asc
    limit 100
  `;

  return ok({
    businessId,
    reviewId,
    comments: rows.map((row) => mapComment(row as Record<string, unknown>, resident.id, businessId, reviewId))
  }, requestId);
}

async function createComment(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string,
  businessId: string,
  reviewId: string
): Promise<Response> {
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  const business = await businessInComplex(sql, complexSlug, businessId);
  if (!business || String(business.complex_id) !== resident.complexId) {
    return fail('BUSINESS_NOT_FOUND', 'Business not found', 404, requestId);
  }
  const review = await activeReviewInBusiness(sql, resident.complexId, businessId, reviewId);
  if (!review) return fail('REVIEW_NOT_FOUND', 'Review not found', 404, requestId);

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const body = commentText(payload, requestId);
  if (body instanceof Response) return body;

  const rows = await sql`
    insert into business_review_comments (complex_id, business_id, review_id, author_user_id, body)
    values (
      ${resident.complexId}::uuid,
      ${businessId}::uuid,
      ${reviewId}::uuid,
      ${resident.id}::uuid,
      ${body}
    )
    returning id, body, created_at, updated_at
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return fail('REVIEW_COMMENT_CREATE_FAILED', 'Review comment could not be created', 500, requestId);
  const created = await sql`
    select
      c.id,
      c.body,
      c.created_at,
      c.updated_at,
      author.id as author_user_id,
      author.display_name as author_nickname,
      author.avatar_url as author_avatar_url
    from business_review_comments c
    join app_users author on author.id = c.author_user_id
    where c.id = ${String(row.id)}::uuid
    limit 1
  `;
  const createdRow = created[0] as Record<string, unknown> | undefined;
  if (!createdRow) return fail('REVIEW_COMMENT_CREATE_FAILED', 'Review comment could not be created', 500, requestId);
  return ok(mapComment(createdRow, resident.id, businessId, reviewId), requestId, 201);
}

async function updateOwnComment(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string,
  businessId: string,
  reviewId: string,
  commentId: string
): Promise<Response> {
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  const business = await businessInComplex(sql, complexSlug, businessId);
  if (!business || String(business.complex_id) !== resident.complexId) {
    return fail('BUSINESS_NOT_FOUND', 'Business not found', 404, requestId);
  }
  const review = await activeReviewInBusiness(sql, resident.complexId, businessId, reviewId);
  if (!review) return fail('REVIEW_NOT_FOUND', 'Review not found', 404, requestId);
  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const body = commentText(payload, requestId);
  if (body instanceof Response) return body;
  const rows = await sql`
    update business_review_comments
    set body = ${body}
    where id = ${commentId}::uuid
      and review_id = ${reviewId}::uuid
      and business_id = ${businessId}::uuid
      and complex_id = ${resident.complexId}::uuid
      and author_user_id = ${resident.id}::uuid
      and status = 'active'
    returning id, body, created_at, updated_at
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return fail('REVIEW_COMMENT_NOT_FOUND', 'Review comment not found', 404, requestId);
  const updated = await sql`
    select
      c.id,
      c.body,
      c.created_at,
      c.updated_at,
      author.id as author_user_id,
      author.display_name as author_nickname,
      author.avatar_url as author_avatar_url
    from business_review_comments c
    join app_users author on author.id = c.author_user_id
    where c.id = ${String(row.id)}::uuid
    limit 1
  `;
  const updatedRow = updated[0] as Record<string, unknown> | undefined;
  if (!updatedRow) return fail('REVIEW_COMMENT_NOT_FOUND', 'Review comment not found', 404, requestId);
  return ok(mapComment(updatedRow, resident.id, businessId, reviewId), requestId);
}

async function deleteOwnComment(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string,
  businessId: string,
  reviewId: string,
  commentId: string
): Promise<Response> {
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;
  const business = await businessInComplex(sql, complexSlug, businessId);
  if (!business || String(business.complex_id) !== resident.complexId) {
    return fail('BUSINESS_NOT_FOUND', 'Business not found', 404, requestId);
  }
  const review = await activeReviewInBusiness(sql, resident.complexId, businessId, reviewId);
  if (!review) return fail('REVIEW_NOT_FOUND', 'Review not found', 404, requestId);
  const rows = await sql`
    update business_review_comments
    set status = 'deleted'
    where id = ${commentId}::uuid
      and review_id = ${reviewId}::uuid
      and business_id = ${businessId}::uuid
      and complex_id = ${resident.complexId}::uuid
      and author_user_id = ${resident.id}::uuid
      and status = 'active'
    returning id
  `;
  const row = rows[0];
  if (!row) return fail('REVIEW_COMMENT_NOT_FOUND', 'Review comment not found', 404, requestId);
  return ok({ id: String(row.id), businessId, reviewId, deleted: true }, requestId);
}

export async function handleBusinessReviewCommentWithSql(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  let match = path.match(/^\/api\/v1\/complexes\/([^/]+)\/businesses\/([0-9a-fA-F-]+)\/reviews\/([0-9a-fA-F-]+)\/comments$/);
  if (match) {
    const complexSlug = decodeURIComponent(match[1]);
    const businessId = canonicalUuid(match[2]);
    const reviewId = canonicalUuid(match[3]);
    if (!businessId || !reviewId) return fail('VALIDATION_ERROR', 'Invalid business or review id', 400, requestId);
    if (request.method === 'GET') return listComments(request, env, sql, requestId, complexSlug, businessId, reviewId);
    if (request.method === 'POST') return createComment(request, env, sql, requestId, complexSlug, businessId, reviewId);
    return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
  }
  match = path.match(/^\/api\/v1\/complexes\/([^/]+)\/businesses\/([0-9a-fA-F-]+)\/reviews\/([0-9a-fA-F-]+)\/comments\/([0-9a-fA-F-]+)$/);
  if (match) {
    const complexSlug = decodeURIComponent(match[1]);
    const businessId = canonicalUuid(match[2]);
    const reviewId = canonicalUuid(match[3]);
    const commentId = canonicalUuid(match[4]);
    if (!businessId || !reviewId || !commentId) {
      return fail('VALIDATION_ERROR', 'Invalid business, review or comment id', 400, requestId);
    }
    if (request.method === 'PATCH') {
      return updateOwnComment(request, env, sql, requestId, complexSlug, businessId, reviewId, commentId);
    }
    if (request.method === 'DELETE') {
      return deleteOwnComment(request, env, sql, requestId, complexSlug, businessId, reviewId, commentId);
    }
    return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
  }
  return null;
}

export async function handleBusinessReviewCommentRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.includes('/businesses/') || !path.includes('/reviews/') || !path.includes('/comments')) return null;
  return handleBusinessReviewCommentWithSql(request, env, sqlFor(env), requestId);
}


