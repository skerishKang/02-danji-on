import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [betterAuth, auth, authz, frontend] = await Promise.all([
  readFile(new URL('src/auth-better-v1.ts', root), 'utf8'),
  readFile(new URL('src/auth-v1.ts', root), 'utf8'),
  readFile(new URL('src/authorization-v2.ts', root), 'utf8'),
  readFile(new URL('../frontend/src/v2/integration/V2AuthEntryPortal.tsx', root), 'utf8')
]);

assert.doesNotMatch(betterAuth, /PHONE_VERIFICATION_REQUIRED|directEmailSignupBlocked/);
assert.match(betterAuth, /return auth\.handler\(request\)/);
assert.match(frontend, /signUpWithEmail/);
assert.doesNotMatch(frontend, /startSignupPhoneVerification|verifySignupPhoneCode|completeVerifiedSignup|phoneVerificationState|verificationReceiptRef/);
assert.match(frontend, /resident 확인|입주민 확인/);
assert.match(frontend, /계정을 만들었다고 주민 권한이 생기지 않습니다/);
assert.doesNotMatch(frontend, /residentVerified\s*=\s*true|VERIFIED_RESIDENT/);
assert.doesNotMatch(auth, /AUTH_ACCOUNT_ONBOARDING_REQUIRED|completedContactOnboarding|approvedSocialProviderAccount/);
assert.match(authz, /export async function requireVerifiedResident/);
assert.match(authz, /hm\.status = 'verified'/);
assert.match(authz, /RESIDENT_VERIFICATION_REQUIRED/);
assert.match(authz, /export async function requirePadiemOperator/);
assert.match(authz, /from padiem_operator_grants/);
assert.doesNotMatch(betterAuth, /Math\.random|crypto\.getRandomValues|raw_otp|verification_code\s+text/i);
assert.doesNotMatch(`${betterAuth}\n${auth}\n${authz}\n${frontend}`, /@gmail\.com|@naver\.com|@kakao\.com/);

console.log('PASS #424 account-first signup, resident fail-closed, social/contact separation, and independent admin grants');
