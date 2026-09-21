import { writeSync } from 'node:fs';
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
/*
 * Last announced step. A wall-clock kill (OS timeout / job timeout) gives the
 * process no chance to flush anything, so the step name is read back from a
 * signal handler instead.
 */
let lastStep = 'NONE';
function step(name) {
  lastStep = name;
  console.log(`STEP=${name}`);
  return `STEP=${name}`;
}
/*
 * Stream every evidence line as it is produced. The run can hang or be
 * cancelled mid-flow, and GitHub only publishes logs after a job finishes —
 * buffering everything until flushEvidence made two consecutive hangs
 * completely unreadable. flushEvidence still replays the whole set at the end.
 */
function emit(line) {
  console.log(line);
  return line;
}
function record(label, pass, detail = '') {
  const line = `${label}=${pass ? 'PASS' : 'FAIL'}${detail ? `:${detail}` : ''}`;
  results.push(line);
  emit(line);
}

/* A locator.evaluate() call has no timeout of its own: if the page function
   never settles the run hangs forever. Every action that cannot carry an
   explicit timeout is raced against one here. */
async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`QA_830_STEP_TIMEOUT:${label}:${ms}ms`)), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
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

/*
 * A malformed or non-JSON body still degrades to null — that is a server
 * answering oddly, and the disposition logic handles it. A *timeout* is different:
 * it must fail closed and reach the top-level failure evidence. Otherwise a 2xx
 * whose body never arrives would be classified as SUCCESS and recorded as an
 * *_ACCEPTANCE=PASS it did not earn.
 */
async function json(response) {
  try {
    return await withTimeout(response.json(), BODY_READ_TIMEOUT_MS, 'RESPONSE_BODY_JSON');
  } catch (error) {
    if (String(error && error.message).startsWith('QA_830_STEP_TIMEOUT:')) throw error;
    return null;
  }
}

/*
 * Evidence records whether the auth bridge / app facade ran, never what the
 * headers carried: a header value is not proven safe to print.
 */
function headerEvidence(headers) {
  const facadePresent = Boolean(headers['x-danjion-app-facade'] || headers['x-danjion-auth-facade']);
  return `AUTH_BRIDGE_PRESENT=${Boolean(headers['x-danjion-auth-bridge'])}:APP_FACADE_PRESENT=${facadePresent}`;
}

/*
 * Safe, pre-body response evidence. A response whose JSON body never finishes must
 * still leave the status/method/path it already had, otherwise the first failure
 * reports nothing but a body-read timeout. Only sanitized presence booleans are
 * emitted: no header values, cookies, tokens, session data or body content.
 */
function responseEvidence(label, response, path) {
  let method = 'UNKNOWN';
  let pathname = path;
  try { method = response.request().method(); } catch { method = 'UNKNOWN'; }
  try { pathname = new URL(response.url()).pathname; } catch { pathname = path; }
  let status = 0;
  try { status = response.status(); } catch { status = 0; }
  return emit(`${label}_RESPONSE:HTTP_${status}:METHOD=${method}:API_PATH=${pathname}:${headerEvidence(response.headers())}`);
}


/* === BOUNDED EVIDENCE HELPERS — contract unit-tested; keep this block contiguous === */
const UNPRINTABLE_EVIDENCE = /cookie|authorization|bearer|password|secret/i;
/* Two or three dot-separated base64url segments starting with the standard JWT
   header prefix; the optional third group is the signature, which must not
   survive on its own either. */
const TOKEN_SHAPED = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]{2,})?/;
const CREDENTIAL_LABELED = /(set[-_ ]?cookie|cookie|authorization|bearer|proxy-authorization|password|passwd|secret|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token)\s*[:=]/i;
const MAX_EVIDENCE_CHARS = 240;
const MAX_SAMPLES = 3;
const MAX_DOM_KEYS = 10;
const HYDRATION_TIMEOUT_MS = 15_000;
/*
 * Explicit upper bounds. Nothing in this script relies on a Playwright or
 * undici default: every DOM evaluation, body read and request carries its own
 * bound, because an unbounded await is what turned a completed run into a
 * 30-60 minute job with no output.
 */
const DOM_EVAL_TIMEOUT_MS = 10_000;
const BODY_READ_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;

/*
 * Browser text is untrusted: it can carry a cookie pair, a bearer value or a
 * JWT-shaped string. A credential label cuts the string short rather than
 * replacing only the next token, because 'Authorization: Bearer x' has to lose
 * x as well. Bound last so no length choice can widen a leak.
 */
function boundedText(raw, limit = MAX_EVIDENCE_CHARS) {
  let text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  text = text.replace(TOKEN_SHAPED, '[redacted]');
  const labeled = text.search(CREDENTIAL_LABELED);
  if (labeled >= 0) text = `${text.slice(0, labeled).trim()} [redacted]`.trim();
  if (UNPRINTABLE_EVIDENCE.test(text) && !text.includes('[redacted]')) return '[redacted]';
  return text.slice(0, Math.max(0, Number(limit) || 0));
}

/* Failure headline: one short line, so the marker stays greppable. */
function boundedError(error) {
  const firstLine = String(error instanceof Error ? error.message : 'UNKNOWN').split('\n')[0];
  const safe = firstLine.replace(/[^\w:=.\- ]/g, '').slice(0, 160).trim();
  if (!safe || UNPRINTABLE_EVIDENCE.test(safe) || TOKEN_SHAPED.test(safe)) return 'REDACTED';
  return safe;
}

/*
 * The rest of the error — a Playwright call log names the locator that timed
 * out, which is the part that was lost at a 120-char headline bound.
 */
function errorDetail(error, limit = 600) {
  const lines = String(error instanceof Error ? error.message : '').split('\n').slice(1);
  return boundedText(lines.join(' ~ '), limit);
}

function pushSample(list, value) {
  const text = boundedText(value);
  if (text && list.length < MAX_SAMPLES) list.push(text);
}

/* Origin + pathname only: a full URL would carry query material. */
function originAndPathname(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return { origin: parsed.origin, pathname: parsed.pathname };
  } catch {
    return { origin: 'UNPARSEABLE', pathname: 'UNPARSEABLE' };
  }
}

function isBusinessDiscovery(endpoint) {
  return endpoint.origin !== 'UNPARSEABLE'
    && endpoint.pathname.includes('/api/v1/complexes/')
    && endpoint.pathname.endsWith('/businesses');
}

/*
 * The structured discovery fields always describe the LATEST business-discovery
 * event, whether it ended in a response or in a failed request. This matters
 * because one page session navigates repeatedly: if a failure only set a flag,
 * an earlier same-origin 200 would keep reporting its own origin after a later
 * request left the QA origin, which is the exact ambiguity this harness exists
 * to resolve. A failed request has no response, so its status is the 0
 * no-response sentinel, never a stale success code. Historical failures stay in
 * the bounded requestFailures samples.
 */
function createDiscoveryLedger() {
  return {
    seen: false,
    origin: 'NOT_OBSERVED',
    pathname: 'NOT_OBSERVED',
    status: 0,
    failed: false,
    note(endpoint, observation) {
      if (!isBusinessDiscovery(endpoint)) return false;
      this.seen = true;
      this.origin = endpoint.origin;
      this.pathname = endpoint.pathname;
      this.failed = Boolean(observation && observation.failed);
      this.status = this.failed ? 0 : Number(observation && observation.status) || 0;
      return true;
    }
  };
}
/* === END BOUNDED EVIDENCE HELPERS === */

const discovery = createDiscoveryLedger();

const diagnostics = {
  pageErrors: [],
  requestFailures: [],
  consoleErrors: [],
  discoveryConsoleInfo: [],
  expectedShopKey: 'NOT_RESOLVED',
  expectedShopKeyPresent: 'NOT_OBSERVED',
  domShopKeyCount: -1,
  domShopKeysSample: [],
  pageReadyState: 'NOT_OBSERVED',
  shopSurfaceState: 'NOT_OBSERVED',
  hydrationMs: -1
};

/*
 * Installed before any navigation, because the failure to explain is a request
 * that never produced a locator. Request and response headers are deliberately
 * never read: they are the cookie and Authorization carriers.
 */
function installPageDiagnostics(page) {
  page.on('pageerror', (error) => pushSample(diagnostics.pageErrors, error && error.message));
  page.on('requestfailed', (request) => {
    const endpoint = originAndPathname(request.url());
    pushSample(diagnostics.requestFailures, `${request.method()} ${endpoint.origin}${endpoint.pathname} ${request.failure()?.errorText || 'FAILED'}`);
    discovery.note(endpoint, { failed: true });
  });
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error') pushSample(diagnostics.consoleErrors, text);
    else if (message.type() === 'info' && text.includes('[danjion] discovery')) pushSample(diagnostics.discoveryConsoleInfo, text);
  });
  page.on('response', (response) => {
    discovery.note(originAndPathname(response.url()), { status: response.status() });
  });
}

function shopKeySelector(key) {
  return `[data-shop-key="${key}"]`;
}

/* Read-only: never writes to the DOM, only reports what the page already shows. */
async function captureShopDomState(page, shopKey) {
  const state = await withTimeout(page.evaluate((probe) => {
    const nodes = [...document.querySelectorAll('[data-shop-key]')];
    const expected = document.querySelector(probe.selector);
    const grid = document.getElementById('shopGridV2');
    return {
      readyState: document.readyState,
      count: nodes.length,
      keys: nodes.slice(0, probe.maxKeys).map((node) => node.getAttribute('data-shop-key')),
      expectedPresent: Boolean(expected),
      surfaceText: nodes.length === 0 && grid ? String(grid.textContent || '').slice(0, 200) : ''
    };
  }, { selector: shopKeySelector(shopKey), maxKeys: MAX_DOM_KEYS }), DOM_EVAL_TIMEOUT_MS, 'CAPTURE_SHOP_DOM_STATE')
    .catch(() => {
      emit('DOM_EVALUATION_BOUND_EXCEEDED=CAPTURE_SHOP_DOM_STATE');
      return null;
    });
  if (!state) {
    diagnostics.pageReadyState = 'EVALUATION_FAILED';
    return;
  }
  diagnostics.pageReadyState = boundedText(state.readyState, 40);
  diagnostics.domShopKeyCount = Number(state.count);
  diagnostics.domShopKeysSample = (state.keys || []).map((key) => boundedText(key, 60));
  diagnostics.expectedShopKeyPresent = state.expectedPresent;
  diagnostics.shopSurfaceState = state.surfaceText || (state.count ? 'CARDS_PRESENT' : 'EMPTY_WITHOUT_MESSAGE');
}

/*
 * Hydration is awaited explicitly instead of being folded into the click, so a
 * missing card and a slow card stop being the same ambiguous timeout.
 */
async function waitShopHydrated(page, shopKey, label) {
  diagnostics.expectedShopKey = shopKey;
  const startedAt = Date.now();
  let hydrated = false;
  try {
    await page.waitForFunction((target) => Boolean(document.querySelector(target)), shopKeySelector(shopKey),
      { timeout: HYDRATION_TIMEOUT_MS, polling: 250 });
    hydrated = true;
  } catch {
    hydrated = false;
  }
  diagnostics.hydrationMs = Date.now() - startedAt;
  await captureShopDomState(page, shopKey);
  record(label, hydrated, `MS_${diagnostics.hydrationMs}`);
  if (!hydrated) throw new Error('QA_830_SHOP_CARD_NOT_HYDRATED');
}

function diagnosisSummary() {
  return [
    `EXPECTED_SHOP_KEY=${diagnostics.expectedShopKey}`,
    `EXPECTED_SHOP_KEY_PRESENT=${diagnostics.expectedShopKeyPresent}`,
    `DOM_SHOP_KEY_COUNT=${diagnostics.domShopKeyCount}`,
    `HYDRATION_MS=${diagnostics.hydrationMs}`,
    `BROWSER_DISCOVERY_SEEN=${discovery.seen}`,
    `BROWSER_DISCOVERY_ORIGIN=${discovery.origin}`,
    `BROWSER_DISCOVERY_STATUS=${discovery.status}`,
    `BROWSER_DISCOVERY_REQUEST_FAILED=${discovery.failed}`,
    `PAGE_ERRORS=${diagnostics.pageErrors.length}`,
    `REQUEST_FAILURES=${diagnostics.requestFailures.length}`,
    `CONSOLE_ERRORS=${diagnostics.consoleErrors.length}`
  ].join(';');
}

function emitDiagnostics() {
  console.log('--- QA #830 BROWSER DIAGNOSTICS ---');
  console.log(`BROWSER_BUSINESS_REQUEST_SEEN=${discovery.seen}`);
  console.log(`BROWSER_BUSINESS_REQUEST_URL_ORIGIN=${discovery.origin}`);
  console.log(`BROWSER_DISCOVERY_ORIGIN=${discovery.origin}`);
  console.log(`BROWSER_BUSINESS_PATHNAME=${discovery.pathname}`);
  console.log(`BROWSER_DISCOVERY_SAME_ORIGIN=${discovery.origin === FRONTEND}`);
  console.log(`BROWSER_BUSINESS_HTTP_STATUS=${discovery.status}`);
  console.log(`BROWSER_BUSINESS_REQUEST_FAILED=${discovery.failed}`);
  console.log(`BROWSER_DISCOVERY_LATEST_EVENT_ONLY=structured fields above describe the most recent business-discovery event; older failures remain in REQUEST_FAILED_SAMPLE`);
  console.log(`EXPECTED_SHOP_KEY=${diagnostics.expectedShopKey}`);
  console.log(`EXPECTED_SHOP_KEY_PRESENT=${diagnostics.expectedShopKeyPresent}`);
  console.log(`DOM_SHOP_KEY_COUNT=${diagnostics.domShopKeyCount}`);
  console.log(`DOM_SHOP_KEYS_SAMPLE=${boundedText(diagnostics.domShopKeysSample.join(','), 300) || 'NONE'}`);
  console.log(`SHOP_HYDRATION_MS=${diagnostics.hydrationMs}`);
  console.log(`PAGE_READY_STATE=${diagnostics.pageReadyState}`);
  console.log(`SHOP_SURFACE_STATE=${boundedText(diagnostics.shopSurfaceState, 200) || 'NONE'}`);
  console.log(`PAGE_ERROR_COUNT=${diagnostics.pageErrors.length}`);
  console.log(`PAGE_ERROR_SAMPLE=${boundedText(diagnostics.pageErrors.join(' ~ '), 300) || 'NONE'}`);
  console.log(`REQUEST_FAILED_COUNT=${diagnostics.requestFailures.length}`);
  console.log(`REQUEST_FAILED_SAMPLE=${boundedText(diagnostics.requestFailures.join(' ~ '), 300) || 'NONE'}`);
  console.log(`CONSOLE_ERROR_COUNT=${diagnostics.consoleErrors.length}`);
  console.log(`CONSOLE_ERROR_SAMPLE=${boundedText(diagnostics.consoleErrors.join(' ~ '), 300) || 'NONE'}`);
  console.log(`DISCOVERY_CONSOLE_INFO_SAMPLE=${boundedText(diagnostics.discoveryConsoleInfo.join(' ~ '), 300) || 'NONE'}`);
}

function flushEvidence(heading) {
  console.log(heading);
  // events and results are bounded by construction: status codes, pathnames,
  // header presence, and fixed disposition labels.
  for (const line of events) console.log(line);
  for (const line of results) console.log(line);
  emitDiagnostics();
}

async function call(request, label, path, init = {}) {
  if (!FRONTEND.startsWith('https://danjion-qa.pages.dev') || !API.startsWith('https://padiem-danjion-api-qa.')) {
    throw new Error('QA_TARGET_GUARD_FAILED');
  }
  const response = await request.fetch(`${FRONTEND}${path}`, {
    ...init,
    timeout: REQUEST_TIMEOUT_MS,
    headers: { accept: 'application/json', Origin: FRONTEND, ...(init.headers || {}) }
  });
  // Pre-body evidence: emitted before the body read so a body timeout cannot erase it.
  events.push(responseEvidence(label, response, path));
  const body = await json(response);
  events.push(emit(`${label}:HTTP_${response.status()}:API_PATH=${new URL(response.url()).pathname}:${headerEvidence(response.headers())}`));
  return { response, body, ...classify(response.status(), body) };
}

async function pageCall(page, label, method, path, action) {
  const responsePromise = page.waitForResponse((response) => {
    if (response.request().method() !== method) return false;
    try { return new URL(response.url()).pathname === path; } catch { return false; }
  }, { timeout: 15_000 });
  await action();
  const response = await responsePromise;
  // Pre-body evidence: emitted before the body read so a body timeout cannot erase it.
  events.push(responseEvidence(label, response, path));
  const body = await json(response);
  events.push(emit(`${label}:HTTP_${response.status()}:API_PATH=${path}:${headerEvidence(response.headers())}`));
  return { response, body, ...classify(response.status(), body) };
}

async function session(request, label) {
  const result = await call(request, label, '/api/auth/get-session');
  const authenticated = Boolean(result.body?.session && result.body?.user);
  record(`${label}_SESSION`, authenticated, `HTTP_${result.response.status()}`);
  return authenticated;
}

/*
 * Wall-clock kill handler. The workflow wraps this process in an OS timeout, and
 * a SIGTERM gives no chance to flush — so the last announced step is written
 * here. Without this, a killed run reported nothing at all.
 */
for (const signalName of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signalName, () => {
    /*
     * Synchronous write, not console.log/emit: on a runner stdout is a pipe, and
     * the buffered path gives no guarantee the lines reach the log before
     * process.exit truncates them. Only fixed application markers and the fixed
     * step name are written here — never a value read from the page or a response,
     * so nothing credential-bearing can enter this stream.
     */
    writeSync(
      process.stdout.fd,
      [
        'QA_830_RUN_WALL_CLOCK_TIMEOUT=YES',
        `QA_830_LAST_STEP=${lastStep}`,
        'SECRET_OUTPUT=NO',
        ''
      ].join('\n')
    );
    process.exit(124);
  });
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
  /* Bound every locator action that carries no explicit timeout (fill, click,
     etc.) so a stuck step cannot hold the job open indefinitely. */
  context.setDefaultTimeout(15_000);
  const page = await context.newPage();
  installPageDiagnostics(page);
  await page.goto(`${FRONTEND}/01_%EC%9D%B4%EC%9B%83%EA%B0%80%EA%B2%8C_%EB%B0%9C%EA%B2%AC.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const signIn = await context.request.post(`${FRONTEND}/api/auth/sign-in/email`, {
    headers: { Origin: FRONTEND, 'Content-Type': 'application/json' },
    data: { email, password },
    timeout: REQUEST_TIMEOUT_MS
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

  /* The ?shop= deep link intentionally auto-opens #shopCompareModal, which then
     covers the card and makes the click below unsatisfiable (pointer events are
     intercepted). Enter without the deep link so the card click is the thing that
     opens the modal — that is the real user gesture this acceptance must prove. */
  await page.goto(`${FRONTEND}/01_%EC%9D%B4%EC%9B%83%EA%B0%80%EA%B2%8C_%EB%B0%9C%EA%B2%AC.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  step('ENTER_SHOP_REVIEW_FLOW');
  await waitShopHydrated(page, shopKey, 'SHOP_HYDRATION');
  await page.locator(shopKeySelector(shopKey)).first().click({ timeout: 15_000 });
  await page.locator('#shopReviewOpen2').click({ timeout: 10_000 });
  await page.locator('#shopReviewInput').fill(`[QA #830] review ${stamp}`);
  const review = await pageCall(page, 'REVIEW', 'POST', `/api/v1/complexes/${COMPLEX}/businesses/${businessId}/reviews`,
    () => page.locator('#shopReviewSubmit').click({ timeout: 10_000 }));
  record('REVIEW_ACCEPTANCE', review.auth, review.disposition);
  authenticated = await session(context.request, 'REVIEW_AFTER');
  if (!authenticated) record('REVIEW_SESSION_PRESERVED', false, 'SESSION_LOST');

  step('ENTER_BOOKMARK_FLOW');
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

  /* Same reason as the first entry: no ?shop= deep link, so the card click below
     opens the compare modal instead of being blocked by an already-open one. */
  await page.goto(`${FRONTEND}/01_%EC%9D%B4%EC%9B%83%EA%B0%80%EA%B2%8C_%EB%B0%9C%EA%B2%AC.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  step('ENTER_SHOP_INQUIRY_FLOW');
  await waitShopHydrated(page, shopKey, 'SHOP_HYDRATION_REVISIT');
  await page.locator(shopKeySelector(shopKey)).first().click({ timeout: 10_000 });
  await page.locator('#shopCompareInquiry').click({ timeout: 10_000 });
  await page.locator('#shopInquirySubject').fill(`[QA #830] inquiry ${stamp}`);
  await page.locator('#shopInquiryText').fill(`QA #830 shop inquiry ${stamp}`);
  const inquiry = await pageCall(page, 'INQUIRY', 'POST', '/api/v1/me/inquiries',
    () => page.locator('#shopInquiryForm button[type="submit"]').click({ timeout: 10_000 }));
  record('INQUIRY_ACCEPTANCE', inquiry.auth, inquiry.disposition);
  authenticated = await session(context.request, 'INQUIRY_AFTER');

  step('ENTER_SHOP_REPORT_FLOW');
  await page.goto(`${FRONTEND}/25A_%EC%8B%A0%EC%B2%AD%EC%A0%9C%EB%B3%B4.html?mode=report`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('[name="reportShopName"]').fill(`[QA #830] report ${stamp}`);
  await page.locator('[name="reportWhat"]').fill('QA authenticated report acceptance');
  await page.locator('[name="reportLocation"]').fill('QA only');
  await page.locator('[name="reportReason"]').fill(`[QA #830] ${stamp}`);
  const report = await pageCall(page, 'REPORT', 'POST', '/api/v1/me/shop-recommendations',
    () => withTimeout(
      page.locator('#requestForm').evaluate((form) => form.requestSubmit()),
      10_000,
      'REPORT_FORM_SUBMIT'
    ));
  record('REPORT_ACCEPTANCE', report.auth, report.disposition);
  authenticated = await session(context.request, 'REPORT_AFTER');

  const community = [
    ['GREETING', '14_%EA%B0%80%EC%9E%85%EC%9D%B8%EC%82%AC_%EA%B8%80%EC%93%B0%EA%B8%B0.html', 'greeting'],
    ['STORY', '15_%EB%8B%A8%EC%A7%80%EC%9D%B4%EC%95%BC%EA%B8%B0_%EA%B8%80%EC%93%B0%EA%B8%B0.html', 'resident_story'],
    ['QUESTION', '16_%EA%B6%81%EA%B8%88%ED%95%B4%EC%9A%94_%EA%B8%80%EC%93%B0%EA%B8%B0.html', 'question'],
    ['TOGETHER', '17_%EA%B0%99%EC%9D%B4%ED%95%B4%EC%9A%94_%EA%B8%80%EC%93%B0%EA%B8%B0.html', 'together']
  ];
  for (const [label, route, kind] of community) {
    step(`ENTER_COMMUNITY_${label}`);
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
  /* Evidence is already streamed and flushed above. Teardown must never be the
     thing that keeps the job open: a hung close() hides an otherwise complete run. */
  try {
    await withTimeout(context.close(), 10_000, 'CONTEXT_CLOSE');
  } catch {
    emit('TEARDOWN=CONTEXT_CLOSE_TIMEOUT_FORCED');
  }
} catch (error) {
  flushEvidence('=== QA #830 AUTHENTICATED ACCEPTANCE FAILURE EVIDENCE ===');
  emitBookmarkMarkers();
  console.error(`QA_830_ACCEPTANCE_FAILED=${boundedError(error)}`);
  console.error(`QA_830_ACCEPTANCE_DETAIL=${boundedText(errorDetail(error), 400) || 'NONE'}`);
  console.error(`QA_830_DIAGNOSTICS=${boundedText(diagnosisSummary(), 400)}`);
  process.exitCode = 1;
} finally {
  try {
    await withTimeout(browser.close(), 10_000, 'BROWSER_CLOSE');
  } catch {
    emit('TEARDOWN=BROWSER_CLOSE_TIMEOUT_FORCED');
  }
  /* Every evidence line has been streamed already; do not let a lingering
     browser handle keep the process — and therefore the job — alive. */
  process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
}
