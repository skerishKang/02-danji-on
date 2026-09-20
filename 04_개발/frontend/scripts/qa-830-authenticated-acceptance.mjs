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

/*
 * Evidence records whether the auth bridge / app facade ran, never what the
 * headers carried: a header value is not proven safe to print.
 */
function headerEvidence(headers) {
  const facadePresent = Boolean(headers['x-danjion-app-facade'] || headers['x-danjion-auth-facade']);
  return `AUTH_BRIDGE_PRESENT=${Boolean(headers['x-danjion-auth-bridge'])}:APP_FACADE_PRESENT=${facadePresent}`;
}

const UNPRINTABLE_EVIDENCE = /cookie|authorization|bearer|password|secret/i;
const TOKEN_SHAPED = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
function boundedError(error) {
  const safe = String(error instanceof Error ? error.message : 'UNKNOWN')
    .slice(0, 120)
    .replace(/[^\w:=.\- ]/g, '');
  if (!safe || UNPRINTABLE_EVIDENCE.test(safe) || TOKEN_SHAPED.test(safe)) return 'REDACTED';
  return safe;
}

function flushEvidence(heading) {
  console.log(heading);
  // events and results are bounded by construction: status codes, pathnames,
  // header presence, and fixed disposition labels.
  for (const line of events) console.log(line);
  for (const line of results) console.log(line);
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
  events.push(`${label}:HTTP_${response.status()}:API_PATH=${new URL(response.url()).pathname}:${headerEvidence(response.headers())}`);
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
  events.push(`${label}:HTTP_${response.status()}:API_PATH=${path}:${headerEvidence(response.headers())}`);
  return { response, body, ...classify(response.status(), body) };
}

async function session(request, label) {
  const result = await call(request, label, '/api/auth/get-session');
  const authenticated = Boolean(result.body?.session && result.body?.user);
  record(`${label}_SESSION`, authenticated, `HTTP_${result.response.status()}`);
  return authenticated;
}

const browser = await chromium.launch({ headless: true });
let BOOKMARK_INITIAL_STATE = '';
let BOOKMARK_TOGGLE_METHOD = '';
let BOOKMARK_TOGGLE_AUTH = false;
let BOOKMARK_RESTORED = false;
/* Bookmark residue must be visible on the failure path too. */
function emitBookmarkMarkers() {
  console.log(`BOOKMARK_INITIAL_STATE=${BOOKMARK_INITIAL_STATE || 'UNKNOWN'}`);
  console.log(`BOOKMARK_TOGGLE_METHOD=${BOOKMARK_TOGGLE_METHOD || 'UNKNOWN'}`);
  console.log(`BOOKMARK_TOGGLE_AUTH=${BOOKMARK_TOGGLE_AUTH}`);
  console.log(`BOOKMARK_RESTORED=${BOOKMARK_RESTORED}`);
}
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

  /* --- bookmark: state-independent toggle + proven restore via final readback --- */
  const togglePath = `/api/v1/me/bookmarks/${businessId}`;
  const saveToggle = () => page.locator('#shopCompareSave').click({ timeout: 10_000 });

  // A. initial state comes from the real server list, never from an assumption.
  const bookmarkInitial = await call(context.request, 'BOOKMARK_INITIAL', '/api/v1/me/bookmarks');
  record('BOOKMARK_LOAD', bookmarkInitial.auth, bookmarkInitial.disposition);
  const initialIds = new Set((bookmarkInitial.body?.data || []).map((b) => String(b?.businessId || b?.id)));
  const wasBookmarked = initialIds.has(businessId);
  BOOKMARK_INITIAL_STATE = wasBookmarked ? 'BOOKMARKED' : 'NOT_BOOKMARKED';

  // B. first toggle moves away from the initial state.
  const toggleMethod = wasBookmarked ? 'DELETE' : 'POST';
  const toggle = await pageCall(page, 'BOOKMARK_TOGGLE', toggleMethod, togglePath, saveToggle);
  record('BOOKMARK_ACCEPTANCE', toggle.auth, toggle.disposition);
  record('BOOKMARK_TOGGLE', toggle.auth, toggle.disposition);
  BOOKMARK_TOGGLE_METHOD = toggleMethod;
  // C. a 401 on the toggle is an outright failure, and auth is recorded explicitly.
  const toggleStatus = toggle.response.status();
  const toggleOk = toggleStatus >= 200 && toggleStatus < 300;
  BOOKMARK_TOGGLE_AUTH = toggle.auth && !(toggleStatus === 401);
  if (toggleStatus === 401) record('BOOKMARK_TOGGLE_401', false, 'AUTH_REQUIRED');
  authenticated = await session(context.request, 'BOOKMARK_AFTER');

  // D. restore returns membership to exactly the initial state.
  const restoreMethod = wasBookmarked ? 'POST' : 'DELETE';
  let restoreOk = false;
  if (toggleOk) {
    const restore = await pageCall(page, 'BOOKMARK_RESTORE', restoreMethod, togglePath, saveToggle);
    const restoreStatus = restore.response.status();
    // E. the restore response is inspected; a 401 is never treated as success.
    restoreOk = restoreStatus >= 200 && restoreStatus < 300;
    if (restoreStatus === 401) record('BOOKMARK_RESTORE_401', false, 'AUTH_REQUIRED');
    record('BOOKMARK_RESTORE', restoreOk, restore.disposition);
  } else {
    record('BOOKMARK_RESTORE', false, 'TOGGLE_NOT_ACCEPTED');
  }

  // F. final readback proves membership matches the initial state, not a guess.
  const bookmarkFinal = await call(context.request, 'BOOKMARK_FINAL', '/api/v1/me/bookmarks');
  const finalIds = new Set((bookmarkFinal.body?.data || []).map((b) => String(b?.businessId || b?.id)));
  const finalBookmarked = finalIds.has(businessId);
  const membershipRestored = bookmarkFinal.auth && restoreOk && finalBookmarked === wasBookmarked;
  BOOKMARK_RESTORED = membershipRestored;
  record('BOOKMARK_FINAL_READBACK', bookmarkFinal.auth, bookmarkFinal.disposition);
  if (!membershipRestored) record('BOOKMARK_RESTORED', false, `FINAL_${finalBookmarked ? 'BOOKMARKED' : 'NOT_BOOKMARKED'}_VS_INITIAL_${BOOKMARK_INITIAL_STATE}`);
  else record('BOOKMARK_RESTORED', true);
  authenticated = await session(context.request, 'BOOKMARK_READBACK_AFTER');

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
    if (kind === 'question') await page.locator('[data-type="생활·살림"]').click({ timeout: 10_000 });
    // selector mismatch must fail the run — no silent catch, no fail-open skip.
    if (kind === 'together') await page.locator('[data-kind="walk"]').click({ timeout: 10_000 });
    await page.locator('#title').fill(`[QA #830 ${kind} ${stamp}]`);
    await page.locator('#body').fill(`QA #830 authenticated ${kind} acceptance ${stamp}`);
    const result = await pageCall(page, `COMMUNITY_${label}`, 'POST', `/api/v1/complexes/${COMPLEX}/community/posts`,
      () => page.locator('[data-publish]').first().click({ timeout: 10_000 }));
    record(`${label}_ACCEPTANCE`, result.auth, result.disposition);
    authenticated = await session(context.request, `${label}_AFTER`);
  }

  record('SESSION_AFTER', authenticated);
  flushEvidence('=== QA #830 AUTHENTICATED ACCEPTANCE ===');
  emitBookmarkMarkers();
  console.log('QA_TARGET=NON_PRODUCTION_ONLY');
  console.log('PRODUCTION_TARGET=NO');
  console.log('SECRET_OUTPUT=NO');
  console.log(`QA_MUTATION_SCOPE=STAMP_${stamp}`);
  if (results.some((line) => line.includes('=FAIL'))) process.exitCode = 1;
  await context.close();
} catch (error) {
  flushEvidence('=== QA #830 AUTHENTICATED ACCEPTANCE FAILURE EVIDENCE ===');
  emitBookmarkMarkers();
  console.error(`QA_830_ACCEPTANCE_FAILED=${boundedError(error)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
