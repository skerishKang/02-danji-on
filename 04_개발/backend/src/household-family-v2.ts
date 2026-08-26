import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type Actor, type AuthEnv } from './auth-v1';

type Sql = NeonQueryFunction<false, false>;
export type HouseholdFamilyEnv = AuthEnv;

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const MAX_BODY_BYTES = 4 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

function json(data: unknown, status: number, requestId: string): Response {
  return Response.json(data, { status, headers: {
    [REQUEST_ID_HEADER]: requestId,
    'access-control-expose-headers': REQUEST_ID_HEADER,
    'cache-control': 'no-store'
  }});
}
function ok(data: unknown, requestId: string, status = 200): Response { return json({ data, requestId }, status, requestId); }
function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}
function sqlFor(env: HouseholdFamilyEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}
function decodeSlug(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw).trim();
    return decoded.length >= 1 && decoded.length <= 120 && /^[a-z0-9][a-z0-9-]*$/.test(decoded) ? decoded : null;
  } catch { return null; }
}
async function objectBody(request: Request, requestId: string): Promise<Record<string, unknown> | Response> {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return fail('CONTENT_TYPE_REQUIRED', 'application/json required', 415, requestId);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('INVALID_JSON', 'JSON object required', 400, requestId);
    return parsed as Record<string, unknown>;
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function newOpaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function audit(
  sql: Sql,
  actor: Actor,
  requestId: string,
  complexId: string,
  action: string,
  resourceType: string,
  resourceId: string | null,
  reasonCode: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await sql`
    insert into audit_events (
      request_id, actor_user_id, actor_kind, complex_id, action, scope,
      resource_type, resource_id, decision, reason_code, metadata
    ) values (
      ${requestId}, ${actor.id}::uuid, 'user', ${complexId}::uuid, ${action}, 'household.family',
      ${resourceType}, ${resourceId}, 'recorded', ${reasonCode}, ${JSON.stringify(metadata)}::jsonb
    )
  `;
}

async function primaryContext(sql: Sql, actorId: string, complexSlug: string) {
  const rows = await sql`
    select hm.id as membership_id, hm.household_id, hm.complex_id, c.slug as complex_slug,
           h.complex_unit_id, cu.building_code, cu.unit_code
    from household_memberships hm
    join households h on h.id = hm.household_id and h.complex_id = hm.complex_id
    join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
    join complexes c on c.id = hm.complex_id
    where hm.user_id = ${actorId}::uuid
      and hm.membership_role = 'primary'
      and hm.status = 'verified'
      and h.status = 'active'
      and cu.status = 'active'
      and c.status <> 'inactive'
      and c.slug = ${complexSlug}
    limit 1
  `;
  return rows[0];
}

async function associationContext(sql: Sql, actorId: string, complexSlug: string) {
  const rows = await sql`
    select hm.id as membership_id, hm.household_id, hm.complex_id, hm.membership_role, hm.status,
           c.slug as complex_slug, h.complex_unit_id, cu.building_code, cu.unit_code
    from household_memberships hm
    join households h on h.id = hm.household_id and h.complex_id = hm.complex_id
    join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
    join complexes c on c.id = hm.complex_id
    where hm.user_id = ${actorId}::uuid
      and hm.status in ('pending','verified')
      and h.status = 'active'
      and cu.status = 'active'
      and c.status <> 'inactive'
      and c.slug = ${complexSlug}
    limit 1
  `;
  return rows[0];
}

async function listHousehold(request: Request, env: HouseholdFamilyEnv, sql: Sql, requestId: string, complexSlug: string): Promise<Response> {
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;
  const context = await associationContext(sql, actor.id, complexSlug);
  if (!context) return fail('HOUSEHOLD_ASSOCIATION_REQUIRED', 'Household association required', 403, requestId);

  const members = await sql`
    select hm.id as membership_id, u.display_name, hm.membership_role, hm.status
    from household_memberships hm
    join app_users u on u.id = hm.user_id
    where hm.household_id = ${String(context.household_id)}::uuid
      and hm.complex_id = ${String(context.complex_id)}::uuid
      and hm.status in ('pending','verified')
    order by case hm.membership_role when 'primary' then 0 else 1 end, hm.created_at asc
  `;

  let invites: Array<Record<string, unknown>> = [];
  if (String(context.membership_role) === 'primary' && String(context.status) === 'verified') {
    const rows = await sql`
      select fi.id, fi.status, fi.created_at, fi.accepted_at, fi.revoked_at, t.expires_at
      from family_invites fi
      join household_invite_tokens t on t.id = fi.invite_token_id
      where fi.household_id = ${String(context.household_id)}::uuid
        and fi.complex_id = ${String(context.complex_id)}::uuid
      order by fi.created_at desc
      limit 50
    `;
    invites = rows.map((row) => ({
      inviteId: String(row.id),
      status: String(row.status),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at,
      revokedAt: row.revoked_at
    }));
  }

  return ok({
    complexSlug: String(context.complex_slug),
    unit: { buildingCode: String(context.building_code), unitCode: String(context.unit_code) },
    myMembership: {
      membershipId: String(context.membership_id),
      membershipRole: String(context.membership_role),
      status: String(context.status),
      residentVerified: String(context.status) === 'verified'
    },
    members: members.map((row) => ({
      membershipId: String(row.membership_id),
      displayName: String(row.display_name),
      membershipRole: String(row.membership_role),
      status: String(row.status),
      residentVerified: String(row.status) === 'verified'
    })),
    ...(invites.length || String(context.membership_role) === 'primary' ? { invites } : {})
  }, requestId);
}

async function createInvite(request: Request, env: HouseholdFamilyEnv, sql: Sql, requestId: string, complexSlug: string): Promise<Response> {
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;
  const context = await primaryContext(sql, actor.id, complexSlug);
  if (!context) return fail('HOUSEHOLD_PRIMARY_REQUIRED', 'Verified primary household membership required', 403, requestId);

  const payload = await objectBody(request, requestId);
  if (payload instanceof Response) return payload;
  if (Object.keys(payload).some((key) => key !== 'expiresInHours')) return fail('VALIDATION_ERROR', 'Only expiresInHours is accepted', 400, requestId);
  const expiresInHours = payload.expiresInHours === undefined ? 24 : Number(payload.expiresInHours);
  if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 168) {
    return fail('VALIDATION_ERROR', 'expiresInHours must be an integer from 1 to 168', 400, requestId);
  }

  const token = newOpaqueToken();
  const tokenHash = await sha256Hex(token);
  const rows = await sql`
    with token_row as (
      insert into household_invite_tokens (
        complex_id, household_id, token_hash, purpose, status, max_uses, use_count,
        created_by_user_id, expires_at
      ) values (
        ${String(context.complex_id)}::uuid,
        ${String(context.household_id)}::uuid,
        ${tokenHash}, 'family', 'active', 1, 0, ${actor.id}::uuid,
        now() + (${expiresInHours}::text || ' hours')::interval
      )
      returning id, expires_at
    ), invite_row as (
      insert into family_invites (
        complex_id, household_id, invite_token_id, inviter_membership_id, status
      )
      select ${String(context.complex_id)}::uuid, ${String(context.household_id)}::uuid,
             token_row.id, ${String(context.membership_id)}::uuid, 'pending'
      from token_row
      returning id, invite_token_id, created_at
    ), audited as (
      insert into audit_events (
        request_id, actor_user_id, actor_kind, complex_id, action, scope,
        resource_type, resource_id, decision, reason_code, metadata
      )
      select ${requestId}, ${actor.id}::uuid, 'user', ${String(context.complex_id)}::uuid,
             'household.family_invite.create', 'household.family', 'family_invite', invite_row.id::text,
             'recorded', 'FAMILY_INVITE_CREATED', ${JSON.stringify({ expiresInHours })}::jsonb
      from invite_row
      returning id
    )
    select invite_row.id, invite_row.created_at, token_row.expires_at
    from invite_row cross join token_row
    where exists (select 1 from audited)
  `;
  if (!rows[0]) return fail('FAMILY_INVITE_CREATE_FAILED', 'Family invite could not be created', 500, requestId);

  // Plaintext token is returned once. It is never stored in DB, logs, or audit metadata.
  return ok({
    inviteId: String(rows[0].id),
    token,
    createdAt: rows[0].created_at,
    expiresAt: rows[0].expires_at
  }, requestId, 201);
}

async function redeemInvite(request: Request, env: HouseholdFamilyEnv, sql: Sql, requestId: string): Promise<Response> {
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;
  const payload = await objectBody(request, requestId);
  if (payload instanceof Response) return payload;
  if (Object.keys(payload).some((key) => key !== 'token')) return fail('VALIDATION_ERROR', 'Only token is accepted', 400, requestId);
  const token = typeof payload.token === 'string' ? payload.token.trim() : '';
  if (!OPAQUE_TOKEN.test(token)) return fail('VALIDATION_ERROR', 'Invalid invite token format', 400, requestId);
  const tokenHash = await sha256Hex(token);

  const rows = await sql`
    with target as (
      select t.id as token_id, t.household_id, t.complex_id, fi.id as invite_id,
             c.slug as complex_slug, h.complex_unit_id
      from household_invite_tokens t
      join family_invites fi
        on fi.invite_token_id = t.id and fi.household_id = t.household_id and fi.complex_id = t.complex_id
      join households h on h.id = t.household_id and h.complex_id = t.complex_id
      join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
      join complexes c on c.id = t.complex_id
      where t.token_hash = ${tokenHash}
        and t.purpose = 'family'
        and t.status = 'active'
        and fi.status = 'pending'
        and t.expires_at > now()
        and t.use_count < t.max_uses
        and h.status = 'active'
        and cu.status = 'active'
        and c.status <> 'inactive'
        and not exists (
          select 1 from household_memberships existing
          where existing.user_id = ${actor.id}::uuid
            and existing.complex_id = t.complex_id
            and existing.status in ('pending','verified')
        )
      limit 1
      for update of t, fi
    ), inserted as (
      insert into household_memberships (
        complex_id, household_id, user_id, membership_role, status, verified_at, revoked_at
      )
      select target.complex_id, target.household_id, ${actor.id}::uuid, 'member', 'pending', null, null
      from target
      on conflict do nothing
      returning id, complex_id, household_id, membership_role, status
    ), consumed as (
      update household_invite_tokens t
      set use_count = t.use_count + 1,
          status = 'redeemed',
          redeemed_at = coalesce(t.redeemed_at, now())
      from target, inserted
      where t.id = target.token_id
      returning t.id
    ), accepted as (
      update family_invites fi
      set accepted_by_user_id = ${actor.id}::uuid,
          accepted_membership_id = inserted.id,
          status = 'accepted',
          accepted_at = now()
      from target, inserted
      where fi.id = target.invite_id and exists (select 1 from consumed)
      returning fi.id
    ), audited as (
      insert into audit_events (
        request_id, actor_user_id, actor_kind, complex_id, action, scope,
        resource_type, resource_id, decision, reason_code, metadata
      )
      select ${requestId}, ${actor.id}::uuid, 'user', inserted.complex_id,
             'household.family_invite.redeem', 'household.family', 'household_membership', inserted.id::text,
             'recorded', 'FAMILY_INVITE_ACCEPTED_PENDING', '{}'::jsonb
      from inserted
      where exists (select 1 from accepted)
      returning id
    )
    select inserted.id as membership_id, inserted.membership_role, inserted.status,
           target.complex_slug, target.complex_unit_id
    from inserted join target on target.household_id = inserted.household_id
    where exists (select 1 from accepted) and exists (select 1 from audited)
  `;

  if (!rows[0]) return fail('FAMILY_INVITE_UNAVAILABLE', 'Family invite cannot be accepted', 409, requestId);
  return ok({
    membershipId: String(rows[0].membership_id),
    membershipRole: String(rows[0].membership_role),
    status: String(rows[0].status),
    complexSlug: String(rows[0].complex_slug),
    unitId: String(rows[0].complex_unit_id),
    residentVerified: false,
    verificationRequired: true
  }, requestId, 201);
}

async function revokeInvite(request: Request, env: HouseholdFamilyEnv, sql: Sql, requestId: string, complexSlug: string, inviteId: string): Promise<Response> {
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;
  const context = await primaryContext(sql, actor.id, complexSlug);
  if (!context) return fail('HOUSEHOLD_PRIMARY_REQUIRED', 'Verified primary household membership required', 403, requestId);

  const rows = await sql`
    with revoked_invite as (
      update family_invites fi
      set status = 'revoked', revoked_at = now()
      where fi.id = ${inviteId}::uuid
        and fi.household_id = ${String(context.household_id)}::uuid
        and fi.complex_id = ${String(context.complex_id)}::uuid
        and fi.status = 'pending'
      returning fi.id, fi.invite_token_id
    ), revoked_token as (
      update household_invite_tokens t
      set status = 'revoked', revoked_at = now()
      from revoked_invite ri
      where t.id = ri.invite_token_id and t.status = 'active'
      returning t.id
    ), audited as (
      insert into audit_events (
        request_id, actor_user_id, actor_kind, complex_id, action, scope,
        resource_type, resource_id, decision, reason_code, metadata
      )
      select ${requestId}, ${actor.id}::uuid, 'user', ${String(context.complex_id)}::uuid,
             'household.family_invite.revoke', 'household.family', 'family_invite', revoked_invite.id::text,
             'recorded', 'FAMILY_INVITE_REVOKED', '{}'::jsonb
      from revoked_invite where exists (select 1 from revoked_token)
      returning id
    )
    select revoked_invite.id
    from revoked_invite
    where exists (select 1 from revoked_token) and exists (select 1 from audited)
  `;
  if (!rows[0]) return fail('FAMILY_INVITE_NOT_REVOCABLE', 'Family invite is not pending or does not belong to this household', 409, requestId);
  return ok({ inviteId: String(rows[0].id), status: 'revoked' }, requestId);
}

async function leaveHousehold(request: Request, env: HouseholdFamilyEnv, sql: Sql, requestId: string, complexSlug: string): Promise<Response> {
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;
  const context = await associationContext(sql, actor.id, complexSlug);
  if (!context) return fail('HOUSEHOLD_ASSOCIATION_REQUIRED', 'Household association required', 403, requestId);
  if (String(context.membership_role) === 'primary') {
    return fail('PRIMARY_TRANSFER_REQUIRED', 'Primary household membership cannot leave without an explicit transfer process', 409, requestId);
  }

  const rows = await sql`
    with revoked as (
      update household_memberships
      set status = 'revoked', revoked_at = now(), verified_at = null
      where id = ${String(context.membership_id)}::uuid and status in ('pending','verified')
      returning id, complex_id
    ), audited as (
      insert into audit_events (
        request_id, actor_user_id, actor_kind, complex_id, action, scope,
        resource_type, resource_id, decision, reason_code, metadata
      )
      select ${requestId}, ${actor.id}::uuid, 'user', revoked.complex_id,
             'household.member.leave', 'household.family', 'household_membership', revoked.id::text,
             'recorded', 'HOUSEHOLD_MEMBER_LEFT', '{}'::jsonb
      from revoked returning id
    )
    select revoked.id from revoked where exists (select 1 from audited)
  `;
  if (!rows[0]) return fail('HOUSEHOLD_LEAVE_FAILED', 'Household membership could not be revoked', 409, requestId);
  return ok({ membershipId: String(rows[0].id), status: 'revoked', residentAccessRevoked: true }, requestId);
}

async function revokeMember(request: Request, env: HouseholdFamilyEnv, sql: Sql, requestId: string, complexSlug: string, membershipId: string): Promise<Response> {
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;
  const context = await primaryContext(sql, actor.id, complexSlug);
  if (!context) return fail('HOUSEHOLD_PRIMARY_REQUIRED', 'Verified primary household membership required', 403, requestId);

  const rows = await sql`
    with revoked as (
      update household_memberships hm
      set status = 'revoked', revoked_at = now(), verified_at = null
      where hm.id = ${membershipId}::uuid
        and hm.household_id = ${String(context.household_id)}::uuid
        and hm.complex_id = ${String(context.complex_id)}::uuid
        and hm.membership_role = 'member'
        and hm.status in ('pending','verified')
      returning hm.id, hm.complex_id
    ), audited as (
      insert into audit_events (
        request_id, actor_user_id, actor_kind, complex_id, action, scope,
        resource_type, resource_id, decision, reason_code, metadata
      )
      select ${requestId}, ${actor.id}::uuid, 'user', revoked.complex_id,
             'household.member.revoke', 'household.family', 'household_membership', revoked.id::text,
             'recorded', 'HOUSEHOLD_MEMBER_REVOKED', '{}'::jsonb
      from revoked returning id
    )
    select revoked.id from revoked where exists (select 1 from audited)
  `;
  if (!rows[0]) return fail('HOUSEHOLD_MEMBER_NOT_REVOCABLE', 'Member cannot be revoked from this household', 409, requestId);
  return ok({ membershipId: String(rows[0].id), status: 'revoked', residentAccessRevoked: true }, requestId);
}

export async function handleHouseholdFamilyWithSql(
  request: Request,
  env: HouseholdFamilyEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === '/api/v1/household/family-invites/redeem') {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return redeemInvite(request, env, sql, requestId);
  }

  let match = url.pathname.match(/^\/api\/v1\/complexes\/([^/]+)\/household$/);
  if (match) {
    const slug = decodeSlug(match[1]);
    if (!slug) return fail('INVALID_COMPLEX_SLUG', 'Invalid complex slug', 400, requestId);
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return listHousehold(request, env, sql, requestId, slug);
  }

  match = url.pathname.match(/^\/api\/v1\/complexes\/([^/]+)\/household\/family-invites$/);
  if (match) {
    const slug = decodeSlug(match[1]);
    if (!slug) return fail('INVALID_COMPLEX_SLUG', 'Invalid complex slug', 400, requestId);
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return createInvite(request, env, sql, requestId, slug);
  }

  match = url.pathname.match(/^\/api\/v1\/complexes\/([^/]+)\/household\/family-invites\/([0-9a-fA-F-]+)$/);
  if (match) {
    const slug = decodeSlug(match[1]);
    if (!slug || !UUID.test(match[2])) return fail('VALIDATION_ERROR', 'Invalid household invite route', 400, requestId);
    if (request.method !== 'DELETE') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return revokeInvite(request, env, sql, requestId, slug, match[2]);
  }

  match = url.pathname.match(/^\/api\/v1\/complexes\/([^/]+)\/household\/members\/me$/);
  if (match) {
    const slug = decodeSlug(match[1]);
    if (!slug) return fail('INVALID_COMPLEX_SLUG', 'Invalid complex slug', 400, requestId);
    if (request.method !== 'DELETE') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return leaveHousehold(request, env, sql, requestId, slug);
  }

  match = url.pathname.match(/^\/api\/v1\/complexes\/([^/]+)\/household\/members\/([0-9a-fA-F-]+)$/);
  if (match) {
    const slug = decodeSlug(match[1]);
    if (!slug || !UUID.test(match[2])) return fail('VALIDATION_ERROR', 'Invalid household member route', 400, requestId);
    if (request.method !== 'DELETE') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return revokeMember(request, env, sql, requestId, slug, match[2]);
  }

  return null;
}

export async function handleHouseholdFamilyRequest(request: Request, env: HouseholdFamilyEnv, requestId: string): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.includes('/household')) return null;
  return handleHouseholdFamilyWithSql(request, env, sqlFor(env), requestId);
}
