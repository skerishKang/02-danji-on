import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { CoreEnv } from './core-v1';
import { requireOperationalAuthority } from './operational-authz-v2';
import { generateHouseholdCode, householdCodeVerifier } from './household-code-crypto';

type Sql = NeonQueryFunction<false, false>;

export type AdminHouseholdCodeEnv = CoreEnv & {
  HOUSEHOLD_CODE_PEPPER?: string;
};

const MAX_BODY_BYTES = 4 * 1024;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNIT_PART = /^[0-9A-Za-z가-힣-]{1,20}$/;
const PADIEM_SCOPE = 'resident.verification.manage';
const COUNCIL_SCOPE = 'council.resident.verification.manage';

function json(data: unknown, status: number, requestId: string): Response {
  return Response.json(data, { status, headers: {
    'x-danjion-request-id': requestId,
    'cache-control': 'no-store'
  }});
}
function ok(data: unknown, requestId: string, status = 200): Response {
  return json({ data, requestId }, status, requestId);
}
function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}
function sqlFor(env: AdminHouseholdCodeEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}
async function bodyJson(request: Request, requestId: string): Promise<Record<string, unknown> | Response> {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return fail('CONTENT_TYPE_REQUIRED', 'application/json required', 415, requestId);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  }
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fail('INVALID_JSON', 'JSON object required', 400, requestId);
    }
    return parsed as Record<string, unknown>;
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
}
function unitPart(value: unknown): string | null {
  const out = typeof value === 'string' ? value.trim() : '';
  return UNIT_PART.test(out) ? out : null;
}
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && String((error as { code?: unknown }).code || '') === '23505');
}
async function authorize(request: Request, env: AdminHouseholdCodeEnv, sql: Sql, requestId: string, slug: string) {
  return requireOperationalAuthority(request, env, sql, requestId, slug, PADIEM_SCOPE, COUNCIL_SCOPE);
}

async function listCodes(
  request: Request,
  env: AdminHouseholdCodeEnv,
  sql: Sql,
  requestId: string,
  slug: string
): Promise<Response> {
  const operator = await authorize(request, env, sql, requestId, slug);
  if (operator instanceof Response) return operator;
  const rows = await sql`
    select
      cu.id as unit_id,
      cu.building_code,
      cu.unit_code,
      h.id as household_id,
      coalesce(vc.status, 'none') as code_status,
      vc.generation,
      coalesce(vc.use_count, 0)::int as use_count,
      vc.last_used_at,
      coalesce(m.verified_member_count, 0)::int as verified_member_count
    from complex_units cu
    left join households h
      on h.complex_unit_id = cu.id
      and h.complex_id = cu.complex_id
      and h.status = 'active'
    left join lateral (
      select c.status, c.generation, c.use_count, c.last_used_at
      from household_verification_codes c
      where c.household_id = h.id
        and c.complex_id = cu.complex_id
        and c.status = 'active'
      order by c.generation desc
      limit 1
    ) vc on true
    left join lateral (
      select count(*) as verified_member_count
      from household_memberships hm
      where hm.household_id = h.id
        and hm.complex_id = cu.complex_id
        and hm.status = 'verified'
    ) m on true
    where cu.complex_id = ${operator.complexId}::uuid
      and cu.status = 'active'
    order by
      case when cu.building_code ~ '^[0-9]+$' then cu.building_code::int else null end nulls last,
      cu.building_code asc,
      case when cu.unit_code ~ '^[0-9]+$' then cu.unit_code::int else null end nulls last,
      cu.unit_code asc
  `;
  return ok({
    households: rows.map((row) => ({
      unitId: String(row.unit_id),
      householdId: row.household_id ? String(row.household_id) : null,
      buildingCode: String(row.building_code),
      unitCode: String(row.unit_code),
      codeStatus: String(row.code_status),
      generation: row.generation === null || row.generation === undefined ? null : Number(row.generation),
      useCount: Number(row.use_count || 0),
      lastUsedAt: row.last_used_at ?? null,
      verifiedMemberCount: Number(row.verified_member_count || 0)
    }))
  }, requestId);
}

async function provisionOnce(
  sql: Sql,
  operator: { id: string; complexId: string },
  requestId: string,
  buildingCode: string,
  unitCode: string,
  codeVerifier: string
) {
  const rows = await sql`
    with unit_row as (
      insert into complex_units (complex_id, building_code, unit_code, status)
      values (${operator.complexId}::uuid, ${buildingCode}, ${unitCode}, 'active')
      on conflict (complex_id, building_code, unit_code)
      do update set status = 'active', updated_at = now()
      returning id, complex_id, building_code, unit_code
    ), household_row as (
      insert into households (complex_id, complex_unit_id, status)
      select unit_row.complex_id, unit_row.id, 'active'
      from unit_row
      on conflict (complex_unit_id)
      do update set status = 'active', updated_at = now()
      returning id, complex_id, complex_unit_id
    ), revoked as (
      update household_verification_codes vc
      set status = 'revoked', revoked_at = now()
      from household_row h
      where vc.household_id = h.id
        and vc.complex_id = h.complex_id
        and vc.status = 'active'
      returning vc.id, vc.generation
    ), inserted as (
      insert into household_verification_codes (
        complex_id, household_id, code_verifier, status, generation,
        use_count, created_by_user_id, rotated_at
      )
      select
        h.complex_id,
        h.id,
        ${codeVerifier},
        'active',
        coalesce((
          select max(existing.generation) + 1
          from household_verification_codes existing
          where existing.household_id = h.id
        ), 1),
        0,
        ${operator.id}::uuid,
        case when exists (select 1 from revoked) then now() else null end
      from household_row h
      returning id, complex_id, household_id, generation, created_at, rotated_at
    ), audited as (
      insert into household_verification_code_events (
        complex_id, household_id, actor_user_id, action, request_id
      )
      select inserted.complex_id, inserted.household_id, ${operator.id}::uuid, 'rotate', ${requestId}
      from inserted
      returning id
    )
    select
      inserted.household_id,
      inserted.generation,
      inserted.created_at,
      inserted.rotated_at,
      unit_row.building_code,
      unit_row.unit_code
    from inserted
    cross join unit_row
    where exists (select 1 from audited)
  `;
  return rows[0];
}

async function provisionCode(
  request: Request,
  env: AdminHouseholdCodeEnv,
  sql: Sql,
  requestId: string,
  slug: string
): Promise<Response> {
  const operator = await authorize(request, env, sql, requestId, slug);
  if (operator instanceof Response) return operator;
  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  if (Object.keys(payload).some((key) => !['buildingCode', 'unitCode'].includes(key))) {
    return fail('VALIDATION_ERROR', 'Only buildingCode and unitCode are accepted', 400, requestId);
  }
  const buildingCode = unitPart(payload.buildingCode);
  const unitCode = unitPart(payload.unitCode);
  if (!buildingCode || !unitCode) {
    return fail('VALIDATION_ERROR', 'Valid buildingCode and unitCode are required', 400, requestId);
  }
  const pepper = String(env.HOUSEHOLD_CODE_PEPPER || '');
  if (pepper.length < 32) {
    return fail('RESIDENT_VERIFICATION_UNAVAILABLE', 'Resident verification is temporarily unavailable', 503, requestId);
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = generateHouseholdCode(8);
    const verifier = await householdCodeVerifier(code, pepper);
    try {
      const row = await provisionOnce(sql, operator, requestId, buildingCode, unitCode, verifier);
      if (!row) return fail('HOUSEHOLD_CODE_PROVISION_FAILED', 'Household code could not be provisioned', 503, requestId);
      return ok({
        householdId: String(row.household_id),
        buildingCode: String(row.building_code),
        unitCode: String(row.unit_code),
        generation: Number(row.generation),
        code,
        codeDisplay: code.slice(0, 4) + '-' + code.slice(4),
        status: 'active',
        createdAt: row.created_at,
        rotatedAt: row.rotated_at ?? null,
        oneTimeDisplay: true
      }, requestId, 201);
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 3) continue;
      throw error;
    }
  }
  return fail('HOUSEHOLD_CODE_PROVISION_FAILED', 'Household code could not be provisioned', 503, requestId);
}

async function revokeCode(
  request: Request,
  env: AdminHouseholdCodeEnv,
  sql: Sql,
  requestId: string,
  slug: string,
  householdId: string
): Promise<Response> {
  const operator = await authorize(request, env, sql, requestId, slug);
  if (operator instanceof Response) return operator;
  if (!UUID.test(householdId)) return fail('VALIDATION_ERROR', 'Invalid household id', 400, requestId);

  const rows = await sql`
    with target as (
      select h.id, h.complex_id, cu.building_code, cu.unit_code
      from households h
      join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
      where h.id = ${householdId}::uuid
        and h.complex_id = ${operator.complexId}::uuid
        and h.status = 'active'
      limit 1
    ), revoked as (
      update household_verification_codes vc
      set status = 'revoked', revoked_at = now()
      from target
      where vc.household_id = target.id
        and vc.complex_id = target.complex_id
        and vc.status = 'active'
      returning vc.id, vc.household_id, vc.complex_id
    ), audited as (
      insert into household_verification_code_events (
        complex_id, household_id, actor_user_id, action, request_id
      )
      select revoked.complex_id, revoked.household_id, ${operator.id}::uuid, 'revoke', ${requestId}
      from revoked
      returning id
    )
    select
      target.id as household_id,
      target.building_code,
      target.unit_code,
      exists(select 1 from revoked) as revoked
    from target
  `;
  const row = rows[0];
  if (!row) return fail('NOT_FOUND', 'Household not found', 404, requestId);
  return ok({
    householdId: String(row.household_id),
    buildingCode: String(row.building_code),
    unitCode: String(row.unit_code),
    status: 'revoked',
    alreadyRevoked: !Boolean(row.revoked)
  }, requestId);
}

export async function handleAdminHouseholdCodeWithSql(
  request: Request,
  env: AdminHouseholdCodeEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  let match = path.match(/^\/api\/v1\/admin\/complexes\/([^/]+)\/resident-verification\/household-codes$/);
  if (match) {
    const slug = decodeURIComponent(match[1]).trim();
    if (!SLUG.test(slug)) return fail('VALIDATION_ERROR', 'Invalid complex', 400, requestId);
    if (request.method === 'GET') return listCodes(request, env, sql, requestId, slug);
    if (request.method === 'POST') return provisionCode(request, env, sql, requestId, slug);
    return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
  }

  match = path.match(/^\/api\/v1\/admin\/complexes\/([^/]+)\/resident-verification\/household-codes\/([0-9a-fA-F-]+)$/);
  if (match) {
    const slug = decodeURIComponent(match[1]).trim();
    if (!SLUG.test(slug)) return fail('VALIDATION_ERROR', 'Invalid complex', 400, requestId);
    if (request.method !== 'DELETE') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return revokeCode(request, env, sql, requestId, slug, match[2]);
  }
  return null;
}

export async function handleAdminHouseholdCodeRequest(
  request: Request,
  env: AdminHouseholdCodeEnv,
  requestId: string
): Promise<Response | null> {
  if (!new URL(request.url).pathname.includes('/resident-verification/household-codes')) return null;
  return handleAdminHouseholdCodeWithSql(request, env, sqlFor(env), requestId);
}
