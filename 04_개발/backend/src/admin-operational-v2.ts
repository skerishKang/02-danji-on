import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type Actor } from './auth-v1';
import { deriveChannel } from './complex-news-channel';
import type { CoreEnv } from './core-v1';
// #975: the canonical UUID validator (same one #973 uses for public route
// identifiers) must gate every ID-based admin route before any ::uuid cast.
import { UUID } from './application-docs-core-v1';
import {
  operationalPrincipalDenial,
  requireOperationalAuthority,
  type OperationalAuthority
} from './operational-authz-v2';
import { validateBusinessImageReference, validateOfficialNewsImageReference } from './storage-reference-v1';
import { decodeComplexSlug } from './complex-slug-v1';
import {
  insertOfficialNewsPostWithAttachment,
  updateOfficialNewsPostWithAttachment
} from './official-news-attachment-v1';

type Sql = NeonQueryFunction<false, false>;

const MAX_BODY_BYTES = 128 * 1024;

type BenefitTimestamp = {
  value: string | null;
  epochMs: number | null;
};

const BENEFIT_ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/i;

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

// #970: validate optional benefit timestamps before SQL and preserve explicit clears.
function normalizeBenefitTimestamp(value: unknown): BenefitTimestamp | null {
  if (value === null || value === undefined) return { value: null, epochMs: null };
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return { value: value.toISOString(), epochMs: value.getTime() };
  }
  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (!text) return { value: null, epochMs: null };
  const match = BENEFIT_ISO_TIMESTAMP.exec(text);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] || '').padEnd(3, '0').slice(0, 3));
  const offset = match[8];

  if (offset.toUpperCase() !== 'Z') {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
  }

  // Date.parse accepts impossible civil dates by rolling them forward. Check
  // the calendar fields before accepting the value so 2026-02-30 cannot pass.
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, millisecond);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second ||
    calendar.getUTCMilliseconds() !== millisecond
  ) return null;

  const epochMs = Date.parse(text);
  if (!Number.isFinite(epochMs)) return null;
  return { value: new Date(epochMs).toISOString(), epochMs };
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

/**
 * #975 non-disclosing absence for ID-based admin routes.
 *
 * A resource-specific 404 is served only to a caller that already cleared the
 * minimum operational-principal boundary. A caller that could not have been
 * authorized for any complex receives the same canonical 403 policy class here
 * as it would for an existing id, so an unknown (or malformed) id is never a
 * resource existence oracle. The exact complex-scoped authority stays the
 * authoritative gate for existing resources and is never replaced by this probe.
 */
async function absentResourceResponse(
  sql: Sql,
  actor: Actor,
  requestId: string,
  requestedScope: string,
  message: string
): Promise<Response> {
  const denial = await operationalPrincipalDenial(sql, actor, requestId, requestedScope);
  if (denial) return denial;
  return fail('NOT_FOUND', message, 404, requestId);
}

async function applicationContext(sql: Sql, applicationId: string) {
  const rows = await sql`
    select a.id, a.status, a.approved_business_id, a.applicant_user_id,
           a.representative_image_object_key, a.category_name, c.slug as complex_slug,
           a.relation_type, a.relation_raw, a.resolved_relation_type
    from business_applications a
    join complexes c on c.id = a.complex_id
    where a.id = ${applicationId}::uuid
    limit 1
  `;
  return rows[0];
}

// Fail-closed category resolution: approvals require an exact canonical
// business_categories.name match that is active. No heuristic matching and no category auto-creation. null means the category resolved.
async function resolveApprovalCategory(sql: Sql, categoryName: string) {
  const rows = await sql`
    select bc.id, bc.is_active
    from business_categories bc
    where bc.name = ${categoryName}
    limit 1
  `;
  const row = rows[0];
  if (!row) {
    return { code: 'CATEGORY_NOT_RESOLVED', message: 'Category does not match an active canonical category' };
  }
  if (!row.is_active) {
    return { code: 'CATEGORY_NOT_ACTIVE', message: 'Category is not active' };
  }
  return null;
}

async function approveApplication(sql: Sql, actorId: string, applicationId: string, reviewNote: string | null) {
  // One data-modifying CTE statement is atomic in PostgreSQL. The UPDATE is the gate:
  // only pending/changes_requested rows with a resolvable active category produce
  // downstream inserts, so category resolution failure can never finalize an approval.
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
        and a.relation_type is not null
        and a.resolved_relation_type is not null
        and exists (
          select 1 from business_categories bc
          where bc.name = a.category_name
            and bc.is_active = true
        )
      returning a.*
    ),
    created_business as (
      insert into businesses (
        id, owner_user_id, category_id, kind, name, summary, description,
        price_text, service_area, availability_text, status
      )
      select a.approved_business_id,
             a.applicant_user_id,
             (select bc.id from business_categories bc where bc.name = a.category_name and bc.is_active = true limit 1),
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
  // #975 Stage 1: the minimum actor boundary runs before the resource lookup, so
  // a signed-out caller receives one and the same 401 for an existing and an
  // unknown id and no business_applications row is ever read for it.
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  // #975 Stage 2 guard: a malformed id is answered exactly like an absent
  // application behind that same boundary and never reaches a ::uuid cast.
  if (!UUID.test(applicationId)) {
    return absentResourceResponse(sql, actor, requestId, POLICY.businessReview.padiem, 'Business application not found');
  }

  const current = await applicationContext(sql, applicationId);
  if (!current) {
    return absentResourceResponse(sql, actor, requestId, POLICY.businessReview.padiem, 'Business application not found');
  }

  // #975 Stage 3: the exact complex-scoped authority for the application's own
  // complex remains the authoritative gate; Stage 1 never replaces it.
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

    const categoryError = await resolveApprovalCategory(sql, String(current.category_name ?? ''));
    if (categoryError) {
      return fail(categoryError.code, categoryError.message, 409, requestId);
    }

    // #341: approval fails closed while the owner relation is unresolved
    // (co/etc intake). No co -> neighbor and no etc -> * inference here.
    if (!current.relation_type || !current.resolved_relation_type) {
      return fail(
        'RELATION_NOT_RESOLVED',
        'Owner relation is unresolved; approval fails closed until a reviewer resolution path exists',
        409,
        requestId
      );
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
  const displayMode = String(payload.displayMode ?? 'highlight').trim();
  if (displayMode !== 'highlight' && displayMode !== 'article') {
    return fail('INVALID_DISPLAY_MODE', 'Invalid display mode', 400, requestId);
  }
  const channel = deriveChannel(sourceName, payload.channel);
  if (!channel) return fail('INVALID_CHANNEL', 'Invalid channel', 400, requestId);
  // #844 BLOCKER 3: a photo attachment is only valid on the two official apartment-news channels.
  if (attachment && channel !== 'apartment_news' && channel !== 'management_office') {
    return fail(
      'OFFICIAL_NEWS_IMAGE_CHANNEL_INVALID',
      'Photo attachments are only supported on apartment_news or management_office',
      400,
      requestId
    );
  }
  // #844: a client-supplied object key is never trusted. It must be a server-issued, active,
  // same-complex official-news image before it may be persisted on the post.
  if (attachment) {
    const invalidAttachment = await validateOfficialNewsImageReference(
      env, sql, attachment, operator.complexId, complexSlug, requestId
    );
    if (invalidAttachment) return invalidAttachment;
    // BLOCKER A: the post write re-locks the official-news registry row FOR UPDATE in the same
    // statement, so a delete intent that won the race yields zero rows instead of a stale write.
    const committed = await insertOfficialNewsPostWithAttachment(sql, {
      objectKey: attachment,
      complexId: operator.complexId,
      complexSlug,
      authorUserId: operator.id,
      sourceName,
      category,
      title,
      body,
      channel,
      displayMode,
      status,
      publishedAt,
      audit: {
        requestId,
        scope: operator.requestedScope,
        fromStatus: null
      }
    });
    if (!committed[0]) {
      return fail(
        'OFFICIAL_NEWS_IMAGE_ATTACHMENT_CONFLICT',
        'Official news image is no longer active for attachment',
        409,
        requestId
      );
    }
    return ok(committed[0], requestId, 201);
  }
  // #1049: the mutation audit row is written by the same statement that inserts
  // the post (audit follows the mutated rows), so a successful create always
  // carries exactly one bounded mutation audit and a failed audit insert aborts
  // the post write with it.
  const rows = await sql`
    with mutated as (
      insert into complex_posts (
        complex_id, author_user_id, source_name, category, title, body,
        attachment_object_key, status, published_at, channel, display_mode
      ) values (
        ${operator.complexId}::uuid,
        ${operator.id}::uuid,
        ${sourceName}, ${category}, ${title}, ${body}, ${attachment}, ${status},
        case when ${status} = 'published' then coalesce(${publishedAt}::timestamptz, now()) else null end,
        ${channel}, ${displayMode}
      )
      returning id, source_name, category, title, body, status, published_at, created_at, channel, display_mode
    ),
    audited as (
      insert into audit_events (
        request_id, actor_user_id, actor_kind, complex_id, action, scope,
        resource_type, resource_id, decision, reason_code, metadata
      )
      select
        ${requestId},
        ${operator.id}::uuid,
        'operator',
        ${operator.complexId}::uuid,
        'admin.official-content.create',
        ${operator.requestedScope},
        'complex_post',
        mutated.id::text,
        'allowed',
        'ADMIN_OFFICIAL_CONTENT_CREATED',
        ${JSON.stringify({ fromStatus: null, toStatus: status })}::jsonb
      from mutated
      returning id
    )
    select mutated.*
    from mutated
    cross join lateral (select count(*) from audited) audit_barrier
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
  // #975 Stage 1: the minimum actor boundary runs before the resource lookup, so
  // a signed-out caller receives one and the same 401 for an existing and an
  // unknown post and no complex_posts row is ever read for it.
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  // #975 Stage 2 guard: a malformed id is answered exactly like an absent post
  // behind that same boundary and never reaches a ::uuid cast.
  if (!UUID.test(postId)) {
    return absentResourceResponse(sql, actor, requestId, POLICY.officialContent.padiem, 'Post not found');
  }

  const rows = await sql`
    select p.*, c.slug as complex_slug
    from complex_posts p
    join complexes c on c.id = p.complex_id
    where p.id = ${postId}::uuid
    limit 1
  `;
  const current = rows[0];
  if (!current) {
    return absentResourceResponse(sql, actor, requestId, POLICY.officialContent.padiem, 'Post not found');
  }

  // #975 Stage 3: the exact complex-scoped authority for the post's own complex
  // remains the authoritative gate; Stage 1 never replaces it.
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
    : payload.attachmentObjectKey == null
      ? null
      : (String(payload.attachmentObjectKey).trim() || null);
  const displayMode = payload.displayMode === undefined
    ? String(current.display_mode || 'highlight')
    : String(payload.displayMode).trim();
  if (!sourceName || !category || !title || !body || !['draft','published','archived'].includes(status)) {
    return fail('VALIDATION_ERROR', 'Invalid post update', 400, requestId);
  }
  if (displayMode !== 'highlight' && displayMode !== 'article') {
    return fail('INVALID_DISPLAY_MODE', 'Invalid display mode', 400, requestId);
  }
  const channel = deriveChannel(sourceName, payload.channel);
  if (!channel) return fail('INVALID_CHANNEL', 'Invalid channel', 400, requestId);
  // #844 BLOCKER 3: a photo attachment is only valid on the two official apartment-news channels.
  if (attachment && channel !== 'apartment_news' && channel !== 'management_office') {
    return fail(
      'OFFICIAL_NEWS_IMAGE_CHANNEL_INVALID',
      'Photo attachments are only supported on apartment_news or management_office',
      400,
      requestId
    );
  }
  // #844: existing attachment is preserved; any newly supplied key is validated as a
  // server-issued, active, same-complex official-news image (no arbitrary key trust).
  const currentAttachmentKey = current.attachment_object_key ? String(current.attachment_object_key) : null;
  if (attachment && attachment !== currentAttachmentKey) {
    const invalidAttachment = await validateOfficialNewsImageReference(
      env, sql, attachment, operator.complexId, String(current.complex_slug), requestId
    );
    if (invalidAttachment) return invalidAttachment;
    // BLOCKER A: swapping in a new reference re-locks the official-news registry row FOR UPDATE
    // in the same statement, so a concurrent delete intent yields zero rows instead of a stale write.
    const committed = await updateOfficialNewsPostWithAttachment(sql, postId, {
      objectKey: attachment,
      complexId: operator.complexId,
      complexSlug: String(current.complex_slug),
      authorUserId: operator.id,
      sourceName,
      category,
      title,
      body,
      channel,
      displayMode,
      status,
      publishedAt: null,
      audit: {
        requestId,
        scope: operator.requestedScope,
        fromStatus: String(current.status)
      }
    });
    if (!committed[0]) {
      return fail(
        'OFFICIAL_NEWS_IMAGE_ATTACHMENT_CONFLICT',
        'Official news image is no longer active for attachment',
        409,
        requestId
      );
    }
    return ok(committed[0], requestId);
  }
  // #1049: mutation audit rides the same statement as the update (see createPost).
  const updated = await sql`
    with mutated as (
      update complex_posts
      set source_name = ${sourceName}, category = ${category}, title = ${title}, body = ${body},
          attachment_object_key = ${attachment}, status = ${status},
          channel = ${channel}, display_mode = ${displayMode},
          published_at = case when ${status} = 'published' then coalesce(published_at, now()) else published_at end
      where id = ${postId}::uuid
      returning id, source_name, category, title, body, status, published_at, updated_at, channel, display_mode
    ),
    audited as (
      insert into audit_events (
        request_id, actor_user_id, actor_kind, complex_id, action, scope,
        resource_type, resource_id, decision, reason_code, metadata
      )
      select
        ${requestId},
        ${operator.id}::uuid,
        'operator',
        ${operator.complexId}::uuid,
        'admin.official-content.update',
        ${operator.requestedScope},
        'complex_post',
        mutated.id::text,
        'allowed',
        'ADMIN_OFFICIAL_CONTENT_UPDATED',
        ${JSON.stringify({ fromStatus: String(current.status), toStatus: status })}::jsonb
      from mutated
      returning id
    )
    select mutated.*
    from mutated
    cross join lateral (select count(*) from audited) audit_barrier
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
  // #1049: benefit write and its mutation audit share one statement.
  const rows = await sql`
    with mutated as (
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
    ),
    audited as (
      insert into audit_events (
        request_id, actor_user_id, actor_kind, complex_id, action, scope,
        resource_type, resource_id, decision, reason_code, metadata
      )
      select
        ${requestId},
        ${operator.id}::uuid,
        'operator',
        ${operator.complexId}::uuid,
        'admin.benefit.create',
        ${operator.requestedScope},
        'benefit',
        mutated.id::text,
        'allowed',
        'ADMIN_BENEFIT_CREATED',
        ${JSON.stringify({ fromStatus: null, toStatus: status })}::jsonb
      from mutated
      returning id
    )
    select mutated.*
    from mutated
    cross join lateral (select count(*) from audited) audit_barrier
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
  // #975 Stage 1: the minimum actor boundary runs before the resource lookup, so
  // a signed-out caller receives one and the same 401 for an existing and an
  // unknown benefit and no benefits row is ever read for it. The #970
  // null/timestamp/range semantics below are untouched.
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  // #975 Stage 2 guard: a malformed id is answered exactly like an absent
  // benefit behind that same boundary and never reaches a ::uuid cast.
  if (!UUID.test(benefitId)) {
    return absentResourceResponse(sql, actor, requestId, POLICY.benefitManage.padiem, 'Benefit not found');
  }

  const rows = await sql`
    select be.*, c.slug as complex_slug
    from benefits be
    join complexes c on c.id = be.complex_id
    where be.id = ${benefitId}::uuid
    limit 1
  `;
  const current = rows[0];
  if (!current) {
    return absentResourceResponse(sql, actor, requestId, POLICY.benefitManage.padiem, 'Benefit not found');
  }

  // #975 Stage 3: the exact complex-scoped authority for the benefit's own
  // complex remains the authoritative gate; Stage 1 never replaces it.
  const operator = await authority(request, env, sql, requestId, String(current.complex_slug), POLICY.benefitManage);
  if (operator instanceof Response) return operator;

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const title = payload.title === undefined ? String(current.title) : String(payload.title).trim();
  const description = payload.description === undefined ? String(current.description ?? '') : String(payload.description);
  const conditions = payload.conditions === undefined
    ? (current.conditions ? String(current.conditions) : null)
    : (payload.conditions === null ? null : String(payload.conditions).trim() || null);
  const status = payload.status === undefined ? String(current.status) : String(payload.status).trim();
  if (!title || !['draft','active','expired','suspended'].includes(status)) {
    return fail('VALIDATION_ERROR', 'Invalid benefit update', 400, requestId);
  }

  const effectiveStartsAt = payload.startsAt === undefined
    ? normalizeBenefitTimestamp(current.starts_at)
    : normalizeBenefitTimestamp(payload.startsAt);
  if (!effectiveStartsAt) {
    return fail('VALIDATION_ERROR', 'startsAt must be a valid ISO timestamp', 400, requestId);
  }
  const effectiveEndsAt = payload.endsAt === undefined
    ? normalizeBenefitTimestamp(current.ends_at)
    : normalizeBenefitTimestamp(payload.endsAt);
  if (!effectiveEndsAt) {
    return fail('VALIDATION_ERROR', 'endsAt must be a valid ISO timestamp', 400, requestId);
  }
  if (
    effectiveStartsAt.epochMs !== null &&
    effectiveEndsAt.epochMs !== null &&
    effectiveStartsAt.epochMs > effectiveEndsAt.epochMs
  ) {
    return fail('VALIDATION_ERROR', 'startsAt must be before or equal to endsAt', 400, requestId);
  }

  const startsAt = effectiveStartsAt.value;
  const endsAt = effectiveEndsAt.value;
  // #1049: benefit update and its mutation audit share one statement.
  const updated = await sql`
    with mutated as (
      update benefits
      set title = ${title}, description = ${description}, conditions = ${conditions},
          starts_at = ${startsAt}::timestamptz, ends_at = ${endsAt}::timestamptz, status = ${status}
      where id = ${benefitId}::uuid
      returning id, business_id, title, description, conditions, starts_at, ends_at, status, updated_at
    ),
    audited as (
      insert into audit_events (
        request_id, actor_user_id, actor_kind, complex_id, action, scope,
        resource_type, resource_id, decision, reason_code, metadata
      )
      select
        ${requestId},
        ${operator.id}::uuid,
        'operator',
        ${operator.complexId}::uuid,
        'admin.benefit.update',
        ${operator.requestedScope},
        'benefit',
        mutated.id::text,
        'allowed',
        'ADMIN_BENEFIT_UPDATED',
        ${JSON.stringify({ fromStatus: String(current.status), toStatus: status })}::jsonb
      from mutated
      returning id
    )
    select mutated.*
    from mutated
    cross join lateral (select count(*) from audited) audit_barrier
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
    const complexSlug = decodeComplexSlug(match[1]);
    if (!complexSlug) return fail('INVALID_COMPLEX_SLUG', 'Invalid complex slug', 400, requestId);
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
  if (match && request.method === 'GET') {
    const complexSlug = decodeComplexSlug(match[1]);
    if (!complexSlug) return fail('INVALID_COMPLEX_SLUG', 'Invalid complex slug', 400, requestId);
    const operator = await authority(request, env, sql, requestId, complexSlug, POLICY.officialContent);
    if (operator instanceof Response) return operator;

    const status = url.searchParams.get('status')?.trim() || 'all';
    if (!['all','draft','published','archived'].includes(status)) {
      return fail('VALIDATION_ERROR', 'Invalid post status filter', 400, requestId);
    }
    const rows = await sql`
      select p.id, p.source_name, p.category, p.channel, p.display_mode, p.title, p.body,
             p.attachment_object_key, p.status, p.published_at, p.created_at, p.updated_at
      from complex_posts p
      where p.complex_id = ${operator.complexId}::uuid
        and (${status} = 'all' or p.status = ${status})
      order by
        case p.status when 'draft' then 0 when 'published' then 1 when 'archived' then 2 else 3 end,
        coalesce(p.published_at, p.created_at) desc,
        p.created_at desc
      limit 200
    `;
    return ok(rows, requestId);
  }

  if (match && request.method === 'POST') {
    const complexSlug = decodeComplexSlug(match[1]);
    if (!complexSlug) return fail('INVALID_COMPLEX_SLUG', 'Invalid complex slug', 400, requestId);
    return createPost(request, env, sql, complexSlug, requestId);
  }

  match = path.match(/^\/api\/v1\/admin\/posts\/([0-9a-fA-F-]+)$/);
  if (match && request.method === 'PATCH') {
    return patchPost(request, env, sql, match[1], requestId);
  }

  match = path.match(/^\/api\/v1\/admin\/complexes\/([^/]+)\/benefits$/);
  if (match && request.method === 'GET') {
    const complexSlug = decodeComplexSlug(match[1]);
    if (!complexSlug) return fail('INVALID_COMPLEX_SLUG', 'Invalid complex slug', 400, requestId);
    const operator = await authority(request, env, sql, requestId, complexSlug, POLICY.benefitManage);
    if (operator instanceof Response) return operator;

    const status = url.searchParams.get('status')?.trim() || 'all';
    if (!['all','draft','active','expired','suspended'].includes(status)) {
      return fail('VALIDATION_ERROR', 'Invalid benefit status filter', 400, requestId);
    }
    const rows = await sql`
      select be.id, be.business_id, b.name as business_name,
             be.title, be.description, be.conditions, be.starts_at, be.ends_at,
             be.status, be.created_at, be.updated_at
      from benefits be
      join businesses b on b.id = be.business_id
      where be.complex_id = ${operator.complexId}::uuid
        and (${status} = 'all' or be.status = ${status})
      order by
        case be.status when 'draft' then 0 when 'active' then 1 when 'suspended' then 2 when 'expired' then 3 else 4 end,
        be.created_at desc
      limit 200
    `;
    return ok(rows, requestId);
  }

  if (match && request.method === 'POST') {
    const complexSlug = decodeComplexSlug(match[1]);
    if (!complexSlug) return fail('INVALID_COMPLEX_SLUG', 'Invalid complex slug', 400, requestId);
    return createBenefit(request, env, sql, complexSlug, requestId);
  }

  match = path.match(/^\/api\/v1\/admin\/benefits\/([0-9a-fA-F-]+)$/);
  if (match && request.method === 'PATCH') {
    return patchBenefit(request, env, sql, match[1], requestId);
  }

  return null;
}
