import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #476: canonical Pages app facade bridges a first-party Better Auth
// session cookie to a server-only JWT for the Worker's bearer-only auth boundary.
// Run: node frontend/tests/leaf-b476-session-to-bearer-bridge-contract.mjs

const facade = await readFile(new URL('../../functions/_lib/app-facade.js', import.meta.url), 'utf8');

assert.ok(facade.includes("AUTH_TOKEN_PATH = '/api/auth/token'"),
  'token bridge must use the Better Auth JWT plugin token endpoint');
assert.ok(facade.includes("AUTH_FACADE_MARKER_HEADER = 'x-danjion-auth-facade'"),
  'token exchange must use the canonical auth-facade marker');
assert.ok(facade.includes("AUTH_FACADE_MARKER_VALUE = 'canonical-pages-v1'"),
  'token exchange marker value must stay pinned');
assert.ok(facade.includes("new URL(AUTH_TOKEN_PATH, WORKER_API_BASE)"),
  'token exchange upstream must be the fixed production Worker');
assert.ok(facade.includes("headers.set('cookie', cookie)"),
  'server-side token exchange must use the first-party session cookie');
assert.ok(facade.includes("headers.set('origin', CANONICAL_PAGES_ORIGIN)"),
  'token exchange and app request Origin must be canonical and server-pinned');
assert.ok(facade.includes("'authorization'"),
  'client Authorization must be in the guarded-header set');
assert.ok(facade.includes("if (HOP_BY_HOP.has(lower) || GUARDED_HEADERS.has(lower)) continue;"),
  'guarded browser headers must be stripped before Worker forwarding');
assert.ok(facade.includes("if (bearer) headers.set('authorization', `Bearer ${bearer}`)"),
  'only a validated server-issued JWT may become Worker bearer authority');
assert.ok(facade.includes("looksLikeJwt"),
  'token payload must be shape-checked before forwarding');
assert.ok(facade.includes("if (!tokenResponse.ok) return null"),
  'failed token exchange must not produce authority');
assert.ok(facade.includes("if (!cookie.trim()) return null"),
  'guest/public requests must not require a token exchange');
assert.ok(!facade.includes('x-danjion-dev-auth-user'),
  'production app facade must never carry development auth');
assert.ok(!facade.includes("headers.set('authorization', request.headers.get"),
  'client-provided Authorization must never be copied into Worker authority');

console.log('leaf-b476-session-to-bearer-bridge-contract: PASS');
