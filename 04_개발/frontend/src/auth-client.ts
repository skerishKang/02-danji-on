import { createAuthClient } from 'better-auth/react';
import { jwtClient, usernameClient } from 'better-auth/client/plugins';

export type SocialLoginProvider = 'kakao' | 'naver' | 'google';

const authBaseURL = import.meta.env.VITE_AUTH_BASE_URL?.trim();

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
  return danjionAuthClient.signIn.social({ provider });
}

export async function signUpWithPhone(input: {
  email: string;
  name: string;
  phone: string;
  password: string;
}) {
  const username = normalizePhoneCredential(input.phone);
  if (!isSupportedPhoneCredential(username)) throw new Error('지원하지 않는 휴대폰 번호 형식입니다.');

  // The recovery email is canonical. The phone number is intentionally an
  // alternate username credential, not an SMS/OTP verification claim.
  return danjionAuthClient.signUp.email({
    email: input.email.trim(),
    name: input.name.trim(),
    password: input.password,
    username,
    callbackURL: emailVerificationCallbackURL()
  });
}

export async function signInWithPhone(phone: string, password: string) {
  const username = normalizePhoneCredential(phone);
  if (!isSupportedPhoneCredential(username)) throw new Error('지원하지 않는 휴대폰 번호 형식입니다.');
  return danjionAuthClient.signIn.username({
    username,
    password,
    callbackURL: emailVerificationCallbackURL()
  });
}

export async function signUpWithEmail(input: {
  email: string;
  name: string;
  password: string;
  phone?: string;
}) {
  const normalizedPhone = input.phone?.trim() ? normalizePhoneCredential(input.phone) : undefined;
  if (normalizedPhone && !isSupportedPhoneCredential(normalizedPhone)) {
    throw new Error('지원하지 않는 휴대폰 번호 형식입니다.');
  }

  return danjionAuthClient.signUp.email({
    email: input.email.trim(),
    name: input.name.trim(),
    password: input.password,
    callbackURL: emailVerificationCallbackURL(),
    ...(normalizedPhone ? { username: normalizedPhone } : {})
  });
}

export async function signInWithEmail(email: string, password: string) {
  return danjionAuthClient.signIn.email({
    email: email.trim(),
    password,
    callbackURL: emailVerificationCallbackURL()
  });
}

export async function resendVerificationEmail(email: string) {
  return danjionAuthClient.sendVerificationEmail({
    email: email.trim(),
    callbackURL: emailVerificationCallbackURL()
  });
}

export async function requestPasswordReset(email: string) {
  return danjionAuthClient.requestPasswordReset({
    email: email.trim(),
    redirectTo: passwordResetCallbackURL()
  });
}

export async function resetPasswordWithToken(token: string, newPassword: string) {
  return danjionAuthClient.resetPassword({
    token,
    newPassword
  });
}

export async function getProductApiBearerToken(): Promise<string | null> {
  const { data, error } = await danjionAuthClient.token();
  if (error) throw new Error(error.message || '단지온 API 토큰을 가져오지 못했습니다.');
  return data?.token ?? null;
}
