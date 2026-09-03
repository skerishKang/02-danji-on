import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { isKoreanMobile, normalizeKoreanPhone } from './auth-better-v1';
import type { CoreEnv } from './core-v1';
import {
  PadiemContactVerificationError,
  issuePadiemContactChallenge,
  resendPadiemContactChallenge,
  verifyPadiemContactChallenge,
  type PadiemContactVerificationEnv,
  type PadiemPersistedChallenge,
  type PadiemRateSnapshot,
  type PadiemVerificationBinding,
  type PadiemVerificationChannel
} from './padiem-contact-verification-v1';

type Sql = NeonQueryFunction<false, false>;

export interface PadiemContactDelivery {
  deliverOtp(payload: {
    productId: 'danjion';
    signupSessionRef: string;
    challengeId: string;
    phoneContactRef: string;
    channel: PadiemVerificationChannel;
    deliveryCode: string;
    expiresAt: string;
  }): Promise<{ ok: boolean; deliveryRef?: string; errorCode?: string }>;
}

export type SignupContactVerificationEnv = CoreEnv & PadiemContactVerificationEnv & {
  DANJION_CONTACT_REF_SECRET?: string;
  PADIEM_CONTACT_DELIVERY?: PadiemContactDelivery;
};

const MAX_BODY_BYTES = 16 * 1024;
const RATE_WINDOW_SECONDS = 3600;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SESSION_ISSUES = 5;
const MAX_PHONE_ISSUES = 5;
const MAX_NETWORK_ISSUES = 20;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^\d{6}$/;
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

function requiredString(body: Record<string, unknown>, key: string, max = 320): string | null {
  const value = body[key];
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function normalizeEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 320 && EMAIL.test(normalized) ? normalized : null;
}

function secret(env: SignupContactVerificationEnv): string {
  const value = env.DANJION_CONTACT_REF_SECRET?.trim();
  if (!value || value.length < 32) throw new Error('DANJION_CONTACT_REF_SECRET is not configured');
  return value;
}

async function opaqueRef(secretValue: string, namespace: 'email' | 'phone' | 'network', raw: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretValue),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${namespace}\x1f${raw}`));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${namespace}.${hex}`;
}

function networkIdentity(request: Request): string {
  return request.headers.get('cf-connecting-ip')?.trim() || 'unknown-network';
}

function nowIso(): string {
  return new Date().toISOString();
}

function newRef(prefix: string): string {
  return `${prefix}.${crypto.randomUUID()}`;
}

function sqlFor(env: SignupContactVerificationEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

type SessionRow = {
  signupSessionRef: string;
  emailNormalized: string;
  phoneNormalized: string;
  emailContactRef: string;
  phoneContactRef: string;
  networkRef: string;
};

async function createSession(
  sql: Sql,
  email: string,
  phone: string,
  emailContactRef: string,
  phoneContactRef: string,
  networkRef: string
): Promise<SessionRow> {
  const signupSessionRef = newRef('signup');
  await sql`
    insert into signup_contact_sessions (
      signup_session_ref, email_normalized, phone_normalized,
      email_contact_ref, phone_contact_ref, network_ref
    ) values (
      ${signupSessionRef}, ${email}, ${phone},
      ${emailContactRef}, ${phoneContactRef}, ${networkRef}
    )
  `;
  return { signupSessionRef, emailNormalized: email, phoneNormalized: phone, emailContactRef, phoneContactRef, networkRef };
}

async function loadSession(sql: Sql, signupSessionRef: string): Promise<SessionRow | null> {
  const rows = await sql`
    select signup_session_ref, email_normalized, phone_normalized,
           email_contact_ref, phone_contact_ref, network_ref
    from signup_contact_sessions
    where signup_session_ref = ${signupSessionRef}
    limit 1
  `;
  const row = rows[0];
  return row ? {
    signupSessionRef: String(row.signup_session_ref),
    emailNormalized: String(row.email_normalized),
    phoneNormalized: String(row.phone_normalized),
    emailContactRef: String(row.email_contact_ref),
    phoneContactRef: String(row.phone_contact_ref),
    networkRef: String(row.network_ref)
  } : null;
}

type RateRow = { windowStartedAt: string; issues: number; lastIssuedAt: string | null };

async function loadRate(sql: Sql, scopeType: string, scopeRef: string, now: Date): Promise<RateRow> {
  const rows = await sql`
    select window_started_at, issues, last_issued_at
    from signup_contact_rate_budgets
    where scope_type = ${scopeType} and scope_ref = ${scopeRef}
    limit 1
  `;
  const row = rows[0];
  if (!row) return { windowStartedAt: now.toISOString(), issues: 0, lastIssuedAt: null };
  const started = new Date(String(row.window_started_at));
  if (!Number.isFinite(started.getTime()) || now.getTime() - started.getTime() >= RATE_WINDOW_SECONDS * 1000) {
    return { windowStartedAt: now.toISOString(), issues: 0, lastIssuedAt: null };
  }
  return {
    windowStartedAt: started.toISOString(),
    issues: Number(row.issues),
    lastIssuedAt: row.last_issued_at ? new Date(String(row.last_issued_at)).toISOString() : null
  };
}

function latestTimestamp(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  if (!present.length) return null;
  return present.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

async function rateSnapshot(sql: Sql, session: SessionRow, now: Date): Promise<PadiemRateSnapshot> {
  const [sessionRate, phoneRate, networkRate] = await Promise.all([
    loadRate(sql, 'signup_session', session.signupSessionRef, now),
    loadRate(sql, 'phone_contact', session.phoneContactRef, now),
    loadRate(sql, 'network', session.networkRef, now)
  ]);
  // Each product budget is normalized against its own persisted window above.
  // The canonical Padiem core receives those current counts in a fresh common
  // window so it applies its standard count/cooldown policy without owning DB IO.
  return {
    window_started_at: now.toISOString(),
    session_issues: sessionRate.issues,
    phone_issues: phoneRate.issues,
    network_issues: networkRate.issues,
    last_issued_at: latestTimestamp([sessionRate.lastIssuedAt, phoneRate.lastIssuedAt, networkRate.lastIssuedAt])
  };
}

async function reserveBudget(
  sql: Sql,
  scopeType: 'signup_session' | 'phone_contact' | 'network',
  scopeRef: string,
  limit: number,
  now: Date
): Promise<boolean> {
  const rows = await sql`
    insert into signup_contact_rate_budgets (
      scope_type, scope_ref, window_started_at, issues, last_issued_at, updated_at
    ) values (${scopeType}, ${scopeRef}, ${now.toISOString()}, 1, ${now.toISOString()}, now())
    on conflict (scope_type, scope_ref) do update set
      window_started_at = case
        when ${now.toISOString()}::timestamptz - signup_contact_rate_budgets.window_started_at >= interval '1 hour'
          then ${now.toISOString()}::timestamptz
        else signup_contact_rate_budgets.window_started_at
      end,
      issues = case
        when ${now.toISOString()}::timestamptz - signup_contact_rate_budgets.window_started_at >= interval '1 hour'
          then 1
        else signup_contact_rate_budgets.issues + 1
      end,
      last_issued_at = ${now.toISOString()}::timestamptz,
      updated_at = now()
    where
      ${now.toISOString()}::timestamptz - signup_contact_rate_budgets.window_started_at >= interval '1 hour'
      or (
        signup_contact_rate_budgets.issues < ${limit}
        and (
          signup_contact_rate_budgets.last_issued_at is null
          or ${now.toISOString()}::timestamptz >= signup_contact_rate_budgets.last_issued_at + interval '60 seconds'
        )
      )
    returning issues
  `;
  return rows.length === 1;
}

async function reserveAllBudgets(sql: Sql, session: SessionRow, now: Date): Promise<boolean> {
  // Conservative fail-closed reservation: if a later dimension rejects, earlier
  // successful reservations remain counted as attempts. This avoids concurrency
  // races turning failed issuance into extra deliverable OTPs.
  if (!await reserveBudget(sql, 'signup_session', session.signupSessionRef, MAX_SESSION_ISSUES, now)) return false;
  if (!await reserveBudget(sql, 'phone_contact', session.phoneContactRef, MAX_PHONE_ISSUES, now)) return false;
  return reserveBudget(sql, 'network', session.networkRef, MAX_NETWORK_ISSUES, now);
}

function binding(session: SessionRow): PadiemVerificationBinding {
  return {
    product_id: 'danjion',
    signup_session_ref: session.signupSessionRef,
    email_contact_ref: session.emailContactRef,
    phone_contact_ref: session.phoneContactRef,
    network_ref: session.networkRef
  };
}

function challengeFromRow(row: Record<string, unknown>): PadiemPersistedChallenge {
  return {
    challenge_id: String(row.challenge_id),
    binding: {
      product_id: 'danjion',
      signup_session_ref: String(row.signup_session_ref),
      email_contact_ref: String(row.email_contact_ref),
      phone_contact_ref: String(row.phone_contact_ref),
      network_ref: String(row.network_ref)
    },
    channel: String(row.channel) as PadiemVerificationChannel,
    otp_digest: String(row.otp_digest),
    issued_at: new Date(String(row.issued_at)).toISOString(),
    expires_at: new Date(String(row.expires_at)).toISOString(),
    resend_not_before: new Date(String(row.resend_not_before)).toISOString(),
    max_attempts: Number(row.max_attempts),
    attempts_used: Number(row.attempts_used),
    generation: Number(row.generation),
    state: String(row.state) as PadiemPersistedChallenge['state']
  };
}

async function latestChallenge(sql: Sql, signupSessionRef: string): Promise<PadiemPersistedChallenge | null> {
  const rows = await sql`
    select challenge_id, signup_session_ref, email_contact_ref, phone_contact_ref, network_ref,
           channel, otp_digest, issued_at, expires_at, resend_not_before,
           max_attempts, attempts_used, generation, state
    from signup_contact_challenges
    where signup_session_ref = ${signupSessionRef}
    order by generation desc
    limit 1
  `;
  return rows[0] ? challengeFromRow(rows[0] as Record<string, unknown>) : null;
}

async function persistChallenge(sql: Sql, challenge: PadiemPersistedChallenge): Promise<void> {
  await sql`
    insert into signup_contact_challenges (
      challenge_id, signup_session_ref, email_contact_ref, phone_contact_ref, network_ref,
      channel, otp_digest, issued_at, expires_at, resend_not_before,
      attempts_used, max_attempts, generation, state
    ) values (
      ${challenge.challenge_id}, ${challenge.binding.signup_session_ref},
      ${challenge.binding.email_contact_ref}, ${challenge.binding.phone_contact_ref}, ${challenge.binding.network_ref},
      ${challenge.channel}, ${challenge.otp_digest}, ${challenge.issued_at}, ${challenge.expires_at},
      ${challenge.resend_not_before}, ${challenge.attempts_used}, ${challenge.max_attempts},
      ${challenge.generation}, ${challenge.state}
    )
  `;
}

async function persistSuperseded(sql: Sql, challenge: PadiemPersistedChallenge): Promise<void> {
  await sql`
    update signup_contact_challenges
    set state = 'superseded', updated_at = now()
    where challenge_id = ${challenge.challenge_id} and state = 'pending'
  `;
}

function delivery(env: SignupContactVerificationEnv): PadiemContactDelivery {
  if (!env.PADIEM_CONTACT_DELIVERY) {
    throw new Error('PADIEM_CONTACT_DELIVERY service binding is not configured');
  }
  return env.PADIEM_CONTACT_DELIVERY;
}

async function markDeliveryFailed(sql: Sql, challengeId: string): Promise<void> {
  await sql`
    update signup_contact_challenges
    set state = 'superseded', updated_at = now()
    where challenge_id = ${challengeId} and state = 'pending'
  `;
}

function mapRpcError(error: PadiemContactVerificationError, requestId: string): Response {
  if (error.code === 'contact_verification_rate_limited') {
    return fail('TOO_MANY_REQUESTS', '인증번호 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', 429, requestId);
  }
  if (error.code === 'contact_verification_resend_cooldown') {
    return fail('RESEND_TOO_SOON', '인증번호를 다시 요청하기 전에 잠시 기다려 주세요.', 429, requestId);
  }
  if (error.code === 'replayed_contact_verification' || error.code === 'superseded_contact_verification') {
    return fail('VERIFICATION_ALREADY_USED', '이 인증 요청은 더 이상 사용할 수 없습니다.', 409, requestId);
  }
  return fail('VERIFICATION_UNAVAILABLE', '인증을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.', 503, requestId);
}

async function startVerification(
  request: Request,
  env: SignupContactVerificationEnv,
  requestId: string
): Promise<Response> {
  if (!env.PADIEM_CONTACT_VERIFICATION || !env.PADIEM_CONTACT_DELIVERY || !env.DANJION_CONTACT_REF_SECRET) {
    return fail('VERIFICATION_NOT_CONFIGURED', '가입 인증 서비스가 아직 준비되지 않았습니다.', 503, requestId);
  }
  const body = await bodyJson(request, requestId);
  if (body instanceof Response) return body;

  const rawEmail = requiredString(body, 'email');
  const rawPhone = requiredString(body, 'phone', 40);
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  const phone = rawPhone ? normalizeKoreanPhone(rawPhone) : '';
  if (!email || !isKoreanMobile(phone)) {
    return fail('VALIDATION_ERROR', '이메일과 휴대폰 번호를 확인해 주세요.', 400, requestId);
  }

  const refSecret = secret(env);
  const [emailContactRef, phoneContactRef, networkRef] = await Promise.all([
    opaqueRef(refSecret, 'email', email),
    opaqueRef(refSecret, 'phone', phone),
    opaqueRef(refSecret, 'network', networkIdentity(request))
  ]);
  const sql = sqlFor(env);
  const requestedSessionRef = requiredString(body, 'signupSessionRef', 128);
  let session: SessionRow;

  if (requestedSessionRef) {
    if (!SAFE_REF.test(requestedSessionRef)) return fail('VERIFICATION_SESSION_INVALID', '가입 인증 세션이 올바르지 않습니다.', 400, requestId);
    const existing = await loadSession(sql, requestedSessionRef);
    if (!existing || existing.emailContactRef !== emailContactRef || existing.phoneContactRef !== phoneContactRef) {
      return fail('VERIFICATION_SESSION_INVALID', '가입 인증 세션이 올바르지 않습니다.', 400, requestId);
    }
    session = existing;
  } else {
    session = await createSession(sql, email, phone, emailContactRef, phoneContactRef, networkRef);
  }

  const now = new Date();
  const rate = await rateSnapshot(sql, session, now);
  const previous = await latestChallenge(sql, session.signupSessionRef);
  const newChallengeId = newRef('challenge');

  try {
    const issued = previous?.state === 'pending'
      ? await resendPadiemContactChallenge(env, {
          previous_challenge: previous,
          new_challenge_id: newChallengeId,
          now: now.toISOString(),
          rate_snapshot: rate
        })
      : await issuePadiemContactChallenge(env, {
          challenge_id: newChallengeId,
          binding: binding(session),
          channel: 'kakao_simulated',
          now: now.toISOString(),
          rate_snapshot: rate,
          generation: previous ? previous.generation + 1 : 1
        });

    if (!await reserveAllBudgets(sql, session, now)) {
      return fail('TOO_MANY_REQUESTS', '인증번호 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', 429, requestId);
    }

    if ('superseded_challenge' in issued) await persistSuperseded(sql, issued.superseded_challenge);
    await persistChallenge(sql, issued.challenge);

    const delivered = await delivery(env).deliverOtp({
      productId: 'danjion',
      signupSessionRef: session.signupSessionRef,
      challengeId: issued.challenge.challenge_id,
      phoneContactRef: session.phoneContactRef,
      channel: issued.challenge.channel,
      deliveryCode: issued.delivery_code,
      expiresAt: issued.challenge.expires_at
    });

    if (!delivered.ok) {
      await markDeliveryFailed(sql, issued.challenge.challenge_id);
      return fail('VERIFICATION_DELIVERY_UNAVAILABLE', '인증번호를 전송하지 못했습니다. 잠시 후 다시 시도해 주세요.', 503, requestId);
    }

    // Raw delivery_code is intentionally not included in this browser response.
    return ok({
      signupSessionRef: session.signupSessionRef,
      challengeId: issued.challenge.challenge_id,
      channel: issued.challenge.channel,
      expiresAt: issued.challenge.expires_at,
      resendNotBefore: issued.challenge.resend_not_before
    }, requestId, 201);
  } catch (error) {
    if (error instanceof PadiemContactVerificationError) return mapRpcError(error, requestId);
    throw error;
  }
}

async function persistVerificationOutcome(
  sql: Sql,
  previous: PadiemPersistedChallenge,
  next: PadiemPersistedChallenge,
  receipt: {
    receipt_id: string;
    signup_session_ref: string;
    email_contact_ref: string;
    phone_contact_ref: string;
    channel: PadiemVerificationChannel;
    verified_at: string;
  } | null
): Promise<boolean> {
  const updated = await sql`
    update signup_contact_challenges
    set attempts_used = ${next.attempts_used}, state = ${next.state}, updated_at = now()
    where challenge_id = ${previous.challenge_id}
      and attempts_used = ${previous.attempts_used}
      and state = ${previous.state}
    returning challenge_id
  `;
  if (!updated.length) return false;

  if (receipt) {
    await sql`
      insert into signup_contact_receipts (
        receipt_id, challenge_id, signup_session_ref, email_contact_ref,
        phone_contact_ref, channel, verified_at
      ) values (
        ${receipt.receipt_id}, ${previous.challenge_id}, ${receipt.signup_session_ref},
        ${receipt.email_contact_ref}, ${receipt.phone_contact_ref}, ${receipt.channel}, ${receipt.verified_at}
      )
      on conflict (challenge_id) do nothing
    `;
    await sql`
      update signup_contact_sessions
      set phone_verified_at = ${receipt.verified_at}, phone_verification_method = 'kakao_otp', updated_at = now()
      where signup_session_ref = ${receipt.signup_session_ref}
        and email_contact_ref = ${receipt.email_contact_ref}
        and phone_contact_ref = ${receipt.phone_contact_ref}
    `;
  }
  return true;
}

async function verifyCode(
  request: Request,
  env: SignupContactVerificationEnv,
  requestId: string
): Promise<Response> {
  if (!env.PADIEM_CONTACT_VERIFICATION) {
    return fail('VERIFICATION_NOT_CONFIGURED', '가입 인증 서비스가 아직 준비되지 않았습니다.', 503, requestId);
  }
  const body = await bodyJson(request, requestId);
  if (body instanceof Response) return body;
  const signupSessionRef = requiredString(body, 'signupSessionRef', 128);
  const challengeId = requiredString(body, 'challengeId', 128);
  const code = requiredString(body, 'code', 6);
  if (!signupSessionRef || !SAFE_REF.test(signupSessionRef) || !challengeId || !SAFE_REF.test(challengeId) || !code || !CODE.test(code)) {
    return fail('VALIDATION_ERROR', '가입 인증 정보를 확인해 주세요.', 400, requestId);
  }

  const sql = sqlFor(env);
  const rows = await sql`
    select c.challenge_id, c.signup_session_ref, c.email_contact_ref, c.phone_contact_ref, c.network_ref,
           c.channel, c.otp_digest, c.issued_at, c.expires_at, c.resend_not_before,
           c.max_attempts, c.attempts_used, c.generation, c.state
    from signup_contact_challenges c
    join signup_contact_sessions s on s.signup_session_ref = c.signup_session_ref
    where c.challenge_id = ${challengeId} and c.signup_session_ref = ${signupSessionRef}
    limit 1
  `;
  if (!rows[0]) return fail('VERIFICATION_INVALID', '가입 인증 정보를 확인해 주세요.', 400, requestId);
  const previous = challengeFromRow(rows[0] as Record<string, unknown>);

  try {
    const result = await verifyPadiemContactChallenge(env, {
      challenge: previous,
      submitted_code: code,
      now: nowIso(),
      receipt_id: newRef('receipt')
    });
    const receipt = result.receipt ? {
      receipt_id: result.receipt.receipt_id,
      signup_session_ref: result.receipt.signup_session_ref,
      email_contact_ref: result.receipt.email_contact_ref,
      phone_contact_ref: result.receipt.phone_contact_ref,
      channel: result.receipt.channel,
      verified_at: result.receipt.verified_at
    } : null;
    if (!await persistVerificationOutcome(sql, previous, result.challenge, receipt)) {
      return fail('VERIFICATION_STATE_CHANGED', '인증 상태가 변경되었습니다. 다시 확인해 주세요.', 409, requestId);
    }

    if (result.outcome === 'invalid_code') {
      return fail('VERIFICATION_CODE_INVALID', '인증번호가 올바르지 않습니다.', 400, requestId);
    }
    if (result.outcome === 'expired') {
      return fail('VERIFICATION_CODE_EXPIRED', '인증번호가 만료되었습니다. 새 인증번호를 받아 주세요.', 410, requestId);
    }
    if (result.outcome === 'locked') {
      return fail('VERIFICATION_LOCKED', '인증 시도 횟수를 초과했습니다. 새 인증번호를 받아 주세요.', 423, requestId);
    }
    if (!result.receipt) return fail('VERIFICATION_UNAVAILABLE', '인증을 완료하지 못했습니다.', 503, requestId);

    return ok({
      verified: true,
      signupSessionRef,
      verificationReceiptRef: result.receipt.receipt_id,
      phoneVerified: true,
      identityAssurance: 'contact_possession_only',
      legalIdentityVerified: false,
      residentVerified: false
    }, requestId);
  } catch (error) {
    if (error instanceof PadiemContactVerificationError) return mapRpcError(error, requestId);
    throw error;
  }
}

/** Public account-onboarding contact verification. This is deliberately outside
 * resident authorization: possession of a phone endpoint does not grant any
 * complex, household, resident, owner or legal-identity authority. */
export async function handleSignupContactVerificationRequest(
  request: Request,
  env: SignupContactVerificationEnv,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  const path = new URL(request.url).pathname;
  if (path === '/auth/verification/start') return startVerification(request, env, requestId);
  if (path === '/auth/verification/verify') return verifyCode(request, env, requestId);
  return null;
}
