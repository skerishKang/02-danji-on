import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type Actor } from './auth-v1';
import type { CoreEnv } from './core-v1';
import { padiemAuthorityResponseData, type PadiemAuthority } from './padiem-authority-v1';
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

// Postgres SQLSTATE `division_by_zero`. The transactional authority assertion in
// `bootstrapAdminAuthorityResponse` raises it deliberately as its abort signal,
// which lets the handler keep the pre-existing failed-readback contract (audit
// reason + 503 error code) even though the decision is now made inside the
// database instead of by a post-commit read.
const AUTHORITY_ASSERTION_ABORT_SQLSTATE = '22012';

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

    const rawPrincipal = rows[0] as Record<string, unknown> | undefined;
    if (!rawPrincipal) {
      await auditBootstrap(sql, actor, requestId, 'denied', 'ADMIN_BOOTSTRAP_NOT_ALLOWLISTED', {
        provider: 'unknown'
      });
      return fail('ADMIN_BOOTSTRAP_NOT_ALLOWED', 'Pre-registered administrator identity required', 403, requestId);
    }

    const principal = normalizedPrincipal(rawPrincipal);
    if (!principal) {
      await auditBootstrap(sql, actor, requestId, 'denied', 'ADMIN_BOOTSTRAP_PRINCIPAL_INVALID', {
        provider: typeof rawPrincipal.provider === 'string' ? rawPrincipal.provider : 'unknown'
      });
      return fail('ADMIN_BOOTSTRAP_PRINCIPAL_INVALID', 'Administrator registration is invalid', 503, requestId);
    }

    const grantMetadata = JSON.stringify({
      source: 'admin_identity_allowlist',
      principalId: principal.id,
      provider: principal.provider
    });

    const runtimeScopes = runtimeScopesForRole(principal.authorityLevel);

    // #1046: grant establishment must be atomic across every runtime scope.
    //
    // Granting scope-by-scope let each INSERT commit independently, so a failure
    // part-way through could leave bootstrap reporting 503 while earlier grants
    // — including the SUPER wildcard — stayed active. Collecting the whole
    // write set and committing it with one `sql.transaction` (the pattern already
    // used by resident-profile-v1) means either every expected grant is
    // established or none of this attempt survives.
    //
    // `on conflict do nothing` is preserved per statement, so re-bootstrapping a
    // principal that already holds grants still creates no duplicates and never
    // rewrites, widens, narrows or revokes an existing grant.
    const grantWrites = runtimeScopes.map((scope) => sql`
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
    `);

    // #1046: the whole success unit must be one commit. Granting, proving the
    // authority and recording ADMIN_BOOTSTRAP_GRANTED are a single commit unit,
    // so a failure in any one of them leaves no grant behind:
    //
    //   * a mid-loop insert failure rolls back the entire write set
    //   * a failed authority readback aborts the transaction itself, so the
    //     grants staged in it never commit
    //   * a failed ADMIN_BOOTSTRAP_GRANTED insert rolls the grants back too,
    //     instead of leaving committed authority with no success audit
    //
    // The readback is expressed as a SQL assertion rather than an application
    // level check, because a query inside a non-interactive transaction cannot
    // branch: only the database can decide to abort. An application level DELETE
    // was deliberately avoided, because a compensating delete can itself fail
    // and would recreate exactly the partial state this transaction prevents.
    const expectedWildcard = principal.authorityLevel === 'admin';
    const grantedMetadata = JSON.stringify({
      principalId: principal.id,
      authorityLevel: principal.authorityLevel,
      scopeCount: runtimeScopes.length
    });

    let authorityRows: Array<{ active_scopes: string[] | null }> | undefined;
    try {
      const transactionResults = await sql.transaction([
        ...grantWrites,
        // Transactional authority assertion, and the authority readback.
        //
        // The assertion semantics are the pre-existing bootstrap readback
        // contract, not a new policy:
        //   * every expected runtime scope is present, active and unexpired
        //   * wildcard presence matches the role (SUPER yes, OPERATIONAL no)
        // An unrelated pre-existing bounded grant is neither rejected nor
        // removed: the expected-scope count is taken over the runtime scopes
        // only, while wildcard parity is judged over all active grants, exactly
        // as `resolvePadiemAuthority` judged it before.
        //
        // The same statement also returns `active_scopes`, the full
        // active/unexpired scope set, so the response can report the real
        // authority without a second query after the commit. That is why the
        // statement is an aggregate over one row: the authority it reports and
        // the assertion it enforces are read from the same consistent snapshot.
        //
        // The abort signal is a genuine runtime `division by zero` (SQLSTATE
        // 22012) and not a constant `else 1 / 0`, which a planner could fold at
        // plan time. The divisor is a CASE over the live aggregate result, so
        // Postgres can only raise when the established authority really fails
        // the expectation.
        //
        // `nullif(x, 0)` must not be used here: dividing by NULL yields NULL
        // instead of an error, so that shape never aborts and the assertion
        // would silently become a no-op.
        sql`
          select
            1 / case when expected_present and wildcard_parity then 1 else 0 end
              as authority_established,
            active_scopes
          from (
            select
              count(distinct scope) filter (
                where scope = any(${runtimeScopes}::text[])
              ) = ${runtimeScopes.length}::int as expected_present,
              coalesce(bool_or(scope = '*'), false) = ${expectedWildcard} as wildcard_parity,
              coalesce(
                array_agg(scope order by scope),
                array[]::text[]
              ) as active_scopes
            from padiem_operator_grants
            where user_id = ${actor.id}::uuid
              and status = 'active'
              and (expires_at is null or expires_at > now())
          ) active_grants
        `,
        sql`
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
            'allowed',
            'ADMIN_BOOTSTRAP_GRANTED',
            ${grantedMetadata}::jsonb
          )
        `
      ]);

      // #1046: the authority the transaction actually established is taken from
      // the assertion statement's own result, inside the same transaction. The
      // commit unit is deliberately never followed by a second query: a
      // post-commit read could fail on its own and turn an already committed
      // bootstrap into a 503 while the grants stayed committed.
      //
      // `transaction()` returns one result per statement, in order, so the
      // assertion sits at `runtimeScopes.length`, immediately after the grants.
      authorityRows = transactionResults[runtimeScopes.length] as unknown as
        Array<{ active_scopes: string[] | null }>;
    } catch (error) {
      // The assertion aborted the transaction. Report the pre-existing
      // failed-readback contract rather than a generic database error, because
      // the observable outcome is the same one the old post-commit readback
      // produced: authority could not be established and nothing was committed.
      if ((error as { code?: unknown } | null)?.code === AUTHORITY_ASSERTION_ABORT_SQLSTATE) {
        await auditBootstrap(sql, actor, requestId, 'denied', 'ADMIN_BOOTSTRAP_GRANT_READBACK_FAILED', {
          principalId: principal.id,
          authorityLevel: principal.authorityLevel,
          scopeCount: runtimeScopes.length
        });
        return fail('ADMIN_BOOTSTRAP_GRANT_FAILED', 'Administrator authority could not be established', 503, requestId);
      }
      throw error;
    }

    // #1046: the response reports the authority the database actually holds, read
    // from the commit unit's own result rather than from a second query.
    //
    // Reporting `[...runtimeScopes]` here would be narrower than the truth: a
    // principal that already holds an unrelated active bounded grant from another
    // grant path really does have that authority, and the pre-existing
    // `resolvePadiemAuthority` response reported it. `active_scopes` carries
    // exactly that set — every active, unexpired grant for this actor — so the
    // authority API keeps saying everything it used to say.
    //
    // The `level` / `wildcard` derivation is identical to `resolvePadiemAuthority`,
    // and the ordering is normalised to the canonical codepoint order the policy
    // module uses, so the response is deterministic regardless of DB collation.
    // `active_scopes` is read exactly like `admin-principals-v1` reads its
    // `array_agg` column: a `text[]` column arrives as a JS array.
    const actualScopes = Array.from(
      new Set((authorityRows?.[0]?.active_scopes ?? []).map((scope) => String(scope)))
    ).sort();
    const wildcard = actualScopes.includes('*');

    const establishedAuthority: PadiemAuthority = {
      level: wildcard ? 'admin' : actualScopes.length > 0 ? 'operator' : 'none',
      scopes: actualScopes,
      wildcard
    };

    return ok(padiemAuthorityResponseData(establishedAuthority), requestId);
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
