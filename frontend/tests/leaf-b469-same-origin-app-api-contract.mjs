import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Issue #469: canonical Pages application API calls must stay same-origin so
// first-party Better Auth cookies reach protected /api/v1/* requests. The Pages
// Function facade then forwards those requests to the fixed production Worker.
// Run: node frontend/tests/leaf-b469-same-origin-app-api-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const sessionSrc = await read('../assets/danjion-session.js');
const facadeSrc = await read('../../functions/_lib/app-facade.js');
const routeSrc = await read('../../functions/api/v1/[[path]].js');
const workflow = await read('../../.github/workflows/pages-production-release.yml');

const ctx = {
  location: { hostname: 'danjion.pages.dev', search: '' },
  URLSearchParams,
  console
};
vm.createContext(ctx);
vm.runInContext(sessionSrc, ctx);
const S = ctx.DanjionSession;

assert.equal(S.danjionApiBase(), 'https://danjion.pages.dev',
  'canonical application API base must be first-party Pages');
assert.equal(S.joinUrl(S.danjionApiBase(), '/api/v1/me/profile'),
  'https://danjion.pages.dev/api/v1/me/profile',
  'protected profile calls must remain same-origin in the browser');
assert.equal(S.PRODUCTION_API_BASE, 'https://padiem-danjion-api-production.padiem.workers.dev',
  'fixed Worker upstream constant remains pinned for infrastructure contracts');

for (const hostname of ['danjion-review.pages.dev', 'localhost', '127.0.0.1']) {
  const c = { location: { hostname, search: '' }, URLSearchParams, console };
  vm.createContext(c);
  vm.runInContext(sessionSrc, c);
  assert.equal(c.DanjionSession.danjionApiBase(), '',
    hostname + ' must not auto-bind the production app facade');
}

assert.ok(facadeSrc.includes("CANONICAL_PAGES_ORIGIN = 'https://danjion.pages.dev'"),
  'app facade must be pinned to canonical Pages');
assert.ok(facadeSrc.includes("WORKER_API_BASE = 'https://padiem-danjion-api-production.padiem.workers.dev'"),
  'app facade upstream must be fixed');
assert.ok(facadeSrc.includes("APP_PROXY_PREFIX = '/api/v1/'"),
  'app facade must be bounded to /api/v1/*');
assert.ok(facadeSrc.includes("url.origin !== CANONICAL_PAGES_ORIGIN"),
  'non-canonical origins must fail closed');
assert.ok(facadeSrc.includes("headers.set(name, value)"),
  'incoming first-party request headers, including Cookie, must be forwarded');
assert.ok(facadeSrc.includes("headers.set('origin', CANONICAL_PAGES_ORIGIN)"),
  'upstream Origin must be server-pinned, not client-controlled');
assert.ok(!facadeSrc.includes('x-danjion-dev-auth-user'),
  'app facade must never carry the development auth bypass header');
assert.ok(!facadeSrc.includes('Authorization:'),
  'app facade must not mint an authorization credential');
assert.ok(routeSrc.includes("appFacadeFetch"),
  'Pages /api/v1 catch-all route must delegate to the bounded facade');
assert.ok(workflow.includes('functions/_lib/auth-facade.js'),
  'production release must still assert the auth facade');
assert.ok(workflow.includes('confirm_production'),
  'manual production deployment gate must remain');

console.log('leaf-b469-same-origin-app-api-contract: PASS');
