import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type Actor } from './auth-v1';
import type { CoreEnv } from './core-v1';
import { recordAuthorityDecision, resolvePadiemAuthority } from './padiem-authority-v1';

type Sql = NeonQueryFunction<false, false>;

const SCOPE = 'resident.verification.manage';
const MAX_BODY_BYTES = 4 * 1024;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function ok(data: unknown, requestId: string): Response {
  return json({ data, requestId }, 200, requestId);
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}

function sqlFor(env: CoreEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

async function requirePadiemHouseholdReviewAuthority(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Actor | Response> {
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  try {
    const authority = await resolvePadiemAuthority(sql, actor.id);
    const grantedScope = authority.wildcard ? '*' : authority.scopes.includes(SCOPE) ? SCOPE : null;
    if (!grantedScope) {
      await recordAuthorityDecision(sql, actor, requestId, SCOPE, 'denied', 'HOUSEHOLD_REVIEW_SCOPE_MISSING', null);
      return fail('HOUSEHOLD_REVIEW_FORBIDDEN', 'PADIEM household review authority required', 403, requestId);
    }

    await recordAuthorityDecision(
      sql,
      actor,
      requestId,
      SCOPE,
      'allowed',
      authority.wildcard ? 'HOUSEHOLD_REVIEW_WILDCARD_GRANTED' : 'HOUSEHOLD_REVIEW_SCOPE_GRANTED',
      grantedScope
    );
    return actor;
  } catch {
    await recordAuthorityDecision(sql, actor, requestId, SCOPE, 'denied', 'HOUSEHOLD_REVIEW_AUTHORITY_DB_ERROR', null).catch(() => {});
    return fail('HOUSEHOLD_REVIEW_AUTHORITY_UNAVAILABLE', 'Household review authority could not be verified', 503, requestId);
  }
}

async function decisionBody(
  request: Request,
  requestId: string
): Promise<{ decision: 'approve' | 'reject' } | Response> {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return fail('CONTENT_TYPE_REQUIRED', 'application/json required', 415, requestId);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('INVALID_JSON', 'JSON object required', 400, requestId);
  }

  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'decision')) {
    return fail('VALIDATION_ERROR', 'Only decision is accepted', 400, requestId);
  }

  const decision = typeof record.decision === 'string' ? record.decision.trim() : '';
  if (decision !== 'approve' && decision !== 'reject') {
    return fail('VALIDATION_ERROR', 'decision must be approve or reject', 400, requestId);
  }

  return { decision };
}

async function listPending(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string
): Promise<Response> {
  const actorOrResponse = await requirePadiemHouseholdReviewAuthority(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;

  const url = new URL(request.url);
  const requestedStatus = (url.searchParams.get('status') || 'pending').trim();
  if (requestedStatus !== 'pending') {
    return fail('HOUSEHOLD_REVIEW_STATUS_INVALID', 'Only pending household memberships may be listed', 400, requestId);
  }

  try {
    const rows = await sql`
      with ranked as (
        select
          hm.id as membership_id,
          hm.user_id,
          hm.membership_role,
          hm.status,
          hm.created_at,
          hm.household_id,
          hm.complex_id,
          row_number() over (
            partition by hm.household_id
            order by hm.created_at asc, hm.id asc
          )::int as member_position
        from household_memberships hm
        where hm.status in ('pending','verified')
      )
      select
        ranked.membership_id,
        ranked.user_id,
        ranked.membership_role,
        ranked.created_at,
        ranked.member_position,
        u.display_name,
        cu.building_code,
        cu.unit_code
      from ranked
      join app_users u on u.id = ranked.user_id
      join households h on h.id = ranked.household_id and h.complex_id = ranked.complex_id
      join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
      join complexes c on c.id = ranked.complex_id
      where ranked.status = 'pending'
        and ranked.member_position >= 3
        and h.status = 'active'
        and cu.status = 'active'
        and c.status <> 'inactive'
        and c.slug = ${complexSlug}
      order by ranked.created_at asc, ranked.membership_id asc
      limit 100
    `;

    return ok({
      memberships: rows.map((row) => ({
        membershipId: String(row.membership_id),
        accountReference: String(row.user_id).slice(0, 8),
        nickname: String(row.display_name || ''),
        membershipRole: String(row.membership_role),
        buildingCode: String(row.building_code),
        unitCode: String(row.unit_code),
        memberPosition: Number(row.member_position),
        requestedAt: row.created_at
      }))
    }, requestId);
  } catch {
    return fail('HOUSEHOLD_REVIEW_LIST_UNAVAILABLE', 'Pending household memberships could not be loaded', 503, requestId);
  }
}

async function reviewPending(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  membershipId: string
): Promise<Response> {
  const actorOrResponse = await requirePadiemHouseholdReviewAuthority(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;

  const payload = await decisionBody(request, requestId);
  if (payload instanceof Response) return payload;

  const nextStatus = payload.decision === 'approve' ? 'verified' : 'revoked';
  const reasonCode = payload.decision === 'approve'
    ? 'HOUSEHOLD_MEMBERSHIP_APPROVED'
    : 'HOUSEHOLD_MEMBERSHIP_REJECTED';

  try {
    const rows = await sql`
      with ranked as materialized (
        select
          hm.id,
          hm.household_id,
          hm.complex_id,
          row_number() over (
            partition by hm.household_id
            order by hm.created_at asc, hm.id asc
          )::int as member_position
        from household_memberships hm
        where hm.status in ('pending','verified')
      ), guarded as materialized (
        select
          hm.id,
          hm.complex_id,
          hm.household_id,
          hm.user_id,
          ranked.member_position
        from household_memberships hm
        join ranked on ranked.id = hm.id
        join complexes c on c.id = hm.complex_id
        where hm.id = ${membershipId}::uuid
          and hm.status = 'pending'
          and ranked.member_position >= 3
          and c.status <> 'inactive'
        limit 1
        for update of hm
      ), changed as (
        update household_memberships hm
        set
          status = ${nextStatus},
          verified_at = case when ${nextStatus} = 'verified' then now() else null end,
          revoked_at = case when ${nextStatus} = 'revoked' then now() else null end
        from guarded
        where hm.id = guarded.id
          and hm.status = 'pending'
        returning hm.id, hm.complex_id, hm.household_id, hm.user_id, hm.status
      ), audited as (
        insert into audit_events (
          request_id, actor_user_id, actor_kind, complex_id, action, scope,
          resource_type, resource_id, decision, reason_code, metadata
        )
        select
          ${requestId},
          ${actor.id}::uuid,
          'operator',
          changed.complex_id,
          'household.membership.review',
          ${SCOPE},
          'household_membership',
          changed.id::text,
          'recorded',
          ${reasonCode},
          jsonb_build_object(
            'reviewDecision', ${payload.decision},
            'resultStatus', changed.status,
            'memberPosition', guarded.member_position
          )
        from changed
        join guarded on guarded.id = changed.id
        returning id
      )
      select
        changed.id as membership_id,
        changed.status,
        guarded.member_position
      from changed
      join guarded on guarded.id = changed.id
      where exists (select 1 from audited)
    `;

    if (!rows[0]) {
      return fail('HOUSEHOLD_REVIEW_CONFLICT', 'Pending household membership is no longer reviewable', 409, requestId);
    }

    return ok({
      membershipId: String(rows[0].membership_id),
      status: String(rows[0].status),
      decision: payload.decision,
      memberPosition: Number(rows[0].member_position)
    }, requestId);
  } catch {
    return fail('HOUSEHOLD_REVIEW_MUTATION_UNAVAILABLE', 'Household membership review could not be completed', 503, requestId);
  }
}

export async function handleAdminHouseholdReviewWithSql(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);

  const listMatch = url.pathname.match(
    /^\/api\/v1\/admin\/complexes\/([^/]+)\/household-memberships$/
  );
  if (listMatch) {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    const complexSlug = decodeURIComponent(listMatch[1]).trim();
    if (!SLUG.test(complexSlug)) return fail('COMPLEX_INVALID', 'Invalid apartment complex', 400, requestId);
    return listPending(request, env, sql, requestId, complexSlug);
  }

  const reviewMatch = url.pathname.match(
    /^\/api\/v1\/admin\/household-memberships\/([0-9a-fA-F-]+)$/
  );
  if (reviewMatch) {
    if (request.method !== 'PATCH') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    if (!UUID.test(reviewMatch[1])) return fail('VALIDATION_ERROR', 'Invalid membership id', 400, requestId);
    return reviewPending(request, env, sql, requestId, reviewMatch[1]);
  }

  return null;
}

export async function handleAdminHouseholdReviewRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.includes('/api/v1/admin/') || !path.includes('household-memberships')) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
  return handleAdminHouseholdReviewWithSql(request, env, sqlFor(env), requestId);
}
