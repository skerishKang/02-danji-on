import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [server, schema, migration, app, authResolver, wranglerSource, verificationRpc, verificationMigration, signupVerification] = await Promise.all([
  readFile(new URL('src/auth-better-v1.ts', root), 'utf8'),
  readFile(new URL('src/auth-better-schema.ts', root), 'utf8'),
  readFile(new URL('migrations/014_danjion_better_auth.sql', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('src/auth-v1.ts', root), 'utf8'),
  readFile(new URL('wrangler.jsonc', root), 'utf8'),
  readFile(new URL('src/padiem-contact-verification-v1.ts', root), 'utf8'),
  readFile(new URL('migrations/038_signup_contact_verification.sql', root), 'utf8'),
  readFile(new URL('src/signup-contact-verification-v1.ts', root), 'utf8')
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
assert.doesNotMatch(server, /sendOTP|sendVerificationOTP|verifyPhoneNumber/, 'v1 phone login must not fake or require SMS verification');

assert.match(server, /jwt\(\{/);
assert.match(authResolver, /\/api\/auth\/jwks/);
assert.match(app, /handleBetterAuthRequest/);
assert.match(app, /handleSignupContactVerificationRequest/);
assert.ok(app.indexOf('handleBetterAuthRequest') < app.indexOf('handleSignupContactVerificationRequest'), 'Better Auth routes must remain canonical');
assert.ok(app.indexOf('handleSignupContactVerificationRequest') < app.indexOf('validateRequestPayload(request'), 'signup verification must be mounted before /api/v1-only payload policy');

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

// Public command layer: only Padiem owns the OTP lifecycle. DanjiOn may derive
// opaque PII references, persist returned challenge state and call a trusted
// delivery binding, but never expose/persist the delivery code.
assert.match(signupVerification, /\/auth\/verification\/start/);
assert.match(signupVerification, /\/auth\/verification\/verify/);
assert.match(signupVerification, /issuePadiemContactChallenge/);
assert.match(signupVerification, /resendPadiemContactChallenge/);
assert.match(signupVerification, /verifyPadiemContactChallenge/);
assert.match(signupVerification, /PADIEM_CONTACT_DELIVERY/);
assert.match(signupVerification, /DANJION_CONTACT_REF_SECRET/);
assert.match(signupVerification, /Raw delivery_code is intentionally not included in this browser response/);
assert.match(signupVerification, /residentVerified:\s*false/);
assert.match(signupVerification, /legalIdentityVerified:\s*false/);
assert.doesNotMatch(signupVerification, /body\[['"]phoneVerified['"]\]|body\.phoneVerified|phone_verified\s*=\s*body/i, 'browser phone verification claims must never become authority');
assert.doesNotMatch(signupVerification, /generateNumericOtp|randbelow|Math\.random\(\).*otp|createHmac.*otp/i, 'DanjiOn command layer must not fork the OTP algorithm');

console.log('PASS Danjion Better Auth and Padiem contact-verification boundary contract');
