import { neon } from '@neondatabase/serverless';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt, username } from 'better-auth/plugins';
import { drizzle } from 'drizzle-orm/neon-http';
import { betterAuthSchema } from './auth-better-schema';
import { sendDanjionAuthEmail, type AuthEmailEnv } from './auth-email-v1';

export interface BetterAuthEnv extends AuthEmailEnv {
  DATABASE_URL: string;
  DANJION_AUTH_BASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  AUTH_TRUSTED_ORIGINS?: string;
  CORS_ALLOWED_ORIGINS?: string;
  AUTH_REQUIRE_EMAIL_VERIFICATION?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  KAKAO_CLIENT_ID?: string;
  KAKAO_CLIENT_SECRET?: string;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
}

const KOREAN_MOBILE = /^01[016789]\d{7,8}$/;

export function normalizeKoreanPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('82') && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits;
}

export function isKoreanMobile(value: string): boolean {
  return KOREAN_MOBILE.test(normalizeKoreanPhone(value));
}

function requireValue(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required for Danjion Better Auth`);
  return normalized;
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('DANJION_AUTH_BASE_URL must use HTTPS outside local development');
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function trustedOrigins(env: BetterAuthEnv, baseUrl: string): string[] {
  const raw = env.AUTH_TRUSTED_ORIGINS?.trim() || env.CORS_ALLOWED_ORIGINS?.trim() || '';
  const values = raw.split(',').map((value) => value.trim()).filter(Boolean);
  const baseOrigin = new URL(baseUrl).origin;
  return Array.from(new Set([baseOrigin, ...values]));
}

function emailVerificationRequired(env: BetterAuthEnv): boolean {
  return env.AUTH_REQUIRE_EMAIL_VERIFICATION?.trim().toLowerCase() !== 'false';
}

function configuredSocialProviders(env: BetterAuthEnv) {
  const googleId = env.GOOGLE_CLIENT_ID?.trim();
  const googleSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const kakaoId = env.KAKAO_CLIENT_ID?.trim();
  const kakaoSecret = env.KAKAO_CLIENT_SECRET?.trim();
  const naverId = env.NAVER_CLIENT_ID?.trim();
  const naverSecret = env.NAVER_CLIENT_SECRET?.trim();

  // Existing linked social accounts sign in normally. A new social account may
  // be created only when the client explicitly sends requestSignUp=true. Product
  // authority remains fail-closed after OAuth until DanjiOn binds a verified
  // phone receipt to the new auth user through /auth/social-onboarding/complete.
  return {
    ...(googleId && googleSecret ? { google: { clientId: googleId, clientSecret: googleSecret, disableImplicitSignUp: true } } : {}),
    ...(kakaoId && kakaoSecret ? { kakao: { clientId: kakaoId, clientSecret: kakaoSecret, disableImplicitSignUp: true } } : {}),
    ...(naverId && naverSecret ? { naver: { clientId: naverId, clientSecret: naverSecret, disableImplicitSignUp: true } } : {})
  };
}

async function requireClosedProductAccount(env: BetterAuthEnv, authUserId: string): Promise<void> {
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`
    select account_status
    from app_users
    where auth_user_id = ${authUserId}
    limit 1
  `;
  const row = rows[0];
  if (!row || String(row.account_status) !== 'closed') {
    throw new APIError('FORBIDDEN', {
      message: 'DanjiOn product account must be closed before deleting the login account.'
    });
  }
}

export function createDanjionAuth(env: BetterAuthEnv) {
  const baseURL = normalizeBaseUrl(requireValue(env.DANJION_AUTH_BASE_URL, 'DANJION_AUTH_BASE_URL'));
  const secret = requireValue(env.BETTER_AUTH_SECRET, 'BETTER_AUTH_SECRET');
  if (secret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');

  const db = drizzle(env.DATABASE_URL, { schema: betterAuthSchema });
  const requireEmailVerification = emailVerificationRequired(env);

  return betterAuth({
    appName: '단지온',
    baseURL,
    secret,
    trustedOrigins: trustedOrigins(env, baseURL),
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: betterAuthSchema,
      schemaName: 'danjion_auth'
    }),
    advanced: {
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip']
      }
    },
    rateLimit: {
      storage: 'database',
      modelName: 'rateLimit'
    },
    user: {
      deleteUser: {
        enabled: true,
        sendDeleteAccountVerification: async ({ user, url }) => {
          await sendDanjionAuthEmail(env, {
            kind: 'delete-account',
            to: user.email,
            userName: user.name,
            actionUrl: url
          });
        },
        beforeDelete: async (user) => {
          await requireClosedProductAccount(env, user.id);
        }
      }
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendDanjionAuthEmail(env, {
          kind: 'verify-email',
          to: user.email,
          userName: user.name,
          actionUrl: url
        });
      },
      sendOnSignUp: true,
      sendOnSignIn: requireEmailVerification,
      autoSignInAfterVerification: false,
      expiresIn: 3600
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification,
      sendResetPassword: async ({ user, url }) => {
        await sendDanjionAuthEmail(env, {
          kind: 'reset-password',
          to: user.email,
          userName: user.name,
          actionUrl: url
        });
      },
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true
    },
    socialProviders: configuredSocialProviders(env),
    disabledPaths: ['/is-username-available'],
    plugins: [
      username({
        displayUsername: false,
        immutableUsername: true,
        minUsernameLength: 10,
        maxUsernameLength: 11,
        usernameNormalization: normalizeKoreanPhone,
        usernameValidator: (value) => KOREAN_MOBILE.test(value),
        validationOrder: { username: 'post-normalization' }
      }),
      jwt({
        jwt: {
          issuer: baseURL,
          audience: baseURL,
          expirationTime: '15m'
        }
      })
    ]
  });
}

function directEmailSignupBlocked(request: Request, path: string): Response | null {
  const normalized = path.replace(/\/+$/, '');
  if (request.method !== 'POST' || normalized !== '/api/auth/sign-up/email') return null;
  return Response.json({
    error: {
      code: 'PHONE_VERIFICATION_REQUIRED',
      message: 'Direct DanjiOn signup requires verified phone contact.'
    }
  }, {
    status: 409,
    headers: { 'cache-control': 'no-store' }
  });
}

export async function handleBetterAuthRequest(
  request: Request,
  env: BetterAuthEnv
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/auth/')) return null;

  const blockedSignup = directEmailSignupBlocked(request, path);
  if (blockedSignup) return blockedSignup;

  return createDanjionAuth(env).handler(request);
}
