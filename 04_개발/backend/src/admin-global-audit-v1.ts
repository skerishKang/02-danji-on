import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { CoreEnv } from './core-v1';
import {
  requirePadiemPrivilegedScope,
  type PadiemPrivilegedActor
} from './padiem-authority-v1';

type Sql = NeonQueryFunction<false, false>;

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const AUDIT_PATH = '/api/v1/admin/audit-events';
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;
const DECISIONS = new Set(['allowed', 'denied', 'recorded']);

function ok(data: unknown, requestId: string): Response {
  return Response.json(
    { data, requestId },
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

function clampLimit(value: string | null): number {
  const parsed = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIMIT);
}

function normalizedDecision(value: string | null): string | null | undefined {
  const decision = String(value ?? '').trim();
  if (!decision) return null;
  return DECISIONS.has(decision) ? decision : undefined;
}

function normalizedBefore(value: string | null): string | null | undefined {
  const before = String(value ?? '').trim();
  if (!before) return null;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(before)) return undefined;
  const parsed = Date.parse(before);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

async function requireSuper(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<PadiemPrivilegedActor | Response> {
  return requirePadiemPrivilegedScope(request, env, sql, requestId, 'platform.audit.read');
}

/**
 * #615: privacy-bounded global audit summary for SUPER administrators.
 *
 * Deliberately omitted from SELECT/response:
 * - actor_user_id
 * - complex_id
 * - resource_id
 * - request_id
 * - metadata
 *
 * The audit table itself is purpose-minimized by migration 011, but this
 * endpoint additionally prevents the admin UI from becoming a generic
 * identifier/metadata inspection surface while #59 remains on HOLD.
 */
export async function globalAuditResponse(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response> {
  const actor = await requireSuper(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  const url = new URL(request.url);
  const decision = normalizedDecision(url.searchParams.get('decision'));
  const before = normalizedBefore(url.searchParams.get('before'));
  if (decision === undefined) {
    return fail('VALIDATION_ERROR', 'decision must be allowed, denied, or recorded', 400, requestId);
  }
  if (before === undefined) {
    return fail('VALIDATION_ERROR', 'before must be an ISO timestamp', 400, requestId);
  }
  const limit = clampLimit(url.searchParams.get('limit'));

  try {
    const rows = await sql`
      select
        e.id,
        e.actor_kind,
        e.action,
        e.scope,
        e.resource_type,
        e.decision,
        e.reason_code,
        e.created_at
      from audit_events e
      where (${decision}::text is null or e.decision = ${decision})
        and (${before}::timestamptz is null or e.created_at < ${before}::timestamptz)
      order by e.created_at desc, e.id desc
      limit ${limit}
    `;

    return ok(rows.map((row) => ({
      id: String(row.id),
      actorKind: String(row.actor_kind),
      action: String(row.action),
      scope: row.scope ? String(row.scope) : null,
      resourceType: row.resource_type ? String(row.resource_type) : null,
      decision: row.decision ? String(row.decision) : null,
      reasonCode: row.reason_code ? String(row.reason_code) : null,
      createdAt: row.created_at ? String(row.created_at) : null
    })), requestId);
  } catch {
    return fail('AUDIT_READ_FAILED', 'Audit records could not be loaded', 503, requestId);
  }
}

export async function handleAdminGlobalAuditRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.pathname !== AUDIT_PATH) return null;
  if (!env.DATABASE_URL) {
    return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
  }

  const sql: Sql = neon(env.DATABASE_URL);
  return globalAuditResponse(request, env, sql, requestId);
}
