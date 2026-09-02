import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireVerifiedResident } from './authorization-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;
const MAX_BODY_BYTES = 4 * 1024;

type ConsentPreference = {
  enabled: boolean | null;
  policyVersion: string | null;
  recordedAt: unknown | null;
};

function ok(data: unknown, requestId: string): Response {
  return Response.json({ data, requestId }, {
    status: 200,
    headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' }
  });
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return Response.json({ error: { code, message }, requestId }, {
    status,
    headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' }
  });
}

function sqlFor(env: CoreEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

async function readBody(request: Request, requestId: string): Promise<Record<string, unknown> | Response> {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return fail('CONTENT_TYPE_REQUIRED', 'application/json required', 415, requestId);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  }
  try {
    const parsed = JSON.parse(text || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fail('INVALID_JSON', 'JSON object required', 400, requestId);
    }
    return parsed as Record<string, unknown>;
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
}

function consentPreference(row: Record<string, unknown> | undefined): ConsentPreference {
  if (!row) return { enabled: null, policyVersion: null, recordedAt: null };
  return {
    enabled: String(row.status) === 'accepted',
    policyVersion: String(row.policy_version),
    recordedAt: row.recorded_at ?? null
  };
}

async function loadSettings(sql: Sql, userId: string): Promise<Record<string, unknown>> {
  const profileRows = await sql`
    select coalesce(is_discoverable, true) as is_discoverable
    from resident_public_profiles
    where user_id = ${userId}::uuid
    limit 1
  `;
  const consentRows = await sql`
    select distinct on (consent_type)
      consent_type, policy_version, status, recorded_at
    from consent_records
    where user_id = ${userId}::uuid
      and complex_id is null
      and consent_type in ('service_notifications','benefit_marketing')
    order by consent_type, recorded_at desc, event_seq desc
  `;
  const serviceRow = consentRows.find((row) => String(row.consent_type) === 'service_notifications') as Record<string, unknown> | undefined;
  const benefitRow = consentRows.find((row) => String(row.consent_type) === 'benefit_marketing') as Record<string, unknown> | undefined;
  return {
    publicProfileEnabled: profileRows[0] ? profileRows[0].is_discoverable === true : true,
    serviceNotifications: consentPreference(serviceRow),
    benefitMarketing: consentPreference(benefitRow),
    fontSizeStorage: 'device'
  };
}

async function updateSettings(
  request: Request,
  sql: Sql,
  userId: string,
  requestId: string
): Promise<Response> {
  const body = await readBody(request, requestId);
  if (body instanceof Response) return body;
  const allowed = new Set(['publicProfileEnabled']);
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys.some((key) => !allowed.has(key))) {
    return fail(
      'VALIDATION_ERROR',
      'Only publicProfileEnabled may be patched here; notification consent changes must use /api/v1/me/consents',
      400,
      requestId
    );
  }
  if (typeof body.publicProfileEnabled !== 'boolean') {
    return fail('VALIDATION_ERROR', 'publicProfileEnabled must be boolean', 400, requestId);
  }

  await sql`
    insert into resident_public_profiles (user_id, is_discoverable)
    values (${userId}::uuid, ${body.publicProfileEnabled})
    on conflict (user_id) do update
      set is_discoverable = excluded.is_discoverable
  `;
  return ok(await loadSettings(sql, userId), requestId);
}

export async function handleResidentSettingsWithSql(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/v1/me/settings') return null;
  const complexSlug = url.searchParams.get('complexSlug')?.trim() || '';
  if (!complexSlug) return fail('VALIDATION_ERROR', 'complexSlug is required', 400, requestId);
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;

  if (request.method === 'GET') return ok(await loadSettings(sql, resident.id), requestId);
  if (request.method === 'PATCH') return updateSettings(request, sql, resident.id, requestId);
  return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
}

export async function handleResidentSettingsRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/v1/me/settings') return null;
  return handleResidentSettingsWithSql(request, env, sqlFor(env), requestId);
}
