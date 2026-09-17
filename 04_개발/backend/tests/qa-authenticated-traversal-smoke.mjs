import assert from 'node:assert/strict';

const PROD_API_HOST = 'padiem-danjion-api-production.padiem.workers.dev';
const PROD_PAGES_HOST = 'danjion.pages.dev';
const QA_API_PREFIX = 'padiem-danjion-api-qa.';
const QA_PAGES_HOST = 'danjion-qa.pages.dev';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_REQUIRED_QA_INPUT:${name}`);
  return value;
}

function secureBase(raw, name) {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error(`${name}_MUST_USE_HTTPS`);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/$/, '');
  return url;
}

function assertQaTargets(apiBase, frontendBase) {
  if (apiBase.hostname === PROD_API_HOST) throw new Error('PRODUCTION_API_TARGET_FORBIDDEN');
  if (frontendBase.hostname === PROD_PAGES_HOST) throw new Error('PRODUCTION_PAGES_TARGET_FORBIDDEN');
  if (!apiBase.hostname.startsWith(QA_API_PREFIX) || !apiBase.hostname.endsWith('.workers.dev')) {
    throw new Error('QA_API_TARGET_INVALID');
  }
  if (frontendBase.hostname !== QA_PAGES_HOST) throw new Error('QA_PAGES_TARGET_INVALID');
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [];
  return values
    .map((value) => value.split(';', 1)[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

function authHeaders(origin, cookie, sessionBearer) {
  return {
    accept: 'application/json',
    origin,
    ...(cookie ? { cookie } : {}),
    ...(sessionBearer ? { authorization: `Bearer ${sessionBearer}` } : {})
  };
}

async function expectStatus(label, response, expected = 200) {
  assert.equal(response.status, expected, `${label}: expected HTTP ${expected}, got ${response.status}`);
  console.log(`PASS ${label} -> HTTP ${response.status}`);
}

const apiBase = secureBase(required('DANJION_QA_API_URL'), 'DANJION_QA_API_URL');
const frontendBase = secureBase(required('DANJION_QA_FRONTEND_URL'), 'DANJION_QA_FRONTEND_URL');
const email = required('DANJION_QA_EMAIL');
const password = required('DANJION_QA_PASSWORD');

assertQaTargets(apiBase, frontendBase);
assert.match(email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'QA email must be syntactically valid');
assert.ok(password.length >= 8, 'QA password must satisfy the current credential minimum');

const api = (path) => new URL(path, apiBase.origin);
const page = (path) => new URL(path, frontendBase.origin);
const origin = frontendBase.origin;

const routes = [
  '/',
  '/04_데일리홈.html',
  '/01_이웃가게_발견.html',
  '/05_우리단지_첫화면.html',
  '/06_단지온공지_목록.html',
  '/08_아파트소식_목록.html',
  '/10_주민소식_목록.html',
  '/19_내정보_메인.html',
  '/26_우리집연결.html'
];

let cookie = '';
let sessionBearer = '';

try {
  const health = await fetch(api('/api/health'), {
    headers: { accept: 'application/json' },
    redirect: 'manual'
  });
  await expectStatus('QA public health', health);

  const signIn = await fetch(api('/api/auth/sign-in/email'), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      origin
    },
    body: JSON.stringify({ email, password }),
    redirect: 'manual'
  });
  await expectStatus('QA Better Auth email sign-in', signIn);

  cookie = cookieHeader(signIn);
  sessionBearer = signIn.headers.get('set-auth-token')?.trim() || '';
  assert.ok(cookie || sessionBearer, 'sign-in must return a session credential without logging it');

  const session = await fetch(api('/api/auth/get-session'), {
    headers: authHeaders(origin, cookie, sessionBearer),
    redirect: 'manual'
  });
  await expectStatus('QA Better Auth session readback', session);

  const sessionBody = await session.json().catch(() => null);
  assert.ok(sessionBody?.session && sessionBody?.user, 'get-session must return an authenticated session');

  let jwt = session.headers.get('set-auth-jwt')?.trim() || '';
  if (!jwt) {
    const token = await fetch(api('/api/auth/token'), {
      headers: authHeaders(origin, cookie, sessionBearer),
      redirect: 'manual'
    });
    await expectStatus('QA Better Auth service JWT', token);
    const tokenBody = await token.json().catch(() => null);
    jwt = typeof tokenBody?.token === 'string' ? tokenBody.token.trim() : '';
  }
  assert.ok(jwt, 'QA session must yield a service JWT without printing it');

  const me = await fetch(api('/api/v1/me'), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${jwt}`,
      origin
    },
    redirect: 'manual'
  });
  await expectStatus('QA authenticated DanjiOn product API', me);

  for (const route of routes) {
    const response = await fetch(page(route), {
      headers: { accept: 'text/html' },
      redirect: 'follow'
    });
    await expectStatus(`QA canonical V3 route ${route}`, response);
  }

  console.log('QA_AUTH_PHASE1=PASS');
  console.log('PRODUCTION_TARGET=NO');
  console.log('DEV_AUTH_BYPASS=NO');
  console.log('SECRET_OUTPUT=NO');
} finally {
  if (cookie || sessionBearer) {
    const signOut = await fetch(api('/api/auth/sign-out'), {
      method: 'POST',
      headers: {
        ...authHeaders(origin, cookie, sessionBearer),
        'content-type': 'application/json'
      },
      body: '{}',
      redirect: 'manual'
    }).catch(() => null);

    if (signOut) {
      if (signOut.ok) console.log('PASS QA Better Auth sign-out');
      else console.log(`WARN QA Better Auth sign-out -> HTTP ${signOut.status}`);
    }
  }
}
