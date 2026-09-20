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

assert.equal(S.danjionApiBase(), '',
  'canonical application API base must use the first-party Pages facade via a relative URL');
assert.equal(S.joinUrl(S.danjionApiBase(), '/api/v1/me/profile'),
  '/api/v1/me/profile',
  'protected profile calls must remain same-origin in the browser');


const primaryCtx = {
  location: { hostname: 'danjion.padiem.net', search: '' },
  URLSearchParams,
  console
};
vm.createContext(primaryCtx);
vm.runInContext(sessionSrc, primaryCtx);
assert.equal(primaryCtx.DanjionSession.danjionApiBase(), '',
  'primary application API base must use the first-party custom-domain facade via a relative URL');
assert.equal(primaryCtx.DanjionSession.joinUrl(primaryCtx.DanjionSession.danjionApiBase(), '/api/v1/me/profile'),
  '/api/v1/me/profile',
  'protected profile calls must remain same-origin on primary custom domain');

for (const hostname of ['danjion-review.pages.dev', 'localhost', '127.0.0.1']) {
  const c = { location: { hostname, search: '' }, URLSearchParams, console };
  vm.createContext(c);
  vm.runInContext(sessionSrc, c);
  assert.equal(c.DanjionSession.danjionApiBase(), '',
    hostname + ' must not auto-bind the production app facade');
}

assert.ok(facadeSrc.includes("PRIMARY_PRODUCTION_ORIGIN = 'https://danjion.padiem.net'"),
  'app facade must be pinned to primary custom domain');
assert.ok(facadeSrc.includes("CANONICAL_PAGES_ORIGIN = 'https://danjion.pages.dev'"),
  'app facade must be pinned to canonical Pages');
assert.ok(facadeSrc.includes("WORKER_API_BASE = 'https://padiem-danjion-api-production.padiem.workers.dev'"),
  'app facade upstream must be fixed');
assert.ok(facadeSrc.includes("APP_PROXY_PREFIX = '/api/v1/'"),
  'app facade must be bounded to /api/v1/*');
assert.ok(facadeSrc.includes("url.origin === QA_PAGES_ORIGIN"),
  'QA facade origin must be explicit');
assert.ok(facadeSrc.includes("QA_WORKER_API_BASE"),
  'QA facade upstream must be fixed');
assert.ok(facadeSrc.includes("headers.set(name, value)"),
  'incoming first-party request headers, including Cookie, must be forwarded');
assert.ok(facadeSrc.includes("headers.set('origin', url.origin)"),
  'upstream Origin must be pinned to the exact verified facade origin');
assert.ok(!facadeSrc.includes('x-danjion-dev-auth-user'),
  'app facade must never carry the development auth bypass header');
assert.ok(facadeSrc.includes("'authorization'"),
  'app facade must treat browser Authorization as a guarded header');
assert.ok(facadeSrc.includes("AUTH_SESSION_PATH = '/api/auth/get-session'"),
  'app facade must bridge the first-party session through the Better Auth JWT token endpoint');
assert.ok(facadeSrc.includes("if (bridge.bearer) headers.set('authorization', `Bearer ${bridge.bearer}`)"),
  'only the validated server-side bridge JWT may become Worker Authorization');
assert.ok(routeSrc.includes("appFacadeFetch"),
  'Pages /api/v1 catch-all route must delegate to the bounded facade');
assert.ok(workflow.includes('functions/_lib/auth-facade.js'),
  'production release must still assert the auth facade');
assert.ok(workflow.includes('confirm_production'),
  'manual production deployment gate must remain');

/* executable exact-origin facade routing: source-string checks alone are insufficient */
{
  const mod = await import(new URL('../../functions/_lib/app-facade.js', import.meta.url).href);
  const { appFacadeFetch } = mod;
  const calls = [];
  const fetchImpl = async (req) => {
    calls.push(req);
    return new Response('{"data":{"ok":true}}', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  const makeContext = (href, init = {}) => ({
    request: new Request(href, init),
    env: { ASSETS: { fetch: async () => new Response('asset', { status: 418 }) } }
  });

  const primary = await appFacadeFetch(makeContext('https://danjion.padiem.net/api/v1/me/profile?x=1', {
    headers: {
      origin: 'https://evil-attacker.example',
      authorization: 'Bearer attacker-controlled',
      'x-forwarded-host': 'evil-attacker.example',
      'x-forwarded-proto': 'http'
    }
  }), { fetchImpl });
  assert.equal(primary.status, 200);
  assert.equal(calls.length, 1, 'primary custom-domain app request must reach production Worker exactly once');
  assert.equal(calls[0].url,
    'https://padiem-danjion-api-production.padiem.workers.dev/api/v1/me/profile?x=1',
    'primary app facade must route only to the fixed production Worker');
  assert.equal(calls[0].headers.get('origin'), 'https://danjion.padiem.net',
    'primary app facade must re-pin Origin to the accepted exact request origin');
  assert.equal(calls[0].headers.get('x-forwarded-host'), 'danjion.padiem.net',
    'primary app facade must re-pin forwarded host');
  assert.equal(calls[0].headers.get('x-forwarded-proto'), 'https',
    'primary app facade must re-pin forwarded protocol');
  assert.equal(calls[0].headers.get('authorization'), null,
    'client Authorization must never pass through the app facade');

  calls.length = 0;
  await appFacadeFetch(makeContext('https://danjion.pages.dev/api/v1/me/profile'), { fetchImpl });
  assert.equal(calls.length, 1, 'legacy Pages fallback must still reach the production Worker');
  assert.ok(calls[0].url.startsWith('https://padiem-danjion-api-production.padiem.workers.dev/'));
  assert.equal(calls[0].headers.get('origin'), 'https://danjion.pages.dev');

  calls.length = 0;
  await appFacadeFetch(makeContext('https://danjion-qa.pages.dev/api/v1/me/profile'), { fetchImpl });
  assert.equal(calls.length, 1, 'QA exact origin must reach only the QA Worker');
  assert.ok(calls[0].url.startsWith('https://padiem-danjion-api-qa.padiem.workers.dev/'));
  assert.equal(calls[0].headers.get('origin'), 'https://danjion-qa.pages.dev');

  for (const href of [
    'https://danjion.padiem.net.evil.example/api/v1/me/profile',
    'https://evil-danjion.padiem.net/api/v1/me/profile',
    'https://danjion.pages.dev.evil.example/api/v1/me/profile'
  ]) {
    calls.length = 0;
    const rejected = await appFacadeFetch(makeContext(href), { fetchImpl });
    assert.equal(rejected.status, 404, href + ' must fail closed');
    assert.equal(calls.length, 0, href + ' must never reach any Worker');
  }
}

console.log('leaf-b469-same-origin-app-api-contract: PASS');
