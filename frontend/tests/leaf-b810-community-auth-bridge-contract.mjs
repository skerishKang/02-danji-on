import assert from 'node:assert/strict';
import { appFacadeFetch } from '../../functions/_lib/app-facade.js';
import { authFacadeFetch } from '../../functions/_lib/auth-facade.js';

// Issue #810: authenticated community writes collapsed to `401 AUTH_REQUIRED`
// ("로그인이 만료되었습니다"). This contract drives the REAL Pages facade runtime
// (functions/_lib/app-facade.js + functions/_lib/auth-facade.js) through the
// full session -> bearer bridge so every disposition is proven at the
// request/response level, not by substring-matching source.
//
// The bridge funnel owns exactly these bounded dispositions:
//   no-cookie -> session-failed -> session-invalid -> no-session-token
//             -> token-failed -> token-invalid
//   success: direct-jwt | fallback-jwt
//
// The facade must fail CLOSED for every broken leg, must never turn a client
// Authorization header into Worker authority, and must resolve a VALID
// first-party session cookie into a server-side bearer for the Worker.
//
// Run: node frontend/tests/b810-community-auth-bridge-contract.mjs

const PAGES = 'https://danjion.pages.dev';
const WORKER = 'https://padiem-danjion-api-production.padiem.workers.dev';
const COMMUNITY = `${PAGES}/api/v1/complexes/banglim-myeongji-roadhill/community/posts`;

const JWT_LOOKALIKE = `eyJhbGciOiJFZERTQSJ9.${'p'.repeat(40)}.${'s'.repeat(40)}`;
const RAW_SESSION_TOKEN = 'bWxUcVd4WXpBMmJDNEQ1RTZGN0c4SDlJSjBLMUw'; // bounded, non-secret shape
const SIGNED_SESSION_COOKIE = `${RAW_SESSION_TOKEN}.Zm9vYmFyYmF6cXV1eDEyMzQ1Njc4OQ`;

const COOKIE_NAME = '__Secure-better-auth.session_token';
const SESSION_PAYLOAD = { session: { id: 'sess-1', userId: 'u-1' }, user: { id: 'u-1' } };

function facadeEnv() {
  return { ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } };
}

async function driveCommunity({ cookie, clientAuthorization, upstream }) {
  const seen = [];
  const response = await appFacadeFetch(
    {
      request: new Request(COMMUNITY, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
          ...(clientAuthorization ? { authorization: clientAuthorization } : {})
        },
        body: JSON.stringify({ kind: 'greeting', title: 't', body: 'bbbbb' })
      }),
      env: facadeEnv()
    },
    {
      fetchImpl: async (request) => {
        seen.push(request);
        return upstream(request, seen.length);
      }
    }
  );
  return { response, seen };
}

function workerPostOk() {
  return new Response(JSON.stringify({ data: { id: 'post-1', kind: 'greeting' } }), {
    status: 201,
    headers: { 'content-type': 'application/json' }
  });
}

function workerAuthDenied() {
  return new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } }), {
    status: 401,
    headers: { 'content-type': 'application/json' }
  });
}

/* ---------------------------------------------------------------------------
 * CASE A — no session cookie at all.
 * The bridge must NOT attempt a token exchange and must fail closed.
 * ------------------------------------------------------------------------- */
{
  const { response, seen } = await driveCommunity({ upstream: () => workerAuthDenied() });
  assert.equal(response.status, 401, 'CASE A: no-cookie community write must preserve the Worker 401');
  assert.equal(response.headers.get('x-danjion-auth-bridge'), 'no-cookie',
    'CASE A: disposition must be the bounded `no-cookie` diagnostic');
  assert.equal(seen.length, 1, 'CASE A: no cookie means no get-session/token round trip');
  assert.equal(seen[0].headers.get('authorization'), null,
    'CASE A: no bearer may be attached when there is no session');
  assert.equal(new URL(seen[0].url).origin, new URL(WORKER).origin,
    'CASE A: upstream must stay the fixed production Worker');
}

/* ---------------------------------------------------------------------------
 * CASE B — cookie present but the session is invalid (get-session: null body).
 * A real Production get-session answers 200/null for a bogus cookie; the bridge
 * must treat that as `session-invalid` and never fall through to a token mint.
 * ------------------------------------------------------------------------- */
{
  const { response, seen } = await driveCommunity({
    cookie: `${COOKIE_NAME}=${SIGNED_SESSION_COOKIE}`,
    upstream: async (request) => {
      if (new URL(request.url).pathname === '/api/auth/get-session') {
        return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return workerAuthDenied();
    }
  });
  assert.equal(response.status, 401, 'CASE B: invalid session must still surface the Worker 401');
  assert.equal(response.headers.get('x-danjion-auth-bridge'), 'session-invalid',
    'CASE B: null session payload must be reported as `session-invalid`');
  const paths = seen.map((r) => new URL(r.url).pathname);
  assert.deepEqual(paths.slice(0, 2), ['/api/auth/get-session', '/api/v1/complexes/banglim-myeongji-roadhill/community/posts'],
    'CASE B: an invalid session must not reach /api/auth/token');
}

/* ---------------------------------------------------------------------------
 * CASE C — VALID session + direct set-auth-jwt.
 * The primary bridge leg: get-session returns a real payload and the jwt plugin
 * surfaces `set-auth-jwt`; that JWT becomes the Worker bearer.
 * ------------------------------------------------------------------------- */
{
  const { response, seen } = await driveCommunity({
    cookie: `${COOKIE_NAME}=${SIGNED_SESSION_COOKIE}`,
    upstream: async (request) => {
      if (new URL(request.url).pathname === '/api/auth/get-session') {
        return new Response(JSON.stringify(SESSION_PAYLOAD), {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-auth-jwt': JWT_LOOKALIKE }
        });
      }
      return workerPostOk();
    }
  });
  assert.equal(response.status, 201, 'CASE C: a valid session must reach the Worker as an authenticated actor');
  assert.equal(response.headers.get('x-danjion-auth-bridge'), 'direct-jwt',
    'CASE C: the primary leg must be reported as `direct-jwt`');
  const workerCall = seen.at(-1);
  assert.equal(workerCall.headers.get('authorization'), `Bearer ${JWT_LOOKALIKE}`,
    'CASE C: the server-issued JWT must be the Worker bearer');
  assert.equal(response.headers.get('set-auth-jwt'), null,
    'CASE C: the exchanged JWT must never be surfaced to the browser');
}

/* ---------------------------------------------------------------------------
 * CASE D — VALID session + NO set-auth-jwt -> fallback /api/auth/token.
 * When the jwt plugin does not expose the header (the observed Production
 * condition), the opaque session token must be exchanged server-side.
 * ------------------------------------------------------------------------- */
{
  const { response, seen } = await driveCommunity({
    cookie: `${COOKIE_NAME}=${SIGNED_SESSION_COOKIE}`,
    upstream: async (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/api/auth/get-session') {
        return new Response(JSON.stringify(SESSION_PAYLOAD), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (path === '/api/auth/token') {
        return new Response(JSON.stringify({ token: JWT_LOOKALIKE }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return workerPostOk();
    }
  });
  assert.equal(response.status, 201, 'CASE D: the fallback leg must also produce an authenticated Worker request');
  assert.equal(response.headers.get('x-danjion-auth-bridge'), 'fallback-jwt',
    'CASE D: the fallback leg must be reported as `fallback-jwt`');
  const tokenCall = seen.find((r) => new URL(r.url).pathname === '/api/auth/token');
  assert.ok(tokenCall, 'CASE D: the fallback must call the canonical Better Auth /api/auth/token endpoint');
  assert.equal(tokenCall.headers.get('authorization'), `Bearer ${SIGNED_SESSION_COOKIE}`,
    'CASE D: only the opaque session token may be presented to Better Auth /token');
  assert.equal(seen.at(-1).headers.get('authorization'), `Bearer ${JWT_LOOKALIKE}`,
    'CASE D: the exchanged JWT must be the Worker bearer');
  assert.equal(response.headers.get('set-auth-jwt'), null,
    'CASE D: the fallback JWT must never be surfaced to the browser');
}

/* ---------------------------------------------------------------------------
 * CASE E — valid session but the token exchange fails.
 * Every failure leg must fail CLOSED (no bearer attached) with a bounded
 * disposition. This is the leg that produced the #810 user-visible 401.
 * ------------------------------------------------------------------------- */
{
  const legs = [
    { name: 'token-failed', token: async () => new Response('nope', { status: 500 }) },
    { name: 'token-invalid', token: async () => new Response(JSON.stringify({ token: 'not-a-jwt' }), { status: 200 }) }
  ];
  for (const leg of legs) {
    const { response, seen } = await driveCommunity({
      cookie: `${COOKIE_NAME}=${SIGNED_SESSION_COOKIE}`,
      upstream: async (request) => {
        const path = new URL(request.url).pathname;
        if (path === '/api/auth/get-session') {
          return new Response(JSON.stringify(SESSION_PAYLOAD), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
        if (path === '/api/auth/token') return leg.token();
        return workerAuthDenied();
      }
    });
    assert.equal(response.status, 401, `CASE E/${leg.name}: a broken token leg must fail closed`);
    assert.equal(response.headers.get('x-danjion-auth-bridge'), leg.name,
      `CASE E: disposition must be the bounded \`${leg.name}\` diagnostic`);
    assert.equal(seen.at(-1).headers.get('authorization'), null,
      `CASE E/${leg.name}: no bearer may be attached when the exchange failed`);
  }

  // get-session itself failing must be `session-failed`, not a silent fallthrough.
  const { response: failed, seen: failedSeen } = await driveCommunity({
    cookie: `${COOKIE_NAME}=${SIGNED_SESSION_COOKIE}`,
    upstream: async (request) => {
      if (new URL(request.url).pathname === '/api/auth/get-session') {
        return new Response('boom', { status: 500 });
      }
      return workerAuthDenied();
    }
  });
  assert.equal(failed.headers.get('x-danjion-auth-bridge'), 'session-failed',
    'CASE E: a failed get-session must be reported as `session-failed`');
  assert.equal(failedSeen.at(-1).headers.get('authorization'), null,
    'CASE E: a failed get-session must not attach a bearer');

  // Cookie present but not a session token -> `no-session-token`.
  const { response: noTok } = await driveCommunity({
    cookie: '__Secure-better-auth.session_data=whatever',
    upstream: async (request) => {
      if (new URL(request.url).pathname === '/api/auth/get-session') {
        return new Response(JSON.stringify(SESSION_PAYLOAD), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return workerAuthDenied();
    }
  });
  assert.equal(noTok.headers.get('x-danjion-auth-bridge'), 'no-session-token',
    'CASE E: a cookie without a session token must be reported as `no-session-token`');
}

/* ---------------------------------------------------------------------------
 * CASE F — client Authorization injection must never become Worker authority.
 * Even with a VALID session cookie, a browser-supplied Bearer is stripped and
 * the canonical server-side exchange result is the only authority.
 * ------------------------------------------------------------------------- */
{
  const forged = `Bearer ${'z'.repeat(80)}.${'z'.repeat(40)}.${'z'.repeat(40)}`;
  const { response, seen } = await driveCommunity({
    cookie: `${COOKIE_NAME}=${SIGNED_SESSION_COOKIE}`,
    clientAuthorization: forged,
    upstream: async (request) => {
      if (new URL(request.url).pathname === '/api/auth/get-session') {
        return new Response(JSON.stringify(SESSION_PAYLOAD), {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-auth-jwt': JWT_LOOKALIKE }
        });
      }
      return workerPostOk();
    }
  });
  assert.equal(response.status, 201, 'CASE F: the canonical bridge result still authorizes the write');
  assert.equal(seen.at(-1).headers.get('authorization'), `Bearer ${JWT_LOOKALIKE}`,
    'CASE F: only the server-issued JWT may be forwarded; the forged client value must be replaced');
  assert.notEqual(seen.at(-1).headers.get('authorization'), forged,
    'CASE F: a client Authorization header must never reach the Worker verbatim');

  // With NO session cookie, a forged client Bearer must produce no authority at all.
  const { response: bare, seen: bareSeen } = await driveCommunity({
    clientAuthorization: forged,
    upstream: () => workerAuthDenied()
  });
  assert.equal(bare.status, 401, 'CASE F: a forged Bearer without a session must stay unauthorized');
  assert.equal(bareSeen[0].headers.get('authorization'), null,
    'CASE F: a forged Bearer without a session must not be attached');
  assert.equal(bare.headers.get('x-danjion-auth-bridge'), 'no-cookie',
    'CASE F: no cookie means `no-cookie` regardless of a client Bearer');
}

/* ---------------------------------------------------------------------------
 * Contract lock — the auth facade must keep forwarding the session cookie and
 * must never mint browser auth state; the fixed upstream stays pinned.
 * ------------------------------------------------------------------------- */
{
  const seen = [];
  const response = await authFacadeFetch(
    {
      request: new Request(`${PAGES}/api/auth/get-session`, {
        headers: { cookie: `${COOKIE_NAME}=${SIGNED_SESSION_COOKIE}` }
      }),
      env: facadeEnv()
    },
    {
      fetchImpl: async (request) => {
        seen.push(request);
        return new Response(JSON.stringify(SESSION_PAYLOAD), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-auth-jwt': JWT_LOOKALIKE,
            'set-cookie': `${COOKIE_NAME}=rotated; Path=/; Secure; HttpOnly`
          }
        });
      }
    }
  );
  const upstreamUrl = new URL(seen[0].url);
  assert.equal(upstreamUrl.origin + upstreamUrl.pathname, `${WORKER}/api/auth/get-session`,
    'auth facade must proxy get-session to the fixed production Worker');
  assert.equal(seen[0].headers.get('cookie'), `${COOKIE_NAME}=${SIGNED_SESSION_COOKIE}`,
    'auth facade must forward the first-party session cookie server-side');
  assert.equal(seen[0].headers.get('x-danjion-auth-facade'), 'canonical-pages-v1',
    'auth facade must re-pin its internal origin marker');
  assert.equal(response.headers.get('set-auth-jwt'), JWT_LOOKALIKE,
    'the jwt plugin header must survive the auth facade for the bridge to consume it');
  assert.ok(response.headers.get('set-cookie'), 'session cookie rotation must survive the auth facade');
}

/* ---------------------------------------------------------------------------
 * Client runtime — the bounded disposition must survive the browser session
 * runtime and drive a truthful failure classification. No credential, cookie,
 * session token, JWT, Authorization value, or PII may ride along.
 * ------------------------------------------------------------------------- */
{
  const { readFile } = await import('node:fs/promises');
  const sessionSrc = await readFile(new URL('../assets/danjion-session.js', import.meta.url), 'utf8');
  const bridgeSrc = await readFile(new URL('../assets/community-bridge.js', import.meta.url), 'utf8');

  assert.ok(sessionSrc.includes("AUTH_BRIDGE_DISPOSITIONS = Object.freeze(["),
    'the session runtime must declare a closed disposition enum');
  for (const d of ['no-cookie', 'session-failed', 'session-invalid', 'direct-jwt', 'no-session-token', 'token-failed', 'token-invalid', 'fallback-jwt']) {
    assert.ok(sessionSrc.includes(`'${d}'`), `session runtime must know the bounded disposition: ${d}`);
  }
  assert.ok(sessionSrc.includes('function authBridgeDisposition('),
    'session runtime must read the bounded bridge disposition header');
  assert.ok(sessionSrc.includes("response.headers?.get?.('x-danjion-auth-bridge')"),
    'the disposition must come only from the facade response header');
  assert.ok(sessionSrc.includes('function authFailureKind('),
    'session runtime must classify an auth failure truthfully');
  assert.ok(sessionSrc.includes("? 'signed-out'") || sessionSrc.includes("'bridge-fault'"),
    'classification must separate signed-out from a server-side bridge fault');
  // The disposition must never be persisted, logged, or widened into a credential.
  assert.ok(!/AUTH_BRIDGE_DISPOSITIONS[^\n]*cookie/i.test(sessionSrc.replace(/\/\/[^\n]*/g, '')),
    'the disposition enum must not be conflated with cookie material');
  assert.ok(!sessionSrc.includes("localStorage.setItem('x-danjion-auth-bridge'"),
    'the disposition must never be persisted to storage');

  assert.ok(bridgeSrc.includes('function failureDetail(result)'),
    'the community bridge must carry the bounded disposition to the page');
  assert.ok(bridgeSrc.includes('...failureDetail(result)'),
    'every community write/read failure must carry the disposition');
  assert.ok(!/failureDetail[\s\S]{0,120}(cookie|token|jwt|authorization)/i.test(bridgeSrc),
    'the bridge must not attach credentials to the failure detail');

  // 14~17 must all use the identical canonical session/facade path and must not
  // open a second auth path of their own.
  const pages = ['14_가입인사_글쓰기.html', '15_단지이야기_글쓰기.html', '16_궁금해요_글쓰기.html', '17_같이해요_글쓰기.html'];
  for (const page of pages) {
    const src = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.equal((src.match(/DanjionSession\.danjionApiBase\(\)/g) || []).length, 1,
      `${page}: must resolve the canonical apiBase exactly once`);
    assert.equal((src.match(/createCommunityBridge\(\{apiBase\}\)/g) || []).length, 1,
      `${page}: must create exactly one canonical community bridge`);
    assert.equal((src.match(/bridge\.createPost\(/g) || []).length, 1,
      `${page}: must publish through the canonical bridge createPost only`);
    assert.equal((src.match(/[^.\w]fetch\(/g) || []).length, 0,
      `${page}: must never open a per-page fetch/auth bypass`);
    assert.ok(src.includes('DanjionSession.authFailureKind'),
      `${page}: must resolve the truthful failure message through the shared runtime`);
  }

  // Exercise the runtime's classification directly, in a stubbed global.
  const win = {};
  const load = new Function(
    'window',
    'location',
    `${sessionSrc}\n;globalThis.__B810__ = window.DanjionSession;`
  );
  load(win, { hostname: 'localhost', pathname: '/x.html', search: '', origin: 'http://localhost' });
  const S = globalThis.__B810__;
  assert.ok(S && typeof S.authFailureKind === 'function', 'the runtime must export authFailureKind');
  assert.ok(typeof S.authBridgeDisposition === 'function', 'the runtime must export authBridgeDisposition');

  // #808 boundary MUST survive: a 403 is never a bridge fault.
  assert.equal(S.authFailureKind({ reason: 'auth-required', status: 403, error: { code: 'RESIDENT_VERIFICATION_REQUIRED' } }), 'forbidden',
    'a 403 resident-verification denial must stay a forbidden authorization decision');
  assert.equal(S.authFailureKind({ reason: 'auth-required', status: 403 }), 'forbidden',
    'any 403 must stay forbidden, never be re-labelled as a bridge fault');
  assert.equal(S.authFailureKind({ reason: 'auth-required', status: 401, authBridge: 'no-cookie' }), 'signed-out');
  assert.equal(S.authFailureKind({ reason: 'auth-required', status: 401, authBridge: 'session-invalid' }), 'signed-out');
  for (const d of ['session-failed', 'no-session-token', 'token-failed', 'token-invalid']) {
    assert.equal(S.authFailureKind({ reason: 'auth-required', status: 401, authBridge: d }), 'bridge-fault',
      `${d} must be reported as a server-side bridge fault, not an expired login`);
  }
  // Legacy behaviour must be unchanged when no disposition is present.
  assert.equal(S.authFailureKind({ reason: 'auth-required', status: 401 }), 'auth-required');
  assert.equal(S.authFailureKind({ reason: 'server-error', status: 500 }), null);
  assert.equal(S.authFailureKind(null), null);
  // An injected/unknown value must be ignored, never trusted.
  assert.equal(S.authFailureKind({ reason: 'auth-required', status: 401, authBridge: 'cookie=leak' }), 'auth-required',
    'an out-of-enum disposition must never influence classification');
  const withHeader = (v) => ({ headers: { get: () => v } });
  for (const d of S.AUTH_BRIDGE_DISPOSITIONS) {
    assert.equal(S.authBridgeDisposition(withHeader(d)), d, `disposition ${d} must round-trip`);
  }
  assert.equal(S.authBridgeDisposition(withHeader('__Secure-better-auth.session_token=abc')), null,
    'a cookie value must never be accepted as a disposition');
  assert.equal(S.authBridgeDisposition(withHeader('x-danjion-session-token')), null,
    'an unknown token header must never be accepted as a disposition');
  assert.equal(S.authBridgeDisposition(withHeader(null)), null);
  assert.equal(S.authBridgeDisposition({}), null);
  delete globalThis.__B810__;
}

console.log('leaf-b810-community-auth-bridge-contract: PASS');
