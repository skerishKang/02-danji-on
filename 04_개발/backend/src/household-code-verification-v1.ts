import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type AuthEnv } from './auth-v1';

type Sql = NeonQueryFunction<false, false>;

export type HouseholdCodeEnv = AuthEnv & {
  HOUSEHOLD_CODE_PEPPER?: string;
};

const MAX_BODY_BYTES = 1024;
const CODE = /^[A-Z0-9]{6,12}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

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
function sqlFor(env: HouseholdCodeEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}
function normalizeCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase().replace(/[\s-]+/g, '') : '';
}
async function parseBody(request: Request, requestId: string): Promise<string | Response> {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return fail('CONTENT_TYPE_REQUIRED', 'application/json required', 415, requestId);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  }
  let value: unknown;
  try { value = JSON.parse(raw || '{}'); } catch { return fail('INVALID_JSON', 'Invalid JSON', 400, requestId); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_JSON', 'JSON object required', 400, requestId);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'code')) return fail('VALIDATION_ERROR', 'Only code is accepted', 400, requestId);
  const code = normalizeCode(record.code);
  if (!CODE.test(code)) return fail('RESIDENT_CODE_INVALID', 'The resident verification code is invalid or unavailable', 409, requestId);
  return code;
}
async function verifier(code: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function auditFailure(sql: Sql, actorId: string, complexId: string | null, requestId: string): Promise<void> {
  await sql`
    insert into household_verification_code_events (complex_id, actor_user_id, action, request_id)
    values (${complexId}::uuid, ${actorId}::uuid, 'verify_failed', ${requestId})
  `;
}

export async function handleHouseholdCodeVerificationWithSql(
  request: Request,
  env: HouseholdCodeEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(/^\/api\/v1\/complexes\/([^/]+)\/resident-verification\/code$/);
  if (!match) return null;
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);

  const complexSlug = decodeURIComponent(match[1]).trim();
  if (!SLUG.test(complexSlug)) return fail('VALIDATION_ERROR', 'Invalid complex', 400, requestId);
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;
  const code = await parseBody(request, requestId);
  if (code instanceof Response) return code;

  const pepper = String(env.HOUSEHOLD_CODE_PEPPER || '');
  if (pepper.length < 32) return fail('RESIDENT_VERIFICATION_UNAVAILABLE', 'Resident verification is temporarily unavailable', 503, requestId);

  const complexes = await sql`select id from complexes where slug = ${complexSlug} and status in ('active','pilot') limit 1`;
  if (!complexes[0]) return fail('NOT_FOUND', 'Complex not found', 404, requestId);
  const complexId = String(complexes[0].id);

  const existing = await sql`
    select hm.status, hm.household_id, cu.building_code, cu.unit_code
    from household_memberships hm
    join households h on h.id = hm.household_id and h.complex_id = hm.complex_id
    join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
    where hm.user_id = ${actor.id}::uuid
      and hm.complex_id = ${complexId}::uuid
      and hm.status in ('pending','verified')
    limit 1
  `;
  if (existing[0]) {
    if (String(existing[0].status) === 'verified') {
      return ok({
        status: 'verified',
        householdLinked: true,
        household: { buildingCode: String(existing[0].building_code), unitCode: String(existing[0].unit_code) },
        alreadyVerified: true
      }, requestId);
    }
    return fail('HOUSEHOLD_MEMBERSHIP_EXISTS', 'An active household membership already exists', 409, requestId);
  }

  const codeVerifier = await verifier(code, pepper);
  const results = await sql.transaction([
    sql`
      with target as (
        select vc.id, vc.household_id, vc.complex_id
        from household_verification_codes vc
        join households h on h.id = vc.household_id and h.complex_id = vc.complex_id
        join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
        where vc.code_verifier = ${codeVerifier}
          and vc.complex_id = ${complexId}::uuid
          and vc.status = 'active'
          and h.status = 'active'
          and cu.status = 'active'
        limit 1
        for update of vc
      ), inserted as (
        insert into household_memberships (complex_id, household_id, user_id, membership_role, status, verified_at)
        select target.complex_id, target.household_id, ${actor.id}::uuid, 'member', 'verified', now()
        from target
        where not exists (
          select 1 from household_memberships hm
          where hm.user_id = ${actor.id}::uuid
            and hm.complex_id = target.complex_id
            and hm.status in ('pending','verified')
        )
        on conflict do nothing
        returning id, complex_id, household_id
      ), used as (
        update household_verification_codes vc
        set use_count = vc.use_count + 1, last_used_at = now()
        from target, inserted
        where vc.id = target.id
        returning vc.id
      ), audited as (
        insert into household_verification_code_events (
          complex_id, household_id, actor_user_id, action, request_id
        )
        select inserted.complex_id, inserted.household_id, ${actor.id}::uuid, 'verify_success', ${requestId}
        from inserted
        where exists (select 1 from used)
        returning id
      )
      select inserted.household_id
      from inserted
      where exists (select 1 from used) and exists (select 1 from audited)
    `,
    sql`select 1 as transaction_boundary`
  ]);

  const inserted = (results[0] as Record<string, unknown>[])[0];
  if (!inserted) {
    await auditFailure(sql, actor.id, complexId, requestId);
    return fail('RESIDENT_CODE_INVALID', 'The resident verification code is invalid or unavailable', 409, requestId);
  }

  const household = await sql`
    select cu.building_code, cu.unit_code
    from households h
    join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
    where h.id = ${String(inserted.household_id)}::uuid
      and h.complex_id = ${complexId}::uuid
    limit 1
  `;
  if (!household[0]) return fail('RESIDENT_VERIFICATION_UNAVAILABLE', 'Resident verification state could not be read back', 500, requestId);

  return ok({
    status: 'verified',
    householdLinked: true,
    household: { buildingCode: String(household[0].building_code), unitCode: String(household[0].unit_code) },
    alreadyVerified: false
  }, requestId, 201);
}

export async function handleHouseholdCodeVerificationRequest(
  request: Request,
  env: HouseholdCodeEnv,
  requestId: string
): Promise<Response | null> {
  if (!/^\/api\/v1\/complexes\/[^/]+\/resident-verification\/code$/.test(new URL(request.url).pathname)) return null;
  return handleHouseholdCodeVerificationWithSql(request, env, sqlFor(env), requestId);
}
