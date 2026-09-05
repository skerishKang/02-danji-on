import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type AuthEnv } from './auth-v1';
import { requireVerifiedResident } from './authorization-v2';

export type CoreEnv = AuthEnv;

type Sql = NeonQueryFunction<false, false>;

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const MAX_BODY_BYTES = 128 * 1024;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,80}$/;

function requestId(request: Request): string {
  const incoming = request.headers.get(REQUEST_ID_HEADER)?.trim();
  return incoming && SAFE_ID.test(incoming) ? incoming : `req-${crypto.randomUUID()}`;
}

function json(data: unknown, status: number, id: string): Response {
  return Response.json(data, {
    status,
    headers: {
      [REQUEST_ID_HEADER]: id,
      'access-control-expose-headers': REQUEST_ID_HEADER,
      'cache-control': 'no-store'
    }
  });
}

function ok(data: unknown, id: string, status = 200): Response {
  return json({ data, requestId: id }, status, id);
}

function fail(code: string, message: string, status: number, id: string): Response {
  return json({ error: { code, message }, requestId: id }, status, id);
}

function sqlFor(env: CoreEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

function clampLimit(value: string | null, fallback = 50, max = 100): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

async function bodyJson(request: Request, id: string): Promise<Record<string, unknown> | Response> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, id);
  }
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fail('INVALID_JSON', 'JSON object required', 400, id);
    }
    return parsed as Record<string, unknown>;
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, id);
  }
}

function relationFilter(value: string | null): string | null {
  if (!value || value === 'all') return null;
  return ['resident', 'resident_family', 'neighbor', 'local'].includes(value) ? value : '__invalid__';
}

const NEWS_CHANNELS = ['danjion_notice', 'apartment_news', 'management_office', 'chair_greeting'];

function channelFilter(value: string | null): string | null {
  if (!value || value === 'all') return null;
  return NEWS_CHANNELS.includes(value.trim()) ? value.trim() : '__invalid__';
}

async function handlePublicGet(sql: Sql, id: string, url: URL): Promise<Response | null> {
  const path = url.pathname;

  if (path === '/api/health') {
    const rows = await sql`select 1 as ok`;
    return ok({ status: 'ok', database: Number(rows[0]?.ok) === 1 ? 'ok' : 'unknown' }, id);
  }

  let match = path.match(/^\/api\/v1\/complexes\/([^/]+)$/);
  if (match) {
    const slug = decodeURIComponent(match[1]);
    const rows = await sql`
      select id, slug, name, address, status
      from complexes
      where slug = ${slug} and status in ('active','pilot')
      limit 1
    `;
    if (!rows[0]) return fail('NOT_FOUND', 'Complex not found', 404, id);
    return ok(rows[0], id);
  }

  match = path.match(/^\/api\/v1\/complexes\/([^/]+)\/businesses$/);
  if (match) {
    const slug = decodeURIComponent(match[1]);
    const rawQuery = url.searchParams.get('q')?.trim() || null;
    const query = rawQuery ? `%${rawQuery}%` : null;
    const category = url.searchParams.get('category')?.trim() || null;
    const relation = relationFilter(url.searchParams.get('relation'));
    if (relation === '__invalid__') return fail('INVALID_RELATION', 'Invalid relation filter', 400, id);
    const limit = clampLimit(url.searchParams.get('limit'));

    const rows = await sql`
      select b.id, b.kind, b.name, b.summary, b.description, b.price_text,
             b.service_area, b.availability_text,
             bc.slug as category_slug, bc.name as category_name,
             r.relation_type, r.priority,
             (
               select bm.object_key
               from business_media bm
               where bm.business_id = b.id
               order by bm.sort_order, bm.created_at
               limit 1
             ) as representative_image_object_key,
             (
               select json_build_object(
                 'id', be.id,
                 'title', be.title,
                 'description', be.description,
                 'conditions', be.conditions,
                 'startsAt', be.starts_at,
                 'endsAt', be.ends_at
               )
               from benefits be
               where be.business_id = b.id
                 and be.complex_id = c.id
                 and be.status = 'active'
                 and (be.starts_at is null or be.starts_at <= now())
                 and (be.ends_at is null or be.ends_at >= now())
               order by be.created_at desc
               limit 1
             ) as active_benefit
      from businesses b
      join business_complex_relations r on r.business_id = b.id
      join complexes c on c.id = r.complex_id
      left join business_categories bc on bc.id = b.category_id
      where c.slug = ${slug}
        and c.status in ('active','pilot')
        and b.status = 'approved'
        and r.verification_status = 'verified'
        and (${relation}::text is null or r.relation_type = ${relation})
        and (${category}::text is null or ${category} = 'all' or bc.slug = ${category} or bc.name = ${category})
        and (
          ${query}::text is null
          or b.name ilike ${query}
          or b.summary ilike ${query}
          or bc.name ilike ${query}
        )
      order by case r.relation_type
        when 'resident' then 0
        when 'resident_family' then 1
        when 'neighbor' then 2
        else 3 end,
        r.priority asc,
        b.created_at desc
      limit ${limit}
    `;
    return ok(rows, id);
  }

  match = path.match(/^\/api\/v1\/complexes\/([^/]+)\/businesses\/([0-9a-fA-F-]+)$/);
  if (match) {
    const slug = decodeURIComponent(match[1]);
    const businessId = match[2];
    const rows = await sql`
      select b.id, b.kind, b.name, b.summary, b.description, b.price_text,
             b.service_area, b.availability_text,
             bc.slug as category_slug, bc.name as category_name,
             r.relation_type
      from businesses b
      join business_complex_relations r on r.business_id = b.id
      join complexes c on c.id = r.complex_id
      left join business_categories bc on bc.id = b.category_id
      where c.slug = ${slug}
        and b.id = ${businessId}::uuid
        and b.status = 'approved'
        and r.verification_status = 'verified'
      limit 1
    `;
    const business = rows[0];
    if (!business) return fail('NOT_FOUND', 'Business not found', 404, id);
    const media = await sql`
      select id, object_key, alt_text, sort_order
      from business_media
      where business_id = ${businessId}::uuid
      order by sort_order, created_at
    `;
    const benefits = await sql`
      select id, title, description, conditions, starts_at, ends_at
      from benefits
      where business_id = ${businessId}::uuid
        and complex_id = (
          select id from complexes where slug = ${slug} limit 1
        )
        and status = 'active'
        and (starts_at is null or starts_at <= now())
        and (ends_at is null or ends_at >= now())
      order by created_at desc
    `;
    return ok({ ...business, media, benefits }, id);
  }

  match = path.match(/^\/api\/v1\/complexes\/([^/]+)\/benefits$/);
  if (match) {
    const slug = decodeURIComponent(match[1]);
    const rows = await sql`
      select be.id, be.title, be.description, be.conditions, be.starts_at, be.ends_at,
             b.id as business_id, b.name as business_name
      from benefits be
      join complexes c on c.id = be.complex_id
      join businesses b on b.id = be.business_id
      where c.slug = ${slug}
        and be.status = 'active'
        and b.status = 'approved'
        and (be.starts_at is null or be.starts_at <= now())
        and (be.ends_at is null or be.ends_at >= now())
      order by be.created_at desc
    `;
    return ok(rows, id);
  }

  match = path.match(/^\/api\/v1\/complexes\/([^/]+)\/posts$/);
  if (match) {
    const slug = decodeURIComponent(match[1]);
    const category = url.searchParams.get('category')?.trim() || null;
    const channel = channelFilter(url.searchParams.get('channel'));
    if (channel === '__invalid__') return fail('INVALID_CHANNEL', 'Invalid channel filter', 400, id);
    const limit = clampLimit(url.searchParams.get('limit'), 20, 50);
    const rows = await sql`
      select p.id, p.source_name, p.category, p.channel, p.title, p.body,
             p.attachment_object_key, p.published_at
      from complex_posts p
      join complexes c on c.id = p.complex_id
      where c.slug = ${slug}
        and p.status = 'published'
        and (${category}::text is null or ${category} = 'all' or p.category = ${category})
        and (${channel}::text is null or ${channel} = 'all' or p.channel = ${channel})
      order by p.published_at desc nulls last, p.created_at desc
      limit ${limit}
    `;
    return ok(rows, id);
  }

  match = path.match(/^\/api\/v1\/complexes\/([^/]+)\/posts\/([0-9a-fA-F-]+)$/);
  if (match) {
    const slug = decodeURIComponent(match[1]);
    const postId = match[2];
    const rows = await sql`
      select p.id, p.source_name, p.category, p.channel, p.title, p.body,
             p.attachment_object_key, p.published_at
      from complex_posts p
      join complexes c on c.id = p.complex_id
      where c.slug = ${slug}
        and p.id = ${postId}::uuid
        and p.status = 'published'
      limit 1
    `;
    if (!rows[0]) return fail('NOT_FOUND', 'Post not found', 404, id);
    return ok(rows[0], id);
  }

  return null;
}

async function handlePrivate(request: Request, env: CoreEnv, sql: Sql, id: string, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith('/api/v1/me') && !path.includes('/contact')) return null;

  const actorOrResponse = await requireActor(request, env, sql, id);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;

  if (request.method === 'GET' && path === '/api/v1/me') {
    const memberships = await sql`
      select c.id as complex_id, c.slug as complex_slug, c.name as complex_name,
             m.role, m.verification_status
      from complex_memberships m
      join complexes c on c.id = m.complex_id
      where m.user_id = ${actor.id}::uuid
      order by c.name
    `;
    return ok({ user: actor, memberships }, id);
  }

  if (request.method === 'GET' && path === '/api/v1/me/bookmarks') {
    const rows = await sql`
      select b.id, b.name, b.summary, b.price_text, bm.created_at as bookmarked_at
      from bookmarks bm
      join businesses b on b.id = bm.business_id
      where bm.user_id = ${actor.id}::uuid and b.status = 'approved'
      order by bm.created_at desc
    `;
    return ok(rows, id);
  }

  let match = path.match(/^\/api\/v1\/me\/bookmarks\/([0-9a-fA-F-]+)$/);
  if (match && request.method === 'POST') {
    const businessId = match[1];
    const inserted = await sql`
      insert into bookmarks (user_id, business_id)
      select ${actor.id}::uuid, b.id
      from businesses b
      where b.id = ${businessId}::uuid and b.status = 'approved'
      on conflict (user_id, business_id) do nothing
      returning business_id
    `;
    if (!inserted[0]) {
      const exists = await sql`select id from businesses where id = ${businessId}::uuid and status = 'approved' limit 1`;
      if (!exists[0]) return fail('NOT_FOUND', 'Business not found', 404, id);
    }
    return ok({ businessId, bookmarked: true }, id, 201);
  }

  if (match && request.method === 'DELETE') {
    const businessId = match[1];
    await sql`delete from bookmarks where user_id = ${actor.id}::uuid and business_id = ${businessId}::uuid`;
    return ok({ businessId, bookmarked: false }, id);
  }

  if (request.method === 'GET' && path === '/api/v1/me/business-applications') {
    const rows = await sql`
      select a.id, c.slug as complex_slug, a.relation_type, a.business_name,
             a.category_name, a.service_summary, a.status, a.review_note,
             a.approved_business_id, a.created_at, a.updated_at
      from business_applications a
      join complexes c on c.id = a.complex_id
      where a.applicant_user_id = ${actor.id}::uuid
      order by a.created_at desc
    `;
    return ok(rows, id);
  }

  match = path.match(/^\/api\/v1\/complexes\/([^/]+)\/businesses\/([0-9a-fA-F-]+)\/contact$/);
  if (match && request.method === 'GET') {
    const complexSlug = decodeURIComponent(match[1]);
    const businessId = match[2];
    const residentOrResponse = await requireVerifiedResident(request, env, sql, id, complexSlug);
    if (residentOrResponse instanceof Response) return residentOrResponse;
    const rows = await sql`
      select bc.contact_type, bc.contact_value
      from business_contacts bc
      join business_complex_relations r on r.business_id = bc.business_id
      join complexes c on c.id = r.complex_id
      where bc.business_id = ${businessId}::uuid
        and c.slug = ${complexSlug}
        and r.verification_status = 'verified'
        and bc.visibility in ('public','verified_residents')
      order by bc.sort_order
    `;
    if (!rows.length) return fail('NOT_FOUND', 'Contact not found', 404, id);
    return ok(rows, id);
  }

  return null;
}

export default {
  async fetch(request: Request, env: CoreEnv): Promise<Response> {
    const id = requestId(request);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': url.origin,
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': `content-type,authorization,${REQUEST_ID_HEADER},x-danjion-dev-auth-user`,
          'access-control-max-age': '86400'
        }
      });
    }

    try {
      const sql = sqlFor(env);
      if (request.method === 'GET') {
        const publicResponse = await handlePublicGet(sql, id, url);
        if (publicResponse) return publicResponse;
      }
      const privateResponse = await handlePrivate(request, env, sql, id, url);
      if (privateResponse) return privateResponse;
      return fail('NOT_FOUND', 'Route not found', 404, id);
    } catch (error) {
      console.error('[DanjiOn Core API]', id, error);
      return fail('INTERNAL_ERROR', 'Internal server error', 500, id);
    }
  }
};