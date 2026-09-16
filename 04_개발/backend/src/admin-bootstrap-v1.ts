import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type Actor } from './auth-v1';
import type { CoreEnv } from './core-v1';
import { padiemAuthorityResponseData, resolvePadiemAuthority } from './padiem-authority-v1';
import {
  isCanonicalPrincipalScopes,
  runtimeScopesForRole,
  type AdminPrincipalRole
} from './admin-scope-policy-v1';

type Sql = NeonQueryFunction<false, false>;

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const BOOTSTRAP_PATH = '/api/v1/admin/bootstrap';
type BootstrapProvider = 'google' | 'credential';
type BootstrapPrincipal = {
  id: string;
  provider: BootstrapProvider;
  authorityLevel: AdminPrincipalRole;
  scopes: string[];
};

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

function ok(data: unknown, requestId: string): Response {
  return json({ data, requestId }, 200, requestId);
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}

function normalizedPrincipal(row: Record<string, unknown> | undefined): BootstrapPrincipal | null {
  if (!row) return null;
  const id = String(row.id ?? '').trim();
  const provider = String(row.provider ?? '');
  const authorityLevel = String(row.authority_level ?? '');
  const rawScopes = Array.isArray(row.scopes) ? row.scopes : [];
  const scopes = Array.from(new Set(rawScopes.map((value) => String(value).trim()))).sort();

  if (!id || (provider !== 'google' && provider !== 'credential')) return null;
  if (authorityLevel !== 'operator' && authorityLevel !== 'admin') return null;
  if (!isCanonicalPrincipalScopes(authorityLevel, scopes)) return null;

  return { id, provider, authorityLevel, scopes };
}

async function auditBootstrap(
  sql: Sql,
  actor: Actor,
  requestId: string,
  decision: 'allowed' | 'denied',
  reasonCode: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await sql`
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
    ) values (
      ${requestId},
      ${actor.id},
      'user',
      ${null},
      'authorization.admin-bootstrap',
      'admin.bootstrap',
      ${decision},
      ${reasonCode},
      ${JSON.stringify(metadata)}::jsonb
    )
  `;
}

/**
 * #592 / #396.
 *
 * This is NOT a public admin signup path. The caller must already be a valid
 * DanjiOn actor and match a separately pre-registered active allowlist row
 * for the actor's exact Better Auth login provider/account. Google principals
 * additionally require Better Auth's verified-email bit; credential principals
 * must be pinned to their exact credential account id and never rely on email alone.
 *
 * The allowlist is consumed only as onboarding approval. The resulting runtime
 * authority is materialized into padiem_operator_grants; all later admin
 * authorization continues through the existing grant-only authority contract.
 *
 * The request body is intentionally ignored: clients cannot choose a role,
 * scope, provider, email, or grant. Every bootstrap input comes from server
 * state tied to the authenticated actor.
 */
export async function bootstrapAdminAuthorityResponse(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response> {
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  try {
    const rows = await sql`
      select
        p.id,
        p.provider,
        p.authority_level,
        p.scopes
      from app_users au
      join danjion_auth."user" u
        on u.id = au.auth_user_id
      join padiem_admin_identity_allowlist p
        on p.provider in ('google','credential')
       and p.normalized_email = lower(btrim(u.email))
       and p.status = 'active'
       and (p.expires_at is null or p.expires_at > now())
      where au.id = ${actor.id}::uuid
        and (
          p.provider = 'credential'
          or u.email_verified = true
        )
        and exists (
          select 1
          from danjion_auth.account a
          where a.user_id = u.id
            and lower(a.provider_id) = p.provider
            and (
              (p.provider = 'google' and (
                p.provider_account_id is null
                or p.provider_account_id = a.account_id
              ))
              or
              (p.provider = 'credential'
                and p.provider_account_id is not null
                and p.provider_account_id = a.account_id)
            )
        )
      limit 1
    `;

    if (!rows[0]) {
      await auditBootstrap(sql, actor, requestId, 'denied', 'ADMIN_BOOTSTRAP_NOT_ALLOWLISTED', {
        provider: rows[0] && typeof rows[0].provider === 'string' ? rows[0].provider : 'unknown'
      });
      return fail('ADMIN_BOOTSTRAP_NOT_ALLOWED', 'Pre-registered administrator identity required', 403, requestId);
    }

    const principal = normalizedPrincipal(rows[0] as Record<string, unknown>);
    if (!principal) {
      await auditBootstrap(sql, actor, requestId, 'denied', 'ADMIN_BOOTSTRAP_PRINCIPAL_INVALID', {
        provider: rows[0] && typeof rows[0].provider === 'string' ? rows[0].provider : 'unknown'
      });
      return fail('ADMIN_BOOTSTRAP_PRINCIPAL_INVALID', 'Administrator registration is invalid', 503, requestId);
    }

    const grantMetadata = JSON.stringify({
      source: 'admin_identity_allowlist',
      principalId: principal.id,
      provider: principal.provider
    });

    const runtimeScopes = runtimeScopesForRole(principal.authorityLevel);

    for (const scope of runtimeScopes) {
      await sql`
        insert into padiem_operator_grants (
          user_id,
          scope,
          status,
          granted_by_user_id,
          granted_at,
          reason,
          metadata
        ) values (
          ${actor.id}::uuid,
          ${scope},
          'active',
          ${null},
          now(),
          'pre-registered administrator bootstrap',
          ${grantMetadata}::jsonb
        )
        on conflict do nothing
      `;
    }

    const authority = await resolvePadiemAuthority(sql, actor.id);
    const expectedWildcard = principal.authorityLevel === 'admin';
    if (
      authority.level === 'none'
      || authority.wildcard !== expectedWildcard
      || runtimeScopes.some((scope) => !authority.scopes.includes(scope))
    ) {
      await auditBootstrap(sql, actor, requestId, 'denied', 'ADMIN_BOOTSTRAP_GRANT_READBACK_FAILED', {
        principalId: principal.id,
        authorityLevel: principal.authorityLevel,
        scopeCount: runtimeScopes.length
      });
      return fail('ADMIN_BOOTSTRAP_GRANT_FAILED', 'Administrator authority could not be established', 503, requestId);
    }

    await auditBootstrap(sql, actor, requestId, 'allowed', 'ADMIN_BOOTSTRAP_GRANTED', {
      principalId: principal.id,
      authorityLevel: principal.authorityLevel,
      scopeCount: runtimeScopes.length
    });

    return ok(padiemAuthorityResponseData(authority), requestId);
  } catch {
    await auditBootstrap(sql, actor, requestId, 'denied', 'ADMIN_BOOTSTRAP_DATABASE_ERROR', {
      provider: 'unknown'
    }).catch(() => {});
    return fail('ADMIN_BOOTSTRAP_UNAVAILABLE', 'Administrator registration could not be verified', 503, requestId);
  }
}

export async function handleAdminBootstrapRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== BOOTSTRAP_PATH || request.method !== 'POST') return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const sql: Sql = neon(env.DATABASE_URL);
  return bootstrapAdminAuthorityResponse(request, env, sql, requestId);
}
