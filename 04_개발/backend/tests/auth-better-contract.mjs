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
  socialOnboarding
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
  readFile(new URL('src/social-onboarding-v1.ts', root), 'utf8')
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
assert.match(server, /directEmailSignupBlocked/);
assert.match(server, /\/api\/auth\/sign-up\/email/);
assert.match(server, /PHONE_VERIFICATION_REQUIRED/);
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

// Product bootstrap policy: existing product users remain compatible; approved
// Google/Naver/Kakao accounts may bootstrap without a phone receipt; direct or
// unknown Better Auth providers remain fail-closed until phone onboarding.
assert.match(authResolver, /approvedSocialProviderAccount/);
assert.match(authResolver, /danjion_auth\.account/);
assert.match(authResolver, /provider_id in \('google', 'naver', 'kakao'\)/);
assert.match(authResolver, /completedContactOnboarding/);
assert.match(authResolver, /config\.authority === 'danjion'/);
assert.match(authResolver, /AUTH_ACCOUNT_ONBOARDING_REQUIRED/);
assert.match(authResolver, /signup_contact_receipts/);
assert.match(authResolver, /const existing = await actorBySubject/);
assert.match(authResolver, /const socialAccount = await approvedSocialProviderAccount/);
assert.match(authResolver, /if \(!socialAccount && !await completedContactOnboarding/);
assert.ok(
  authResolver.indexOf('const existing = await actorBySubject')
    < authResolver.indexOf('const socialAccount = await approvedSocialProviderAccount'),
  'existing product users must be accepted before the first-bootstrap provider/phone gate'
);

assert.match(server, /jwt\(\{/);
assert.match(authResolver, /\/api\/auth\/jwks/);
assert.match(app, /handleBetterAuthRequest/);
assert.match(app, /handleVerifiedSignupRequest/);
assert.match(app, /handleSignupContactVerificationRequest/);
assert.match(app, /handleSocialOnboardingRequest/);
assert.match(app, /createDanjionAuth\(env\)\.api\.getSession/);
assert.match(app, /access-control-allow-credentials/);
assert.ok(app.indexOf('handleBetterAuthRequest') < app.indexOf('validateRequestPayload(request'), 'auth handler must be mounted before app JSON payload policy');
assert.ok(app.indexOf('handleSocialOnboardingRequest') < app.indexOf('validateRequestPayload(request'), 'account onboarding status must run before generic product payload policy');

assert.match(schema, /pgSchema\('danjion_auth'\)/);
assert.match(migration, /create schema if not exists danjion_auth/i);
assert.doesNotMatch(migration, /create\s+(?:table|schema).*neon_auth/i, 'migration must never own the managed neon_auth schema');
assert.match(migration, /issuer text not null/i);
assert.match(migration, /unique index[\s\S]*issuer, account_id/i);
assert.match(migration, /username text unique/i);
assert.match(migration, /Never use this schema as resident verification authority/i);

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

// Final direct signup gate: exact receipt consumption precedes Better Auth.
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

console.log('PASS Danjion Better Auth direct-phone and social-no-second-factor contract');
