import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [
  server,
  schema,
  migration,
  app,
  authResolver,
  wranglerSource,
  verificationRpc,
  verificationMigration,
  verifiedSignup,
  socialOnboarding,
  jwksAlgCrvMigration
] = await Promise.all([
  readFile(new URL('src/auth-better-v1.ts', root), 'utf8'),
  readFile(new URL('src/auth-better-schema.ts', root), 'utf8'),
  readFile(new URL('migrations/014_danjion_better_auth.sql', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('src/auth-v1.ts', root), 'utf8'),
  readFile(new URL('wrangler.jsonc', root), 'utf8'),
  readFile(new URL('src/padiem-contact-verification-v1.ts', root), 'utf8'),
  readFile(new URL('migrations/038_signup_contact_verification.sql', root), 'utf8'),
  readFile(new URL('src/verified-signup-v1.ts', root), 'utf8'),
  readFile(new URL('src/social-onboarding-v1.ts', root), 'utf8'),
  readFile(new URL('migrations/039_danjion_better_auth_jwks_alg_crv.sql', root), 'utf8')
]);

for (const provider of ['google', 'kakao', 'naver']) {
  assert.match(server, new RegExp(`${provider}:`), `missing ${provider} social provider boundary`);
}

assert.match(server, /emailAndPassword:\s*\{[\s\S]*enabled:\s*true/);
assert.match(server, /username\(\{/);
assert.match(server, /displayUsername:\s*false/);
assert.match(server, /usernameNormalization:\s*normalizeKoreanPhone/);
assert.match(server, /usernameValidator:/);
assert.doesNotMatch(server, /phoneNumber\(/, 'phone plugin would couple this v1 path to phone verification/OTP semantics');
assert.doesNotMatch(server, /sendOTP|sendVerificationOTP|verifyPhoneNumber/, 'Better Auth must not own the Padiem OTP algorithm');
assert.doesNotMatch(server, /directEmailSignupBlocked|PHONE_VERIFICATION_REQUIRED/,
  'direct Better Auth email signup must not be blocked by phone verification');
assert.match(server, /return auth\.handler\(request\)/,
  'direct Better Auth email signup must reach the standard Better Auth handler');
assert.match(server, /disableImplicitSignUp:\s*true/g, 'new social users must require explicit signup intent');

// Google/Naver/Kakao use explicit OAuth signup without an additional phone
// second factor. The compatibility status endpoint must distinguish account
// onboarding from phone-possession evidence rather than equating the two.
assert.doesNotMatch(server, /addOAuthServerContext|getOAuthState|prepareSocialSignupServerContext|consumeSocialSignupServerContext/);
assert.match(socialOnboarding, /\/auth\/social-onboarding\/status/);
assert.match(socialOnboarding, /\/auth\/social-onboarding\/complete/);
assert.match(socialOnboarding, /danjion_auth\.account/);
assert.match(socialOnboarding, /provider_id in \('google', 'naver', 'kakao'\)/);
assert.match(socialOnboarding, /social_provider/);
assert.match(socialOnboarding, /phone_verified/);
assert.match(socialOnboarding, /accountOnboarding:\s*state\.complete \? 'complete' : 'phone_required'/);
assert.match(socialOnboarding, /phoneVerified:\s*state\.phoneVerified/);
assert.match(socialOnboarding, /signup_contact_receipts/);
assert.match(socialOnboarding, /r\.consumed_at is null/);
assert.match(socialOnboarding, /r\.auth_user_id is null/);
assert.match(socialOnboarding, /c\.state = 'verified'/);
assert.match(socialOnboarding, /s\.phone_verified_at is not null/);
assert.match(socialOnboarding, /set consumed_at = now\(\), auth_user_id = \$\{authUserId\}/);
assert.doesNotMatch(socialOnboarding, /otp_digest|delivery_code|submitted_code/i, 'account onboarding must never own OTP material');

// Product bootstrap policy: any authenticated account may bootstrap a normal
// product account; resident-only authority remains a separate verified-
// household gate. Social onboarding and contact receipts never grant residency.
assert.match(authResolver, /const existing = await actorBySubject/);
assert.doesNotMatch(authResolver, /AUTH_ACCOUNT_ONBOARDING_REQUIRED|completedContactOnboarding|approvedSocialProviderAccount/);

assert.match(server, /jwt\(\{/);
assert.match(authResolver, /\/api\/auth\/jwks/);
assert.match(app, /handleBetterAuthRequest/);
assert.match(app, /handleVerifiedSignupRequest/);
assert.match(app, /handleSignupContactVerificationRequest/);
assert.match(app, /access-control-allow-credentials/);
assert.ok(app.indexOf('handleBetterAuthRequest') < app.indexOf('validateRequestPayload(request'), 'auth handler must be mounted before app JSON payload policy');
// #372 D3 / #375 F2: the app-level social-onboarding dispatch was a dead
// duplicate of the Better Auth handler's internal delegation. auth-better-v1
// is the sole owner of /auth/social-onboarding/* and it is mounted before the
// app-level payload policy (pinned via handleBetterAuthRequest above), which
// preserves the former "onboarding runs before payload policy" invariant.
assert.doesNotMatch(app, /handleSocialOnboardingRequest/,
  'app-level social-onboarding dispatch must stay removed; auth-better-v1 owns /auth/social-onboarding/*');
assert.match(server, /path\.startsWith\('\/auth\/social-onboarding\/'\)/,
  'auth-better-v1 must keep the social-onboarding prefix branch');
assert.match(server, /handleSocialOnboardingRequest\(/,
  'auth-better-v1 must delegate /auth/social-onboarding/* to the social onboarding lane');
assert.match(server, /auth\.api\.getSession\(\{ headers: incoming\.headers \}\)/,
  'social onboarding session resolution must stay inside the Better Auth handler');

assert.match(schema, /pgSchema\('danjion_auth'\)/);
assert.match(migration, /create schema if not exists danjion_auth/i);
assert.doesNotMatch(migration, /create\s+(?:table|schema).*neon_auth/i, 'migration must never own the managed neon_auth schema');
assert.match(migration, /issuer text not null/i);
assert.match(migration, /unique index[\s\S]*issuer, account_id/i);
assert.match(migration, /username text unique/i);
assert.match(migration, /Never use this schema as resident verification authority/i);

// Better Auth 1.7.x jwt plugin requires alg/crv on the jwks model; without them
// /api/auth/jwks answers 500 and every remote JWKS verifier breaks.
assert.match(schema, /jwks[\s\S]*alg:\s*text\('alg'\)[\s\S]*crv:\s*text\('crv'\)/);
assert.match(jwksAlgCrvMigration, /alter table danjion_auth\.jwks add column if not exists alg text/i);
assert.match(jwksAlgCrvMigration, /alter table danjion_auth\.jwks add column if not exists crv text/i);

const wrangler = JSON.parse(wranglerSource);
const production = wrangler.env?.production;
assert.equal(production?.name, 'padiem-danjion-api-production', 'production Worker identity must remain explicit');
assert.equal(production?.workers_dev, true, 'production must expose a stable workers.dev endpoint until a custom API domain is introduced');
assert.equal(
  production?.vars?.CORS_ALLOWED_ORIGINS,
  'https://danjion.pages.dev,https://*.danjion.pages.dev',
  'production CORS must be limited to canonical Danjion Pages origins'
);
assert.equal(
  production?.vars?.AUTH_TRUSTED_ORIGINS,
  'https://danjion.pages.dev,https://*.danjion.pages.dev',
  'Better Auth trusted origins must match the production frontend boundary'
);
assert.equal(production?.vars?.AUTH_REQUIRE_EMAIL_VERIFICATION, 'true', 'production direct accounts must require email verification');
assert.equal(production?.vars?.DEV_AUTH_BYPASS, 'false', 'production must never enable the dev auth bypass');

// Padiem contact-verification reuse boundary. DanjiOn persists product state but
// must never fork the OTP algorithm implemented in ai-revenue-lab.
assert.match(verificationRpc, /PADIEM_CONTACT_VERIFICATION/);
assert.match(verificationRpc, /\.issue\(payload\)/);
assert.match(verificationRpc, /\.resend\(payload\)/);
assert.match(verificationRpc, /\.verify\(payload\)/);
assert.match(verificationRpc, /ai-revenue-lab PR #1703 \+ PR #1710/);
assert.doesNotMatch(verificationRpc, /Math\.random|crypto\.getRandomValues|subtle\.sign|createHmac|sha256/i, 'DanjiOn must not implement the OTP algorithm locally');

assert.match(verificationMigration, /create table if not exists signup_contact_sessions/i);
assert.match(verificationMigration, /create table if not exists signup_contact_challenges/i);
assert.match(verificationMigration, /create table if not exists signup_contact_rate_budgets/i);
assert.match(verificationMigration, /create table if not exists signup_contact_receipts/i);
assert.match(verificationMigration, /otp_digest text not null/i);
assert.doesNotMatch(verificationMigration, /\braw_otp\s+(?:text|varchar|char)/i, 'raw OTP must never be persisted');
assert.doesNotMatch(verificationMigration, /\bverification_code\s+(?:text|varchar|char)/i, 'browser-entered verification code must never be persisted');
assert.match(verificationMigration, /identity_verified_at timestamptz/);
assert.match(verificationMigration, /never resident or legal identity authority/i);

// The legacy receipt-gated endpoint remains available as a separate contact
// capability, but is no longer the account creation path.
assert.match(verifiedSignup, /\/auth\/signup/);
assert.match(verifiedSignup, /consumeVerifiedReceipt/);
assert.match(verifiedSignup, /r\.consumed_at is null/);
assert.match(verifiedSignup, /c\.state = 'verified'/);
assert.match(verifiedSignup, /s\.phone_verified_at is not null/);
assert.match(verifiedSignup, /auth\.api\.signUpEmail/);
assert.ok(
  verifiedSignup.indexOf('consumeVerifiedReceipt(') < verifiedSignup.indexOf('auth.api.signUpEmail'),
  'one-time verification receipt must be consumed before Better Auth account creation'
);
assert.match(verifiedSignup, /username:\s*phone/);
assert.match(verifiedSignup, /contact_possession_only/);
assert.match(verifiedSignup, /legalIdentityVerified:\s*false/);
assert.match(verifiedSignup, /residentVerified:\s*false/);
assert.doesNotMatch(verifiedSignup, /phoneVerified:\s*true[\s\S]*VERIFIED_RESIDENT/);

// #448: cross-site OAuth cookie hardening (pages.dev frontend ↔ workers.dev auth).
// Secure/httpOnly/SameSite=none keep the Better Auth state cookie usable across sites
// without weakening any CSRF/state/origin validation.
assert.match(server, /useSecureCookies:\s*true/, '#448: production auth cookies must be Secure');
assert.match(
  server,
  /defaultCookieAttributes:\s*\{\s*httpOnly:\s*true,\s*secure:\s*true,\s*sameSite:\s*'none'\s*\}/,
  "#448: default cookie attributes must be httpOnly+secure with SameSite='none' for the cross-site OAuth flow"
);
assert.match(server, /ipAddressHeaders:\s*\[\s*'cf-connecting-ip'\s*\]/, '#448: existing cf-connecting-ip advanced setting must be preserved');
assert.doesNotMatch(server, /skipStateCookieCheck/, '#448: Better Auth state cookie check must never be skipped');
assert.doesNotMatch(server, /disableCSRFCheck\s*:\s*true/, '#448: CSRF check must never be disabled');
assert.doesNotMatch(server, /disableOriginCheck\s*:\s*true/, '#448: origin check must never be disabled');

// #448 round 2: first-party social OAuth start. The Pages frontend navigates top-level
// to GET /auth/social-start on the Worker; the served no-store page issues the
// same-origin /api/auth/sign-in/social POST so the state cookie lives on the Worker site.
assert.match(server, /request\.method === 'GET' && path === '\/auth\/social-start'/,
  '#448r2: auth-better-v1 must own the GET /auth/social-start first-party start route');
assert.match(server, /SOCIAL_START_PROVIDERS = new Set\(\['google', 'naver', 'kakao'\]\)/,
  '#448r2: social start must use an explicit google|naver|kakao provider allowlist');
assert.match(server, /if \(!SOCIAL_START_PROVIDERS\.has\(provider\)\)/,
  '#448r2: non-allowlisted providers must be rejected before any auth work');
assert.match(server, /trustedOrigins\(env, normalizeBaseUrl\(requireValue\(env\.DANJION_AUTH_BASE_URL/,
  '#448r2: callback validation must reuse the existing trustedOrigins policy boundary');
assert.match(server, /isTrustedCallbackOrigin\(callback\.origin, trusted\)/,
  '#448r2: callbackURL origin must be validated against the trusted origins list');
assert.match(server, /callback\.hash = '';\s*callback\.search = ''/,
  '#448r2: callbackURL must be normalized to a bare trusted page URL');
assert.match(server, /new Response\(html, \{[\s\S]*'cache-control': 'no-store'[\s\S]*'x-content-type-options': 'nosniff'[\s\S]*'referrer-policy': 'no-referrer'[\s\S]*content-security-policy': `default-src 'none'; script-src 'nonce-\$\{nonce\}'; connect-src 'self'/,
  '#448r2: start page must be no-store with nosniff, no-referrer, and a nonce-only CSP allowing same-origin connect');
assert.match(server, /fetch\('\/api\/auth\/sign-in\/social',\{method:'POST'[\s\S]*credentials:'include'\}/,
  '#448r2: the start page must POST sign-in/social same-origin with credentials included');
assert.match(server, /location\.replace\(redirect\)/,
  '#448r2: navigation must follow only the HTTPS redirect returned by Better Auth');
assert.doesNotMatch(server, /location\.(href|replace|assign)\(start\.callbackURL\)|location\.(href|replace|assign)\(callback/,
  '#448r2: the Worker page must never redirect straight to a caller-supplied callback URL');
assert.match(server, /\.replace\(\/<\/g, '\\\\u003c'\)/,
  '#448r2: embedded start payload must escape angle brackets to keep the inline script inert');

console.log('PASS Danjion Better Auth direct-phone and social-no-second-factor contract');
