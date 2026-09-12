import type { NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type Actor, type AuthEnv } from './auth-v1';

type Sql = NeonQueryFunction<false, false>;

const REQUEST_ID_HEADER = 'x-danjion-request-id';

/**
 * Centralized PADIEM authority-level contract (#411).
 *
 * Authority is derived exclusively from active rows in `padiem_operator_grants`
 * (same fail-closed semantics as requirePadiemOperator: status = 'active' and
 * an unexpired window). Legacy role-table authority is not consulted anywhere
 * in this module, and client headers can never elevate authority.
 *
 * - super admin ('admin')  : active wildcard grant, scope = '*'
 * - operator               : active bounded PADIEM scopes only, no wildcard
 * - none                   : no active PADIEM grant at all
 */
export type PadiemAuthorityLevel = 'admin' | 'operator' | 'none';

export type PadiemAuthority = {
  level: PadiemAuthorityLevel;
  scopes: string[];
  wildcard: boolean;
};

/**
 * Owner-only privileged scopes reserved for future super-admin functionality.
 * Only an active wildcard grant satisfies them; bounded operator grants never do.
 */
export const PRIVILEGED_PADIEM_SCOPES = [
  'platform.users.read',
  'platform.users.manage',
  'platform.authz.manage',
  'platform.audit.read',
  'platform.audit.export',
  'platform.sensitive.read',
  'platform.system.manage'
] as const;

export type PrivilegedPadiemScope = (typeof PRIVILEGED_PADIEM_SCOPES)[number];

export function isPrivilegedPadiemScope(scope: string): scope is PrivilegedPadiemScope {
  return (PRIVILEGED_PADIEM_SCOPES as readonly string[]).includes(scope);
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return Response.json(
    { error: { code, message }, requestId },
    {
      status,
      headers: {
        [REQUEST_ID_HEADER]: requestId,
        'access-control-expose-headers': REQUEST_ID_HEADER,
        'cache-control': 'no-store'
      }
    }
  );
}

export async function resolvePadiemAuthority(sql: Sql, actorId: string): Promise<PadiemAuthority> {
  const rows = await sql`
    select id, scope
    from padiem_operator_grants
    where user_id = ${actorId}
      and status = 'active'
      and (expires_at is null or expires_at > now())
    order by scope
  `;
  const scopes = rows.map((row) => String(row.scope));
  const wildcard = scopes.includes('*');
  const level: PadiemAuthorityLevel = wildcard ? 'admin' : scopes.length > 0 ? 'operator' : 'none';
  return { level, scopes, wildcard };
}

export async function recordAuthorityDecision(
  sql: Sql,
  actor: Actor,
  requestId: string,
  requestedScope: string,
  decision: 'allowed' | 'denied',
  reasonCode: string,
  grantedScope: string | null
): Promise<void> {
  const metadata = JSON.stringify({
    ...(grantedScope ? { grantedScope } : {}),
    authorityKind: 'padiem'
  });
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
      'operator',
      ${null},
      'authorization.padiem-authority-check',
      ${requestedScope},
      ${decision},
      ${reasonCode},
      ${metadata}::jsonb
    )
  `;
}

export type PadiemPrivilegedActor = Actor & { authority: PadiemAuthority };

/**
 * Reusable privileged-scope guard: only an active PADIEM wildcard grant passes.
 * Bounded operators and ungranted actors receive 403; every decision is audited;
 * any database failure is fail-closed with 503.
 */
export async function requirePadiemPrivilegedScope(
  request: Request,
  env: AuthEnv,
  sql: Sql,
  requestId: string,
  scope: string
): Promise<PadiemPrivilegedActor | Response> {
  if (!isPrivilegedPadiemScope(scope)) {
    return fail('PRIVILEGED_SCOPE_INVALID', 'Requested scope is not a privileged PADIEM scope', 400, requestId);
  }

  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  try {
    const authority = await resolvePadiemAuthority(sql, actor.id);
    if (authority.wildcard) {
      await recordAuthorityDecision(sql, actor, requestId, scope, 'allowed', 'PRIVILEGED_WILDCARD_GRANT', '*');
      return { ...actor, authority };
    }
    const reasonCode = authority.level === 'operator' ? 'PRIVILEGED_WILDCARD_REQUIRED' : 'NO_ACTIVE_PADIEM_GRANT';
    await recordAuthorityDecision(sql, actor, requestId, scope, 'denied', reasonCode, null);
    return fail('PRIVILEGED_FORBIDDEN', 'Active PADIEM wildcard grant required', 403, requestId);
  } catch {
    await recordAuthorityDecision(sql, actor, requestId, scope, 'denied', 'AUTHORITY_DATABASE_ERROR', null).catch(() => {});
    return fail('AUTHORITY_DB_ERROR', 'Authorization could not be verified', 503, requestId);
  }
}

export function padiemAuthorityResponseData(authority: PadiemAuthority) {
  return {
    level: authority.level,
    label: authority.level === 'admin' ? '최고관리자' : '일반관리자',
    scopes: authority.scopes,
    wildcard: authority.wildcard
  };
}
