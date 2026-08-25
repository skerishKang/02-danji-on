import type { NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type Actor, type AuthEnv } from './auth-v1';

type Sql = NeonQueryFunction<false, false>;

export type VerifiedResident = Actor & {
  complexId: string;
  complexSlug: string;
  householdId: string;
  membershipId: string;
  membershipRole: 'primary' | 'member';
};

export type PadiemOperator = Actor & {
  operatorGrantId: string;
  requestedScope: string;
  grantedScope: string;
};

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

function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}

function validComplexSlug(value: string): boolean {
  return value.length >= 1 && value.length <= 120 && /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function validOperatorScope(value: string): boolean {
  return value.length >= 1 && value.length <= 120 && /^[a-z0-9][a-z0-9.*:_-]*$/.test(value);
}

async function recordOperatorDecision(
  sql: Sql,
  actor: Actor,
  requestId: string,
  requestedScope: string,
  decision: 'allowed' | 'denied',
  reasonCode: string,
  grantedScope: string | null
): Promise<void> {
  const metadata = JSON.stringify(grantedScope ? { grantedScope } : {});
  await sql`
    insert into audit_events (
      request_id,
      actor_user_id,
      actor_kind,
      action,
      scope,
      decision,
      reason_code,
      metadata
    ) values (
      ${requestId},
      ${actor.id},
      'operator',
      'authorization.check',
      ${requestedScope},
      ${decision},
      ${reasonCode},
      ${metadata}::jsonb
    )
  `;
}

export async function requireVerifiedResident(
  request: Request,
  env: AuthEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string
): Promise<VerifiedResident | Response> {
  if (!validComplexSlug(complexSlug)) {
    return fail('COMPLEX_INVALID', 'Invalid apartment complex', 400, requestId);
  }

  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  try {
    const rows = await sql`
      select
        hm.id as membership_id,
        hm.membership_role,
        h.id as household_id,
        c.id as complex_id,
        c.slug as complex_slug
      from household_memberships hm
      join households h
        on h.id = hm.household_id
       and h.complex_id = hm.complex_id
      join complex_units cu
        on cu.id = h.complex_unit_id
       and cu.complex_id = h.complex_id
      join complexes c
        on c.id = hm.complex_id
      where hm.user_id = ${actor.id}
        and hm.status = 'verified'
        and h.status = 'active'
        and cu.status = 'active'
        and c.status <> 'inactive'
        and c.slug = ${complexSlug}
      limit 1
    `;

    const row = rows[0];
    if (!row) {
      return fail('RESIDENT_VERIFICATION_REQUIRED', 'Verified resident access required', 403, requestId);
    }

    const membershipRole = String(row.membership_role);
    if (membershipRole !== 'primary' && membershipRole !== 'member') {
      return fail('RESIDENT_AUTHZ_INVALID', 'Resident authorization state is invalid', 500, requestId);
    }

    return {
      ...actor,
      complexId: String(row.complex_id),
      complexSlug: String(row.complex_slug),
      householdId: String(row.household_id),
      membershipId: String(row.membership_id),
      membershipRole
    };
  } catch (error) {
    console.error('[DanjiOn Resident AuthZ]', requestId, error instanceof Error ? error.name : 'resident_authz_failed');
    return fail('RESIDENT_AUTHZ_FAILED', 'Resident authorization could not be verified', 500, requestId);
  }
}

export async function requirePadiemOperator(
  request: Request,
  env: AuthEnv,
  sql: Sql,
  requestId: string,
  scope: string
): Promise<PadiemOperator | Response> {
  if (!validOperatorScope(scope)) {
    return fail('OPERATOR_SCOPE_INVALID', 'Invalid operator scope', 400, requestId);
  }

  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  try {
    const rows = await sql`
      select id, scope
      from padiem_operator_grants
      where user_id = ${actor.id}
        and status = 'active'
        and (expires_at is null or expires_at > now())
        and (scope = ${scope} or scope = '*')
      order by case when scope = ${scope} then 0 else 1 end, granted_at desc
      limit 1
    `;

    const row = rows[0];
    if (!row) {
      await recordOperatorDecision(sql, actor, requestId, scope, 'denied', 'OPERATOR_SCOPE_MISSING', null);
      return fail('OPERATOR_FORBIDDEN', 'PADIEM operator authorization required', 403, requestId);
    }

    const grantedScope = String(row.scope);
    await recordOperatorDecision(sql, actor, requestId, scope, 'allowed', 'OPERATOR_SCOPE_GRANTED', grantedScope);

    return {
      ...actor,
      operatorGrantId: String(row.id),
      requestedScope: scope,
      grantedScope
    };
  } catch (error) {
    console.error('[DanjiOn Operator AuthZ]', requestId, error instanceof Error ? error.name : 'operator_authz_failed');
    return fail('OPERATOR_AUTHZ_FAILED', 'Operator authorization could not be verified and audited', 500, requestId);
  }
}
