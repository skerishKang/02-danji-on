import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type AuthEnv } from './auth-v1';

type Sql = NeonQueryFunction<false, false>;
export type AccountLifecycleEnv = AuthEnv;

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const MAX_BODY_BYTES = 8 * 1024;
const CONSENT_TYPES = new Set([
  'terms',
  'privacy',
  'resident_rules',
  'community_rules',
  'marketing',
  'service_notifications',
  'benefit_marketing'
]);
const CONSENT_STATUSES = new Set(['accepted', 'withdrawn']);
const CLOSE_CONFIRMATION = 'CLOSE_DANJION_ACCOUNT';

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

function sqlFor(env: AccountLifecycleEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

async function readJsonObject(request: Request, requestId: string): Promise<Record<string, unknown> | Response> {
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
  return parsed as Record<string, unknown>;
}

async function listConsents(sql: Sql, userId: string, requestId: string): Promise<Response> {
  const rows = await sql`
    select distinct on (consent_type)
      consent_type,
      policy_version,
      status,
      recorded_at,
      withdrawn_at
    from consent_records
    where user_id = ${userId}::uuid
      and complex_id is null
    order by consent_type, recorded_at desc, id desc
  `;

  return ok({
    consents: rows.map((row) => ({
      consentType: String(row.consent_type),
      policyVersion: String(row.policy_version),
      status: String(row.status),
      recordedAt: row.recorded_at,
      withdrawnAt: row.withdrawn_at ?? null
    }))
  }, requestId);
}

async function recordConsent(
  request: Request,
  sql: Sql,
  userId: string,
  requestId: string
): Promise<Response> {
  const body = await readJsonObject(request, requestId);
  if (body instanceof Response) return body;

  const allowed = new Set(['consentType', 'policyVersion', 'status']);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    return fail('VALIDATION_ERROR', 'Only consentType, policyVersion and status are accepted', 400, requestId);
  }

  const consentType = typeof body.consentType === 'string' ? body.consentType.trim() : '';
  const policyVersion = typeof body.policyVersion === 'string' ? body.policyVersion.trim() : '';
  const status = typeof body.status === 'string' ? body.status.trim() : '';

  if (!CONSENT_TYPES.has(consentType)) {
    return fail('VALIDATION_ERROR', 'Unsupported consent type', 400, requestId);
  }
  if (policyVersion.length < 1 || policyVersion.length > 80) {
    return fail('VALIDATION_ERROR', 'Invalid policy version', 400, requestId);
  }
  if (!CONSENT_STATUSES.has(status)) {
    return fail('VALIDATION_ERROR', 'Consent status must be accepted or withdrawn', 400, requestId);
  }

  const rows = await sql`
    with inserted as (
      insert into consent_records (
        user_id,
        consent_type,
        policy_version,
        status,
        source,
        recorded_at,
        withdrawn_at,
        metadata
      ) values (
        ${userId}::uuid,
        ${consentType},
        ${policyVersion},
        ${status},
        'web',
        now(),
        case when ${status} = 'withdrawn' then now() else null end,
        '{}'::jsonb
      )
      returning id, consent_type, policy_version, status, recorded_at, withdrawn_at
    ), audited as (
      insert into audit_events (
        request_id,
        actor_user_id,
        actor_kind,
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
        ${userId}::uuid,
        'user',
        'account.consent.record',
        inserted.consent_type,
        'consent_record',
        inserted.id::text,
        'recorded',
        case when inserted.status = 'accepted' then 'CONSENT_ACCEPTED' else 'CONSENT_WITHDRAWN' end,
        jsonb_build_object('policyVersion', inserted.policy_version)
      from inserted
      returning id
    )
    select
      inserted.id,
      inserted.consent_type,
      inserted.policy_version,
      inserted.status,
      inserted.recorded_at,
      inserted.withdrawn_at
    from inserted
    where exists (select 1 from audited)
  `;

  const row = rows[0];
  if (!row) return fail('CONSENT_RECORD_FAILED', 'Consent could not be recorded', 500, requestId);

  return ok({
    consent: {
      id: String(row.id),
      consentType: String(row.consent_type),
      policyVersion: String(row.policy_version),
      status: String(row.status),
      recordedAt: row.recorded_at,
      withdrawnAt: row.withdrawn_at ?? null
    }
  }, requestId, 201);
}

async function closeProductAccount(
  request: Request,
  sql: Sql,
  userId: string,
  requestId: string
): Promise<Response> {
  const body = await readJsonObject(request, requestId);
  if (body instanceof Response) return body;

  const allowed = new Set(['confirm']);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    return fail('VALIDATION_ERROR', 'Only confirm is accepted', 400, requestId);
  }

  const confirm = typeof body.confirm === 'string' ? body.confirm.trim() : '';
  if (confirm !== CLOSE_CONFIRMATION) {
    return fail('ACCOUNT_CLOSE_CONFIRMATION_REQUIRED', 'Explicit account closure confirmation is required', 400, requestId);
  }

  const rows = await sql`
    with target as (
      select id
      from app_users
      where id = ${userId}::uuid
        and account_status = 'active'
      for update
    ), revoked_family_invites as (
      update family_invites fi
      set
        status = 'revoked',
        revoked_at = coalesce(fi.revoked_at, now())
      where fi.status = 'pending'
        and fi.invite_token_id in (
          select t.id
          from household_invite_tokens t
          where t.created_by_user_id = ${userId}::uuid
            and t.status = 'active'
        )
        and exists (select 1 from target)
      returning fi.id
    ), revoked_invite_tokens as (
      update household_invite_tokens t
      set
        status = 'revoked',
        revoked_at = coalesce(t.revoked_at, now())
      where t.created_by_user_id = ${userId}::uuid
        and t.status = 'active'
        and exists (select 1 from target)
      returning t.id
    ), revoked_household_memberships as (
      update household_memberships hm
      set
        status = 'revoked',
        revoked_at = coalesce(hm.revoked_at, now()),
        updated_at = now()
      where hm.user_id = ${userId}::uuid
        and hm.status in ('pending', 'verified')
        and exists (select 1 from target)
      returning hm.id
    ), revoked_padiem_grants as (
      update padiem_operator_grants g
      set
        status = 'revoked',
        revoked_at = coalesce(g.revoked_at, now()),
        reason = coalesce(g.reason, 'product_account_closed')
      where g.user_id = ${userId}::uuid
        and g.status = 'active'
        and exists (select 1 from target)
      returning g.id
    ), revoked_complex_grants as (
      update complex_operator_grants g
      set
        status = 'revoked',
        revoked_at = coalesce(g.revoked_at, now()),
        reason = coalesce(g.reason, 'product_account_closed')
      where g.user_id = ${userId}::uuid
        and g.status = 'active'
        and exists (select 1 from target)
      returning g.id
    ), closed as (
      update app_users u
      set
        account_status = 'closed',
        closed_at = coalesce(u.closed_at, now()),
        display_name = '탈퇴한 사용자',
        avatar_url = null,
        updated_at = now()
      where u.id = ${userId}::uuid
        and exists (select 1 from target)
      returning u.id, u.closed_at
    ), audited as (
      insert into audit_events (
        request_id,
        actor_user_id,
        actor_kind,
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
        closed.id,
        'user',
        'account.close',
        'account.self',
        'app_user',
        closed.id::text,
        'recorded',
        'PRODUCT_ACCOUNT_CLOSED',
        jsonb_build_object(
          'householdMembershipsRevoked', (select count(*) from revoked_household_memberships),
          'padiemGrantsRevoked', (select count(*) from revoked_padiem_grants),
          'complexGrantsRevoked', (select count(*) from revoked_complex_grants),
          'inviteTokensRevoked', (select count(*) from revoked_invite_tokens),
          'familyInvitesRevoked', (select count(*) from revoked_family_invites)
        )
      from closed
      returning id
    )
    select
      closed.id,
      closed.closed_at,
      (select count(*) from revoked_household_memberships) as household_memberships_revoked,
      (select count(*) from revoked_padiem_grants) as padiem_grants_revoked,
      (select count(*) from revoked_complex_grants) as complex_grants_revoked,
      (select count(*) from revoked_invite_tokens) as invite_tokens_revoked,
      (select count(*) from revoked_family_invites) as family_invites_revoked
    from closed
    where exists (select 1 from audited)
  `;

  const row = rows[0];
  if (!row) {
    return fail('ACCOUNT_CLOSE_FAILED', 'Product account could not be closed', 409, requestId);
  }

  return ok({
    accountStatus: 'closed',
    closedAt: row.closed_at,
    authorizationRevoked: true,
    revoked: {
      householdMemberships: Number(row.household_memberships_revoked || 0),
      padiemGrants: Number(row.padiem_grants_revoked || 0),
      complexGrants: Number(row.complex_grants_revoked || 0),
      inviteTokens: Number(row.invite_tokens_revoked || 0),
      familyInvites: Number(row.family_invites_revoked || 0)
    },
    authProviderAccountDeleted: false
  }, requestId);
}

export async function handleAccountLifecycleWithSql(
  request: Request,
  env: AccountLifecycleEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const isConsentRoute = path === '/api/v1/me/consents';
  const isCloseRoute = path === '/api/v1/me/account/close';
  if (!isConsentRoute && !isCloseRoute) return null;

  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;

  if (isConsentRoute) {
    if (request.method === 'GET') return listConsents(sql, actor.id, requestId);
    if (request.method === 'POST') return recordConsent(request, sql, actor.id, requestId);
    return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
  }

  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
  return closeProductAccount(request, sql, actor.id, requestId);
}

export async function handleAccountLifecycleRequest(
  request: Request,
  env: AccountLifecycleEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== '/api/v1/me/consents' && path !== '/api/v1/me/account/close') return null;
  return handleAccountLifecycleWithSql(request, env, sqlFor(env), requestId);
}
