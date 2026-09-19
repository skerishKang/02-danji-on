import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const facade = await readFile(new URL('../../functions/_lib/auth-facade.js', import.meta.url), 'utf8');
const apiRoute = await readFile(new URL('../../functions/api/auth/[[path]].js', import.meta.url), 'utf8');
const startRoute = await readFile(new URL('../../functions/auth/social-start.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../../frontend/index.html', import.meta.url), 'utf8');
const session = await readFile(new URL('../../frontend/assets/danjion-session.js', import.meta.url), 'utf8');

/* --- Stage 1 is a dormant Pages Function facade: fixed marker + fixed canonical origin --- */
assert.match(facade, /export const AUTH_FACADE_MARKER = 'danjion-auth-facade\/v1';/,
  'facade must export a fixed stage-1 marker');
assert.match(facade, /export const PRIMARY_PRODUCTION_ORIGIN = 'https:\/\/danjion\.padiem\.net';/,
  'facade must declare the primary production custom domain origin');
assert.match(facade, /export const CANONICAL_PAGES_ORIGIN = 'https:\/\/danjion\.pages\.dev';/,
  'facade must pin the canonical Pages origin');
assert.match(facade, /export const WORKER_API_BASE = 'https:\/\/padiem-danjion-api-production\.padiem\.workers\.dev';/,
  'facade must proxy to the canonical production Worker base');
assert.match(facade, /export const PRIMARY_GOOGLE_REDIRECT_URI = `\$\{PRIMARY_PRODUCTION_ORIGIN\}\/api\/auth\/callback\/google`;/,
  'primary Google redirect URI contract must be the custom domain callback path');
assert.match(facade, /export const EXPECTED_GOOGLE_REDIRECT_URI = `\$\{CANONICAL_PAGES_ORIGIN\}\/api\/auth\/callback\/google`;/,
  'Google redirect URI contract must be the canonical Pages callback path');
assert.match(facade, /export const FACADE_REQUEST_MARKER_HEADER = 'x-danjion-auth-facade';/,
  'facade must export the fixed internal request-marker header');
assert.match(facade, /export const FACADE_REQUEST_MARKER_VALUE = 'canonical-pages-v1';/,
  'facade must export the fixed internal request-marker value');
assert.match(facade, /const FORGED_GUARDED_HEADERS = new Set\(\['origin', FACADE_REQUEST_MARKER_HEADER\]\);/,
  'client-supplied Origin and marker must be forged-guarded before forwarding');

/* --- auth-only routing with static-asset fallthrough --- */
assert.match(facade, /pathname\.startsWith\(AUTH_PROXY_PREFIX\)\s*\|\|\s*pathname === SOCIAL_START_PATH/,
  'only /api/auth/* and /auth/social-start may be proxied');
assert.match(facade, /return env\.ASSETS\.fetch\(request\);/,
  'non-auth paths must fall through to the static asset router');
assert.match(apiRoute, /import \{ authFacadeFetch \} from '\.\.\/\.\.\/_lib\/auth-facade\.js';\s*export const onRequest = authFacadeFetch;/,
  '/api/auth/* route must delegate to the shared facade module');
assert.match(startRoute, /import \{ authFacadeFetch \} from '\.\.\/_lib\/auth-facade\.js';\s*export const onRequest = authFacadeFetch;/,
  '/auth/social-start route must delegate to the shared facade module');
assert.match(facade, /if \(!upstreamBase\) \{\s*return new Response\('not found', \{ status: 404/,
  'unapproved origins must fail closed with 404');

/* --- transparent forwarding: cookie, set-cookie, location, query --- */
assert.match(facade, /HOP_BY_HOP/, 'hop-by-hop headers must be stripped, cookie must not be');
assert.match(facade, /for \(const \[name, value\] of request\.headers\)/, 'request headers must be forwarded verbatim');
assert.match(facade, /getSetCookie\(\)/, 'multiple Set-Cookie values must be preserved');
assert.match(facade, /outHeaders\.append\('set-cookie', cookie\)/, 'each Set-Cookie must be appended untouched');
assert.match(facade, /redirect: 'manual'/, 'upstream redirects must not be followed (Location passthrough)');
assert.match(facade, /upstream\.search = url\.search;/, 'query strings must be forwarded');
assert.match(facade, /headers\.set\('x-forwarded-host', url\.host\);/, 'the canonical host must be forwarded for redirect-URI derivation');

/* --- Stage 2 cutover: browser auth traffic binds the same-origin facade --- */
assert.match(html, /location\.href=__session\.joinUrl\(__session\.danjionAuthBase\(\),'\/auth\/social-start'\)/,
  '#444 Stage 2: frontend social-start must bind the auth base (same-origin facade on canonical Pages)');
assert.doesNotMatch(html, /__session\.danjionApiBase\(\),'\/auth\/social-start'/,
  '#444 Stage 2: no Worker-absolute social-start binding may remain in the entry');
assert.doesNotMatch(html, /__session\.danjionApiBase\(\),'\/api\/auth/,
  '#444 Stage 2: no browser auth endpoint may keep the direct Worker API base');
assert.match(html, /createSessionFetch\(__session\.danjionAuthBase\(\)\)/,
  '#444 Stage 2: session check must run against the auth base');
assert.match(session, /PRODUCTION_API_BASE/,
  'DanjionSession must keep exporting the direct production Worker base for general API traffic');

/* --- executable contract: run the real facade module against fake upstream/assets --- */
{
  const mod = await import(new URL('../../functions/_lib/auth-facade.js', import.meta.url).href);
  const { authFacadeFetch } = mod;
  const makeContext = (href, init = {}) => ({
    request: new Request(href, init),
    env: { ASSETS: { fetch: async () => new Response('asset-fallthrough', { status: 418 }) } }
  });
  const calls = [];
  const makeUpstream = () => new Response('{"ok":1}', {
    status: 302,
    headers: [
      ['set-cookie', 'better-auth.session_token=abc; Path=/; HttpOnly; Secure; SameSite=none'],
      ['set-cookie', 'better-auth.callback_url=def; Path=/; HttpOnly; Secure; SameSite=none'],
      ['location', 'https://accounts.google.com/o/oauth2/v2/auth?state=xyz'],
      ['content-type', 'application/json']
    ]
  });
  const fetchImpl = async (req) => { calls.push(req); return makeUpstream(); };

  const ctx = makeContext('https://danjion.pages.dev/api/auth/get-session?disableCookieCache=true', {
    headers: { cookie: 'better-auth.session_token=abc', accept: 'application/json' }
  });
  const res = await authFacadeFetch(ctx, { fetchImpl });
  assert.equal(calls.length, 1, 'canonical auth path must reach the Worker exactly once');
  const up = calls[0];
  assert.equal(up.url, 'https://padiem-danjion-api-production.padiem.workers.dev/api/auth/get-session?disableCookieCache=true',
    'upstream URL must carry the Worker base, path and forwarded query');
  assert.equal(up.headers.get('cookie'), 'better-auth.session_token=abc', 'Cookie header must be forwarded');
  assert.equal(up.headers.get('x-forwarded-host'), 'danjion.pages.dev', 'canonical host must be forwarded');
  assert.equal(up.headers.get('origin'), 'https://danjion.pages.dev', 'facade must pin the canonical Origin on the Worker request');
  assert.equal(up.headers.get(mod.FACADE_REQUEST_MARKER_HEADER), mod.FACADE_REQUEST_MARKER_VALUE,
    'facade must stamp the fixed internal request marker');
  assert.equal(up.headers.get('host'), null, 'hop-by-hop Host must not leak to the upstream fetch');
  assert.equal(res.status, 302, 'upstream status must pass through (no redirect following)');
  assert.equal(res.headers.get('location'), 'https://accounts.google.com/o/oauth2/v2/auth?state=xyz',
    'Location must pass through untouched');
  assert.deepEqual(res.headers.getSetCookie(), [
    'better-auth.session_token=abc; Path=/; HttpOnly; Secure; SameSite=none',
    'better-auth.callback_url=def; Path=/; HttpOnly; Secure; SameSite=none'
  ], 'every Set-Cookie must reach the browser untouched');
  assert.equal(res.headers.get('x-danjion-auth-facade'), 'danjion-auth-facade/v1', 'response must carry the fixed facade marker');
  assert.equal(res.headers.get('cache-control'), 'no-store', 'facade responses must never be cached');
  assert.equal(await res.text(), '{"ok":1}', 'body must pass through untouched');

  calls.length = 0;
  const startRes = await authFacadeFetch(makeContext('https://danjion.pages.dev/auth/social-start?provider=google&callbackURL=https%3A%2F%2Fdanjion.pages.dev%2F&requestSignUp=1'), { fetchImpl });
  assert.equal(calls.length, 1, '/auth/social-start must be proxied');
  assert.ok(calls[0].url.startsWith('https://padiem-danjion-api-production.padiem.workers.dev/auth/social-start?provider=google'),
    'social-start must proxy to the Worker start page with its query');
  assert.equal(startRes.status, 302);

  calls.length = 0;
  const postRes = await authFacadeFetch(makeContext('https://danjion.pages.dev/api/auth/sign-in/social', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: 'x=y' }, body: '{"provider":"google"}'
  }), { fetchImpl });
  assert.equal(calls.length, 1, 'POST /api/auth/sign-in/social must be proxied when invoked');
  assert.equal(await calls[0].text(), '{"provider":"google"}', 'request body must be forwarded');
  assert.equal(postRes.status, 302);

  calls.length = 0;
  await authFacadeFetch(makeContext('https://danjion.pages.dev/api/auth/get-session', {
    headers: {
      origin: 'https://evil-attacker.example',
      [mod.FACADE_REQUEST_MARKER_HEADER]: 'attacker-controlled-v9',
      cookie: 'a=b'
    }
  }), { fetchImpl });
  assert.equal(calls.length, 1, 'forged authority headers must still proxy as a normal canonical request');
  const forged = calls[0];
  assert.equal(forged.headers.get('origin'), 'https://danjion.pages.dev',
    'client-forged Origin must be rewritten to the canonical Pages origin (marker can never select an arbitrary origin)');
  assert.equal(forged.headers.get(mod.FACADE_REQUEST_MARKER_HEADER), mod.FACADE_REQUEST_MARKER_VALUE,
    'client-forged marker must be stripped and replaced by the fixed marker value');

  const fall = await authFacadeFetch(makeContext('https://danjion.pages.dev/index.html'), { fetchImpl });
  assert.equal(fall.status, 418, 'non-auth paths must fall through to ASSETS.fetch');
  assert.equal(await fall.text(), 'asset-fallthrough');

  calls.length = 0;
  const preview = await authFacadeFetch(makeContext('https://danjion-review.pages.dev/api/auth/get-session'), { fetchImpl });
  assert.equal(preview.status, 404, 'preview origins must fail closed');
  assert.equal(calls.length, 0, 'fail-closed must never reach the Worker');

  calls.length = 0;
  const qa = await authFacadeFetch(makeContext('https://danjion-qa.pages.dev/api/auth/get-session'), { fetchImpl });
  assert.equal(qa.status, 302, 'QA auth facade must proxy');
  assert.ok(calls[0].url.startsWith('https://padiem-danjion-api-qa.padiem.workers.dev/'), 'QA facade must use the fixed QA Worker');

  calls.length = 0;
  const primary = await authFacadeFetch(makeContext('https://danjion.padiem.net/api/auth/get-session', {
    headers: {
      origin: 'https://evil-attacker.example',
      [mod.FACADE_REQUEST_MARKER_HEADER]: 'attacker-controlled-v9',
      cookie: 'a=b'
    }
  }), { fetchImpl });
  assert.equal(calls.length, 1, 'primary custom domain auth request must proxy to the Worker');
  assert.equal(primary.status, 302);
  const primaryCall = calls[0];
  assert.ok(primaryCall.url.startsWith('https://padiem-danjion-api-production.padiem.workers.dev/api/auth/get-session'),
    'primary custom domain must proxy to production Worker');
  assert.equal(primaryCall.headers.get('origin'), 'https://danjion.padiem.net',
    'origin must be re-pinned to exact primary custom domain');
  assert.equal(primaryCall.headers.get('x-forwarded-host'), 'danjion.padiem.net',
    'x-forwarded-host must carry the primary custom domain');
  assert.equal(primaryCall.headers.get(mod.FACADE_REQUEST_MARKER_HEADER), mod.FACADE_REQUEST_MARKER_VALUE,
    'client-forged marker must be replaced with canonical marker');

  calls.length = 0;
  const primarySpoof = await authFacadeFetch(makeContext('https://danjion.padiem.net.evil.example/api/auth/get-session'), { fetchImpl });
  assert.equal(primarySpoof.status, 404, 'spoofed primary origin must fail closed');
  assert.equal(calls.length, 0, 'spoofed origin must never reach the Worker');

  assert.equal(mod.PRIMARY_GOOGLE_REDIRECT_URI, 'https://danjion.padiem.net/api/auth/callback/google',
    'the primary Google redirect URI must be the custom domain callback');
  assert.equal(mod.EXPECTED_GOOGLE_REDIRECT_URI, 'https://danjion.pages.dev/api/auth/callback/google',
    'the Google console redirect contract must be the canonical Pages callback');
}

console.log('leaf-b14-canonical-auth-facade-stage1-contract: PASS');
