import { chromium } from '@playwright/test';

const FRONTEND = 'https://danjion-qa.pages.dev';
const API = 'https://padiem-danjion-api-qa.padiem.workers.dev';
const COMPLEX = 'banglim-myeongji-roadhill';
const stamp = Date.now().toString(36);
const email = process.env.DANJION_QA_RESIDENT_EMAIL?.trim();
const password = process.env.DANJION_QA_RESIDENT_PASSWORD?.trim();
if (!email || !password) {
  console.error('QA_830_MISSING_CREDENTIALS');
  process.exit(1);
}

const results = [];
const events = [];
function record(label, pass, detail = '') {
  results.push(`${label}=${pass ? 'PASS' : 'FAIL'}${detail ? `:${detail}` : ''}`);
}

function classify(status, body) {
  const code = String(body?.error?.code || '');
  if (status === 401) return { auth: false, disposition: 'AUTH_REQUIRED' };
  if (status === 403 && ['RESIDENT_VERIFICATION_REQUIRED', 'HOUSEHOLD_ASSOCIATION_REQUIRED'].includes(code)) {
    return { auth: true, disposition: code };
  }
  if (status === 403) return { auth: true, disposition: 'FORBIDDEN_PRODUCT_POLICY' };
  if (status >= 400 && status < 500) return { auth: true, disposition: `VALIDATION_OR_PRODUCT_${status}` };
  return { auth: status >= 200 && status < 300, disposition: status >= 200 && status < 300 ? 'SUCCESS' : `SERVER_${status}` };
}

async function json(response) {
  return response.json().catch(() => null);
}

async function call(request, label, path, init = {}) {
  if (!FRONTEND.startsWith('https://danjion-qa.pages.dev') || !API.startsWith('https://padiem-danjion-api-qa.')) {
    throw new Error('QA_TARGET_GUARD_FAILED');
  }
  const response = await request.fetch(`${FRONTEND}${path}`, {
    ...init,
    headers: { accept: 'application/json', Origin: FRONTEND, ...(init.headers || {}) }
  });
  const body = await json(response);
  const bridge = response.headers()['x-danjion-auth-bridge'] || '-';
  const facade = response.headers()['x-danjion-app-facade'] || response.headers()['x-danjion-auth-facade'] || '-';
  events.push(`${label}:HTTP_${response.status()}:API_PATH=${new URL(response.url()).pathname}:AUTH_BRIDGE_HEADER=${bridge}:APP_FACADE_HEADER=${facade}`);
  return { response, body, ...classify(response.status(), body) };
}

async function pageCall(page, label, method, path, action) {
  const responsePromise = page.waitForResponse((response) => {
    if (response.request().method() !== method) return false;
    try { return new URL(response.url()).pathname === path; } catch { return false; }
  }, { timeout: 15_000 });
  await action();
  const response = await responsePromise;
  const body = await response.json().catch(() => null);
  const bridge = response.headers()['x-danjion-auth-bridge'] || '-';
  const facade = response.headers()['x-danjion-app-facade'] || response.headers()['x-danjion-auth-facade'] || '-';
  events.push(`${label}:HTTP_${response.status()}:API_PATH=${path}:AUTH_BRIDGE_HEADER=${bridge}:APP_FACADE_HEADER=${facade}`);
  return { response, body, ...classify(response.status(), body) };
}

async function session(request, label) {
  const result = await call(request, label, '/api/auth/get-session');
  const authenticated = Boolean(result.body?.session && result.body?.user);
  record(`${label}_SESSION`, authenticated, `HTTP_${result.response.status()}`);
  return authenticated;
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${FRONTEND}/01_%EC%9D%B4%EC%9B%83%EA%B0%80%EA%B2%8C_%EB%B0%9C%EA%B2%AC.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const signIn = await context.request.post(`${FRONTEND}/api/auth/sign-in/email`, {
    headers: { Origin: FRONTEND, 'Content-Type': 'application/json' },
    data: { email, password }
  });
  record('SIGN_IN', signIn.status() === 200, `HTTP_${signIn.status()}`);
  let authenticated = await session(context.request, 'SESSION_BEFORE');
  if (!authenticated) throw new Error('QA_830_SESSION_NOT_AUTHENTICATED');

  const businesses = await call(context.request, 'BUSINESSES', `/api/v1/complexes/${COMPLEX}/businesses?limit=50`);
  const business = businesses.body?.data?.find((row) => row?.id) || null;
  const businessId = String(business?.id || '');
  record('SERVER_BUSINESS_RESOLVED', Boolean(businessId), businesses.disposition);
  if (!businessId) throw new Error('QA_830_NO_SERVER_BUSINESS');
  const shopKey = `api-${businessId}`;

  await page.goto(`${FRONTEND}/01_%EC%9D%B4%EC%9B%83%EA%B0%80%EA%B2%8C_%EB%B0%9C%EA%B2%AC.html?shop=${encodeURIComponent(shopKey)}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator(`[data-shop-key="${shopKey}"]`).first().click({ timeout: 15_000 });
  await page.locator('#shopReviewOpen2').click({ timeout: 10_000 });
  await page.locator('#shopReviewInput').fill(`[QA #830] review ${stamp}`);
  const review = await pageCall(page, 'REVIEW', 'POST', `/api/v1/complexes/${COMPLEX}/businesses/${businessId}/reviews`,
    () => page.locator('#shopReviewSubmit').click({ timeout: 10_000 }));
  record('REVIEW_ACCEPTANCE', review.auth, review.disposition);
  authenticated = await session(context.request, 'REVIEW_AFTER');
  if (!authenticated) record('REVIEW_SESSION_PRESERVED', false, 'SESSION_LOST');

  const bookmarks = await call(context.request, 'BOOKMARK_LOAD', '/api/v1/me/bookmarks');
  record('BOOKMARK_LOAD', bookmarks.auth, bookmarks.disposition);
  const bookmark = await pageCall(page, 'BOOKMARK_TOGGLE', 'POST', `/api/v1/me/bookmarks/${businessId}`,
    () => page.locator('#shopCompareSave').click({ timeout: 10_000 }).catch(async () => {
      await page.locator(`[data-shop-key="${shopKey}"]`).first().click({ timeout: 10_000 });
      await page.locator('#shopCompareSave').click({ timeout: 10_000 });
    }));
  record('BOOKMARK_ACCEPTANCE', bookmark.auth, bookmark.disposition);
  record('BOOKMARK_TOGGLE', bookmark.auth, bookmark.disposition);
  if (bookmark.response.status() >= 200 && bookmark.response.status() < 300) {
    await pageCall(page, 'BOOKMARK_CLEANUP', 'DELETE', `/api/v1/me/bookmarks/${businessId}`,
      () => page.locator('#shopCompareSave').click({ timeout: 10_000 }));
  }
  authenticated = await session(context.request, 'BOOKMARK_AFTER');

  await page.goto(`${FRONTEND}/01_%EC%9D%B4%EC%9B%83%EA%B0%80%EA%B2%8C_%EB%B0%9C%EA%B2%AC.html?shop=${encodeURIComponent(shopKey)}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator(`[data-shop-key="${shopKey}"]`).first().click({ timeout: 10_000 });
  await page.locator('#shopCompareInquiry').click({ timeout: 10_000 });
  await page.locator('#shopInquirySubject').fill(`[QA #830] inquiry ${stamp}`);
  await page.locator('#shopInquiryText').fill(`QA #830 shop inquiry ${stamp}`);
  const inquiry = await pageCall(page, 'INQUIRY', 'POST', '/api/v1/me/inquiries',
    () => page.locator('#shopInquiryForm button[type="submit"]').click({ timeout: 10_000 }));
  record('INQUIRY_ACCEPTANCE', inquiry.auth, inquiry.disposition);
  authenticated = await session(context.request, 'INQUIRY_AFTER');

  await page.goto(`${FRONTEND}/25A_%EC%8B%A0%EC%B2%AD%EC%A0%9C%EB%B3%B4.html?mode=report`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('[name="reportShopName"]').fill(`[QA #830] report ${stamp}`);
  await page.locator('[name="reportWhat"]').fill('QA authenticated report acceptance');
  await page.locator('[name="reportLocation"]').fill('QA only');
  await page.locator('[name="reportReason"]').fill(`[QA #830] ${stamp}`);
  const report = await pageCall(page, 'REPORT', 'POST', '/api/v1/me/shop-recommendations',
    () => page.locator('#requestForm').evaluate((form) => form.requestSubmit()));
  record('REPORT_ACCEPTANCE', report.auth, report.disposition);
  authenticated = await session(context.request, 'REPORT_AFTER');

  const community = [
    ['GREETING', '14_%EA%B0%80%EC%9E%85%EC%9D%B8%EC%82%AC_%EA%B8%80%EC%93%B0%EA%B8%B0.html', 'greeting'],
    ['STORY', '15_%EB%8B%A8%EC%A7%80%EC%9D%B4%EC%95%BC%EA%B8%B0_%EA%B8%80%EC%93%B0%EA%B8%B0.html', 'resident_story'],
    ['QUESTION', '16_%EA%B6%81%EA%B8%88%ED%95%B4%EC%9A%94_%EA%B8%80%EC%93%B0%EA%B8%B0.html', 'question'],
    ['TOGETHER', '17_%EA%B0%99%EC%9D%B4%ED%95%B4%EC%9A%94_%EA%B8%80%EC%93%B0%EA%B8%B0.html', 'together']
  ];
  for (const [label, route, kind] of community) {
    await page.goto(`${FRONTEND}/${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (kind === 'question') await page.locator('[data-type="생활·살림"]').click().catch(() => {});
    if (kind === 'together') await page.locator('[data-kind="산책·운동"]').click().catch(() => {});
    await page.locator('#title').fill(`[QA #830 ${kind} ${stamp}]`);
    await page.locator('#body').fill(`QA #830 authenticated ${kind} acceptance ${stamp}`);
    const result = await pageCall(page, `COMMUNITY_${label}`, 'POST', `/api/v1/complexes/${COMPLEX}/community/posts`,
      () => page.locator('[data-publish]').first().click({ timeout: 10_000 }));
    record(`${label}_ACCEPTANCE`, result.auth, result.disposition);
    authenticated = await session(context.request, `${label}_AFTER`);
  }

  record('SESSION_AFTER', authenticated);
  console.log('=== QA #830 AUTHENTICATED ACCEPTANCE ===');
  for (const line of events) console.log(line);
  for (const line of results) console.log(line);
  console.log('QA_TARGET=NON_PRODUCTION_ONLY');
  console.log('PRODUCTION_TARGET=NO');
  console.log('SECRET_OUTPUT=NO');
  console.log(`QA_MUTATION_SCOPE=STAMP_${stamp}`);
  if (results.some((line) => line.includes('=FAIL'))) process.exitCode = 1;
  await context.close();
} catch (error) {
  console.error(`QA_830_ACCEPTANCE_FAILED=${error instanceof Error ? error.message : 'UNKNOWN'}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
