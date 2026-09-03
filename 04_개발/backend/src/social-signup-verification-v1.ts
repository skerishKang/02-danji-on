import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

type Sql = NeonQueryFunction<false, false>;

export interface SocialSignupVerificationEnv {
  DATABASE_URL: string;
}

export type SocialSignupClientData = {
  signupSessionRef: string;
  verificationReceiptRef: string;
};

export type SocialSignupServerContext = {
  receiptId: string;
  signupSessionRef: string;
  email: string;
  phone: string;
};

const SAFE_REF = /^[A-Za-z0-9._:-]{1,128}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 320 && EMAIL.test(normalized) ? normalized : null;
}

function sqlFor(env: SocialSignupVerificationEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

export function parseSocialSignupClientData(value: unknown): SocialSignupClientData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const signupSessionRef = candidate.signupSessionRef;
  const verificationReceiptRef = candidate.verificationReceiptRef;
  if (
    typeof signupSessionRef !== 'string'
    || typeof verificationReceiptRef !== 'string'
    || !SAFE_REF.test(signupSessionRef)
    || !SAFE_REF.test(verificationReceiptRef)
  ) return null;
  return { signupSessionRef, verificationReceiptRef };
}

/**
 * Validate untrusted OAuth `additionalData` against DanjiOn persistence before
 * it is promoted into Better Auth's server-only OAuth state. This function does
 * not consume the receipt; consumption happens only if Better Auth is actually
 * about to create a new OAuth user on callback.
 */
export async function prepareSocialSignupServerContext(
  env: SocialSignupVerificationEnv,
  input: SocialSignupClientData
): Promise<SocialSignupServerContext | null> {
  const sql = sqlFor(env);
  const rows = await sql`
    select
      r.receipt_id,
      r.signup_session_ref,
      s.email_normalized,
      s.phone_normalized
    from signup_contact_receipts r
    join signup_contact_sessions s
      on s.signup_session_ref = r.signup_session_ref
    join signup_contact_challenges c
      on c.challenge_id = r.challenge_id
     and c.signup_session_ref = r.signup_session_ref
    where r.receipt_id = ${input.verificationReceiptRef}
      and r.signup_session_ref = ${input.signupSessionRef}
      and r.consumed_at is null
      and r.auth_user_id is null
      and s.phone_verified_at is not null
      and s.email_contact_ref = r.email_contact_ref
      and s.phone_contact_ref = r.phone_contact_ref
      and c.state = 'verified'
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  const email = normalizeEmail(String(row.email_normalized));
  const phone = String(row.phone_normalized);
  if (!email || !phone) return null;
  return {
    receiptId: String(row.receipt_id),
    signupSessionRef: String(row.signup_session_ref),
    email,
    phone
  };
}

/**
 * One-time social signup gate. The provider-mapped email must match the exact
 * email that was bound to the verified phone challenge. The receipt is consumed
 * before Better Auth inserts the OAuth user, matching the direct-signup
 * fail-closed policy: a later account-creation failure requires fresh phone
 * verification instead of replaying the receipt.
 */
export async function consumeSocialSignupServerContext(
  env: SocialSignupVerificationEnv,
  context: SocialSignupServerContext,
  oauthEmail: string,
  authUserId: string
): Promise<boolean> {
  const normalizedOauthEmail = normalizeEmail(oauthEmail);
  if (!normalizedOauthEmail || normalizedOauthEmail !== context.email) return false;

  const sql = sqlFor(env);
  const rows = await sql`
    update signup_contact_receipts r
    set consumed_at = now(), auth_user_id = ${authUserId}
    from signup_contact_sessions s, signup_contact_challenges c
    where r.receipt_id = ${context.receiptId}
      and r.signup_session_ref = ${context.signupSessionRef}
      and r.consumed_at is null
      and r.auth_user_id is null
      and s.signup_session_ref = r.signup_session_ref
      and s.email_normalized = ${context.email}
      and s.phone_normalized = ${context.phone}
      and s.phone_verified_at is not null
      and s.email_contact_ref = r.email_contact_ref
      and s.phone_contact_ref = r.phone_contact_ref
      and c.challenge_id = r.challenge_id
      and c.signup_session_ref = r.signup_session_ref
      and c.state = 'verified'
    returning r.receipt_id
  `;
  return Boolean(rows[0]);
}
