import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #476 + #686: canonical/QA Pages app facades bridge a first-party
// Better Auth session cookie to a server-only JWT for the selected fixed
// Worker's bearer-only auth boundary. The upstream is selected only from the
// exact Pages origin; it is never client-provided.
// Run: node frontend/tests/leaf-b476-session-to-bearer-bridge-contract.mjs

const facade = await readFile(new URL('../../functions/_lib/app-facade.js', import.meta.url), 'utf8');

assert.ok(facade.includes("AUTH_SESSION_PATH = '/api/auth/get-session'"),
  'session bridge must use Better Auth get-session');
assert.ok(facade.includes("AUTH_FACADE_MARKER_HEADER = 'x-danjion-auth-facade'"),
  'token exchange must use the canonical auth-facade marker');
assert.ok(facade.includes("AUTH_FACADE_MARKER_VALUE = 'canonical-pages-v1'"),
  'token exchange marker value must stay pinned');
assert.ok(facade.includes("PRIMARY_PRODUCTION_ORIGIN = 'https://danjion.padiem.net'"),
  'Primary Production custom domain origin must stay fixed');
assert.ok(facade.includes("CANONICAL_PAGES_ORIGIN = 'https://danjion.pages.dev'"),
  'Production Pages origin must stay fixed');
assert.ok(facade.includes("WORKER_API_BASE = 'https://padiem-danjion-api-production.padiem.workers.dev'"),
  'Production Worker upstream must stay fixed');
assert.ok(facade.includes("QA_PAGES_ORIGIN = 'https://danjion-qa.pages.dev'"),
  'QA Pages origin must be explicit');
assert.ok(facade.includes("QA_WORKER_API_BASE = 'https://padiem-danjion-api-qa.padiem.workers.dev'"),
  'QA Worker upstream must stay fixed');
assert.ok(facade.includes('async function bearerFromSessionCookie(fetchImpl, request, url, upstreamBase)'),
  'session bridge must receive only the facade-selected fixed upstream');
assert.ok(facade.includes("new URL(AUTH_SESSION_PATH, upstreamBase)"),
  'session bridge must use the already-selected fixed upstream');
assert.ok(facade.includes("new URL(AUTH_TOKEN_PATH, upstreamBase)"),
  'fallback token exchange must use the already-selected fixed upstream');
assert.ok(facade.includes("url.origin === PRIMARY_PRODUCTION_ORIGIN || url.origin === LEGACY_PRODUCTION_ORIGIN"),
  'upstream selection must support primary custom domain and legacy fallback origin');
assert.ok(facade.includes("url.origin === QA_PAGES_ORIGIN"),
  'upstream selection may include only the explicit QA Pages origin');
assert.ok(facade.includes("if (!upstreamBase)"),
  'unknown origins must fail closed before any Worker call');
assert.ok(facade.includes("headers.set('cookie', cookie)"),
  'server-side token exchange must use the first-party session cookie');
assert.ok(facade.includes("headers.set('origin', url.origin)"),
  'token exchange and app request Origin must be server-pinned to the selected exact origin');
assert.ok(facade.includes("'authorization'"),
  'client Authorization must be in the guarded-header set');
assert.ok(facade.includes("if (HOP_BY_HOP.has(lower) || GUARDED_HEADERS.has(lower)) continue;"),
  'guarded browser headers must be stripped before Worker forwarding');
assert.ok(facade.includes("if (bridge.bearer) headers.set('authorization', `Bearer ${bridge.bearer}`)"),
  'only a validated server-issued JWT may become Worker bearer authority');
assert.ok(facade.includes("payload.session && payload.user"),
  'session bridge must require a real Better Auth session payload');
assert.ok(facade.includes("sessionResponse.headers.get('set-auth-jwt')"),
  'primary Worker bearer path must use Better Auth set-auth-jwt');
assert.ok(facade.includes("AUTH_TOKEN_PATH = '/api/auth/token'"),
  'fallback must use the Better Auth JWT token endpoint');
assert.ok(facade.includes("betterAuthSessionToken(cookie)"),
  'fallback may extract only the first-party Better Auth session token server-side');
assert.ok(facade.includes("tokenHeaders.set('authorization', `Bearer ${sessionToken}`)"),
  'fallback must present the opaque session token only to Better Auth /token server-side');
assert.ok(facade.includes("tokenPayload.token"),
  'fallback must consume the JWT response body, not expose it to the browser');
assert.ok(facade.includes("looksLikeJwt"),
  'both JWT paths must be shape-checked before forwarding');
assert.ok(facade.includes("if (!sessionResponse.ok) return { bearer: null, disposition: 'session-failed' }"),
  'failed session resolution must fail closed with a bounded diagnostic');
assert.ok(facade.includes("if (!cookie.trim()) return { bearer: null, disposition: 'no-cookie' }"),
  'guest/public requests must not require a token exchange');
assert.ok(!facade.includes('x-danjion-dev-auth-user'),
  'app facade must never carry development auth');
assert.ok(!facade.includes("headers.set('authorization', request.headers.get"),
  'client-provided Authorization must never be copied into Worker authority');
assert.ok(!facade.includes("outHeaders.set('authorization'"),
  'server-only bearer authority must never be exposed to the browser');
assert.ok(!facade.includes("outHeaders.set('set-auth-jwt'"),
  'exchanged JWT must never be surfaced in the browser response');
assert.ok(facade.includes("outHeaders.set('x-danjion-auth-bridge', bridge.disposition)"),
  'browser may receive only the bounded bridge disposition, never credentials');
for (const disposition of ['no-cookie','session-failed','session-invalid','direct-jwt','no-session-token','token-failed','token-invalid','fallback-jwt']) {
  assert.ok(facade.includes(`disposition: '${disposition}'`), `missing closed diagnostic disposition: ${disposition}`);
}
assert.ok(!facade.includes("outHeaders.set('cookie'"), 'diagnostic must never expose Cookie');
assert.ok(!facade.includes("outHeaders.set('x-danjion-session-token'"), 'diagnostic must never expose session token');

console.log('leaf-b476-session-to-bearer-bridge-contract: PASS');
