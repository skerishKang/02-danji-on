import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

type Sql = NeonQueryFunction<false, false>;
type SessionUser = { id: string; email: string };
type SessionResolver = (request: Request) => Promise<{ user?: SessionUser | null } | null>;

export interface SocialOnboardingEnv { DATABASE_URL: string; }

const MAX_BODY_BYTES = 16 * 1024;
const SAFE_REF = /^[A-Za-z0-9._:-]{1,128}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data: unknown, status: number, requestId: string): Response {
  return Response.json(data, { status, headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' } });
}
function ok(data: unknown, requestId: string): Response { return json({ data, requestId }, 200, requestId); }
function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}
function sqlFor(env: SocialOnboardingEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}
function normalizeEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 320 && EMAIL.test(normalized) ? normalized : null;
}
async function bodyJson(request: Request, requestId: string): Promise<Record<string, unknown> | Response> {
  if (!(request.headers.get('content-type') || '').includes('application/json')) return fail('INVALID_CONTENT_TYPE', 'JSON request required', 415, requestId);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('INVALID_JSON', 'JSON object required', 400, requestId);
    return parsed as Record<string, unknown>;
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
}
function requiredRef(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && SAFE_REF.test(value) ? value : null;
}

async function onboardingComplete(sql: Sql, authUserId: string): Promise<boolean> {
  const rows = await sql`
    select (
      exists(
        select 1 from app_users
        where auth_user_id = ${authUserId} and account_status = 'active'
      )
      or exists(
        select 1 from signup_contact_receipts
        where auth_user_id = ${authUserId} and consumed_at is not null
      )
    ) as complete
  `;
  return rows[0]?.complete === true;
}

async function status(request: Request, env: SocialOnboardingEnv, requestId: string, resolveSession: SessionResolver): Promise<Response> {
  const session = await resolveSession(request);
  if (!session?.user?.id) return fail('AUTH_REQUIRED', 'Authentication required', 401, requestId);
  const complete = await onboardingComplete(sqlFor(env), session.user.id);
  return ok({
    authenticated: true,
    email: session.user.email,
    accountOnboarding: complete ? 'complete' : 'phone_required',
    phoneVerified: complete,
    residentVerified: false
  }, requestId);
}

async function complete(request: Request, env: SocialOnboardingEnv, requestId: string, resolveSession: SessionResolver): Promise<Response> {
  const session = await resolveSession(request);
  const authUserId = session?.user?.id?.trim();
  const email = normalizeEmail(session?.user?.email || '');
  if (!authUserId || !email) return fail('AUTH_REQUIRED', 'Authentication required', 401, requestId);

  const body = await bodyJson(request, requestId);
  if (body instanceof Response) return body;
  const signupSessionRef = requiredRef(body, 'signupSessionRef');
  const verificationReceiptRef = requiredRef(body, 'verificationReceiptRef');
  if (!signupSessionRef || !verificationReceiptRef) return fail('INVALID_REQUEST', 'Verification receipt is required', 400, requestId);

  const sql = sqlFor(env);
  if (await onboardingComplete(sql, authUserId)) {
    return ok({ accepted: true, accountOnboarding: 'complete', phoneVerified: true, identityAssurance: 'contact_possession_only', legalIdentityVerified: false, residentVerified: false }, requestId);
  }

  const rows = await sql`
    update signup_contact_receipts r
    set consumed_at = now(), auth_user_id = ${authUserId}
    from signup_contact_sessions s, signup_contact_challenges c
    where r.receipt_id = ${verificationReceiptRef}
      and r.signup_session_ref = ${signupSessionRef}
      and r.consumed_at is null
      and r.auth_user_id is null
      and s.signup_session_ref = r.signup_session_ref
      and s.email_normalized = ${email}
      and s.phone_verified_at is not null
      and s.email_contact_ref = r.email_contact_ref
      and s.phone_contact_ref = r.phone_contact_ref
      and c.challenge_id = r.challenge_id
      and c.signup_session_ref = r.signup_session_ref
      and c.state = 'verified'
    returning r.receipt_id
  `;
  if (!rows[0]) return fail('VERIFICATION_REQUIRED', 'Verified phone contact must match the authenticated social account email.', 409, requestId);

  return ok({ accepted: true, accountOnboarding: 'complete', phoneVerified: true, identityAssurance: 'contact_possession_only', legalIdentityVerified: false, residentVerified: false }, requestId);
}

/** Better Auth login/session may exist before DanjiOn product onboarding completes. */
export async function handleSocialOnboardingRequest(
  request: Request,
  env: SocialOnboardingEnv,
  requestId: string,
  resolveSession: SessionResolver
): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (path === '/auth/social-onboarding/status' && request.method === 'GET') return status(request, env, requestId, resolveSession);
  if (path === '/auth/social-onboarding/complete' && request.method === 'POST') return complete(request, env, requestId, resolveSession);
  return null;
}
