import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../src/', import.meta.url);
const main = await readFile(new URL('main.tsx', root), 'utf8');
const portal = await readFile(new URL('v2/integration/V2AuthEntryPortal.tsx', root), 'utf8');
const integrated = await readFile(new URL('v2/integration/V2IntegratedApp.tsx', root), 'utf8');
const authClient = await readFile(new URL('auth-client.ts', root), 'utf8');

assert.match(main, /V2AuthEntryPortal/, 'V2 main must mount the actual account entry portal');
assert.match(portal, /VITE_AUTH_MODE === 'danjion'/, 'live account mutations must be limited to Danjion auth mode');
assert.match(portal, /startSignupPhoneVerification/, 'direct email signup must request the canonical phone verification flow');
assert.match(portal, /verifySignupPhoneCode/, 'direct email signup must verify the six-digit code');
assert.match(portal, /completeVerifiedSignup/, 'direct email signup must complete through the receipt-gated product endpoint');
assert.match(portal, /verificationReceiptRef/, 'direct signup must retain the exact one-time verification receipt');
assert.match(portal, /phoneVerificationState !== 'verified'/, 'direct email account creation remains disabled before phone verification');
assert.doesNotMatch(portal, /signUpWithEmail|signUpWithPhone/, 'V2 must not call the direct Better Auth signup path');
assert.match(portal, /signInWithEmail/, 'email sign-in must be available');
assert.match(portal, /signInWithPhone/, 'phone sign-in must be available');
assert.match(portal, /signInWithSocial/, 'existing social account sign-in must use the Better Auth adapter');

// Google/Naver/Kakao signup is explicit OAuth signup with no post-OAuth phone
// second factor. The direct-email phone flow must not gate social buttons.
assert.match(portal, /signUpWithSocial/, 'new social signup must begin with OAuth');
assert.doesNotMatch(portal, /completeSocialOnboarding|getSocialOnboardingStatus|socialOnboardingRequired/, 'V2 must not force social users through phone onboarding');
assert.doesNotMatch(portal, /account_onboarding=phone/, 'social signup must not return to a phone-completion route');
assert.match(
  portal,
  /<button type="button" disabled=\{busy\} onClick=\{\(\) => void social\('google'\)\}/,
  'social signup buttons must not be disabled by direct-email phone state'
);
assert.match(portal, /Google·Naver·Kakao/, 'V2 copy must explain the no-extra-phone-second-factor social policy');
assert.match(portal, /\/verification\.html/, 'authenticated accounts must continue to resident verification');
assert.match(portal, /getProductApiBearerToken/, 'the launcher must detect an existing Better Auth account session');
assert.doesNotMatch(portal, /x-danjion-dev-auth-user/, 'live account entry must not manufacture a dev identity');
assert.doesNotMatch(portal, /VERIFIED_RESIDENT|residentVerified\s*=\s*true/, 'account authentication must not manufacture resident authority');

assert.match(integrated, /getProductApiBearerToken/, 'V2 private readiness must probe the real Better Auth JWT bridge');
assert.match(integrated, /danjionSessionReady/, 'V2 must keep explicit async Danjion session readiness state');
assert.match(integrated, /danjionAuthMode\s*&&\s*danjionSessionReady/, 'a Danjion account session must unlock only the account-session gate');
assert.match(integrated, /!danjionAuthMode\s*&&\s*import\.meta\.env\.DEV/, 'dev bypass must not override Danjion live-auth mode');
assert.doesNotMatch(integrated, /x-danjion-dev-auth-user/, 'V2 Danjion readiness must not manufacture a dev identity');
assert.doesNotMatch(integrated, /residentVerified\s*=\s*true|VERIFIED_RESIDENT/, 'V2 account-session readiness must not manufacture resident authority');

assert.match(authClient, /\/auth\/verification\/start/, 'client must call product verification start for direct email signup');
assert.match(authClient, /\/auth\/verification\/verify/, 'client must call product verification verify for direct email signup');
assert.match(authClient, /\/auth\/signup/, 'client must call the verified direct-signup completion endpoint');
assert.match(authClient, /requestSignUp:\s*true/, 'new social accounts require explicit Better Auth signup intent');
assert.match(authClient, /newUserCallbackURL:\s*browserUrl\('\/'\)/, 'new social accounts must return directly after OAuth');
assert.doesNotMatch(authClient, /account_onboarding=phone/, 'client must not create a social phone-second-factor callback');
assert.doesNotMatch(authClient, /additionalData:[\s\S]*danjionSocialSignup/, 'browser receipt refs must not be promoted into OAuth state');
assert.doesNotMatch(authClient, /danjionAuthClient\.signUp\.email/, 'browser must not invoke direct Better Auth signup');
assert.match(authClient, /moveToVerificationLanding\(\)/, 'verified direct accounts must keep the email verification landing');
assert.match(authClient, /danjionAuthClient\.token\(\)/, 'product API bearer readiness must come from the Better Auth JWT plugin');

console.log('V2 direct-phone and social-no-second-factor auth entry contract: PASS');
