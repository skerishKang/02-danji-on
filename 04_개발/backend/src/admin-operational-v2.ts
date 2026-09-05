import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { deriveChannel } from './complex-news-channel';
import type { CoreEnv } from './core-v1';
import { requireOperationalAuthority, type OperationalAuthority } from './operational-authz-v2';
import { validateBusinessImageReference } from './storage-v1';

type Sql = NeonQueryFunction<false, false>;

const MAX_BODY_BYTES = 128 * 1024;

const POLICY = {
  businessReview: {
    padiem: 'business.review',
    council: 'council.business.review'
  },
  officialContent: {
    padiem: 'official-content.manage',
    council: 'council.official-content.manage'
  },
  benefitManage: {
    padiem: 'benefit.manage',
    council: 'council.benefit.manage'
  }
} as const;

function json(data: unknown, status: number, requestId: string): Response {
  return Response.json(data, {
    status,
    headers: {
      'x-danjion-request-id': requestId,
      'access-control-expose-headers': 'x-danjion-request-id',
      'cache-control': 'no-store'
    }
  });
}

function ok(data: unknown, requestId: string, status = 200): Response {
  return json({ data, requestId }, status, requestId);
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}

async function bodyJson(request: Request, requestId: string): Promise<Record<string, unknown> | Response> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  }
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fail('INVALID_JSON', 'JSON object required', 400, requestId);
    }
    return parsed as Record<string, unknown>;
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
}

async function authority(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string,
  policy: { readonly padiem: string; readonly council: string }
): Promise<OperationalAuthority | Response> {
  return requireOperationalAuthority(
    request,
    env,
    sql,
    requestId,
    complexSlug,
    policy.padiem,
    policy.council
  );
}

async function applicationContext(sql: Sql, applicationId: string) {
  const rows = await sql`
    select a.id, a.status, a.approved_business_id, a.applicant_user_id,
           a.representative_image_object_key, c.slug as complex_slug
    from business_applications a
    join complexes c on c.id = a.complex_id
    where a.id = ${applicationId}::uuid
    limit 1
  `;
  return rows[0];
}

async function approveApplication(sql: Sql, actorId: string, applicationId: string, reviewNote: string | null) {
  const rows = await sql`
    with approved as (
      update business_applications a
      set status = 'approved',
          review_note = ${reviewNote},
          reviewed_by = ${actorId}::uuid,
          reviewed_at = now(),
          approved_business_id = coalesce(a.approved_business_id, gen_random_uuid())
      where a.id = ${applicationId}::uuid
        and a.status in ('pending','changes_requested')
      returning a.*
    ),
    created_business as (
      insert into businesses (
        id, owner_user_id, category_id, kind, name, summary, description,
        price_text, service_area, availability_text, status
      )
      select a.approved_business_id,
             a.applicant_user_id,
             (select bc.id from business_categories bc where bc.name = a.category_name limit 1),
             'service',
             a.business_name,
             a.service_summary,
             a.service_summary,
             a.price_text,
             a.service_area,
             a.availability_text,
             'approved'
      from approved a
      on conflict (id) do nothing
      returning id
    ),
    created_relation as (
      insert into business_complex_relations (
        business_id, complex_id, relation_type, verification_status,
        priority, verified_by, verified_at
      )
      select a.approved_business_id, a.complex_id, a.relation_type,
             'verified', 100, ${actorId}::uuid, now()
      from approved a
      on conflict (business_id, complex_id) do update
        set relation_type = excluded.relation_type,
            verification_status = 'verified',
            verified_by = excluded.verified_by,
            verified_at = excluded.verified_at
      returning id
    ),
    created_media as (
      insert into business_media (business_id, object_key, alt_text, sort_order)
      select a.approved_business_id, a.representative_image_object_key,
             a.business_name || ' 대표 이미지', 0
      from approved a
      where nullif(trim(a.representative_image_object_key), '') is not null
      on conflict do nothing
      returning id
    ),
    created_benefit as (
      insert into benefits (complex_id, business_id, title, description, conditions, status)
      select a.complex_id, a.approved_business_id, a.benefit_text,
             '단지온 등록 신청에서 승인된 주민혜택',
             '해당 단지 인증 입주민 대상', 'active'
      from approved a
      where nullif(trim(a.benefit_text), '') is not null
        and not exists (
          select 1 from benefits be
          where be.complex_id = a.complex_id
            and be.business_id = a.approved_business_id
            and be.title = a.benefit_text
        )
      returning id
    )
    select id, status, approved_business_id, review_note, reviewed_at
    from approved
  `;
  return rows[0];
}

async function patchApplication(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  applicationId: string,
  requestId: string
): Promise<Response> {
  const current = await applicationContext(sql, applicationId);
  if (!current) return fail('NOT_FOUND', 'Business application not found', 404, requestId);

  const operator = await authority(request, env, sql, requestId, String(current.complex_slug), POLICY.businessReview);
  if (operator instanceof Response) return operator;

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const status = String(payload.status ?? '').trim();
  const noteText = String(payload.reviewNote ?? '').trim();
  const reviewNote = noteText || null;
  if (!['changes_requested','approved','rejected'].includes(status)) {
    return fail('VALIDATION_ERROR', 'status must be changes_requested, approved or rejected', 400, requestId);
  }

  if (status === 'approved') {
    if (String(current.status) === 'approved' && current.approved_business_id) {
      return ok({ id: current.id, status: 'approved', approvedBusinessId: current.approved_business_id, alreadyApproved: true }, requestId);
    }

    const imageKey = current.representative_image_object_key
      ? String(current.representative_image_object_key).trim()
      : '';
    if (imageKey) {
      const imageReferenceError = await validateBusinessImageReference(
        env,
        imageKey,
        String(current.applicant_user_id),
        String(current.complex_slug),
        requestId
      );
      if (imageReferenceError) return imageReferenceError;
    }

    const approved = await approveApplication(sql, operator.id, applicationId, reviewNote);
    if (approved) return ok(approved, requestId);
    const latest = await applicationContext(sql, applicationId);
    if (latest && String(latest.status) === 'approved' && latest.approved_business_id) {
      return ok({ id: latest.id, status: 'approved', approvedBusinessId: latest.approved_business_id, alreadyApproved: true }, requestId);
    }
    return fail('CONFLICT', 'Application can no longer be approved from its current state', 409, requestId);
  }

  const rows = await sql`
    update business_applications
    set status = ${status}, review_note = ${reviewNote},
        reviewed_by = ${operator.id}::uuid, reviewed_at = now()
    where id = ${applicationId}::uuid
      and status in ('pending','changes_requested')
    returning id, status, review_note, reviewed_at
  `;
  if (rows[0]) return ok(rows[0], requestId);
  const latest = await applicationContext(sql, applicationId);
  if (latest && String(latest.status) === status) {
    return ok({ id: latest.id, status, alreadyInState: true }, requestId);
  }
  return fail('CONFLICT', 'Application can no longer be reviewed from its current state', 409, requestId);
}

async function createPost(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  complexSlug: string,
  requestId: string
): Promise<Response> {
  const operator = await authority(request, env, sql, requestId, complexSlug, POLICY.officialContent);
  if (operator instanceof Response) return operator;

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;

  const sourceName = String(payload.sourceName ?? '').trim();
  const category = String(payload.category ?? '').trim();
  const title = String(payload.title ?? '').trim();
  const body = String(payload.body ?? '').trim();
  const status = String(payload.status ?? 'published').trim();
  if (!sourceName || !category || !title || !body) {
    return fail('VALIDATION_ERROR', 'sourceName, category, title and body are required', 400, requestId);
  }
  if (!['draft','published','archived'].includes(status)) {
    return fail('VALIDATION_ERROR', 'Invalid post status', 400, requestId);
  }

  const publishedAt = String(payload.publishedAt ?? '').trim() || null;
  const attachment = String(payload.attachmentObjectKey ?? '').trim() || null;
  const channel = deriveChannel(sourceName, payload.channel);
  if (!channel) return fail('INVALID_CHANNEL', 'Invalid channel', 400, requestId);
  const rows = await sql`
    insert into complex_posts (
      complex_id, author_user_id, source_name, category, title, body,
      attachment_object_key, status, published_at, channel
    ) values (
      ${operator.complexId}::uuid,
      ${operator.id}::uuid,
      ${sourceName}, ${category}, ${title}, ${body}, ${attachment}, ${status},
      case when ${status} = 'published' then coalesce(${publishedAt}::timestamptz, now()) else null end,
      ${channel}
    )
    returning id, source_name, category, title, body, status, published_at, created_at, channel
  `;
  return ok(rows[0], requestId, 201);
}

async function patchPost(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  postId: string,
  requestId: string
): Promise<Response> {
  const rows = await sql`
    select p.*, c.slug as complex_slug
    from complex_posts p
    join complexes c on c.id = p.complex_id
    where p.id = ${postId}::uuid
    limit 1
  `;
  const current = rows[0];
  if (!current) return fail('NOT_FOUND', 'Post not found', 404, requestId);

  const operator = await authority(request, env, sql, requestId, String(current.complex_slug), POLICY.officialContent);
  if (operator instanceof Response) return operator;

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const sourceName = payload.sourceName === undefined ? String(current.source_name) : String(payload.sourceName).trim();
  const category = payload.category === undefined ? String(current.category) : String(payload.category).trim();
  const title = payload.title === undefined ? String(current.title) : String(payload.title).trim();
  const body = payload.body === undefined ? String(current.body) : String(payload.body).trim();
  const status = payload.status === undefined ? String(current.status) : String(payload.status).trim();
  const attachment = payload.attachmentObjectKey === undefined
    ? (current.attachment_object_key ? String(current.attachment_object_key) : null)
    : (String(payload.attachmentObjectKey).trim() || null);
  if (!sourceName || !category || !title || !body || !['draft','published','archived'].includes(status)) {
    return fail('VALIDATION_ERROR', 'Invalid post update', 400, requestId);
  }
  const channel = deriveChannel(sourceName, payload.channel);
  if (!channel) return fail('INVALID_CHANNEL', 'Invalid channel', 400, requestId);
  const updated = await sql`
    update complex_posts
    set source_name = ${sourceName}, category = ${category}, title = ${title}, body = ${body},
        attachment_object_key = ${attachment}, status = ${status},
        channel = ${channel},
        published_at = case when ${status} = 'published' then coalesce(published_at, now()) else published_at end
    where id = ${postId}::uuid
    returning id, source_name, category, title, body, status, published_at, updated_at, channel
  `;
  return ok(updated[0], requestId);
}

async function createBenefit(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  complexSlug: string,
  requestId: string
): Promise<Response> {
  const operator = await authority(request, env, sql, requestId, complexSlug, POLICY.benefitManage);
  if (operator instanceof Response) return operator;

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const businessId = String(payload.businessId ?? '').trim();
  const title = String(payload.title ?? '').trim();
  if (!businessId || !title) return fail('VALIDATION_ERROR', 'businessId and title are required', 400, requestId);

  const related = await sql`
    select b.id
    from businesses b
    join business_complex_relations r on r.business_id = b.id
    where b.id = ${businessId}::uuid and r.complex_id = ${operator.complexId}::uuid
    limit 1
  `;
  if (!related[0]) return fail('VALIDATION_ERROR', 'Business is not related to this complex', 400, requestId);

  const status = String(payload.status ?? 'active').trim();
  if (!['draft','active','expired','suspended'].includes(status)) {
    return fail('VALIDATION_ERROR', 'Invalid benefit status', 400, requestId);
  }
  const startsAt = String(payload.startsAt ?? '').trim() || null;
  const endsAt = String(payload.endsAt ?? '').trim() || null;
  const rows = await sql`
    insert into benefits (
      complex_id, business_id, title, description, conditions, starts_at, ends_at, status
    ) values (
      ${operator.complexId}::uuid,
      ${businessId}::uuid,
      ${title},
      ${String(payload.description ?? '')},
      ${String(payload.conditions ?? '').trim() || null},
      ${startsAt}::timestamptz,
      ${endsAt}::timestamptz,
      ${status}
    )
    returning id, business_id, title, description, conditions, starts_at, ends_at, status, created_at
  `;
  return ok(rows[0], requestId, 201);
}

async function patchBenefit(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  benefitId: string,
  requestId: string
): Promise<Response> {
  const rows = await sql`
    select be.*, c.slug as complex_slug
    from benefits be
    join complexes c on c.id = be.complex_id
    where be.id = ${benefitId}::uuid
    limit 1
  `;
  const current = rows[0];
  if (!current) return fail('NOT_FOUND', 'Benefit not found', 404, requestId);

  const operator = await authority(request, env, sql, requestId, String(current.complex_slug), POLICY.benefitManage);
  if (operator instanceof Response) return operator;

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const title = payload.title === undefined ? String(current.title) : String(payload.title).trim();
  const description = payload.description === undefined ? String(current.description ?? '') : String(payload.description);
  const conditions = payload.conditions === undefined
    ? (current.conditions ? String(current.conditions) : null)
    : (String(payload.conditions).trim() || null);
  const status = payload.status === undefined ? String(current.status) : String(payload.status).trim();
  const startsAt = payload.startsAt === undefined ? (current.starts_at ? String(current.starts_at) : null) : (String(payload.startsAt).trim() || null);
  const endsAt = payload.endsAt === undefined ? (current.ends_at ? String(current.ends_at) : null) : (String(payload.endsAt).trim() || null);
  if (!title || !['draft','active','expired','suspended'].includes(status)) {
    return fail('VALIDATION_ERROR', 'Invalid benefit update', 400, requestId);
  }
  const updated = await sql`
    update benefits
    set title = ${title}, description = ${description}, conditions = ${conditions},
        starts_at = ${startsAt}::timestamptz, ends_at = ${endsAt}::timestamptz, status = ${status}
    where id = ${benefitId}::uuid
    returning id, business_id, title, description, conditions, starts_at, ends_at, status, updated_at
  `;
  return ok(updated[0], requestId);
}

/**
 * Phase-B replacement for the six legacy admin-v1 operational routes.
 * Returning null leaves unrelated admin route families to their existing handlers.
 */
export async function handleAdminOperationalRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const sql: Sql = neon(env.DATABASE_URL);

  let match = path.match(/^\/api\/v1\/admin\/complexes\/([^/]+)\/business-applications$/);
  if (match && request.method === 'GET') {
    const complexSlug = decodeURIComponent(match[1]);
    const operator = await authority(request, env, sql, requestId, complexSlug, POLICY.businessReview);
    if (operator instanceof Response) return operator;

    const status = url.searchParams.get('status')?.trim() || null;
    if (status && status !== 'all' && !['draft','pending','changes_requested','approved','rejected'].includes(status)) {
      return fail('VALIDATION_ERROR', 'Invalid application status filter', 400, requestId);
    }
    const rows = await sql`
      select a.id, a.relation_type, a.business_name, a.category_name, a.service_summary,
             a.price_text, a.contact_method, a.service_area, a.benefit_text,
             a.availability_text, a.representative_image_object_key,
             a.status, a.review_note, a.approved_business_id,
             u.display_name as applicant_name, a.created_at, a.updated_at
      from business_applications a
      join app_users u on u.id = a.applicant_user_id
      where a.complex_id = ${operator.complexId}::uuid
        and (${status}::text is null or ${status} = 'all' or a.status = ${status})
      order by case a.status when 'pending' then 0 when 'changes_requested' then 1 else 2 end,
               a.created_at asc
    `;
    return ok(rows, requestId);
  }

  match = path.match(/^\/api\/v1\/admin\/business-applications\/([0-9a-fA-F-]+)$/);
  if (match && request.method === 'PATCH') {
    return patchApplication(request, env, sql, match[1], requestId);
  }

  match = path.match(/^\/api\/v1\/admin\/complexes\/([^/]+)\/posts$/);
  if (match && request.method === 'POST') {
    return createPost(request, env, sql, decodeURIComponent(match[1]), requestId);
  }

  match = path.match(/^\/api\/v1\/admin\/posts\/([0-9a-fA-F-]+)$/);
  if (match && request.method === 'PATCH') {
    return patchPost(request, env, sql, match[1], requestId);
  }

  match = path.match(/^\/api\/v1\/admin\/complexes\/([^/]+)\/benefits$/);
  if (match && request.method === 'POST') {
    return createBenefit(request, env, sql, decodeURIComponent(match[1]), requestId);
  }

  match = path.match(/^\/api\/v1\/admin\/benefits\/([0-9a-fA-F-]+)$/);
  if (match && request.method === 'PATCH') {
    return patchBenefit(request, env, sql, match[1], requestId);
  }

  return null;
}
