export type PadiemVerificationChannel = 'kakao_simulated' | 'kakao_alimtalk' | 'sms_fallback';

export type PadiemVerificationBinding = {
  product_id: 'danjion';
  signup_session_ref: string;
  email_contact_ref: string;
  phone_contact_ref: string;
  network_ref: string;
};

export type PadiemRateSnapshot = {
  window_started_at: string;
  session_issues: number;
  phone_issues: number;
  network_issues: number;
  last_issued_at: string | null;
};

export type PadiemPersistedChallenge = {
  challenge_id: string;
  binding: PadiemVerificationBinding;
  channel: PadiemVerificationChannel;
  otp_digest: string;
  issued_at: string;
  expires_at: string;
  resend_not_before: string;
  max_attempts: number;
  attempts_used: number;
  generation: number;
  state: 'pending' | 'verified' | 'expired' | 'locked' | 'superseded';
};

export type PadiemVerificationReceipt = {
  receipt_id: string;
  challenge_id: string;
  product_id: 'danjion';
  signup_session_ref: string;
  email_contact_ref: string;
  phone_contact_ref: string;
  channel: PadiemVerificationChannel;
  verified_at: string;
  phone_verified: true;
  identity_assurance: 'contact_possession_only';
  legal_identity_verified: false;
};

type RpcFailure = {
  ok: false;
  error: { code: string; message: string };
};

type IssueSuccess = {
  ok: true;
  challenge: PadiemPersistedChallenge;
  rate_snapshot: PadiemRateSnapshot;
  /** Internal service-to-service value. Never return this field to the browser or persist it. */
  delivery_code: string;
};

type ResendSuccess = IssueSuccess & {
  superseded_challenge: PadiemPersistedChallenge;
};

type VerifySuccess = {
  ok: true;
  challenge: PadiemPersistedChallenge;
  outcome: 'verified' | 'invalid_code' | 'expired' | 'locked';
  receipt: PadiemVerificationReceipt | null;
};

export type PadiemIssueCommandSuccess = IssueSuccess & { operation: 'issue' };
export type PadiemResendCommandSuccess = ResendSuccess & { operation: 'resend' };

export interface PadiemContactVerificationRpc {
  issue(payload: Record<string, unknown>): Promise<IssueSuccess | RpcFailure>;
  resend(payload: Record<string, unknown>): Promise<ResendSuccess | RpcFailure>;
  verify(payload: Record<string, unknown>): Promise<VerifySuccess | RpcFailure>;
}

export interface PadiemContactVerificationEnv {
  /** Same-account Cloudflare Service Binding to `padiem-contact-verification`. */
  PADIEM_CONTACT_VERIFICATION?: PadiemContactVerificationRpc;
}

export class PadiemContactVerificationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PadiemContactVerificationError';
    this.code = code;
  }
}

function rpc(env: PadiemContactVerificationEnv): PadiemContactVerificationRpc {
  if (!env.PADIEM_CONTACT_VERIFICATION) {
    throw new PadiemContactVerificationError(
      'CONTACT_VERIFICATION_NOT_CONFIGURED',
      'Padiem contact verification service binding is not configured'
    );
  }
  return env.PADIEM_CONTACT_VERIFICATION;
}

function unwrap<T extends { ok: true }>(result: T | RpcFailure): T {
  if (!result.ok) throw new PadiemContactVerificationError(result.error.code, result.error.message);
  return result;
}

/**
 * DanjiOn owns signup persistence and product policy; Padiem owns the canonical
 * OTP challenge algorithm. These functions intentionally contain no OTP
 * generation, hashing, expiry, attempt, replay, or resend implementation.
 *
 * Canonical upstream:
 *   ai-revenue-lab PR #1703 + PR #1710
 */
export async function issuePadiemContactChallenge(
  env: PadiemContactVerificationEnv,
  payload: Record<string, unknown>
): Promise<PadiemIssueCommandSuccess> {
  return { ...unwrap(await rpc(env).issue(payload)), operation: 'issue' };
}

export async function resendPadiemContactChallenge(
  env: PadiemContactVerificationEnv,
  payload: Record<string, unknown>
): Promise<PadiemResendCommandSuccess> {
  return { ...unwrap(await rpc(env).resend(payload)), operation: 'resend' };
}

export async function verifyPadiemContactChallenge(
  env: PadiemContactVerificationEnv,
  payload: Record<string, unknown>
): Promise<VerifySuccess> {
  return unwrap(await rpc(env).verify(payload));
}
