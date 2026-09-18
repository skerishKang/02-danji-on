import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type Actor } from './auth-v1';
import type { CoreEnv } from './core-v1';
import { recordAuthorityDecision, resolvePadiemAuthority } from './padiem-authority-v1';

type Sql = NeonQueryFunction<false, false>;
type TargetType = 'unit' | 'units' | 'building' | 'all';
type UnitTarget = { buildingCode: string; unitCode: string };
type TargetRow = UnitTarget & {
  householdCount: number;
  recipientAccountCount: number;
};

const SCOPE = 'household.message.manage';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_SELECTED_UNITS = 100;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const UNIT_PART = /^[0-9A-Za-z가-힣-]{1,20}$/;

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

function ok(data: unknown, requestId: string): Response {
  return json({ data, requestId }, 200, requestId);
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}

function sqlFor(env: CoreEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

function unitPart(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return UNIT_PART.test(text) ? text : null;
}

async function requirePadiemHouseholdMessageAuthority(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Actor | Response> {
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  try {
    const authority = await resolvePadiemAuthority(sql, actor.id);
    const grantedScope = authority.wildcard ? '*' : authority.scopes.includes(SCOPE) ? SCOPE : null;
    if (!grantedScope) {
      await recordAuthorityDecision(sql, actor, requestId, SCOPE, 'denied', 'HOUSEHOLD_MESSAGE_SCOPE_MISSING', null);
      return fail('HOUSEHOLD_MESSAGE_FORBIDDEN', 'PADIEM household message authority required', 403, requestId);
    }
    await recordAuthorityDecision(
      sql,
      actor,
      requestId,
      SCOPE,
      'allowed',
      authority.wildcard ? 'HOUSEHOLD_MESSAGE_WILDCARD_GRANTED' : 'HOUSEHOLD_MESSAGE_SCOPE_GRANTED',
      grantedScope
    );
    return actor;
  } catch {
    await recordAuthorityDecision(
      sql,
      actor,
      requestId,
      SCOPE,
      'denied',
      'HOUSEHOLD_MESSAGE_AUTHORITY_DB_ERROR',
      null
    ).catch(() => {});
    return fail('HOUSEHOLD_MESSAGE_AUTHORITY_UNAVAILABLE', 'Household message authority could not be verified', 503, requestId);
  }
}

async function targetRows(sql: Sql, complexSlug: string): Promise<TargetRow[]> {
  const rows = await sql`
    select
      cu.building_code,
      cu.unit_code,
      count(distinct h.id)::int as household_count,
      count(distinct hm.user_id) filter (where hm.status = 'verified')::int as recipient_account_count
    from complex_units cu
    join complexes c on c.id = cu.complex_id
    left join households h
      on h.complex_unit_id = cu.id
      and h.complex_id = cu.complex_id
      and h.status = 'active'
    left join household_memberships hm
      on hm.household_id = h.id
      and hm.complex_id = h.complex_id
      and hm.status = 'verified'
    where c.slug = ${complexSlug}
      and c.status <> 'inactive'
      and cu.status = 'active'
    group by cu.id, cu.building_code, cu.unit_code
    order by
      case when cu.building_code ~ '^[0-9]+$' then cu.building_code::numeric else null end nulls last,
      cu.building_code asc,
      case when cu.unit_code ~ '^[0-9]+$' then cu.unit_code::numeric else null end nulls last,
      cu.unit_code asc
  `;

  return rows.map((row) => ({
    buildingCode: String(row.building_code),
    unitCode: String(row.unit_code),
    householdCount: Number(row.household_count || 0),
    recipientAccountCount: Number(row.recipient_account_count || 0)
  }));
}

function assertUnambiguous(rows: TargetRow[], requestId: string): Response | null {
  if (rows.some((row) => row.householdCount > 1)) {
    return fail(
      'HOUSEHOLD_MAPPING_AMBIGUOUS',
      'Household mapping is ambiguous; messaging target resolution failed closed',
      409,
      requestId
    );
  }
  return null;
}

async function listTargets(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string
): Promise<Response> {
  const actor = await requirePadiemHouseholdMessageAuthority(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  try {
    const rows = await targetRows(sql, complexSlug);
    const ambiguous = assertUnambiguous(rows, requestId);
    if (ambiguous) return ambiguous;

    return ok({
      units: rows.map((row) => ({
        buildingCode: row.buildingCode,
        unitCode: row.unitCode
      })),
      deliveryChannel: 'in_app',
      sendEnabled: false
    }, requestId);
  } catch {
    return fail('HOUSEHOLD_MESSAGE_TARGETS_UNAVAILABLE', 'Household message targets could not be loaded', 503, requestId);
  }
}

async function previewBody(
  request: Request,
  requestId: string
): Promise<{ targetType: TargetType; buildingCode: string | null; units: UnitTarget[] } | Response> {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return fail('CONTENT_TYPE_REQUIRED', 'application/json required', 415, requestId);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('INVALID_JSON', 'JSON object required', 400, requestId);
  }

  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['targetType', 'buildingCode', 'units'].includes(key))) {
    return fail('VALIDATION_ERROR', 'Only targetType, buildingCode and units are accepted', 400, requestId);
  }

  const targetType = String(record.targetType || '').trim() as TargetType;
  if (!['unit', 'units', 'building', 'all'].includes(targetType)) {
    return fail('VALIDATION_ERROR', 'targetType must be unit, units, building or all', 400, requestId);
  }

  const buildingCode = record.buildingCode === undefined || record.buildingCode === null
    ? null
    : unitPart(record.buildingCode);
  const rawUnits = record.units === undefined ? [] : record.units;
  if (!Array.isArray(rawUnits)) return fail('VALIDATION_ERROR', 'units must be an array', 400, requestId);

  const units: UnitTarget[] = [];
  const seen = new Set<string>();
  for (const candidate of rawUnits) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return fail('VALIDATION_ERROR', 'Each unit target must be an object', 400, requestId);
    }
    const item = candidate as Record<string, unknown>;
    if (Object.keys(item).some((key) => !['buildingCode', 'unitCode'].includes(key))) {
      return fail('VALIDATION_ERROR', 'Unit targets accept only buildingCode and unitCode', 400, requestId);
    }
    const building = unitPart(item.buildingCode);
    const unit = unitPart(item.unitCode);
    if (!building || !unit) return fail('VALIDATION_ERROR', 'Invalid buildingCode or unitCode', 400, requestId);
    const key = `${building}\u0000${unit}`;
    if (!seen.has(key)) {
      seen.add(key);
      units.push({ buildingCode: building, unitCode: unit });
    }
  }

  if (units.length > MAX_SELECTED_UNITS) {
    return fail('VALIDATION_ERROR', 'Too many selected units', 400, requestId);
  }
  if (targetType === 'unit' && units.length !== 1) {
    return fail('VALIDATION_ERROR', 'unit target requires exactly one unit', 400, requestId);
  }
  if (targetType === 'units' && units.length < 1) {
    return fail('VALIDATION_ERROR', 'units target requires at least one unit', 400, requestId);
  }
  if ((targetType === 'building' && !buildingCode) || (targetType !== 'building' && buildingCode !== null)) {
    return fail('VALIDATION_ERROR', 'buildingCode is accepted only for building targets', 400, requestId);
  }
  if ((targetType === 'building' || targetType === 'all') && units.length !== 0) {
    return fail('VALIDATION_ERROR', 'units are accepted only for unit or units targets', 400, requestId);
  }

  return { targetType, buildingCode, units };
}

async function previewTargets(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string
): Promise<Response> {
  const actor = await requirePadiemHouseholdMessageAuthority(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  const payload = await previewBody(request, requestId);
  if (payload instanceof Response) return payload;

  try {
    const rows = await targetRows(sql, complexSlug);
    const ambiguous = assertUnambiguous(rows, requestId);
    if (ambiguous) return ambiguous;

    let selected: TargetRow[] = [];
    if (payload.targetType === 'all') {
      selected = rows;
    } else if (payload.targetType === 'building') {
      selected = rows.filter((row) => row.buildingCode === payload.buildingCode);
    } else {
      const requested = new Set(payload.units.map((unit) => `${unit.buildingCode}\u0000${unit.unitCode}`));
      selected = rows.filter((row) => requested.has(`${row.buildingCode}\u0000${row.unitCode}`));
      if (selected.length !== requested.size) {
        return fail('HOUSEHOLD_MESSAGE_TARGET_NOT_FOUND', 'One or more target units do not exist', 404, requestId);
      }
    }

    if (!selected.length) {
      return fail('HOUSEHOLD_MESSAGE_TARGET_NOT_FOUND', 'No target units matched', 404, requestId);
    }

    return ok({
      targetType: payload.targetType,
      targetUnitCount: selected.length,
      recipientAccountCount: selected.reduce((sum, row) => sum + row.recipientAccountCount, 0),
      deliveryChannel: 'in_app',
      sendEnabled: false,
      dispatchStatus: 'disabled_pending_activation'
    }, requestId);
  } catch {
    return fail('HOUSEHOLD_MESSAGE_PREVIEW_UNAVAILABLE', 'Household message preview could not be calculated', 503, requestId);
  }
}

export async function handleAdminHouseholdMessagingWithSql(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const targetsMatch = url.pathname.match(
    /^\/api\/v1\/admin\/complexes\/([^/]+)\/household-messages\/targets$/
  );
  if (targetsMatch) {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    const complexSlug = decodeURIComponent(targetsMatch[1]).trim();
    if (!SLUG.test(complexSlug)) return fail('COMPLEX_INVALID', 'Invalid apartment complex', 400, requestId);
    return listTargets(request, env, sql, requestId, complexSlug);
  }

  const previewMatch = url.pathname.match(
    /^\/api\/v1\/admin\/complexes\/([^/]+)\/household-messages\/preview$/
  );
  if (previewMatch) {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    const complexSlug = decodeURIComponent(previewMatch[1]).trim();
    if (!SLUG.test(complexSlug)) return fail('COMPLEX_INVALID', 'Invalid apartment complex', 400, requestId);
    return previewTargets(request, env, sql, requestId, complexSlug);
  }

  return null;
}

export async function handleAdminHouseholdMessagingRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.includes('/api/v1/admin/') || !path.includes('/household-messages/')) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
  return handleAdminHouseholdMessagingWithSql(request, env, sqlFor(env), requestId);
}
