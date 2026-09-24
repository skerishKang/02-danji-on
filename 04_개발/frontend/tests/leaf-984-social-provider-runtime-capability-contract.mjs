/**
 * #984 [Auth/UI] — runtime social-provider capability (frontend contract).
 *
 * Two independent layers:
 *   A. BEHAVIORAL — the real dependency-free capability module is imported and
 *      executed by plain Node ESM (no tsx, no bundler). Every malformed shape
 *      must fail closed: unknown names, Naver, duplicates, wrong types, and
 *      non-array input all collapse to an empty/known-only list in product
 *      order (kakao before google).
 *   B. SOURCE CONTRACT — the portal and the auth client must render social
 *      buttons ONLY from the runtime capability read, never from their own
 *      environment, and must keep email/phone/password recovery intact.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  AUTH_CAPABILITY_PATH,
  UI_SOCIAL_PROVIDER_ORDER,
  normalizeUiSocialProviders,
  socialProvidersFromCapabilityBody
} from '../src/v2/integration/social-provider-capability.mjs';

/* --- A. behavioral normalizer -------------------------------------- */
assert.deepEqual(UI_SOCIAL_PROVIDER_ORDER, ['kakao', 'google'],
  'product order must be kakao then google, never alphabetical');
assert.equal(AUTH_CAPABILITY_PATH, '/api/auth/capabilities', 'capability route must stay stable');

assert.deepEqual(normalizeUiSocialProviders(['google', 'evil', 'naver', 'google', null]), ['google'],
  'unknown, naver, duplicate, and null entries must all drop');
assert.deepEqual(normalizeUiSocialProviders(['google', 'kakao']), ['kakao', 'google'],
  'normalizer must reorder arbitrary input into product order');
assert.deepEqual(normalizeUiSocialProviders(['kakao', 'kakao', 'kakao']), ['kakao'],
  'duplicates must collapse to one entry');
assert.deepEqual(normalizeUiSocialProviders(['naver']), [],
  'naver alone must never survive normalization (#586)');
assert.deepEqual(normalizeUiSocialProviders('kakao'), [], 'a bare string is not a capability list');
assert.deepEqual(normalizeUiSocialProviders(undefined), [], 'undefined must fail closed');
assert.deepEqual(normalizeUiSocialProviders(null), [], 'null must fail closed');
assert.deepEqual(normalizeUiSocialProviders({ 0: 'kakao' }), [], 'an object is not a capability list');
assert.deepEqual(normalizeUiSocialProviders([]), [], 'an empty list stays empty');
assert.deepEqual(normalizeUiSocialProviders(['Google', 'KAKAO']), [],
  'provider names are case-sensitive and must not be coerced');
assert.deepEqual(normalizeUiSocialProviders([1, true, {}, [], null]), [],
  'wrong-typed entries must all drop');
const normalized = normalizeUiSocialProviders(['kakao', 'google']);
assert.notEqual(normalized, UI_SOCIAL_PROVIDER_ORDER,
  'normalization must return a fresh array, never the frozen product-order constant');
assert.deepEqual(UI_SOCIAL_PROVIDER_ORDER, ['kakao', 'google'],
  'normalization must never mutate the frozen product-order constant');

assert.deepEqual(socialProvidersFromCapabilityBody({ data: { socialProviders: ['google', 'naver'] } }), ['google'],
  'body extraction must keep known providers and drop naver');
assert.deepEqual(socialProvidersFromCapabilityBody({ data: { socialProviders: [] } }), [],
  'an empty capability body resolves to zero providers');
assert.deepEqual(socialProvidersFromCapabilityBody(null), [], 'a null body must fail closed');
assert.deepEqual(socialProvidersFromCapabilityBody({}), [], 'a body without data must fail closed');
assert.deepEqual(socialProvidersFromCapabilityBody({ data: null }), [], 'a null data field must fail closed');
assert.deepEqual(socialProvidersFromCapabilityBody({ data: 'kakao' }), [],
  'a non-object data field must fail closed');
assert.deepEqual(socialProvidersFromCapabilityBody({ data: { socialProviders: 'kakao' } }), [],
  'a non-array socialProviders field must fail closed');
console.log('MALFORMED_CAPABILITY=FAIL_CLOSED=PASS');

/* --- B. source contract -------------------------------------------- */
const root = new URL('../src/', import.meta.url);
const portal = await readFile(new URL('v2/integration/V2AuthEntryPortal.tsx', root), 'utf8');
const authClient = await readFile(new URL('auth-client.ts', root), 'utf8');

// no-flash initial state + runtime-only resolution
assert.match(portal, /useState<UiSocialProvider\[\]>\(\[\]\)/,
  'socialProviders must start empty so no provider is rendered before it is known available');
assert.match(portal, /getAuthRuntimeCapabilities\(\)/,
  'the portal must resolve providers from the runtime capability read');
assert.match(portal, /getAuthRuntimeCapabilities[\s\S]*setSocialProviders\(capability\.socialProviders\)/,
  'the resolved capability must be the only thing that populates the provider list');

// gated render, conditional per-provider buttons, product order
assert.match(portal, /socialProviders\.length > 0 &&/,
  'the social block must be gated on at least one available provider');
assert.match(portal, /socialProviders\.includes\('kakao'\)/, 'kakao button must be conditional');
assert.match(portal, /socialProviders\.includes\('google'\)/, 'google button must be conditional');
const kakaoIndex = portal.indexOf("socialProviders.includes('kakao')");
const googleIndex = portal.indexOf("socialProviders.includes('google')");
assert.ok(kakaoIndex > -1 && googleIndex > -1, 'both provider conditions must be present');
assert.ok(kakaoIndex < googleIndex, 'render order must be kakao before google');
assert.doesNotMatch(portal, /social\('naver'\)/,
  '#586: Naver must never regain a visible V2 auth UI button');

// defense-in-depth fail-closed guard inside social()
assert.match(portal, /if \(!socialProviders\.includes\(provider\)\)/,
  'the social() handler must fail closed for an unavailable provider');
assert.match(portal, /현재 사용할 수 없는 소셜 로그인입니다\./,
  'the fail-closed social() guard must surface a bounded error');

// no environment/hostname/production re-derivation of provider readiness
assert.doesNotMatch(portal, /VITE_ENABLE_GOOGLE/, 'the portal must not gate Google by an env flag');
assert.doesNotMatch(portal, /VITE_ENABLE_KAKAO/, 'the portal must not gate Kakao by an env flag');
assert.doesNotMatch(portal, /window\.location\.hostname/, 'the portal must not branch on hostname');
assert.doesNotMatch(portal, /import\.meta\.env\.PROD/, 'the portal must not branch on production mode');
assert.doesNotMatch(authClient, /VITE_ENABLE_GOOGLE|import\.meta\.env\.PROD/,
  'the auth client must not re-derive provider readiness from its own environment');

// email / phone / password-recovery paths must remain intact
assert.match(portal, /signUpWithEmail/, 'email signup must remain available');
assert.match(portal, /signInWithEmail/, 'email sign-in must remain available');
assert.match(portal, /signInWithPhone/, 'phone sign-in must remain available');
assert.match(portal, /\/auth-recovery\.html/, 'password recovery must remain reachable');
assert.match(authClient, /requestPasswordReset/, 'password recovery must keep its client call');
assert.match(authClient, /signUpWithEmail|danjionAuthClient\.signUp\.email/,
  'email signup must keep its client path');

// capability read must fail closed, never throw
assert.match(authClient, /socialProvidersFromCapabilityBody/,
  'the client must parse the capability body through the fail-closed parser');
const emptyListReturns = [...authClient.matchAll(/return \{ socialProviders: \[\] \};/g)].length;
assert.ok(emptyListReturns >= 2,
  'both the non-OK and the transport/parse failure paths must resolve to an empty list');
const capabilityFn = authClient.match(/export async function getAuthRuntimeCapabilities[\s\S]*?\n\}/)?.[0] ?? '';
assert.ok(capabilityFn, 'getAuthRuntimeCapabilities must exist');
assert.doesNotMatch(capabilityFn, /\bthrow\b/,
  'the capability read must never throw (SOCIAL_PROVIDER_FAILURE_POLICY=HIDE_SOCIAL_BUTTONS)');
assert.match(authClient, /type UiSocialProvider/, 'the UI provider type must stay exported for callers');
console.log('HIDE_SOCIAL_BUTTONS=FAIL_CLOSED=PASS');

console.log('leaf-984-social-provider-runtime-capability-contract: PASS');
