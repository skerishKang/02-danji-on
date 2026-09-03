import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { createDanjionAuth, isKoreanMobile, normalizeKoreanPhone, type BetterAuthEnv } from './auth-better-v1';

type Sql = NeonQueryFunction<false, false>;

export type VerifiedSignupEnv = BetterAuthEnv;

const MAX_BODY_BYTES = 16 * 1024;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_REF = /^[A-Za-z0-9._:-]{1,128}$/;

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

async function bodyJson(request: Request, requestId: string): Promise<Record<string, unknown> | Response> {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return fail('INVALID_CONTENT_TYPE', 'JSON request required', 415, requestId);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fail('INVALID_JSON', 'JSON object required', 400, requestId);
    }
    return parsed as Record<string, unknown>;
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
}

function requiredString(body: Record<string, unknown>, key: string, max: number): string | null {
  const value = body[key];
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function normalizeEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 320 && EMAIL.test(normalized) ? normalized : null;
}

function originMatchesRule(origin: string, rule: string): boolean {
  if (origin === rule) return true;
  const marker = '://*.';
  const markerIndex = rule.indexOf(marker);
  if (markerIndex < 1) return false;
  const protocol = rule.slice(0, markerIndex);
  const hostnameSuffix = rule.slice(markerIndex + marker.length);
  if (!hostnameSuffix || hostnameSuffix.includes('/') || hostnameSuffix.includes(':')) return false;
  try {
    const candidate = new URL(origin);
    return candidate.protocol === `${protocol}:`
      && !candidate.port
      && candidate.hostname.endsWith(`.${hostnameSuffix}`);
  } catch {
    return false;
  }
}

function trustedFrontendOrigin(request: Request, env: VerifiedSignupEnv): string | null {
  const rules = (env.AUTH_TRUSTED_ORIGINS?.trim() || env.CORS_ALLOWED_ORIGINS?.trim() || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const incoming = request.headers.get('origin')?.trim();
  if (incoming && rules.some((rule) => originMatchesRule(incoming, rule))) return incoming;

  for (const rule of rules) {
    if (rule.includes('*')) continue;
    try {
      const parsed = new URL(rule);
      if (parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return parsed.origin;
      }
    } catch {
      // Ignore malformed configured origins; Better Auth will separately reject them.
    }
  }
  return null;
}

function sqlFor(env: VerifiedSignupEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

type ConsumedReceipt = {
  receiptId: string;
  signupSessionRef: string;
};

async function consumeVerifiedReceipt(
  sql: Sql,
  receiptId: string,
  signupSessionRef: string,
  email: string,
  phone: string
): Promise<ConsumedReceipt | null> {
  const rows = await sql`
    update signup_contact_receipts r
    set consumed_at = now()
    from signup_contact_sessions s, signup_contact_challenges c
    where r.receipt_id = ${receiptId}
      and r.signup_session_ref = ${signupSessionRef}
      and r.consumed_at is null
      and s.signup_session_ref = r.signup_session_ref
      and s.email_normalized = ${email}
      and s.phone_normalized = ${phone}
      and s.email_contact_ref = r.email_contact_ref
      and s.phone_contact_ref = r.phone_contact_ref
      and s.phone_verified_at is not null
      and c.challenge_id = r.challenge_id
      and c.signup_session_ref = r.signup_session_ref
      and c.state = 'verified'
    returning r.receipt_id, r.signup_session_ref
  `;
  const row = rows[0];
  return row ? {
    receiptId: String(row.receipt_id),
    signupSessionRef: String(row.signup_session_ref)
  } : null;
}

async function authUserByEmail(sql: Sql, email: string): Promise<{ id: string; username: string | null } | null> {
  const rows = await sql`
    select id, username
    from danjion_auth."user"
    where email = ${email}
    limit 1
  `;
  const row = rows[0];
  return row ? {
    id: String(row.id),
    username: row.username == null ? null : String(row.username)
  } : null;
}

async function linkReceiptToAuthUser(sql: Sql, receiptId: string, authUserId: string): Promise<void> {
  await sql`
    update signup_contact_receipts
    set auth_user_id = ${authUserId}
    where receipt_id = ${receiptId}
      and consumed_at is not null
      and auth_user_id is null
  `;
}

async function completeSignup(
  request: Request,
  env: VerifiedSignupEnv,
  requestId: string
): Promise<Response> {
  const body = await bodyJson(request, requestId);
  if (body instanceof Response) return body;

  const rawEmail = requiredString(body, 'email', 320);
  const rawPhone = requiredString(body, 'phone', 40);
  const name = requiredString(body, 'name', 80);
  const password = requiredString(body, 'password', 128);
  const signupSessionRef = requiredString(body, 'signupSessionRef', 128);
  const verificationReceiptRef = requiredString(body, 'verificationReceiptRef', 128);
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  const phone = rawPhone ? normalizeKoreanPhone(rawPhone) : '';

  if (
    !email || !isKoreanMobile(phone) || !name || !password || password.length < 8
    || !signupSessionRef || !SAFE_REF.test(signupSessionRef)
    || !verificationReceiptRef || !SAFE_REF.test(verificationReceiptRef)
  ) {
    return fail('VALIDATION_ERROR', '가입 정보를 확인해 주세요.', 400, requestId);
  }

  const frontendOrigin = trustedFrontendOrigin(request, env);
  if (!frontendOrigin) {
    return fail('SIGNUP_ORIGIN_NOT_ALLOWED', '가입 요청 출처를 확인할 수 없습니다.', 403, requestId);
  }

  const sql = sqlFor(env);
  const consumed = await consumeVerifiedReceipt(
    sql,
    verificationReceiptRef,
    signupSessionRef,
    email,
    phone
  );
  if (!consumed) {
    return fail('VERIFICATION_REQUIRED', '휴대폰 인증을 다시 완료해 주세요.', 409, requestId);
  }

  const callbackURL = new URL('/auth-recovery.html?mode=verified', frontendOrigin).toString();
  const auth = createDanjionAuth(env);
  const headers = new Headers(request.headers);
  headers.delete('authorization');

  let signupError: unknown = null;
  try {
    await auth.api.signUpEmail({
      body: {
        email,
        name,
        password,
        username: phone,
        callbackURL
      },
      headers
    });
  } catch (error) {
    signupError = error;
  }

  // Better Auth intentionally returns a synthetic success for duplicate email
  // when verification is required. Therefore the product boundary never trusts
  // the API response as proof of a new account. It independently checks the
  // persisted auth row and links only an exact email+phone identity.
  const persistedUser = await authUserByEmail(sql, email);
  if (persistedUser?.username === phone) {
    await linkReceiptToAuthUser(sql, consumed.receiptId, persistedUser.id);
    return ok({
      accepted: true,
      emailVerificationRequired: true,
      phoneVerified: true,
      identityAssurance: 'contact_possession_only',
      legalIdentityVerified: false,
      residentVerified: false
    }, requestId, 201);
  }

  if (signupError) {
    console.error('[DanjiOn Verified Signup]', requestId, 'better_auth_signup_failed');
    return fail(
      'ACCOUNT_CREATION_FAILED',
      '계정 가입을 완료하지 못했습니다. 휴대폰 인증부터 다시 진행해 주세요.',
      409,
      requestId
    );
  }

  // Preserve Better Auth email-enumeration behavior: a duplicate email with a
  // different existing phone must not be distinguishable from a generic signup
  // acceptance response. No resident/legal-identity authority is granted.
  return ok({
    accepted: true,
    emailVerificationRequired: true,
    phoneVerified: true,
    identityAssurance: 'contact_possession_only',
    legalIdentityVerified: false,
    residentVerified: false
  }, requestId, 201);
}

/**
 * Final direct account signup boundary. The exact one-time phone verification
 * receipt is consumed before Better Auth is allowed to create an email/password
 * account. Social OAuth remains a separate onboarding path and is not handled
 * here.
 */
export async function handleVerifiedSignupRequest(
  request: Request,
  env: VerifiedSignupEnv,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  if (new URL(request.url).pathname !== '/auth/signup') return null;
  return completeSignup(request, env, requestId);
}
