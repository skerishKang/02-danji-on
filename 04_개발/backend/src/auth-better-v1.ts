import { neon } from '@neondatabase/serverless';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, jwt, username } from 'better-auth/plugins';
import { drizzle } from 'drizzle-orm/neon-http';
import { betterAuthSchema } from './auth-better-schema';
import { sendDanjionAuthEmail, type AuthEmailEnv } from './auth-email-v1';
import { handleSocialOnboardingRequest } from './social-onboarding-v1';

export interface BetterAuthEnv extends AuthEmailEnv {
  DATABASE_URL: string;
  APP_ENV?: string;
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

/* #444 stage-1: the Pages auth facade rewrites both of these headers itself and
 * strips any client-supplied copies before forwarding. The per-request public
 * base may switch to the canonical Pages origin ONLY when the request carries
 * this exact marker value AND the exact canonical Origin; every other request
 * (direct Worker traffic, forged headers) keeps the env-configured Worker base.
 */
export const AUTH_FACADE_MARKER_HEADER = 'x-danjion-auth-facade';
export const AUTH_FACADE_MARKER_VALUE = 'canonical-pages-v1';
export const PRIMARY_PRODUCTION_AUTH_BASE_URL = 'https://danjion.padiem.net';
export const LEGACY_PRODUCTION_AUTH_BASE_URL = 'https://danjion.pages.dev';
export const CANONICAL_PAGES_AUTH_BASE_URL = 'https://danjion.pages.dev';
export const QA_PAGES_AUTH_BASE_URL = 'https://danjion-qa.pages.dev';

export function resolveAuthPublicBaseUrl(env: BetterAuthEnv, request?: Request): string {
  const envBase = normalizeBaseUrl(requireValue(env.DANJION_AUTH_BASE_URL, 'DANJION_AUTH_BASE_URL'));
  if (!request) return envBase;
  if (request.headers.get(AUTH_FACADE_MARKER_HEADER) !== AUTH_FACADE_MARKER_VALUE) return envBase;
  const origin = request.headers.get('origin');
  if (origin === new URL(PRIMARY_PRODUCTION_AUTH_BASE_URL).origin) return PRIMARY_PRODUCTION_AUTH_BASE_URL;
  if (origin === new URL(LEGACY_PRODUCTION_AUTH_BASE_URL).origin) return LEGACY_PRODUCTION_AUTH_BASE_URL;
  if (env.APP_ENV === 'qa' && origin === new URL(QA_PAGES_AUTH_BASE_URL).origin) return QA_PAGES_AUTH_BASE_URL;
  return envBase;
}

function emailVerificationRequired(env: BetterAuthEnv): boolean {
  return env.AUTH_REQUIRE_EMAIL_VERIFICATION?.trim().toLowerCase() !== 'false';
}

/* #984: single source of truth for social-provider readiness. Both the Better
 * Auth registration map and the public UI-capability response read the same
 * credential extraction and completeness rule below, so the server can never
 * advertise a provider it did not register (or hide one it did). Only provider
 * NAMES ever leave this module; credential material stays private here.
 */
type ProviderCredential = { id: string | undefined; secret: string | undefined };

function socialProviderCredentials(env: BetterAuthEnv): Record<'google' | 'kakao' | 'naver', ProviderCredential> {
  return {
    google: { id: env.GOOGLE_CLIENT_ID?.trim(), secret: env.GOOGLE_CLIENT_SECRET?.trim() },
    kakao: { id: env.KAKAO_CLIENT_ID?.trim(), secret: env.KAKAO_CLIENT_SECRET?.trim() },
    naver: { id: env.NAVER_CLIENT_ID?.trim(), secret: env.NAVER_CLIENT_SECRET?.trim() }
  };
}

// A provider is usable only with a COMPLETE credential pair. An id-only or
// secret-only configuration must never register or advertise the provider.
function hasCompleteCredentialPair(credential: ProviderCredential): boolean {
  return Boolean(credential.id && credential.secret);
}

function configuredSocialProviders(env: BetterAuthEnv) {
  const credentials = socialProviderCredentials(env);
  return {
    ...(hasCompleteCredentialPair(credentials.google)
      ? { google: { clientId: credentials.google.id!, clientSecret: credentials.google.secret!, disableImplicitSignUp: true } } : {}),
    ...(hasCompleteCredentialPair(credentials.kakao)
      ? { kakao: { clientId: credentials.kakao.id!, clientSecret: credentials.kakao.secret!, disableImplicitSignUp: true } } : {}),
    ...(hasCompleteCredentialPair(credentials.naver)
      ? { naver: { clientId: credentials.naver.id!, clientSecret: credentials.naver.secret!, disableImplicitSignUp: true } } : {})
  };
}

/* #984: the UI-visible social providers. The product UI supports exactly Kakao
 * and Google in product order. Naver credentials may be configured for other
 * surfaces, but Naver stays intentionally hidden from the product UI (#586),
 * so it is never added here. Returns provider names only.
 */
export type UiSocialProvider = 'kakao' | 'google';
const UI_SOCIAL_PROVIDER_ORDER: readonly UiSocialProvider[] = ['kakao', 'google'];

export function configuredUiSocialProviders(env: BetterAuthEnv): UiSocialProvider[] {
  const credentials = socialProviderCredentials(env);
  return UI_SOCIAL_PROVIDER_ORDER.filter((provider) => hasCompleteCredentialPair(credentials[provider]));
}

async function requireClosedProductAccount(env: BetterAuthEnv, authUserId: string): Promise<void> {
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`
    select account_status from app_users where auth_user_id = ${authUserId} limit 1
  `;
  const row = rows[0];
  if (!row || String(row.account_status) !== 'closed') {
    throw new APIError('FORBIDDEN', { message: 'DanjiOn product account must be closed before deleting the login account.' });
  }
}

export function createDanjionAuth(env: BetterAuthEnv, publicBase = resolveAuthPublicBaseUrl(env)) {
  const baseURL = normalizeBaseUrl(publicBase);
  const jwtAuthority = normalizeBaseUrl(requireValue(env.DANJION_AUTH_BASE_URL, 'DANJION_AUTH_BASE_URL'));
  const secret = requireValue(env.BETTER_AUTH_SECRET, 'BETTER_AUTH_SECRET');
  if (secret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
  const db = drizzle(env.DATABASE_URL, { schema: betterAuthSchema });
  const requireEmailVerification = emailVerificationRequired(env);

  return betterAuth({
    appName: '단지온',
    baseURL,
    secret,
    trustedOrigins: trustedOrigins(env, baseURL),
    database: drizzleAdapter(db, { provider: 'pg', schema: betterAuthSchema, schemaName: 'danjion_auth' }),
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      useSecureCookies: true,
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: 'none' },
    },
    rateLimit: { storage: 'database', modelName: 'rateLimit' },
    user: {
      deleteUser: {
        enabled: true,
        sendDeleteAccountVerification: async ({ user, url }) => {
          await sendDanjionAuthEmail(env, { kind: 'delete-account', to: user.email, userName: user.name, actionUrl: url });
        },
        beforeDelete: async (user) => { await requireClosedProductAccount(env, user.id); }
      }
    },
    // Demo stabilization: the email-verification rollout is intentionally
    // dormant while Production transactional delivery is deferred. The handler
    // remains implemented for the post-demo re-enable issue, but no signup/signin
    // path sends a verification message while the production flag is false.
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendDanjionAuthEmail(env, { kind: 'verify-email', to: user.email, userName: user.name, actionUrl: url });
      },
      sendOnSignUp: requireEmailVerification,
      sendOnSignIn: requireEmailVerification,
      autoSignInAfterVerification: false,
      expiresIn: 3600
    },
    account: {
      // Demo stabilization: keep each login method independent for now.
      // Explicit/implicit social-account linking returns only after the deferred
      // convergence work proves conflict handling and the admin-backup exception.
      accountLinking: {
        enabled: false,
        disableImplicitLinking: true
      }
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification,
      sendResetPassword: async ({ user, url }) => {
        await sendDanjionAuthEmail(env, { kind: 'reset-password', to: user.email, userName: user.name, actionUrl: url });
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
      // Server-only Pages facade fallback: bearer() lets the JWT plugin /token
      // endpoint accept the opaque Better Auth session token as Authorization.
      // The browser never receives or constructs this Authorization header.
      bearer(),
      // The public auth base may switch per request to canonical Pages for
      // callbacks/cookies, but application-service JWT authority must stay
      // stable and match auth-v1.ts verification.
      jwt({ jwt: { issuer: jwtAuthority, audience: jwtAuthority, expirationTime: '15m' } })
    ]
  });
}

function requestId(request: Request): string {
  const incoming = request.headers.get('x-danjion-request-id')?.trim();
  return incoming && /^[A-Za-z0-9._:-]{1,80}$/.test(incoming) ? incoming : `req-${crypto.randomUUID()}`;
}

/* --- #448 round 2: first-party social OAuth start -----------------------------
 * The Pages frontend must never POST /api/auth/sign-in/social cross-site; the
 * Better Auth state cookie would be dropped by the browser and the callback
 * fails with state_mismatch. Instead the frontend navigates top-level to this
 * Worker route, and the minimal no-store HTML below performs the sign-in POST
 * same-origin on the workers.dev site, so the state cookie is issued, stored,
 * and read back on the first-party site.
 * ----------------------------------------------------------------------------- */
const SOCIAL_START_PROVIDERS = new Set(['google', 'naver', 'kakao']);

function socialStartFailure(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer'
    }
  });
}

function isTrustedCallbackOrigin(origin: string, patterns: string[]): boolean {
  let candidate: URL;
  try { candidate = new URL(origin); } catch { return false; }
  if (candidate.protocol !== 'https:' && candidate.hostname !== 'localhost' && candidate.hostname !== '127.0.0.1') return false;
  return patterns.some((pattern) => {
    let expected: URL;
    try { expected = new URL(pattern); } catch { return false; }
    if (expected.protocol !== candidate.protocol) return false;
    if (expected.hostname.startsWith('*.')) {
      return candidate.hostname !== expected.hostname.slice(2) && candidate.hostname.endsWith(expected.hostname.slice(1));
    }
    return expected.hostname === candidate.hostname && expected.port === candidate.port;
  });
}

function handleSocialStart(request: Request, env: BetterAuthEnv): Response {
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider') ?? '';
  const rawCallback = url.searchParams.get('callbackURL') ?? '';
  const requestSignUp = url.searchParams.get('requestSignUp') === '1';
  if (!SOCIAL_START_PROVIDERS.has(provider)) {
    return socialStartFailure('지원하지 않는 소셜 로그인 제공자입니다.');
  }
  let callback: URL;
  try { callback = new URL(rawCallback); } catch { return socialStartFailure('잘못된 복귀 주소입니다.'); }
  callback.hash = '';
  callback.search = '';
  let trusted: string[];
  try {
    trusted = trustedOrigins(env, resolveAuthPublicBaseUrl(env, request));
  } catch {
    return socialStartFailure('인증 서버 설정을 확인할 수 없습니다.');
  }
  if (!isTrustedCallbackOrigin(callback.origin, trusted)) {
    return socialStartFailure('신뢰할 수 없는 복귀 주소입니다.');
  }
  const payload = JSON.stringify({
    provider,
    callbackURL: callback.toString(),
    requestSignUp
  }).replace(/</g, '\\u003c');
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>단지온 인증 연결</title></head><body><p id="danjion-social-start-message">인증 서비스를 연결하는 중입니다…</p><script nonce="${nonce}">(async()=>{const fail=()=>{const el=document.getElementById('danjion-social-start-message');if(el)el.textContent='소셜 인증을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.';};try{const start=${payload};const body={provider:start.provider,callbackURL:start.callbackURL,newUserCallbackURL:start.callbackURL};if(start.requestSignUp)body.requestSignUp=true;const r=await fetch('/api/auth/sign-in/social',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),credentials:'include'});const j=r.ok?await r.json().catch(()=>null):null;const redirect=j&&(j.url||j.data&&j.data.url);if(typeof redirect==='string'&&/^https:\\/\\//i.test(redirect)){location.replace(redirect);return}fail()}catch{fail()}})();</script></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'`
    }
  });
}

/* --- #984: public runtime social-provider capability --------------------------
 * The first-party UI reads this to render ONLY the social providers the runtime
 * actually registered. Public, read-only, GET-only, no auth, no DB query, and
 * no mutation. The payload carries provider AVAILABILITY alone — never a client
 * id, client secret, env value, credential length, or callback/internal config.
 * The provider set comes from the same source as Better Auth registration.
 * ----------------------------------------------------------------------------- */
export const AUTH_CAPABILITY_PATH = '/api/auth/capabilities';

function handleAuthCapabilities(env: BetterAuthEnv): Response {
  return Response.json(
    { data: { socialProviders: configuredUiSocialProviders(env) } },
    { headers: { 'cache-control': 'no-store' } }
  );
}

export async function handleBetterAuthRequest(request: Request, env: BetterAuthEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (request.method === 'GET' && path === '/auth/social-start') {
    return handleSocialStart(request, env);
  }

  if (request.method === 'GET' && path === AUTH_CAPABILITY_PATH) {
    return handleAuthCapabilities(env);
  }

  const auth = createDanjionAuth(env, resolveAuthPublicBaseUrl(env, request));

  if (path.startsWith('/auth/social-onboarding/')) {
    return handleSocialOnboardingRequest(
      request,
      env,
      requestId(request),
      async (incoming) => auth.api.getSession({ headers: incoming.headers })
    );
  }

  if (!path.startsWith('/api/auth/')) return null;
  return auth.handler(request);
}
