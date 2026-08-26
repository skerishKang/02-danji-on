import type { NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type Actor, type AuthEnv } from './auth-v1';

type Sql = NeonQueryFunction<false, false>;

export type OperationalAuthorityKind = 'padiem' | 'resident_council';

export type OperationalAuthority = Actor & {
  complexId: string;
  complexSlug: string;
  authorityKind: OperationalAuthorityKind;
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

function validScope(value: string): boolean {
  return value.length >= 1 && value.length <= 120 && /^[a-z0-9][a-z0-9.*:_-]*$/.test(value);
}

async function auditOperationalDecision(
  sql: Sql,
  actor: Actor,
  requestId: string,
  complexId: string | null,
  requestedScope: string,
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
      'operator',
      ${complexId},
      'authorization.operational-check',
      ${requestedScope},
      ${decision},
      ${reasonCode},
      ${JSON.stringify(metadata)}::jsonb
    )
  `;
}

/**
 * Authorizes one day-to-day DanjiOn operation against the product-owner governance model:
 * PADIEM platform operator OR explicitly granted resident-council operator for this complex.
 *
 * Management-office/onboarding-support grants are deliberately excluded from this helper.
 * Legacy apartment manager/admin membership state is never consulted.
 */
export async function requireOperationalAuthority(
  request: Request,
  env: AuthEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string,
  padiemScope: string,
  councilScope: string
): Promise<OperationalAuthority | Response> {
  if (!validComplexSlug(complexSlug)) {
    return fail('COMPLEX_INVALID', 'Invalid apartment complex', 400, requestId);
  }
  if (!validScope(padiemScope) || !validScope(councilScope) || !councilScope.startsWith('council.')) {
    return fail('OPERATIONAL_SCOPE_INVALID', 'Invalid operational scope', 400, requestId);
  }

  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  try {
    const rows = await sql`
      select
        c.id as complex_id,
        c.slug as complex_slug,
        pg.grant_id as padiem_grant_id,
        pg.scope as padiem_granted_scope,
        cg.grant_id as council_grant_id,
        cg.scope as council_granted_scope
      from complexes c
      left join lateral (
        select g.id as grant_id, g.scope
        from padiem_operator_grants g
        where g.user_id = ${actor.id}
          and g.status = 'active'
          and (g.expires_at is null or g.expires_at > now())
          and (g.scope = ${padiemScope} or g.scope = '*')
        order by case when g.scope = ${padiemScope} then 0 else 1 end, g.granted_at desc
        limit 1
      ) pg on true
      left join lateral (
        select g.id as grant_id, g.scope
        from complex_operator_grants g
        where g.complex_id = c.id
          and g.user_id = ${actor.id}
          and g.operator_kind = 'resident_council'
          and g.status = 'active'
          and (g.expires_at is null or g.expires_at > now())
          and g.scope = ${councilScope}
        order by g.granted_at desc
        limit 1
      ) cg on true
      where c.slug = ${complexSlug}
        and c.status <> 'inactive'
      limit 1
    `;

    const row = rows[0];
    if (!row) {
      await auditOperationalDecision(
        sql,
        actor,
        requestId,
        null,
        padiemScope,
        'denied',
        'OPERATIONAL_COMPLEX_NOT_FOUND',
        { padiemScope, councilScope }
      );
      return fail('COMPLEX_NOT_FOUND', 'Apartment complex not found', 404, requestId);
    }

    const complexId = String(row.complex_id);
    const resolvedSlug = String(row.complex_slug);

    if (row.padiem_grant_id) {
      const grantedScope = String(row.padiem_granted_scope);
      await auditOperationalDecision(
        sql,
        actor,
        requestId,
        complexId,
        padiemScope,
        'allowed',
        'PADIEM_OPERATIONAL_SCOPE_GRANTED',
        { authorityKind: 'padiem', grantedScope, padiemScope, councilScope }
      );
      return {
        ...actor,
        complexId,
        complexSlug: resolvedSlug,
        authorityKind: 'padiem',
        operatorGrantId: String(row.padiem_grant_id),
        requestedScope: padiemScope,
        grantedScope
      };
    }

    if (row.council_grant_id) {
      const grantedScope = String(row.council_granted_scope);
      await auditOperationalDecision(
        sql,
        actor,
        requestId,
        complexId,
        councilScope,
        'allowed',
        'COUNCIL_OPERATIONAL_SCOPE_GRANTED',
        { authorityKind: 'resident_council', grantedScope, padiemScope, councilScope }
      );
      return {
        ...actor,
        complexId,
        complexSlug: resolvedSlug,
        authorityKind: 'resident_council',
        operatorGrantId: String(row.council_grant_id),
        requestedScope: councilScope,
        grantedScope
      };
    }

    await auditOperationalDecision(
      sql,
      actor,
      requestId,
      complexId,
      padiemScope,
      'denied',
      'OPERATIONAL_SCOPE_MISSING',
      { padiemScope, councilScope }
    );
    return fail('OPERATIONAL_FORBIDDEN', 'PADIEM or resident-council authorization required', 403, requestId);
  } catch (error) {
    console.error('[DanjiOn Operational AuthZ]', requestId, error instanceof Error ? error.name : 'operational_authz_failed');
    return fail('OPERATIONAL_AUTHZ_FAILED', 'Operational authorization could not be verified and audited', 500, requestId);
  }
}
