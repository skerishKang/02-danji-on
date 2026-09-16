import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { CoreEnv } from './core-v1';
import {
  requirePadiemPrivilegedScope,
  type PadiemPrivilegedActor
} from './padiem-authority-v1';
import {
  OPERATIONAL_ADMIN_SCOPES,
  principalScopesForRole,
  runtimeScopesForRole,
  type AdminPrincipalRole
} from './admin-scope-policy-v1';

type Sql = NeonQueryFunction<false, false>;

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const COLLECTION_PATH = '/api/v1/admin/principals';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export { OPERATIONAL_ADMIN_SCOPES };

type PrincipalRole = AdminPrincipalRole;
type PrincipalStatus = 'active' | 'revoked';

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

async function bodyJson(request: Request, requestId: string): Promise<Record<string, unknown> | Response> {
  const text = await request.text();
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

function normalizedEmail(value: unknown): string | null {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

function normalizedRole(value: unknown): PrincipalRole | null {
  const role = String(value ?? '').trim();
  return role === 'admin' || role === 'operator' ? role : null;
}

function normalizedStatus(value: unknown): PrincipalStatus | null {
  const status = String(value ?? '').trim();
  return status === 'active' || status === 'revoked' ? status : null;
}

function safeReason(value: unknown): string | null {
  const reason = String(value ?? '').trim();
  return reason ? reason.slice(0, 500) : null;
}

function hasUnexpectedKeys(payload: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(payload).some((key) => !allowedKeys.has(key));
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && String((error as { code?: unknown }).code ?? '') === '23505'
  );
}

async function requireSuper(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<PadiemPrivilegedActor | Response> {
  return requirePadiemPrivilegedScope(request, env, sql, requestId, 'platform.authz.manage');
}

async function listPrincipals(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response> {
  const actor = await requireSuper(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  const rows = await sql`
    select
      p.id,
      p.provider,
      p.normalized_email,
      p.authority_level,
      p.scopes,
      p.status,
      p.created_at,
      p.expires_at,
      p.revoked_at,
      coalesce(rt.runtime_user_count, 0)::int as runtime_user_count,
      coalesce(rt.runtime_scopes, array[]::text[]) as runtime_scopes
    from padiem_admin_identity_allowlist p
    left join lateral (
      select
        count(distinct g.user_id)
          filter (
            where g.status = 'active'
              and (g.expires_at is null or g.expires_at > now())
          ) as runtime_user_count,
        coalesce(
          array_agg(distinct g.scope order by g.scope)
            filter (
              where g.status = 'active'
                and (g.expires_at is null or g.expires_at > now())
            ),
          array[]::text[]
        ) as runtime_scopes
      from padiem_operator_grants g
      where g.metadata ->> 'source' = 'admin_identity_allowlist'
        and g.metadata ->> 'principalId' = p.id::text
    ) rt on true
    where p.provider in ('google','credential')
    order by
      case p.status when 'active' then 0 else 1 end,
      case p.authority_level when 'admin' then 0 else 1 end,
      p.created_at asc
  `;

  return ok(rows.map((row) => {
    const runtimeScopes = Array.isArray(row.runtime_scopes)
      ? row.runtime_scopes.map((scope) => String(scope))
      : [];
    return {
      id: String(row.id),
      provider: String(row.provider),
      email: String(row.normalized_email),
      role: String(row.authority_level),
      status: String(row.status),
      scopes: Array.isArray(row.scopes) ? row.scopes.map((scope) => String(scope)) : [],
      runtimeUserCount: Number(row.runtime_user_count ?? 0),
      runtimeScopes,
      runtimeRole: runtimeScopes.includes('*') ? 'admin' : runtimeScopes.length ? 'operator' : 'none',
      createdAt: row.created_at ? String(row.created_at) : null,
      expiresAt: row.expires_at ? String(row.expires_at) : null,
      revokedAt: row.revoked_at ? String(row.revoked_at) : null
    };
  }), requestId);
}

async function createPrincipal(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response> {
  const actor = await requireSuper(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  if (hasUnexpectedKeys(payload, ['email', 'role', 'reason'])) {
    return fail('VALIDATION_ERROR', 'Unsupported administrator principal fields', 400, requestId);
  }

  const email = normalizedEmail(payload.email);
  const role = normalizedRole(payload.role);
  const reason = safeReason(payload.reason);
  if (!email || !role) {
    return fail('VALIDATION_ERROR', 'Valid email and role are required', 400, requestId);
  }
  const principalScopes = principalScopesForRole(role);
  const principalScopesJson = JSON.stringify(principalScopes);
  const metadata = JSON.stringify({ provider: 'google', role, email });

  try {
    const rows = await sql`
      with inserted as (
        insert into padiem_admin_identity_allowlist (
          provider,
          normalized_email,
          authority_level,
          scopes,
          status,
          created_by_user_id,
          reason
        )
        select
          'google',
          ${email},
          ${role},
          array(select jsonb_array_elements_text(${principalScopesJson}::jsonb)),
          'active',
          ${actor.id}::uuid,
          ${reason}
        where not exists (
          select 1
          from padiem_admin_identity_allowlist p
          where p.provider = 'google'
            and p.normalized_email = ${email}
            and p.status = 'active'
        )
        returning id, provider, normalized_email, authority_level, scopes, status, created_at
      ),
      audited as (
        insert into audit_events (
          request_id,
          actor_user_id,
          actor_kind,
          complex_id,
          action,
          scope,
          decision,
          reason_code,
          metadata
        )
        select
          ${requestId},
          ${actor.id}::uuid,
          'operator',
          ${null},
          'admin.principal.create',
          'platform.authz.manage',
          'allowed',
          'ADMIN_PRINCIPAL_CREATED',
          (${metadata}::jsonb || jsonb_build_object('principalId', inserted.id::text))
        from inserted
        returning id
      )
      select inserted.*
      from inserted
      cross join lateral (select count(*) from audited) audit_barrier
    `;
    if (!rows[0]) {
      return fail('ADMIN_PRINCIPAL_EXISTS', 'An active administrator principal already exists for this email', 409, requestId);
    }
    const row = rows[0];
    return ok({
      id: String(row.id),
      provider: String(row.provider),
      email: String(row.normalized_email),
      role: String(row.authority_level),
      scopes: Array.isArray(row.scopes) ? row.scopes.map((scope) => String(scope)) : principalScopes,
      status: String(row.status),
      runtimeUserCount: 0,
      runtimeScopes: [],
      runtimeRole: 'none',
      createdAt: row.created_at ? String(row.created_at) : null
    }, requestId, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail('ADMIN_PRINCIPAL_EXISTS', 'An active administrator principal already exists for this email', 409, requestId);
    }
    return fail('ADMIN_PRINCIPAL_CREATE_FAILED', 'Administrator principal could not be created', 503, requestId);
  }
}

async function updatePrincipal(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  principalId: string
): Promise<Response> {
  const actor = await requireSuper(request, env, sql, requestId);
  if (actor instanceof Response) return actor;
  if (!UUID_PATTERN.test(principalId)) return fail('VALIDATION_ERROR', 'Invalid principal id', 400, requestId);

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  if (hasUnexpectedKeys(payload, ['role', 'status', 'reason'])) {
    return fail('VALIDATION_ERROR', 'Unsupported administrator principal fields', 400, requestId);
  }
  const role = normalizedRole(payload.role);
  const status = normalizedStatus(payload.status);
  const reason = safeReason(payload.reason);
  if (!role || !status) {
    return fail('VALIDATION_ERROR', 'Valid role and status are required', 400, requestId);
  }

  const currentRows = await sql`
    select id, provider, normalized_email, authority_level, status
    from padiem_admin_identity_allowlist
    where id = ${principalId}::uuid
      and provider in ('google','credential')
    limit 1
  `;
  const current = currentRows[0];
  if (!current) return fail('NOT_FOUND', 'Administrator principal not found', 404, requestId);

  if (status === 'active') {
    const duplicateRows = await sql`
      select 1
      from padiem_admin_identity_allowlist p
      where p.provider = ${String(current.provider)}
        and p.normalized_email = ${String(current.normalized_email)}
        and p.status = 'active'
        and p.id <> ${principalId}::uuid
      limit 1
    `;
    if (duplicateRows[0]) {
      return fail('ADMIN_PRINCIPAL_EXISTS', 'Another active administrator principal already exists for this email', 409, requestId);
    }
  }

  const linkedRows = await sql`
    select distinct g.user_id
    from padiem_operator_grants g
    where g.metadata ->> 'source' = 'admin_identity_allowlist'
      and g.metadata ->> 'principalId' = ${principalId}
  `;
  const linkedUserIds = linkedRows.map((row) => String(row.user_id));
  const removesWildcard = status !== 'active' || role !== 'admin';
  if (removesWildcard && linkedUserIds.includes(actor.id)) {
    return fail('SELF_LOCKOUT_BLOCKED', 'A super administrator cannot demote or revoke their own principal', 409, requestId);
  }

  const principalScopes = principalScopesForRole(role);
  const runtimeScopes = runtimeScopesForRole(role);
  const principalScopesJson = JSON.stringify(principalScopes);
  const runtimeScopesJson = JSON.stringify(runtimeScopes);
  const syncMetadata = JSON.stringify({
    source: 'admin_identity_allowlist',
    principalId,
    provider: String(current.provider)
  });
  const auditMetadata = JSON.stringify({
    principalId,
    email: String(current.normalized_email),
    previousRole: String(current.authority_level),
    previousStatus: String(current.status),
    role,
    status,
    linkedUserCount: linkedUserIds.length
  });

  try {
    const rows = await sql`
      with linked_users as materialized (
        select distinct g.user_id
        from padiem_operator_grants g
        where g.metadata ->> 'source' = 'admin_identity_allowlist'
          and g.metadata ->> 'principalId' = ${principalId}
      ),
      updated as (
        update padiem_admin_identity_allowlist
        set authority_level = ${role},
            scopes = array(select jsonb_array_elements_text(${principalScopesJson}::jsonb)),
            status = ${status},
            revoked_at = case when ${status} = 'revoked' then coalesce(revoked_at, now()) else null end,
            reason = ${reason}
        where id = ${principalId}::uuid
          and provider in ('google','credential')
        returning id, provider, normalized_email, authority_level, scopes, status, created_at, expires_at, revoked_at
      ),
      revoked as (
        update padiem_operator_grants g
        set status = 'revoked',
            revoked_at = now(),
            reason = coalesce(${reason}, 'administrator principal authority changed')
        from updated u
        where u.id = ${principalId}::uuid
          and g.status = 'active'
          and g.metadata ->> 'source' = 'admin_identity_allowlist'
          and g.metadata ->> 'principalId' = ${principalId}
        returning g.user_id
      ),
      revoke_barrier as (
        select count(*) as revoked_count from revoked
      ),
      desired_scopes as (
        select value as scope
        from jsonb_array_elements_text(${runtimeScopesJson}::jsonb)
      ),
      inserted_grants as (
        insert into padiem_operator_grants (
          user_id,
          scope,
          status,
          granted_by_user_id,
          granted_at,
          reason,
          metadata
        )
        select
          lu.user_id,
          ds.scope,
          'active',
          ${actor.id}::uuid,
          now(),
          coalesce(${reason}, 'administrator principal authority synchronized'),
          ${syncMetadata}::jsonb
        from linked_users lu
        cross join desired_scopes ds
        cross join updated u
        cross join revoke_barrier rb
        where u.status = 'active'
        on conflict do nothing
        returning user_id, scope
      ),
      audited as (
        insert into audit_events (
          request_id,
          actor_user_id,
          actor_kind,
          complex_id,
          action,
          scope,
          decision,
          reason_code,
          metadata
        )
        select
          ${requestId},
          ${actor.id}::uuid,
          'operator',
          ${null},
          'admin.principal.update',
          'platform.authz.manage',
          'allowed',
          'ADMIN_PRINCIPAL_UPDATED',
          ${auditMetadata}::jsonb
        from updated
        cross join lateral (select count(*) from inserted_grants) sync_barrier
        returning id
      )
      select
        updated.*,
        (select count(distinct user_id)::int from inserted_grants) as runtime_user_count,
        coalesce(
          (select array_agg(distinct scope order by scope) from inserted_grants),
          array[]::text[]
        ) as runtime_scopes
      from updated
      cross join lateral (select count(*) from audited) audit_barrier
    `;
    if (!rows[0]) return fail('NOT_FOUND', 'Administrator principal not found', 404, requestId);
    const row = rows[0];
    const runtimeScopes = Array.isArray(row.runtime_scopes)
      ? row.runtime_scopes.map((scope) => String(scope))
      : [];
    return ok({
      id: String(row.id),
      provider: String(row.provider),
      email: String(row.normalized_email),
      role: String(row.authority_level),
      status: String(row.status),
      scopes: Array.isArray(row.scopes) ? row.scopes.map((scope) => String(scope)) : principalScopes,
      runtimeUserCount: Number(row.runtime_user_count ?? 0),
      runtimeScopes,
      runtimeRole: runtimeScopes.includes('*') ? 'admin' : runtimeScopes.length ? 'operator' : 'none',
      createdAt: row.created_at ? String(row.created_at) : null,
      expiresAt: row.expires_at ? String(row.expires_at) : null,
      revokedAt: row.revoked_at ? String(row.revoked_at) : null
    }, requestId);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail('ADMIN_PRINCIPAL_EXISTS', 'Another active administrator principal already exists for this email', 409, requestId);
    }
    return fail('ADMIN_PRINCIPAL_UPDATE_FAILED', 'Administrator authority could not be synchronized', 503, requestId);
  }
}

export async function handleAdminPrincipalRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === COLLECTION_PATH && request.method === 'GET') {
    if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
    const sql: Sql = neon(env.DATABASE_URL);
    return listPrincipals(request, env, sql, requestId);
  }
  if (url.pathname === COLLECTION_PATH && request.method === 'POST') {
    if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
    const sql: Sql = neon(env.DATABASE_URL);
    return createPrincipal(request, env, sql, requestId);
  }

  const match = url.pathname.match(/^\/api\/v1\/admin\/principals\/([0-9a-fA-F-]+)$/);
  if (match && request.method === 'PATCH') {
    if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
    const sql: Sql = neon(env.DATABASE_URL);
    return updatePrincipal(request, env, sql, requestId, match[1]);
  }
  return null;
}
