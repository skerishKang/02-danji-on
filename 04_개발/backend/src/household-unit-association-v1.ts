import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type AuthEnv } from './auth-v1';

type Sql = NeonQueryFunction<false, false>;
export type HouseholdUnitAssociationEnv = AuthEnv;

const MAX_BODY_BYTES = 4 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const AUTO_CONNECT_MEMBER_LIMIT = 2;

function json(data: unknown, status: number, requestId: string): Response {
  return Response.json(data, {
    status,
    headers: {
      'x-danjion-request-id': requestId,
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

function sqlFor(env: HouseholdUnitAssociationEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

async function bodyJson(request: Request, requestId: string): Promise<{ unitId: string } | Response> {
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
  if (Object.keys(record).some((key) => key !== 'unitId')) {
    return fail('VALIDATION_ERROR', 'Only unitId is accepted', 400, requestId);
  }
  const unitId = typeof record.unitId === 'string' ? record.unitId.trim().toLowerCase() : '';
  if (!UUID.test(unitId)) return fail('VALIDATION_ERROR', 'Valid unitId is required', 400, requestId);
  return { unitId };
}

async function audit(
  sql: Sql,
  requestId: string,
  actorId: string,
  complexId: string,
  unitId: string,
  decision: 'recorded' | 'denied',
  reasonCode: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await sql`
    insert into audit_events (
      request_id, actor_user_id, actor_kind, complex_id, action, scope,
      resource_type, resource_id, decision, reason_code, metadata
    ) values (
      ${requestId}, ${actorId}::uuid, 'user', ${complexId}::uuid,
      'household.unit.associate', 'resident.onboarding', 'complex_unit', ${unitId},
      ${decision}, ${reasonCode}, ${JSON.stringify(metadata)}::jsonb
    )
  `;
}

export async function handleHouseholdUnitAssociationWithSql(
  request: Request,
  env: HouseholdUnitAssociationEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(/^\/api\/v1\/complexes\/([^/]+)\/household\/associate$/);
  if (!match) return null;
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);

  const complexSlug = decodeURIComponent(match[1]).trim();
  if (!SLUG.test(complexSlug)) return fail('VALIDATION_ERROR', 'Invalid complex', 400, requestId);

  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;

  const unitRows = await sql`
    select cu.id, cu.complex_id, cu.building_code, cu.unit_code, c.slug
    from complex_units cu
    join complexes c on c.id = cu.complex_id
    where cu.id = ${payload.unitId}::uuid
      and c.slug = ${complexSlug}
      and c.status in ('active','pilot')
      and cu.status = 'active'
    limit 1
  `;
  const unit = unitRows[0];
  if (!unit) return fail('HOUSEHOLD_UNIT_NOT_FOUND', 'Selected household unit is unavailable', 404, requestId);
  const complexId = String(unit.complex_id);

  const existingRows = await sql`
    select hm.id, hm.membership_role, hm.status, h.complex_unit_id, cu.building_code, cu.unit_code
    from household_memberships hm
    join households h on h.id = hm.household_id and h.complex_id = hm.complex_id
    join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
    where hm.user_id = ${actor.id}::uuid
      and hm.complex_id = ${complexId}::uuid
      and hm.status in ('pending','verified')
    limit 1
  `;
  const existing = existingRows[0];
  if (existing) {
    if (String(existing.complex_unit_id) !== payload.unitId) {
      await audit(sql, requestId, actor.id, complexId, payload.unitId, 'denied', 'HOUSEHOLD_ASSOCIATION_CONFLICT');
      return fail('HOUSEHOLD_ASSOCIATION_CONFLICT', 'This account is already linked to a different household', 409, requestId);
    }
    const status = String(existing.status);
    return ok({
      status,
      membershipRole: String(existing.membership_role),
      unitId: payload.unitId,
      buildingCode: String(existing.building_code),
      unitCode: String(existing.unit_code),
      autoConnected: status === 'verified',
      reviewRequired: status === 'pending',
      alreadyAssociated: true
    }, requestId);
  }

  const householdRows = await sql`
    insert into households (complex_id, complex_unit_id, status)
    values (${complexId}::uuid, ${payload.unitId}::uuid, 'active')
    on conflict (complex_unit_id)
    do update set status = 'active', updated_at = now()
    returning id, complex_id
  `;
  const household = householdRows[0];
  if (!household) return fail('HOUSEHOLD_ASSOCIATION_UNAVAILABLE', 'Household could not be resolved', 503, requestId);
  const householdId = String(household.id);

  const memberRows = await sql`
    select count(*)::int as member_count,
           count(*) filter (where membership_role = 'primary')::int as primary_count
    from household_memberships
    where household_id = ${householdId}::uuid
      and complex_id = ${complexId}::uuid
      and status in ('pending','verified')
  `;
  const currentMemberCount = Number(memberRows[0]?.member_count || 0);
  const primaryCount = Number(memberRows[0]?.primary_count || 0);
  const memberPosition = currentMemberCount + 1;
  const autoConnected = memberPosition <= AUTO_CONNECT_MEMBER_LIMIT;
  const status = autoConnected ? 'verified' : 'pending';
  const role = primaryCount === 0 ? 'primary' : 'member';

  const insertedRows = await sql`
    insert into household_memberships (
      complex_id, household_id, user_id, membership_role, status, verified_at
    ) values (
      ${complexId}::uuid,
      ${householdId}::uuid,
      ${actor.id}::uuid,
      ${role},
      ${status},
      ${autoConnected ? new Date().toISOString() : null}::timestamptz
    )
    on conflict (complex_id, user_id) do nothing
    returning id, membership_role, status
  `;
  const inserted = insertedRows[0];
  if (!inserted) {
    return fail('HOUSEHOLD_ASSOCIATION_CONFLICT', 'Household association changed while the request was being processed', 409, requestId);
  }

  await audit(
    sql,
    requestId,
    actor.id,
    complexId,
    payload.unitId,
    'recorded',
    autoConnected ? 'HOUSEHOLD_AUTO_CONNECTED' : 'HOUSEHOLD_REVIEW_REQUIRED',
    { memberPosition, autoConnected }
  );

  return ok({
    status,
    membershipRole: role,
    unitId: payload.unitId,
    buildingCode: String(unit.building_code),
    unitCode: String(unit.unit_code),
    autoConnected,
    reviewRequired: !autoConnected,
    memberPosition,
    alreadyAssociated: false
  }, requestId, 201);
}

export async function handleHouseholdUnitAssociationRequest(
  request: Request,
  env: HouseholdUnitAssociationEnv,
  requestId: string
): Promise<Response | null> {
  if (!/^\/api\/v1\/complexes\/[^/]+\/household\/associate$/.test(new URL(request.url).pathname)) return null;
  return handleHouseholdUnitAssociationWithSql(request, env, sqlFor(env), requestId);
}
