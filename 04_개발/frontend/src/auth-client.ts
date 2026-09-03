import { createAuthClient } from 'better-auth/react';
import { jwtClient, usernameClient } from 'better-auth/client/plugins';

export type SocialLoginProvider = 'kakao' | 'naver' | 'google';

const authBaseURL = import.meta.env.VITE_AUTH_BASE_URL?.trim();
const apiBaseURL = import.meta.env.VITE_API_BASE_URL?.trim();

export const danjionAuthClient = createAuthClient({
  ...(authBaseURL ? { baseURL: authBaseURL } : {}),
  plugins: [
    usernameClient({ displayUsername: false }),
    jwtClient()
  ]
});

function browserUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  return new URL(path, window.location.origin).toString();
}

function apiUrl(path: string): string {
  if (!apiBaseURL) return path;
  return new URL(path, apiBaseURL.endsWith('/') ? apiBaseURL : `${apiBaseURL}/`).toString();
}

function assertAuthSuccess(result: { error?: { message?: string } | null }, fallback: string): void {
  if (result.error) throw new Error(result.error.message || fallback);
}

async function publicAuthPost<T>(path: string, payload: Record<string, unknown>, fallback: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => null) as {
    data?: T;
    error?: { message?: string };
  } | null;
  if (!response.ok || !result?.data) {
    throw new Error(result?.error?.message || fallback);
  }
  return result.data;
}

function moveToVerificationLanding(): void {
  if (typeof window !== 'undefined') window.location.assign(browserUrl('/auth-recovery.html?mode=check-email'));
}

export function emailVerificationCallbackURL(): string {
  return browserUrl('/auth-recovery.html?mode=verified');
}

export function passwordResetCallbackURL(): string {
  return browserUrl('/auth-recovery.html');
}

export function normalizePhoneCredential(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('82') && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits;
}

export function isSupportedPhoneCredential(value: string): boolean {
  return /^01[016789]\d{7,8}$/.test(normalizePhoneCredential(value));
}

export async function signInWithSocial(provider: SocialLoginProvider) {
  const result = await danjionAuthClient.signIn.social({
    provider,
    callbackURL: browserUrl('/')
  });
  assertAuthSuccess(result, '소셜 로그인을 시작하지 못했습니다.');
  return result.data;
}

export async function startSignupPhoneVerification(input: {
  email: string;
  phone: string;
  signupSessionRef?: string;
}) {
  const phone = normalizePhoneCredential(input.phone);
  if (!isSupportedPhoneCredential(phone)) throw new Error('지원하지 않는 휴대폰 번호 형식입니다.');
  return publicAuthPost<{
    signupSessionRef: string;
    challengeId: string;
    channel: string;
    expiresAt: string;
    resendNotBefore: string;
  }>('/auth/verification/start', {
    email: input.email.trim(),
    phone,
    ...(input.signupSessionRef ? { signupSessionRef: input.signupSessionRef } : {})
  }, '인증번호를 보내지 못했습니다.');
}

export async function verifySignupPhoneCode(input: {
  signupSessionRef: string;
  challengeId: string;
  code: string;
}) {
  return publicAuthPost<{
    verified: true;
    signupSessionRef: string;
    verificationReceiptRef: string;
    phoneVerified: true;
    identityAssurance: 'contact_possession_only';
    legalIdentityVerified: false;
    residentVerified: false;
  }>('/auth/verification/verify', input, '휴대폰 인증을 완료하지 못했습니다.');
}

export async function completeVerifiedSignup(input: {
  email: string;
  name: string;
  phone: string;
  password: string;
  signupSessionRef: string;
  verificationReceiptRef: string;
}) {
  const phone = normalizePhoneCredential(input.phone);
  if (!isSupportedPhoneCredential(phone)) throw new Error('지원하지 않는 휴대폰 번호 형식입니다.');
  const data = await publicAuthPost<{
    accepted: true;
    emailVerificationRequired: true;
    phoneVerified: true;
    identityAssurance: 'contact_possession_only';
    legalIdentityVerified: false;
    residentVerified: false;
  }>('/auth/signup', {
    email: input.email.trim(),
    name: input.name.trim(),
    phone,
    password: input.password,
    signupSessionRef: input.signupSessionRef,
    verificationReceiptRef: input.verificationReceiptRef
  }, '단지온 계정을 만들지 못했습니다.');
  moveToVerificationLanding();
  return data;
}

/**
 * Legacy Gate1 visual compatibility only. These names used to call Better Auth
 * signup directly, which would now bypass the verified-phone product boundary.
 * They intentionally fail closed until that visual surface is migrated to
 * startSignupPhoneVerification -> verifySignupPhoneCode -> completeVerifiedSignup.
 */
export async function signUpWithPhone(_input: {
  email: string;
  name: string;
  phone: string;
  password: string;
}): Promise<never> {
  throw new Error('휴대폰 인증이 필요한 새 가입 화면에서 가입해 주세요.');
}

export async function signUpWithEmail(_input: {
  email: string;
  name: string;
  password: string;
  phone?: string;
}): Promise<never> {
  throw new Error('휴대폰 인증이 필요한 새 가입 화면에서 가입해 주세요.');
}

export async function signInWithPhone(phone: string, password: string) {
  const username = normalizePhoneCredential(phone);
  if (!isSupportedPhoneCredential(username)) throw new Error('지원하지 않는 휴대폰 번호 형식입니다.');
  const result = await danjionAuthClient.signIn.username({ username, password });
  assertAuthSuccess(result, '휴대폰 번호로 로그인하지 못했습니다.');
  return result.data;
}

export async function signInWithEmail(email: string, password: string) {
  const result = await danjionAuthClient.signIn.email({ email: email.trim(), password });
  assertAuthSuccess(result, '이메일로 로그인하지 못했습니다.');
  return result.data;
}

export async function resendVerificationEmail(email: string) {
  const result = await danjionAuthClient.sendVerificationEmail({
    email: email.trim(),
    callbackURL: emailVerificationCallbackURL()
  });
  assertAuthSuccess(result, '이메일 확인 링크를 보내지 못했습니다.');
  return result.data;
}

export async function requestPasswordReset(email: string) {
  const result = await danjionAuthClient.requestPasswordReset({
    email: email.trim(),
    redirectTo: passwordResetCallbackURL()
  });
  assertAuthSuccess(result, '비밀번호 재설정 이메일을 보내지 못했습니다.');
  return result.data;
}

export async function resetPasswordWithToken(token: string, newPassword: string) {
  const result = await danjionAuthClient.resetPassword({
    token,
    newPassword
  });
  assertAuthSuccess(result, '비밀번호를 변경하지 못했습니다.');
  return result.data;
}

export async function getProductApiBearerToken(): Promise<string | null> {
  const { data, error } = await danjionAuthClient.token();
  if (error) throw new Error(error.message || '단지온 API 토큰을 가져오지 못했습니다.');
  return data?.token ?? null;
}
