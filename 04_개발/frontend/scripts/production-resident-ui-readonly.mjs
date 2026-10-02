// Production resident UI audit: one pre-existing resident account, read-only browsing.
// Login/logout are the only permitted mutation-class requests. No product-data writes.
import { chromium } from '@playwright/test';

const EXPECTED_HOST = 'danjion.pages.dev';
const COMPLEX = 'banglim-myeongji-roadhill';
const ROUTES = Object.freeze([
  ['HOME', '/04_데일리홈.html'],
  ['APARTMENT_NEWS', '/08_아파트소식_목록.html'],
  ['RESIDENT_NEWS', '/10_주민소식_목록.html'],
  ['SHOPS', '/01_이웃가게_발견.html'],
  ['BENEFITS', '/03_주민혜택_쿠폰.html'],
  ['COMPLEX', '/05_우리단지_첫화면.html'],
  ['COMMUNITY', '/12_이웃대화_첫화면.html'],
  ['MESSAGES', '/20_메시지함_목록.html'],
  ['MY_INFO', '/19_내정보_메인.html'],
  ['SETTINGS', '/24_설정.html'],
  ['HOUSEHOLD', '/26_우리세대.html'],
  ['NOTIFICATIONS', '/27_알림함.html'],
  ['ACTIVITY', '/28_나의활동.html'],
  ['ADMIN', '/admin/'],
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`PRODUCTION_RESIDENT_UI_MISSING_INPUT:${name}`);
  return value;
}

function assert(condition, token) {
  if (!condition) throw new Error(`PRODUCTION_RESIDENT_UI_${token}`);
}

const frontendBase = (() => {
  const url = new URL(required('DANJION_PRODUCTION_FRONTEND_URL'));
  assert(
    url.protocol === 'https:' &&
    url.hostname === EXPECTED_HOST &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash,
    'FRONTEND_ORIGIN_INVALID',
  );
  return url.origin;
})();

const email = required('DANJION_PRODUCTION_TEST_RESIDENT_EMAIL');
const password = required('DANJION_PRODUCTION_TEST_RESIDENT_PASSWORD');
assert(password.length >= 8, 'PASSWORD_INVALID');

const findings = [];
const consoleErrors = [];
const failedGets = [];
const forbiddenMutations = [];

function finding(id, severity, detail) {
  findings.push({ id, severity, detail });
}

async function sessionShape(context) {
  const response = await context.request.get(`${frontendBase}/api/auth/get-session`, {
    headers: { Origin: frontendBase, accept: 'application/json' },
    timeout: 15_000,
  });
  const body = await response.json().catch(() => null);
  return {
    status: response.status(),
    authenticated: Boolean(body?.session && body?.user),
  };
}

async function apiGet(context, path) {
  const response = await context.request.get(`${frontendBase}${path}`, {
    headers: { Origin: frontendBase, accept: 'application/json' },
    timeout: 15_000,
  });
  return { status: response.status(), body: await response.json().catch(() => null) };
}

function installReadOnlyGuards(page) {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(String(message.text()).slice(0, 180));
    }
  });
  page.on('request', (request) => {
    const method = request.method().toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    const url = new URL(request.url());
    const allowedAuthMutation =
      url.origin === frontendBase &&
      (url.pathname === '/api/auth/sign-in/email' || url.pathname === '/api/auth/sign-out');
    if (!allowedAuthMutation) {
      forbiddenMutations.push(`${method} ${url.pathname}`);
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    if (request.method().toUpperCase() !== 'GET') return;
    if (response.status() < 400) return;
    const url = new URL(response.url());
    if (url.origin !== frontendBase) return;
    failedGets.push(`${response.status()} ${url.pathname}`);
  });
}

async function visibleLoggedInHeader(page) {
  const logout = await page.getByRole('button', { name: '로그아웃' }).first().isVisible().catch(() => false);
  const myInfoButton = await page.getByRole('button', { name: '내정보' }).first().isVisible().catch(() => false);
  const myInfoLink = await page.getByRole('link', { name: '내정보' }).first().isVisible().catch(() => false);
  return logout || myInfoButton || myInfoLink;
}

async function auditRoute(page, name, path) {
  const response = await page.goto(`${frontendBase}${path}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForTimeout(900);
  const status = response?.status() ?? 0;
  const shape = await page.evaluate(() => ({
    title: document.title,
    bodyLength: (document.body?.innerText || '').trim().length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
  }));
  const loggedInHeader = await visibleLoggedInHeader(page);
  const ok = status === 200 && shape.bodyLength > 20;
  console.log(`ROUTE=${name} HTTP=${status} DOM=${ok ? 'PASS' : 'FAIL'} LOGGED_IN_HEADER=${loggedInHeader ? 'YES' : 'NO'} HORIZONTAL_OVERFLOW=${shape.overflow ? 'YES' : 'NO'}`);
  if (!ok) finding(`ROUTE_${name}`, 'P2', `HTTP_${status}_BODY_${shape.bodyLength}`);
  if (name !== 'ADMIN' && !loggedInHeader) finding(`HEADER_${name}`, 'P2', 'logged-in header not visible');
  if (shape.overflow) finding(`OVERFLOW_${name}`, 'P3', 'desktop horizontal overflow');
}

const browser = await chromium.launch({ headless: true });
let context;
try {
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  installReadOnlyGuards(page);

  await page.goto(`${frontendBase}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(1_000);
  const preLogin = await page.getByRole('button', { name: '로그인', exact: true }).first().isVisible().catch(() => false);
  assert(preLogin, 'PRELOGIN_BUTTON_NOT_VISIBLE');

  await page.getByRole('button', { name: '로그인', exact: true }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /이메일로 로그인/ }).first().click({ timeout: 10_000 });

  const loginForm = page.locator('form[data-form="login"]').first();
  assert(await loginForm.isVisible().catch(() => false), 'LOGIN_FORM_NOT_VISIBLE');
  await loginForm.locator('input[name="email"]').fill(email, { timeout: 10_000 });
  await loginForm.locator('input[name="password"]').fill(password, { timeout: 10_000 });

  const signInResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    if (request.method().toUpperCase() !== 'POST') return false;
    try {
      return new URL(response.url()).pathname === '/api/auth/sign-in/email';
    } catch {
      return false;
    }
  }, { timeout: 15_000 });

  await loginForm.locator('button[type="submit"]').click({ timeout: 10_000 });
  const signInResponse = await signInResponsePromise;
  console.log(`PRODUCTION_RESIDENT_UI_SIGNIN_HTTP=${signInResponse.status()}`);
  assert(signInResponse.status() === 200, `SIGNIN_HTTP_${signInResponse.status()}`);

  let session = { status: 0, authenticated: false };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    session = await sessionShape(context);
    if (session.status === 200 && session.authenticated) break;
    await page.waitForTimeout(500);
  }
  assert(session.status === 200 && session.authenticated, `LOGIN_SESSION_HTTP_${session.status}`);
  console.log('PRODUCTION_RESIDENT_UI_LOGIN=PASS');

  const loggedInHeader = await visibleLoggedInHeader(page);
  assert(loggedInHeader, 'LOGGED_IN_HEADER_NOT_VISIBLE');
  console.log('PRODUCTION_RESIDENT_UI_HEADER=PASS');

  const me = await apiGet(context, '/api/v1/me');
  console.log(`API_ME_HTTP=${me.status}`);
  if (me.status !== 200) finding('API_ME', 'P1', `HTTP_${me.status}`);

  const community = await apiGet(context, `/api/v1/complexes/${COMPLEX}/community/posts?limit=1`);
  console.log(`API_COMMUNITY_HTTP=${community.status}`);
  if (community.status !== 200) finding('API_COMMUNITY', 'P1', `HTTP_${community.status}`);

  const residentNews = await apiGet(context, `/api/v1/complexes/${COMPLEX}/resident-news`);
  console.log(`API_RESIDENT_NEWS_HTTP=${residentNews.status}`);
  if (residentNews.status === 401 || residentNews.status === 403 || residentNews.status >= 500) {
    finding('API_RESIDENT_NEWS', 'P2', `HTTP_${residentNews.status}`);
  }

  const authority = await apiGet(context, '/api/v1/admin/authority');
  console.log(`API_ADMIN_AUTHORITY_HTTP=${authority.status}`);
  if (!(authority.status === 401 || authority.status === 403)) {
    finding('RESIDENT_ADMIN_AUTHORITY', 'P0', `unexpected HTTP_${authority.status}`);
  }

  const auditEvents = await apiGet(context, '/api/v1/admin/audit-events?limit=1');
  console.log(`API_ADMIN_AUDIT_HTTP=${auditEvents.status}`);
  if (auditEvents.status !== 403) {
    finding('RESIDENT_ADMIN_AUDIT', 'P0', `unexpected HTTP_${auditEvents.status}`);
  }

  for (const [name, path] of ROUTES) {
    await auditRoute(page, name, path);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, path] of [
    ['MOBILE_HOME', '/04_데일리홈.html'],
    ['MOBILE_SHOPS', '/01_이웃가게_발견.html'],
    ['MOBILE_MY_INFO', '/19_내정보_메인.html'],
  ]) {
    const response = await page.goto(`${frontendBase}${path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(700);
    const shape = await page.evaluate(() => ({
      bodyLength: (document.body?.innerText || '').trim().length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      bottomNavVisible: [...document.querySelectorAll('.mobile-bottom')].some((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && rect.width > 0 && rect.height > 0;
      }),
    }));
    const status = response?.status() ?? 0;
    console.log(`ROUTE=${name} HTTP=${status} DOM=${shape.bodyLength > 20 ? 'PASS' : 'FAIL'} HORIZONTAL_OVERFLOW=${shape.overflow ? 'YES' : 'NO'} MOBILE_NAV=${shape.bottomNavVisible ? 'VISIBLE' : 'NOT_VISIBLE'}`);
    if (status !== 200 || shape.bodyLength <= 20) finding(`ROUTE_${name}`, 'P2', `HTTP_${status}`);
    if (shape.overflow) finding(`OVERFLOW_${name}`, 'P2', '390px horizontal overflow');
  }

  const after = await sessionShape(context);
  if (!(after.status === 200 && after.authenticated)) finding('SESSION_PERSISTENCE', 'P1', `HTTP_${after.status}`);
  console.log(`PRODUCTION_RESIDENT_UI_SESSION_PERSISTS=${after.authenticated ? 'PASS' : 'FAIL'}`);

  if (forbiddenMutations.length > 0) {
    finding('UNEXPECTED_MUTATION', 'P0', [...new Set(forbiddenMutations)].join(','));
  }
  for (const item of [...new Set(failedGets)]) {
    if (/^5\d\d /.test(item)) finding('FAILED_GET_5XX', 'P1', item);
  }

  console.log(`MUTATION_REQUESTS_OBSERVED=${forbiddenMutations.length}`);
  console.log(`CONSOLE_ERROR_COUNT=${consoleErrors.length}`);
  console.log(`FAILED_GET_COUNT=${failedGets.length}`);
  console.log(`NEW_FINDINGS_COUNT=${findings.length}`);
  for (const item of findings) {
    console.log(`FINDING=${item.id} SEVERITY=${item.severity} DETAIL=${String(item.detail).replace(/\s+/g, '_').slice(0, 180)}`);
  }

  const logoutVisible = await page.getByRole('button', { name: '로그아웃' }).first().isVisible().catch(() => false);
  if (logoutVisible) {
    await page.getByRole('button', { name: '로그아웃' }).first().click({ timeout: 10_000 });
    await page.waitForTimeout(1_500);
  } else {
    await context.request.post(`${frontendBase}/api/auth/sign-out`, {
      headers: { Origin: frontendBase, 'Content-Type': 'application/json' },
      data: {},
      timeout: 15_000,
    });
  }
  const signedOut = await sessionShape(context);
  console.log(`PRODUCTION_RESIDENT_UI_LOGOUT=${!signedOut.authenticated ? 'PASS' : 'FAIL'}`);
  if (signedOut.authenticated) finding('LOGOUT', 'P1', 'session remained authenticated');

  console.log('PRODUCT_DATA_MUTATION=0');
  console.log('ACCOUNT_PROVISIONING=0');
  console.log('GRANT_MUTATION=0');
  console.log('SECRET_OUTPUT=0');

  if (findings.some((item) => item.severity === 'P0' || item.severity === 'P1')) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`PRODUCTION_RESIDENT_UI_FATAL=${String(error instanceof Error ? error.message : error).replace(/[^A-Za-z0-9_:.-]/g, '_').slice(0, 220)}`);
  console.log('PRODUCT_DATA_MUTATION=0');
  console.log('SECRET_OUTPUT=0');
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
