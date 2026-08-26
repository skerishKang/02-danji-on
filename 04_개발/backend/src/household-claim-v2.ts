import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type Actor, type AuthEnv } from './auth-v1';

type Sql = NeonQueryFunction<false, false>;
export type HouseholdClaimEnv = AuthEnv;

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const MAX_BODY_BYTES = 4 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

function json(data: unknown, status: number, requestId: string): Response {
  return Response.json(data, {
    status,
    headers: {
      [REQUEST_ID_HEADER]: requestId,
      'access-control-expose-headers': REQUEST_ID_HEADER,
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

function sqlFor(env: HouseholdClaimEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

function decodeSlug(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw).trim();
    return decoded.length >= 1 && decoded.length <= 120 && /^[a-z0-9][a-z0-9-]*$/.test(decoded)
      ? decoded
      : null;
  } catch {
    return null;
  }
}

async function bodyJson(request: Request, requestId: string): Promise<{ unitId: string; token: string } | Response> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return fail('CONTENT_TYPE_REQUIRED', 'application/json required', 415, requestId);
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('INVALID_JSON', 'JSON object required', 400, requestId);
  }

  const payload = parsed as Record<string, unknown>;
  const allowed = new Set(['unitId', 'token']);
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    return fail('VALIDATION_ERROR', 'Only unitId and token are accepted', 400, requestId);
  }

  const unitId = typeof payload.unitId === 'string' ? payload.unitId.trim() : '';
  const token = typeof payload.token === 'string' ? payload.token.trim() : '';
  if (!UUID.test(unitId)) return fail('VALIDATION_ERROR', 'Invalid unitId', 400, requestId);
  if (!OPAQUE_TOKEN.test(token)) return fail('VALIDATION_ERROR', 'Invalid invite token format', 400, requestId);

  return { unitId, token };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function recordClaimDecision(
  sql: Sql,
  actor: Actor,
  requestId: string,
  complexId: string,
  unitId: string,
  decision: 'allowed' | 'denied' | 'recorded',
  reasonCode: string
): Promise<void> {
  const metadata = JSON.stringify({ unitId });
  await sql`
    insert into audit_events (
      request_id,
      actor_user_id,
      actor_kind,
      complex_id,
      action,
      scope,
      resource_type,
      resource_id,
      decision,
      reason_code,
      metadata
    ) values (
      ${requestId},
      ${actor.id}::uuid,
      'user',
      ${complexId}::uuid,
      'household.primary_claim.redeem',
      'resident.verify',
      'complex_unit',
      ${unitId},
      ${decision},
      ${reasonCode},
      ${metadata}::jsonb
    )
  `;
}

export async function handleHouseholdPrimaryClaimWithSql(
  request: Request,
  env: HouseholdClaimEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/v1\/complexes\/([^/]+)\/household\/claim$/);
  if (!match) return null;
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);

  const complexSlug = decodeSlug(match[1]);
  if (!complexSlug) return fail('INVALID_COMPLEX_SLUG', 'Invalid complex slug', 400, requestId);

  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;

  const complexes = await sql`
    select id, slug, name
    from complexes
    where slug = ${complexSlug}
      and status in ('active', 'pilot')
    limit 1
  `;
  const complex = complexes[0];
  if (!complex) return fail('NOT_FOUND', 'Complex not found', 404, requestId);
  const complexId = String(complex.id);

  const existing = await sql`
    select hm.membership_role, hm.status, h.complex_unit_id
    from household_memberships hm
    join households h
      on h.id = hm.household_id
     and h.complex_id = hm.complex_id
    where hm.user_id = ${actor.id}::uuid
      and hm.complex_id = ${complexId}::uuid
      and hm.status in ('pending', 'verified')
    limit 1
  `;
  const current = existing[0];
  if (current) {
    const currentUnitId = String(current.complex_unit_id);
    const currentStatus = String(current.status);
    const currentRole = String(current.membership_role);
    if (currentStatus === 'verified' && currentUnitId === payload.unitId) {
      await recordClaimDecision(sql, actor, requestId, complexId, payload.unitId, 'allowed', 'HOUSEHOLD_ALREADY_VERIFIED');
      return ok({
        status: 'verified',
        membershipRole: currentRole,
        unitId: payload.unitId,
        alreadyVerified: true
      }, requestId);
    }

    await recordClaimDecision(sql, actor, requestId, complexId, payload.unitId, 'denied', 'HOUSEHOLD_MEMBERSHIP_EXISTS');
    return fail('HOUSEHOLD_MEMBERSHIP_EXISTS', 'An active household membership already exists for this complex', 409, requestId);
  }

  // The plaintext invite token exists only in request memory. DB lookup receives
  // the SHA-256 digest, and audit metadata never contains the token or its hash.
  const tokenHash = await sha256Hex(payload.token);
  const successAuditMetadata = JSON.stringify({ unitId: payload.unitId });

  const claimed = await sql`
    with target as (
      select
        t.id as token_id,
        t.household_id,
        t.complex_id,
        h.complex_unit_id
      from household_invite_tokens t
      join households h
        on h.id = t.household_id
       and h.complex_id = t.complex_id
      join complex_units cu
        on cu.id = h.complex_unit_id
       and cu.complex_id = h.complex_id
      where t.token_hash = ${tokenHash}
        and t.purpose = 'primary_claim'
        and t.status = 'active'
        and t.expires_at > now()
        and t.use_count < t.max_uses
        and t.complex_id = ${complexId}::uuid
        and h.status = 'active'
        and cu.status = 'active'
        and h.complex_unit_id = ${payload.unitId}::uuid
        and not exists (
          select 1
          from household_memberships primary_member
          where primary_member.household_id = t.household_id
            and primary_member.membership_role = 'primary'
            and primary_member.status in ('pending', 'verified')
        )
      limit 1
      for update of t
    ), inserted as (
      insert into household_memberships (
        complex_id,
        household_id,
        user_id,
        membership_role,
        status,
        verified_at
      )
      select
        target.complex_id,
        target.household_id,
        ${actor.id}::uuid,
        'primary',
        'verified',
        now()
      from target
      where not exists (
        select 1
        from household_memberships actor_membership
        where actor_membership.user_id = ${actor.id}::uuid
          and actor_membership.complex_id = target.complex_id
          and actor_membership.status in ('pending', 'verified')
      )
      on conflict do nothing
      returning id, complex_id, household_id, membership_role, status, verified_at
    ), consumed as (
      update household_invite_tokens token
      set
        use_count = token.use_count + 1,
        status = 'redeemed',
        redeemed_at = coalesce(token.redeemed_at, now())
      from target, inserted
      where token.id = target.token_id
      returning token.id
    ), audited as (
      insert into audit_events (
        request_id,
        actor_user_id,
        actor_kind,
        complex_id,
        action,
        scope,
        resource_type,
        resource_id,
        decision,
        reason_code,
        metadata
      )
      select
        ${requestId},
        ${actor.id}::uuid,
        'user',
        inserted.complex_id,
        'household.primary_claim.redeem',
        'resident.verify',
        'household_membership',
        inserted.id::text,
        'recorded',
        'PRIMARY_CLAIM_REDEEMED',
        ${successAuditMetadata}::jsonb
      from inserted
      where exists (select 1 from consumed)
      returning id
    )
    select
      inserted.membership_role,
      inserted.status,
      target.complex_unit_id
    from inserted
    join target on target.household_id = inserted.household_id
    where exists (select 1 from consumed)
      and exists (select 1 from audited)
  `;

  const row = claimed[0];
  if (!row) {
    await recordClaimDecision(sql, actor, requestId, complexId, payload.unitId, 'denied', 'HOUSEHOLD_CLAIM_UNAVAILABLE');
    return fail(
      'HOUSEHOLD_CLAIM_UNAVAILABLE',
      'The household claim could not be completed with the supplied selection and invite',
      409,
      requestId
    );
  }

  return ok({
    status: String(row.status),
    membershipRole: String(row.membership_role),
    unitId: String(row.complex_unit_id),
    alreadyVerified: false
  }, requestId, 201);
}

export async function handleHouseholdPrimaryClaimRequest(
  request: Request,
  env: HouseholdClaimEnv,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!/^\/api\/v1\/complexes\/[^/]+\/household\/claim$/.test(url.pathname)) return null;
  return handleHouseholdPrimaryClaimWithSql(request, env, sqlFor(env), requestId);
}
