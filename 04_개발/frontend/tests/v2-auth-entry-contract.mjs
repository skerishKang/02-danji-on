import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../src/', import.meta.url);
const main = await readFile(new URL('main.tsx', root), 'utf8');
const portal = await readFile(new URL('v2/integration/V2AuthEntryPortal.tsx', root), 'utf8');
const integrated = await readFile(new URL('v2/integration/V2IntegratedApp.tsx', root), 'utf8');
const authClient = await readFile(new URL('auth-client.ts', root), 'utf8');

assert.match(main, /V2AuthEntryPortal/, 'V2 main must mount the actual account entry portal');
assert.match(portal, /VITE_AUTH_MODE === 'danjion'/, 'live account mutations must be limited to Danjion auth mode');
assert.match(portal, /startSignupPhoneVerification/, 'signup must request the canonical phone verification flow');
assert.match(portal, /verifySignupPhoneCode/, 'signup must verify the six-digit code');
assert.match(portal, /completeVerifiedSignup/, 'direct signup must complete through the receipt-gated product endpoint');
assert.match(portal, /verificationReceiptRef/, 'signup must retain the exact one-time verification receipt');
assert.match(portal, /phoneVerificationState !== 'verified'/, 'direct account creation and onboarding completion remain disabled before phone verification');
assert.doesNotMatch(portal, /signUpWithEmail|signUpWithPhone/, 'V2 must not call the direct Better Auth signup path');
assert.match(portal, /signInWithEmail/, 'email sign-in must be available');
assert.match(portal, /signInWithPhone/, 'phone sign-in must be available');
assert.match(portal, /signInWithSocial/, 'existing social account sign-in must use the Better Auth adapter');

// Canonical social signup order: OAuth first, phone completion second.
assert.match(portal, /signUpWithSocial/, 'new social signup must begin with OAuth');
assert.match(portal, /getSocialOnboardingStatus/, 'returning OAuth sessions must resolve product onboarding state');
assert.match(portal, /socialOnboardingRequired/, 'V2 must expose a dedicated post-OAuth phone-completion state');
assert.match(portal, /completeSocialOnboarding/, 'verified phone receipt must be bound to the current social auth user');
assert.match(portal, /account_onboarding/, 'new social users must return to the phone completion flow');
assert.doesNotMatch(portal, /signUpWithVerifiedSocial/, 'social signup must not require a phone receipt before the OAuth redirect');
assert.match(
  portal,
  /<button type="button" disabled=\{busy\} onClick=\{\(\) => void social\('google'\)\}/,
  'social signup buttons must not be disabled by pre-OAuth phone state'
);
assert.match(portal, /readOnly=\{socialOnboardingRequired\}/, 'post-OAuth email authority must come from the authenticated social session');
assert.match(portal, /\/verification\.html/, 'completed account onboarding must continue to resident verification');
assert.match(portal, /getProductApiBearerToken/, 'the launcher must detect an existing Better Auth account session');
assert.doesNotMatch(portal, /x-danjion-dev-auth-user/, 'live account entry must not manufacture a dev identity');
assert.doesNotMatch(portal, /VERIFIED_RESIDENT|residentVerified\s*=\s*true/, 'account authentication must not manufacture resident authority');

assert.match(integrated, /getProductApiBearerToken/, 'V2 private readiness must probe the real Better Auth JWT bridge');
assert.match(integrated, /danjionSessionReady/, 'V2 must keep explicit async Danjion session readiness state');
assert.match(integrated, /danjionAuthMode\s*&&\s*danjionSessionReady/, 'a Danjion account session must unlock only the account-session gate');
assert.match(integrated, /!danjionAuthMode\s*&&\s*import\.meta\.env\.DEV/, 'dev bypass must not override Danjion live-auth mode');
assert.doesNotMatch(integrated, /x-danjion-dev-auth-user/, 'V2 Danjion readiness must not manufacture a dev identity');
assert.doesNotMatch(integrated, /residentVerified\s*=\s*true|VERIFIED_RESIDENT/, 'V2 account-session readiness must not manufacture resident authority');

assert.match(authClient, /\/auth\/verification\/start/, 'client must call product verification start');
assert.match(authClient, /\/auth\/verification\/verify/, 'client must call product verification verify');
assert.match(authClient, /\/auth\/signup/, 'client must call the verified direct-signup completion endpoint');
assert.match(authClient, /requestSignUp:\s*true/, 'new social accounts require explicit Better Auth signup intent');
assert.match(authClient, /newUserCallbackURL:\s*browserUrl\('\/\?account_onboarding=phone'\)/, 'new social accounts must return to phone onboarding after OAuth');
assert.match(authClient, /\/auth\/social-onboarding\/status/, 'client must read post-OAuth onboarding status');
assert.match(authClient, /\/auth\/social-onboarding\/complete/, 'client must bind the verified receipt to the authenticated social account');
assert.match(authClient, /credentials:\s*'include'/, 'post-OAuth onboarding requests must carry the Better Auth session cookie');
assert.doesNotMatch(authClient, /additionalData:[\s\S]*danjionSocialSignup/, 'browser receipt refs must not be promoted into OAuth state');
assert.doesNotMatch(authClient, /danjionAuthClient\.signUp\.email/, 'browser must not invoke direct Better Auth signup');
assert.match(authClient, /moveToVerificationLanding\(\)/, 'verified direct accounts must keep the email verification landing');
assert.match(authClient, /danjionAuthClient\.token\(\)/, 'product API bearer readiness must come from the Better Auth JWT plugin');

console.log('V2 direct signup and post-OAuth verified-phone onboarding contract: PASS');
