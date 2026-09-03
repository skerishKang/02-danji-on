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
assert.match(portal, /verifySignupPhoneCode/, 'signup must verify the six-digit code before account creation');
assert.match(portal, /completeVerifiedSignup/, 'signup must complete through the receipt-gated product endpoint');
assert.match(portal, /verificationReceiptRef/, 'signup must retain the exact one-time verification receipt');
assert.match(portal, /phoneVerificationState !== 'verified'/, 'account creation must remain disabled before phone verification');
assert.doesNotMatch(portal, /signUpWithEmail|signUpWithPhone/, 'V2 must not call the direct Better Auth signup path');
assert.match(portal, /signInWithEmail/, 'email sign-in must be available');
assert.match(portal, /signInWithPhone/, 'phone sign-in must be available');
assert.match(portal, /signInWithSocial/, 'existing social account sign-in must use the Better Auth adapter');
assert.match(portal, /\/verification\.html/, 'successful direct sign-in must continue to resident verification');
assert.match(portal, /getProductApiBearerToken/, 'the launcher must detect an existing Better Auth product session');
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
assert.match(authClient, /\/auth\/signup/, 'client must call the verified signup completion endpoint');
assert.doesNotMatch(authClient, /danjionAuthClient\.signUp\.email/, 'browser must not invoke direct Better Auth signup');
assert.match(authClient, /moveToVerificationLanding\(\)/, 'verified direct accounts must keep the email verification landing');
assert.match(authClient, /danjionAuthClient\.token\(\)/, 'product API bearer readiness must come from the Better Auth JWT plugin');

console.log('V2 verified-phone auth entry and session bridge contract: PASS');
