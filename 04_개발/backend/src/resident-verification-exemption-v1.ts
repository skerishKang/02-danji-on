import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import type { CoreEnv } from './core-v1';
import { resolvePadiemAuthority } from './padiem-authority-v1';
import { resolveOrdinaryTestResidentExemption } from './resident-verification-ordinary-exemption-v1';
import {
  hasVerifiedResidentMembership,
  isTemporaryResidentAccessEnabled
} from './temporary-resident-access-v1';

type Sql = NeonQueryFunction<false, false>;

const REQUEST_ID_HEADER = 'x-danjion-request-id';
export const RESIDENT_VERIFICATION_EXEMPTION_PATH = '/api/v1/me/resident-verification-exemption';
export const RESIDENT_VERIFICATION_EXEMPT_SCOPE = 'resident.verification.exempt';

/**
 * `exempt` keeps its original boolean shape. The additive `temporary` key is
 * emitted ONLY for a temporary-mode admission (#868), so:
 *   - `{ exempt: true }`                 — canonical admin/operator exemption
 *   - `{ exempt: true, temporary: true }` — #868 temporary resident access
 *   - `{ exempt: false }`                 — ordinary resident, no exemption
 * An absent `temporary` key therefore always means "not temporary", and no
 * existing consumer of the `exempt` boolean changes behaviour.
 */
function ok(exempt: boolean, requestId: string, temporary = false): Response {
  return Response.json(
    { data: temporary ? { exempt, temporary: true } : { exempt }, requestId },
    {
      status: 200,
      headers: {
        [REQUEST_ID_HEADER]: requestId,
        'access-control-expose-headers': REQUEST_ID_HEADER,
        'cache-control': 'no-store'
      }
    }
  );
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

/**
 * Self-only, read-only resident-verification exemption probe (#656).
 *
 * This endpoint intentionally does NOT use the audited administrator-authority
 * decision path. My Info needs one boolean for the signed-in actor; it does not
 * need the actor's administrator tier or scope list. Ordinary residents therefore
 * receive { exempt:false } without creating an audit_events row from routine page
 * navigation.
 *
 * Exemption remains fail-closed and server-derived: wildcard '*' alone is never
 * sufficient. Only the actor's exact active resident.verification.exempt grant
 * returns true.
 *
 * #868 adds one more, strictly bounded source: while
 * TEMP_RESIDENT_ACCESS_MODE is exactly 'true', a SIGNED-IN actor without a real
 * verified membership is reported as `{ exempt: true, temporary: true }`. That
 * answer exists so the UI can say "temporary resident access" instead of the
 * operator copy — it is not a claim of completed resident verification, and it
 * carries no authority and no household. An already-verified resident keeps
 * `{ exempt: false }` because no exemption is needed for a real membership.
 */
export async function resolveResidentVerificationExemptionResponse(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response> {
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  try {
    const authority = await resolvePadiemAuthority(sql, actor.id);
    if (authority.scopes.includes(RESIDENT_VERIFICATION_EXEMPT_SCOPE)) {
      return ok(true, requestId);
    }
    // #823: the ordinary test-resident allowlist is a fallback of the same
    // exact-scope decision, never a new authority source.
    if (await resolveOrdinaryTestResidentExemption(sql, actor)) {
      return ok(true, requestId);
    }
    // #868: temporary access describes an ORDINARY member, so a principal that
    // already holds PADIEM authority is never reported as temporary. Its canonical
    // exemption is the explicit `resident.verification.exempt` scope answered
    // above, and the wildcard '*' alone never exempts (the admin authority helper
    // enforces the same rule), so a wildcard/bounded principal without that scope
    // resolves to "not exempt" - exactly the answer it received before the
    // temporary switch existed.
    if (authority.level !== 'none') {
      return ok(false, requestId);
    }
    // #868: the temporary switch is consulted strictly LAST, after both canonical
    // exemption sources, and only while it is explicitly enabled. When it is off
    // this function behaves exactly as before.
    if (!isTemporaryResidentAccessEnabled(env)) {
      return ok(false, requestId);
    }
    // A real verified resident needs no exemption at all: keep the ordinary
    // answer so an already-verified account is never labelled temporary.
    if (await hasVerifiedResidentMembership(sql, actor.id)) {
      return ok(false, requestId);
    }
    return ok(true, requestId, true);
  } catch {
    return fail(
      'RESIDENT_VERIFICATION_EXEMPTION_DB_ERROR',
      'Resident-verification exemption could not be verified',
      503,
      requestId
    );
  }
}

export async function handleResidentVerificationExemptionRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  if (new URL(request.url).pathname !== RESIDENT_VERIFICATION_EXEMPTION_PATH) return null;
  if (!env.DATABASE_URL) {
    return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
  }

  const sql: Sql = neon(env.DATABASE_URL);
  return resolveResidentVerificationExemptionResponse(request, env, sql, requestId);
}
