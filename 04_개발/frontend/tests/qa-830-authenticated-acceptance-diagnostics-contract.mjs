import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const script = await readFile(new URL('04_개발/frontend/scripts/qa-830-authenticated-acceptance.mjs', root), 'utf8');

/* ===== the shipped helpers are executed, not just quoted ===== */
const START = '/* === BOUNDED EVIDENCE HELPERS';
const END = '/* === END BOUNDED EVIDENCE HELPERS === */';
const startAt = script.indexOf(START);
const endAt = script.indexOf(END);
assert.ok(startAt >= 0, 'bounded evidence helper block must keep its opening marker');
assert.ok(endAt > startAt, 'bounded evidence helper block must stay contiguous');
const helpers = new Function(`${script.slice(startAt, endAt)}
return { boundedText, boundedError, errorDetail, pushSample, originAndPathname, isBusinessDiscovery,
  createDiscoveryLedger, MAX_SAMPLES, MAX_DOM_KEYS, HYDRATION_TIMEOUT_MS };`)();
const { boundedText, boundedError, errorDetail, pushSample, originAndPathname, isBusinessDiscovery,
  createDiscoveryLedger } = helpers;

/* ===== the latest business-discovery event must own the structured fields ===== */
const QA_ORIGIN = 'https://danjion-qa.pages.dev';
const PROD_ORIGIN = 'https://padiem-danjion-api-production.padiem.workers.dev';
const DISCOVERY_PATH = '/api/v1/complexes/banglim-myeongji-roadhill/businesses';

const ledger = createDiscoveryLedger();
assert.deepEqual(
  { seen: ledger.seen, origin: ledger.origin, status: ledger.status, failed: ledger.failed },
  { seen: false, origin: 'NOT_OBSERVED', status: 0, failed: false },
  'a fresh ledger must claim nothing yet');

/* The core regression: an earlier success must not mask a later CORS failure. */
assert.equal(ledger.note({ origin: QA_ORIGIN, pathname: DISCOVERY_PATH }, { status: 200 }), true,
  'a same-origin discovery response must be recorded');
assert.equal(ledger.note({ origin: PROD_ORIGIN, pathname: DISCOVERY_PATH }, { failed: true }), true,
  'a later failed discovery request must be recorded');
assert.equal(ledger.seen, true, 'FAILED_DISCOVERY_MARKS_REQUEST_SEEN');
assert.equal(ledger.origin, PROD_ORIGIN, 'FAILED_DISCOVERY_CAPTURES_ORIGIN: latest event must win over the earlier 200');
assert.equal(ledger.pathname, DISCOVERY_PATH, 'FAILED_DISCOVERY_CAPTURES_PATHNAME');
assert.equal(ledger.status, 0, 'FAILED_DISCOVERY_ZEROES_RESPONSE_STATUS: a failed request has no response status');
assert.equal(ledger.failed, true, 'FAILED_DISCOVERY_SETS_FAILED');
assert.notEqual(ledger.status, 200, 'a stale success status must never survive a later failure');

/* A later success legitimately becomes the newest observation. */
assert.equal(ledger.note({ origin: QA_ORIGIN, pathname: DISCOVERY_PATH }, { status: 200 }), true);
assert.equal(ledger.origin, QA_ORIGIN, 'a newer success must replace an older failure');
assert.equal(ledger.status, 200, 'a recorded response must keep its real status');
assert.equal(ledger.failed, false, 'failed must not latch once a response arrived');

/* Only the discovery endpoint may move these fields. */
const untouched = createDiscoveryLedger();
assert.equal(untouched.note({ origin: QA_ORIGIN, pathname: '/api/v1/me/bookmarks' }, { status: 401 }), false,
  'a non-discovery response must not be attributed to discovery');
assert.equal(untouched.note(originAndPathname('not a url'), { failed: true }), false,
  'an unparseable url must not be attributed to discovery');
assert.deepEqual(
  { seen: untouched.seen, origin: untouched.origin, status: untouched.status, failed: untouched.failed },
  { seen: false, origin: 'NOT_OBSERVED', status: 0, failed: false },
  'rejected observations must leave the ledger untouched');

/* A real failure status must not be invented as success, nor a 401 hidden. */
const authFail = createDiscoveryLedger();
authFail.note({ origin: QA_ORIGIN, pathname: DISCOVERY_PATH }, { status: 401 });
assert.equal(authFail.status, 401, 'an HTTP 401 discovery response must be reported as 401');
assert.equal(authFail.failed, false, 'a received response is not a transport failure');
const serverFail = createDiscoveryLedger();
serverFail.note({ origin: QA_ORIGIN, pathname: DISCOVERY_PATH }, { status: 503 });
assert.equal(serverFail.status, 503, 'a server-side discovery status must survive exactly');
const noObservation = createDiscoveryLedger();
noObservation.note({ origin: QA_ORIGIN, pathname: DISCOVERY_PATH }, {});
assert.equal(noObservation.status, 0, 'a missing observation must not fabricate a success code');
assert.equal(noObservation.failed, false, 'a missing observation must not be called a failure either');

/* `failed` dominates: a failed request has no response, whatever else is passed. */
const contradiction = createDiscoveryLedger();
contradiction.note({ origin: QA_ORIGIN, pathname: DISCOVERY_PATH }, { status: 200, failed: true });
assert.equal(contradiction.failed, true, 'a failed observation must report failed');
assert.equal(contradiction.status, 0, 'a failed request must keep the no-response status even if a status was also supplied');

/* Both listeners must route through the ledger, inside their own handler bodies. */
const failedHandler = script.slice(script.indexOf("page.on('requestfailed'"), script.indexOf("page.on('console'"));
assert.ok(failedHandler.length > 60, 'the requestfailed handler must exist');
assert.ok(failedHandler.includes('discovery.note(endpoint, { failed: true });'),
  'the requestfailed handler must attribute the failed request to the ledger');
assert.ok(failedHandler.includes('pushSample(diagnostics.requestFailures'),
  'the requestfailed handler must keep the historical bounded samples');
const responseHandler = script.slice(script.indexOf("page.on('response'"));
assert.ok(responseHandler.slice(0, 300).includes('discovery.note('),
  'the response handler must route through the same latest-event ledger');
assert.ok(responseHandler.slice(0, 300).includes('{ status: response.status() }'),
  'the response handler must record the real response status');
assert.doesNotMatch(script, /businessRequestSeen|businessRequestOrigin|businessResponseStatus|businessRequestPathname|businessRequestFailed/,
  'no second copy of discovery state may exist outside the ledger');

assert.equal(helpers.MAX_SAMPLES, 3, 'event samples must stay capped at three');
assert.equal(helpers.MAX_DOM_KEYS, 10, 'DOM key sample must stay capped at ten');
assert.ok(helpers.HYDRATION_TIMEOUT_MS >= 10_000 && helpers.HYDRATION_TIMEOUT_MS <= 15_000,
  'hydration wait must stay inside the 10-15s budget');

assert.equal(boundedText(null), '', 'absent text must render empty, not "null"');
assert.equal(boundedText(undefined), '', 'absent text must render empty, not "undefined"');
assert.equal(boundedText('   \n\t  '), '', 'whitespace-only text must render empty');

const longInput = 'x'.repeat(5_000);
assert.ok(boundedText(longInput).length <= 240, 'browser text must be length bounded');
assert.ok(boundedText(longInput, 40).length <= 40, 'explicit limit must be honoured');
assert.equal(boundedText('a\n  b'), 'a b', 'newlines must collapse so one field stays one line');

/*
 * Credential-shaped samples are assembled at runtime and use obvious
 * placeholders: a literal three-segment JWT or a key=value pair in the diff
 * trips secret scanners (GitGuardian failed this PR's first head on exactly the
 * public jwt.io example) even though the values are fictitious. The runtime
 * input is still credential-shaped, which is all the sanitizer is being tested
 * against, and the assertions still require the value to be gone.
 */
const SESSION_VALUE = '<QA_SESSION_VALUE_PLACEHOLDER>';
const BEARER_VALUE = '<QA_BEARER_VALUE_PLACEHOLDER>';
const JWT_HEAD = 'eyJ' + 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
const JWT_BODY = 'eyJ' + 'zdWIiOiIxMjM0NTY3ODkw' + 'In0';
const JWT_SIG = 'dozjg' + 'Thuz';
const JWT_SAMPLE = `${JWT_HEAD}.${JWT_BODY}.${JWT_SIG}`;

const cookieText = boundedText(`failed with Cookie: danjion_session=${SESSION_VALUE} for user`);
assert.ok(!cookieText.includes(SESSION_VALUE), 'cookie value must never survive sanitising');
assert.ok(cookieText.includes('[redacted]'), 'cookie must be replaced by a redaction marker');
const bearerText = boundedText(`Authorization: Bearer ${BEARER_VALUE} request rejected`);
assert.ok(!bearerText.includes(BEARER_VALUE), 'bearer value must never survive sanitising');
const jwtText = boundedText(`state ${JWT_SAMPLE}`);
assert.ok(!/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(jwtText), 'JWT-shaped text must be redacted');
assert.ok(!jwtText.includes(JWT_BODY), 'JWT payload must never be printed');
assert.ok(!jwtText.includes(JWT_SIG), 'JWT signature must never be printed');

/*
 * The sanitizer must not swallow the diagnostics it exists to protect: a plain
 * failure line has to survive intact, and the cap must be a width limit only.
 */
const plainFailure = 'GET https://danjion-qa.pages.dev/api/v1/complexes/banglim-myeongji-roadhill/businesses net::ERR_FAILED';
assert.equal(boundedText(plainFailure), plainFailure, 'an ordinary failure line must survive unmodified');
assert.ok(boundedText(`${plainFailure} ${'y'.repeat(900)}`).startsWith('GET https://danjion-qa.pages.dev'),
  'bounding must truncate, never replace, a non-credential event');
assert.ok(boundedText(`state ${JWT_SAMPLE}`).includes('[redacted]'),
  'a JWT must still leave a visible redaction marker');

const locatorFailure = new Error('locator.click: Timeout 15000ms exceeded.\nCall log: waiting for locator "[data-shop-key=api-71a8300d]"');
assert.equal(boundedError(locatorFailure).startsWith('locator.click: Timeout 15000ms exceeded.'), true,
  'headline must keep the first line of the failure');
assert.ok(!boundedError(locatorFailure).includes('Call log'), 'headline must not absorb the call log');
assert.ok(boundedError(locatorFailure).length <= 160, 'headline must stay bounded');
assert.ok(errorDetail(locatorFailure).includes('waiting for locator'),
  'the locator named in the call log must survive as its own field');
assert.ok(errorDetail(locatorFailure).length <= 600, 'detail must stay bounded');
assert.equal(errorDetail(new Error('single line only')), '', 'a single-line error has no detail');
assert.equal(boundedError(new Error(`Cookie: danjion_session=${SESSION_VALUE}`)), 'REDACTED',
  'a credential-shaped headline must be redacted outright');

const samples = [];
for (let i = 0; i < 9; i += 1) pushSample(samples, `event ${i}`);
assert.equal(samples.length, 3, 'sample collection must stop at the cap');
pushSample(samples, '   ');
assert.ok(!samples.some((line) => line.trim() === ''), 'empty events must not consume a sample slot');

const endpoint = originAndPathname('https://danjion-qa.pages.dev/api/v1/complexes/banglim-myeongji-roadhill/businesses?limit=50&session=leak');
assert.equal(endpoint.origin, 'https://danjion-qa.pages.dev', 'discovery origin must be recorded exactly');
assert.ok(!endpoint.pathname.includes('leak') && !endpoint.pathname.includes('?'),
  'query material must never reach the evidence stream');
assert.equal(isBusinessDiscovery(endpoint), true, 'the business discovery response must be recognised');
assert.equal(isBusinessDiscovery(originAndPathname('https://danjion-qa.pages.dev/api/v1/me/bookmarks')), false,
  'other endpoints must not be mistaken for discovery');
assert.equal(isBusinessDiscovery(originAndPathname('https://danjion-qa.pages.dev/api/v1/complexes/x/businesses/7/reviews')), false,
  'a business sub-path must not be mistaken for the list');
assert.equal(originAndPathname('not a url').origin, 'UNPARSEABLE', 'an unusable url must degrade to a marker, never a throw');

/* ===== listeners must exist before the first navigation ===== */
const firstGoto = script.indexOf('page.goto(');
assert.ok(firstGoto > 0, 'the run must open the QA page');
const installer = script.indexOf('installPageDiagnostics(page);');
assert.ok(installer >= 0, 'diagnostics listeners must be installed');
assert.ok(installer < firstGoto, 'listeners must be attached before any navigation');
for (const event of ['pageerror', 'requestfailed', 'console', 'response']) {
  assert.match(script, new RegExp(`page\\.on\\('${event}'`), `the ${event} listener must remain`);
}
assert.ok(script.indexOf('isBusinessDiscovery(endpoint)') > 0, 'the response listener must filter discovery');

/* ===== hydration is waited for explicitly, and a miss fails before any click ===== */
const firstHydration = script.indexOf("waitShopHydrated(page, shopKey, 'SHOP_HYDRATION')");
const firstClick = script.indexOf('.locator(shopKeySelector(shopKey)).first().click(');
assert.ok(firstHydration > 0, 'the expected shop key must be awaited before interaction');
assert.ok(firstClick > firstHydration, 'the click must happen only after hydration is proven');
assert.match(script, /await page\.waitForFunction\(\(target\) => Boolean\(document\.querySelector\(target\)\), shopKeySelector\(shopKey\)/,
  'the wait must target the expected [data-shop-key] node itself');
assert.match(script, /\{ timeout: HYDRATION_TIMEOUT_MS, polling: 250 \}/, 'the wait must stay bounded and polled');
assert.match(script, /if \(!hydrated\) throw new Error\('QA_830_SHOP_CARD_NOT_HYDRATED'\)/,
  'a missing card must fail as its own labelled error, not a bare click timeout');
assert.match(script, /record\(label, hydrated, `MS_\$\{diagnostics\.hydrationMs\}`\)/,
  'hydration verdict and duration must be recorded');
assert.ok(script.includes('SHOP_HYDRATION_MS='), 'hydration duration must be emitted');
assert.ok(script.includes("waitShopHydrated(page, shopKey, 'SHOP_HYDRATION_REVISIT')"),
  'the revisit navigation must be guarded the same way');

/* ===== the failure verdict must name DOM state, origin and page errors ===== */
for (const field of [
  'BROWSER_BUSINESS_REQUEST_SEEN=',
  'BROWSER_BUSINESS_REQUEST_URL_ORIGIN=',
  'BROWSER_DISCOVERY_ORIGIN=',
  'BROWSER_DISCOVERY_SAME_ORIGIN=',
  'BROWSER_BUSINESS_HTTP_STATUS=',
  'BROWSER_BUSINESS_REQUEST_FAILED=',
  'EXPECTED_SHOP_KEY=',
  'EXPECTED_SHOP_KEY_PRESENT=',
  'DOM_SHOP_KEY_COUNT=',
  'DOM_SHOP_KEYS_SAMPLE=',
  'PAGE_READY_STATE=',
  'SHOP_SURFACE_STATE=',
  'PAGE_ERROR_COUNT=',
  'PAGE_ERROR_SAMPLE=',
  'REQUEST_FAILED_COUNT=',
  'REQUEST_FAILED_SAMPLE=',
  'CONSOLE_ERROR_COUNT=',
  'CONSOLE_ERROR_SAMPLE=',
  'DISCOVERY_CONSOLE_INFO_SAMPLE=',
  'QA_830_DIAGNOSTICS='
]) assert.ok(script.includes(field), `missing bounded diagnostic field ${field}`);

const diagBody = script.slice(script.indexOf('function emitDiagnostics() {'));
for (const list of ['pageErrors', 'requestFailures', 'consoleErrors', 'discoveryConsoleInfo']) {
  assert.match(diagBody, new RegExp(`${list}\\.join\\(' ~ '\\)`), `${list} must be joined as bounded samples`);
}
assert.match(diagBody, /domShopKeysSample\.join\(','\)/, 'DOM key sample must be joined as one bounded field');
assert.match(diagBody, /diagnostics\.pageErrors\.length/, 'event counts must be emitted beside samples');
assert.match(script, /QA_830_ACCEPTANCE_FAILED=\$\{boundedError\(error\)\}/, 'headline must stay a separate field');
assert.match(script, /QA_830_ACCEPTANCE_DETAIL=\$\{boundedText\(errorDetail\(error\), 400\)/,
  'call-log detail must be its own sanitised field');

/* ===== nothing sensitive may ride the diagnostic path ===== */
assert.doesNotMatch(script, /request\(\)\.headers\(|\.headers\(\)\.cookie|responseheaders|getAllHeaders/,
  'request headers must never be read into evidence');
assert.doesNotMatch(script, /storageState|context\.cookies\(|\.cookies\(/, 'session storage must never be dumped');
assert.doesNotMatch(script, /console\.\w+\([^)]*\$\{(email|password|jwt|cookie|token)\b/i,
  'credentials must never be printed');
assert.doesNotMatch(script, /QA_830_ACCEPTANCE_FAILED=\$\{error instanceof/, 'raw error text must never be printed');
const domProbe = script.slice(script.indexOf('async function captureShopDomState('), script.indexOf('async function waitShopHydrated('));
assert.ok(domProbe.length > 100, 'the DOM state probe must exist');
assert.doesNotMatch(domProbe, /\.innerHTML\s*=|\.value\s*=|\.click\(|setAttribute|document\.write|appendChild|remove\(\)/,
  'the DOM probe must be read-only');

/* ===== acceptance semantics must not have been softened ===== */
for (const label of ['REVIEW_ACCEPTANCE', 'BOOKMARK_ACCEPTANCE', 'INQUIRY_ACCEPTANCE', 'REPORT_ACCEPTANCE']) {
  assert.ok(script.includes(`'${label}'`), `acceptance result ${label} must remain`);
}
assert.match(script, /record\(`\$\{label\}_ACCEPTANCE`/, 'community acceptance labels must remain');
assert.ok(script.includes("page.locator('[data-kind=\"walk\"]').click({ timeout: 10_000 })"),
  'Together selector must still be clicked strictly');
assert.doesNotMatch(script, /data-kind="walk"\][^\n]*\.catch\(/, 'Together selector must not swallow failures');
assert.doesNotMatch(script, /\.catch\(\(\) => \{\}\)/, 'no silent fail-open catch may exist');
assert.match(script, /if \(!authenticated\) throw new Error\('QA_830_SESSION_NOT_AUTHENTICATED'\)/,
  'session must still be proven before any write');
assert.match(script, /const restoreMethod = wasBookmarked \? 'POST' : 'DELETE'/, 'bookmark restore contract must remain');
assert.match(script, /const membershipRestored = bookmarkFinal\.auth && restoreOk && finalBookmarked === wasBookmarked/,
  'bookmark restore must still be proven by readback');
assert.match(script, /if \(toggleStatus === 401\) record\('BOOKMARK_TOGGLE_401', false, 'AUTH_REQUIRED'\)/,
  'a 401 must still fail the run');
assert.match(script, /if \(!businessId\) throw new Error\('QA_830_NO_SERVER_BUSINESS'\)/,
  'an empty server business set must still stop the run');
assert.match(script, /function flushEvidence\(heading\) \{[\s\S]*?emitDiagnostics\(\);/,
  'both evidence paths must print diagnostics, not only the success path');
/*
 * Superseded here were three source asserts of the form
 * `diagnostics.businessRequestOrigin = endpoint.origin;` etc. They pinned one
 * implementation shape; the behaviour they existed to protect is now asserted
 * directly against `createDiscoveryLedger()` above, plus the handler-body checks
 * below, so the guarantee is wider rather than narrower.
 */
assert.match(script.slice(startAt, endAt), /if \(!isBusinessDiscovery\(endpoint\)\) return false;/,
  'the ledger itself must reject non-discovery endpoints');
/*
 * Bypass must be ruled out by mechanism, not by English: the script legitimately
 * documents "no fail-open skip" in a comment, and a word-level scan would match
 * the prose that forbids the thing.
 */
assert.doesNotMatch(script, /page\.route\(|force:\s*true|\.skip\(|test\.skip|bypass|stubResponse|continue:\s*false/i,
  'no request interception, forced click, skipping or bypass may appear');

/*
 * This file only protects the harness while CI actually runs it, so the wiring
 * is asserted here as well: a deleted step or a dropped path filter must fail
 * loudly instead of silently reverting to "local only".
 */
const contractPath = '04_개발/frontend/tests/qa-830-authenticated-acceptance-diagnostics-contract.mjs';
const workflow = await readFile(new URL('.github/workflows/qa-830-authenticated-acceptance.yml', root), 'utf8');
assert.ok(workflow.includes(`- '${contractPath}'`),
  'this contract must stay listed in the workflow paths filter');
assert.ok(workflow.includes(`      - name: Verify acceptance diagnostics contract\n        run: node ${contractPath}`),
  'the diagnostics step must run this contract in CI');
assert.ok(workflow.indexOf('Verify acceptance source contract') < workflow.indexOf('Verify acceptance diagnostics contract'),
  'the diagnostics step must run after the existing source contract');
assert.ok(workflow.includes('      - name: Syntax-check acceptance script\n        run: node --check 04_개발/frontend/scripts/qa-830-authenticated-acceptance.mjs'),
  'the syntax-check step must remain');
assert.ok(workflow.includes('      - name: Verify acceptance source contract\n        run: node 04_개발/frontend/tests/qa-830-authenticated-acceptance-contract.mjs'),
  'the existing acceptance contract step must remain');
assert.doesNotMatch(workflow, /environment:\s*production/, 'the workflow must never use a production environment');
assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.run_live/,
  'the live QA job must stay dispatch-and-confirm gated');
assert.match(workflow, /expected_main/, 'exact-main authority must remain');
assert.match(workflow, /git ls-remote origin refs\/heads\/main/, 'remote main must still be fresh-read');

console.log('qa-830-authenticated-acceptance-diagnostics-contract: PASS');

/* ===== #830 truthfulness repair: pre-body response evidence ===== */

/*
 * The first live failure (run 35547989201) reported only
 * QA_830_STEP_TIMEOUT:RESPONSE_BODY_JSON:10000ms with QA_830_ACCEPTANCE_DETAIL=NONE:
 * the status/method/path of the failing request were lost because the evidence line
 * was emitted only after the body read resolved. These checks make that impossible to
 * regress. They execute the shipped helpers rather than quoting them.
 */

function functionBlock(source, name) {
  const start = source.indexOf(name === 'call' ? 'async function call(' : `${name}`);
  assert.ok(start >= 0, `${name} must exist in the acceptance script`);
  const end = source.indexOf('\n}\n', start);
  assert.ok(end > start, `${name} must have a bounded body`);
  return source.slice(start, end);
}

function emitsPreBodyEvidence(source, name) {
  const block = functionBlock(source, name);
  const evidenceAt = block.indexOf('events.push(responseEvidence(');
  const bodyAt = block.indexOf('await json(response)');
  return evidenceAt >= 0 && bodyAt >= 0 && evidenceAt < bodyAt;
}

/* A. status evidence must be emitted before the body read, in both write paths. */
for (const name of ['call', 'pageCall']) {
  assert.equal(emitsPreBodyEvidence(script, name), true,
    `PRE_BODY_STATUS_EVIDENCE: ${name} must emit response evidence before awaiting the body`);
}

/* The shipped helper block is executed, not just quoted. The body-read bound is
 * shortened in the evaluated copy only, so the fail-closed semantics are real. */
const HELP_START = 'async function withTimeout(';
const HELP_END = '/* === END BOUNDED EVIDENCE HELPERS === */';
const helperStartAt = script.indexOf(HELP_START);
const helperEndAt = script.indexOf(HELP_END);
assert.ok(helperStartAt >= 0 && helperEndAt > helperStartAt, 'bounded helper region must stay contiguous');
const shortened = script
  .slice(helperStartAt, helperEndAt)
  .replace('const BODY_READ_TIMEOUT_MS = 10_000;', 'const BODY_READ_TIMEOUT_MS = 25;');
assert.match(shortened, /BODY_READ_TIMEOUT_MS = 25;/, 'test copy must shorten only the body-read bound');
const runtime = new Function(`
const emit = (line) => line;
${shortened}
return { json, responseEvidence, headerEvidence, withTimeout, classify };
`)();

/* B. a body read that never settles must still fail closed with the same error. */
await assert.rejects(
  () => runtime.json({ json: () => new Promise(() => {}) }),
  /QA_830_STEP_TIMEOUT:RESPONSE_BODY_JSON/,
  'BODY_TIMEOUT_FAIL_CLOSED: the body-read bound must still reject with QA_830_STEP_TIMEOUT'
);

/* D. a malformed / non-JSON body keeps the existing null policy. */
assert.equal(await runtime.json({ json: async () => { throw new SyntaxError('not json'); } }), null,
  'MALFORMED_JSON_STILL_NULL');

/* C/E. the pre-body evidence carries status/method/path and never a header value,
 *     and it must never touch the body itself. */
let bodyTouched = false;
const bookmarkResponse = {
  status: () => 401,
  url: () => 'https://danjion-qa.pages.dev/api/v1/me/bookmarks/71a8300d-0000-4000-8000-000000000001',
  request: () => ({ method: () => 'DELETE' }),
  headers: () => ({
    'x-danjion-auth-bridge': '1',
    'x-danjion-app-facade': '1',
    'set-cookie': 'session=SUPERSECRETCOOKIEVALUE',
    authorization: 'Bearer SUPERSECRETTOKENVALUE'
  }),
  json: () => { bodyTouched = true; throw new Error('the body must not be read for pre-body evidence'); }
};
const evidenceLine = runtime.responseEvidence(
  'BOOKMARK_TOGGLE',
  bookmarkResponse,
  '/api/v1/me/bookmarks/71a8300d-0000-4000-8000-000000000001'
);
assert.match(evidenceLine, /^BOOKMARK_TOGGLE_RESPONSE:HTTP_401:METHOD=DELETE:API_PATH=\/api\/v1\/me\/bookmarks\//);
assert.match(evidenceLine, /AUTH_BRIDGE_PRESENT=true/);
assert.match(evidenceLine, /APP_FACADE_PRESENT=true/);
assert.equal(bodyTouched, false, 'PRE_BODY_EVIDENCE_MUST_NOT_READ_THE_BODY');
assert.equal(evidenceLine.includes('SUPERSECRETCOOKIEVALUE'), false, 'SECRET_OUTPUT: cookie value must never be printed');
assert.equal(evidenceLine.includes('SUPERSECRETTOKENVALUE'), false, 'SECRET_OUTPUT: authorization value must never be printed');
assert.equal(/cookie|authorization|bearer|session/i.test(evidenceLine), false,
  'the evidence line must contain no credential-bearing label at all');

/* A response object that cannot answer must degrade to explicit unknowns, never throw. */
const hostile = {
  status: () => { throw new Error('no status'); },
  url: () => { throw new Error('no url'); },
  request: () => { throw new Error('no request'); },
  headers: () => ({})
};
const degraded = runtime.responseEvidence('SESSION_BEFORE', hostile, '/api/auth/get-session');
assert.match(degraded, /^SESSION_BEFORE_RESPONSE:HTTP_0:METHOD=UNKNOWN:API_PATH=\/api\/auth\/get-session/,
  'an unanswerable response must degrade to explicit unknowns');

/* F. mutation proof: moving the pre-body evidence after the body read must FAIL. */
const POST_BODY_EMIT_LINE = '  events.push(emit(`${label}:HTTP_${status}:API_PATH=${path}:${headerEvidence(response.headers())}`));';
/* Relocates the pre-body evidence push to AFTER the body read, which is the regression the
   ordering check exists to catch. Used by both mutation proofs. */
function moveEvidenceAfterBodyRead(source) {
  return source
    .replace('  events.push(responseEvidence(label, response, path));\n  const status = response.status();\n', '  const status = response.status();\n')
    .replace(POST_BODY_EMIT_LINE, '  events.push(responseEvidence(label, response, path));\n' + POST_BODY_EMIT_LINE);
}
const normalizedScript = script.replace(/\r\n/g, '\n');
const mutated = moveEvidenceAfterBodyRead(normalizedScript);
assert.notEqual(mutated, normalizedScript, 'the mutation must actually reorder the pageCall evidence');
assert.equal(emitsPreBodyEvidence(mutated, 'pageCall'), false,
  'MUTATION_PROOF: the ordering check must fail when the pre-body evidence moves after the body read');

process.stdout.write('PRE_BODY_STATUS_EVIDENCE=PASS\n');
process.stdout.write('BODY_TIMEOUT_FAIL_CLOSED=PASS\n');
process.stdout.write('MALFORMED_JSON_NULL=PASS\n');
process.stdout.write('PRE_BODY_EVIDENCE_NO_SECRET=PASS\n');
process.stdout.write('MUTATION_PROOF_PRE_BODY_ORDER=PASS\n');

/* ===== #830 write-response body policy: HTTP status is the acceptance authority ===== */

/*
 * Second live failure (run 35549641133) proved the bookmark toggle returned HTTP 201 with
 * AUTH_BRIDGE_PRESENT=true, yet pageCall aborted the whole run because that 2xx response's
 * JSON body never settled. The product updates saved state from response.ok, so for a
 * mutation response the status is authoritative and the body is diagnostics. These checks
 * execute the shipped pageCall, not a quotation of it.
 */

function pageCallFactory(source) {
  const start = source.indexOf('async function pageCall(');
  assert.ok(start >= 0, 'pageCall must exist in the acceptance script');
  const end = source.indexOf('\n}\n', start);
  assert.ok(end > start, 'pageCall must have a bounded body');
  const body = source.slice(start, end + 2);
  return new Function('deps', `
    const { events, emit, json, classify, responseEvidence, headerEvidence } = deps;
    ${body}
    return pageCall;
  `);
}

function makeResponse({ status, method = 'POST', path, headers = {} }) {
  return {
    status: () => status,
    url: () => `https://danjion-qa.pages.dev${path}`,
    request: () => ({ method: () => method }),
    headers: () => ({ 'x-danjion-auth-bridge': '1', 'x-danjion-app-facade': '1', ...headers }),
    json: () => new Promise(() => {})
  };
}

function makePage(response) {
  return { waitForResponse: async () => response };
}

const TOGGLE_PATH = '/api/v1/me/bookmarks/71a8300d-0000-4000-8000-000000000001';

async function runPageCall(source, status) {
  const events = [];
  const pageCall = pageCallFactory(source)({
    events,
    emit: (line) => line,
    json: runtime.json,
    classify: runtime.classify,
    responseEvidence: runtime.responseEvidence,
    headerEvidence: runtime.headerEvidence
  });
  const result = await pageCall(makePage(makeResponse({ status, path: TOGGLE_PATH })), 'BOOKMARK_TOGGLE', 'POST', TOGGLE_PATH, async () => {});
  return { result, events };
}

/* A. HTTP 201 + never-settling body -> marker, SUCCESS, and it RETURNS instead of throwing. */
const a = await runPageCall(script, 201);
assert.equal(a.result.bodyTimeout, true, 'HTTP_201_BODY_TIMEOUT_CONTINUES: the body timeout must be recorded as a diagnostic');
assert.equal(a.result.auth, true, 'a 2xx mutation must stay authenticated');
assert.equal(a.result.disposition, 'SUCCESS', 'a 2xx mutation must stay SUCCESS');
assert.ok(
  a.events.some((l) => l === `BOOKMARK_TOGGLE_BODY_TIMEOUT=YES:HTTP_201:METHOD=POST:API_PATH=${TOGGLE_PATH}`),
  'the body timeout must leave an explicit marker with the authoritative status'
);
assert.ok(
  a.events.some((l) => l.startsWith('BOOKMARK_TOGGLE_RESPONSE:HTTP_201:METHOD=POST:')),
  'PAGECALL_STATUS_AUTHORITATIVE: the pre-body status evidence must still be emitted'
);

/* B. HTTP 401 + never-settling body -> AUTH_REQUIRED, never a false pass. */
const b = await runPageCall(script, 401);
assert.equal(b.result.auth, false, 'HTTP_401_NOT_FALSE_PASS: a 401 must never be treated as authenticated');
assert.equal(b.result.disposition, 'AUTH_REQUIRED', 'a 401 must stay AUTH_REQUIRED');

/* C. HTTP 403 + never-settling body -> product/authz failure, never an auth rejection, never 2xx. */
const c = await runPageCall(script, 403);
assert.equal(c.result.auth, true, 'HTTP_403_NOT_FALSE_PASS: a 403 is a product/authz failure, not an auth rejection');
assert.equal(c.result.disposition, 'FORBIDDEN_PRODUCT_POLICY_UNKNOWN_BODY_TIMEOUT',
  'the exact product-policy code must be UNKNOWN_BODY_TIMEOUT, never invented');
assert.notEqual(c.result.disposition, 'AUTH_REQUIRED', 'a 403 must never be confused with a 401');
assert.notEqual(c.result.disposition, 'SUCCESS', 'a 403 must never be confused with 2xx');

/* D. call() keeps the fail-closed body policy — its body is functional input, not diagnostics. */
const callStart = script.indexOf('async function call(');
const callEnd = script.indexOf('\n}\n', callStart);
const callBlock = script.slice(callStart, callEnd);
assert.ok(callBlock.includes('const body = await json(response);'), 'call() must still await its functional body');
assert.equal(callBlock.includes('_BODY_TIMEOUT'), false, 'direct call() must not swallow a body timeout');
assert.equal(callBlock.includes('catch'), false, 'direct call() must not catch the body-read timeout');
const callBodyRead = script.slice(script.indexOf('  const body = await json(response);\n  events.push(emit(`${label}:HTTP_${response.status()}:API_PATH=${new URL(response.url()).pathname}'));
assert.ok(callBodyRead.length > 0 || callBlock.includes('await json(response)'),
  'DIRECT_CALL_FAIL_CLOSED: the un-caught body read must remain');
await assert.rejects(
  () => runtime.json({ json: () => new Promise(() => {}) }),
  /QA_830_STEP_TIMEOUT:RESPONSE_BODY_JSON/,
  'DIRECT_CALL_FAIL_CLOSED: the shipped json() must still reject with QA_830_STEP_TIMEOUT'
);

/* E. Pre-body status evidence is still emitted before the body read. */
for (const name of ['call', 'pageCall']) {
  assert.equal(emitsPreBodyEvidence(script, name), true,
    `PRE_BODY_EVIDENCE_PRESERVED: ${name} must still emit response evidence before awaiting the body`);
}

/* F. No secret, header value or body content may appear in any emitted line. */
for (const line of [...a.events, ...b.events, ...c.events]) {
  assert.equal(/cookie|authorization|bearer|password|secret|set-cookie/i.test(line), false,
    `SECRET_OUTPUT: emitted line must carry no credential label: ${line}`);
  assert.equal(line.includes('SUPERSECRET'), false, 'SECRET_OUTPUT: no secret value may be emitted');
}

/* G. Mutation proof: reverting the body timeout to an unconditional throw must FAIL. */
const bpMutationTarget = `  } catch (error) {
    if (!String(error && error.message).startsWith('QA_830_STEP_TIMEOUT:')) throw error;
    bodyTimeout = true;`;
const bpMutationReplacement = `  } catch (error) {
    throw error;`;
const bpMutated = moveEvidenceAfterBodyRead(normalizedScript).replace(bpMutationTarget, bpMutationReplacement);
assert.notEqual(bpMutated, normalizedScript, 'the mutation must actually change the pageCall timeout handling');
let mutationThrew = false;
try {
  await runPageCall(bpMutated, 201);
} catch (error) {
  mutationThrew = String(error && error.message).startsWith('QA_830_STEP_TIMEOUT:');
}
assert.equal(mutationThrew, true,
  'MUTATION_PROOF_PAGECALL_BODY_TIMEOUT: an unconditional throw on a 2xx body timeout must fail the contract');

process.stdout.write('PAGECALL_STATUS_AUTHORITATIVE=PASS\n');
process.stdout.write('HTTP_201_BODY_TIMEOUT_CONTINUES=PASS\n');
process.stdout.write('HTTP_401_NOT_FALSE_PASS=PASS\n');
process.stdout.write('HTTP_403_NOT_FALSE_PASS=PASS\n');
process.stdout.write('DIRECT_CALL_FAIL_CLOSED=PASS\n');
process.stdout.write('PRE_BODY_EVIDENCE_PRESERVED=PASS\n');
process.stdout.write('MUTATION_PROOF_PAGECALL_BODY_TIMEOUT=PASS\n');

/* ===== #830 semantic acceptance: ok (2xx) is separate from auth ===== */

/*
 * A 403 previously came back auth=true, and the write callsites recorded
 * *_ACCEPTANCE from .auth — so an authenticated but forbidden write could be recorded as
 * *_ACCEPTANCE=PASS. These checks pin the separation: acceptance means the mutation was
 * functionally accepted (2xx), while auth only answers "was a session required".
 */

const SEMANTIC_SOURCES = [
  "record('REVIEW_ACCEPTANCE', review.ok",
  "record('BOOKMARK_ACCEPTANCE', toggle.ok",
  "record('INQUIRY_ACCEPTANCE', inquiry.ok",
  "record('REPORT_ACCEPTANCE', report.ok",
  'record(`${label}_ACCEPTANCE`, result.ok'
];
const AUTH_MARKER_SOURCES = [
  "record('REVIEW_AUTH', review.auth",
  "record('BOOKMARK_AUTH', toggle.auth",
  "record('INQUIRY_AUTH', inquiry.auth",
  "record('REPORT_AUTH', report.auth",
  'record(`${label}_AUTH`, result.auth'
];
function acceptanceUsesOk(source) {
  return SEMANTIC_SOURCES.every((needle) => source.includes(needle));
}
function acceptanceNeverUsesAuth(source) {
  return !/_ACCEPTANCE',\s*\w+\.auth/.test(source) && !/_ACCEPTANCE`, result\.auth/.test(source);
}

assert.equal(acceptanceUsesOk(script), true,
  'every write *_ACCEPTANCE must be recorded from the functional-success flag ok');
assert.equal(acceptanceNeverUsesAuth(script), true,
  'no write *_ACCEPTANCE may be recorded from the auth boolean');
for (const needle of AUTH_MARKER_SOURCES) {
  assert.ok(script.includes(needle), `the auth question must stay visible: ${needle}`);
}

/* Behavioural: ok/auth across the status ladder, all with a never-settling body. */
const ladder = {};
for (const status of [201, 401, 403, 422, 500]) {
  ladder[status] = (await runPageCall(script, status)).result;
}
assert.equal(ladder[201].ok, true, 'HTTP_201_BODY_TIMEOUT_ACCEPTANCE: a 2xx mutation is accepted');
assert.equal(ladder[201].auth, true, 'a 2xx mutation is authenticated');
assert.equal(ladder[401].ok, false, 'HTTP_401_BODY_TIMEOUT_ACCEPTANCE: a 401 is not accepted');
assert.equal(ladder[401].auth, false, 'a 401 is not authenticated -> FALSE_LOGIN_REQUIRED evidence');
assert.equal(ladder[403].ok, false, 'HTTP_403_BODY_TIMEOUT_ACCEPTANCE: a 403 is not accepted');
assert.equal(ladder[403].auth, true, 'a 403 is authenticated: AUTH=PASS / ACCEPTANCE=FAIL');
assert.notEqual(ladder[403].disposition, 'AUTH_REQUIRED', 'a 403 must never be read as a missing session');
assert.equal(ladder[422].ok, false, 'HTTP_422 is not accepted');
assert.equal(ladder[500].ok, false, 'HTTP_500 is not accepted');

/* F. no secret material may appear in the semantic lines either. */
for (const status of Object.keys(ladder)) {
  const line = `${ladder[status].disposition}`;
  assert.equal(/cookie|authorization|bearer|password|secret/i.test(line), false,
    'SECRET_OUTPUT: a disposition must carry no credential label');
}

/* G. Mutation proof: recording an acceptance from auth again must FAIL. */
const semanticMutated = script.replace(
  "record('INQUIRY_ACCEPTANCE', inquiry.ok",
  "record('INQUIRY_ACCEPTANCE', inquiry.auth"
);
assert.notEqual(semanticMutated, script, 'the mutation must actually change an acceptance record');
assert.equal(acceptanceUsesOk(semanticMutated), false,
  'MUTATION_PROOF_ACCEPTANCE_USES_OK: reverting an acceptance record to auth must fail the contract');
assert.equal(acceptanceNeverUsesAuth(semanticMutated), false,
  'MUTATION_PROOF_ACCEPTANCE_USES_OK: the auth-on-acceptance pattern must be detected');

process.stdout.write('ACCEPTANCE_USES_OK=PASS\n');
process.stdout.write('OK_AUTH_SEPARATED=PASS\n');
process.stdout.write('HTTP_201_BODY_TIMEOUT_ACCEPTANCE=PASS\n');
process.stdout.write('HTTP_401_BODY_TIMEOUT_ACCEPTANCE=PASS\n');
process.stdout.write('HTTP_403_BODY_TIMEOUT_ACCEPTANCE=PASS\n');
process.stdout.write('HTTP_422_500_NOT_ACCEPTED=PASS\n');
process.stdout.write('MUTATION_PROOF_ACCEPTANCE_USES_OK=PASS\n');

/* ===== #830 community post-publish navigation settle ===== */

/*
 * Run 35551295214 aborted at ENTER_COMMUNITY_QUESTION with
 * "page.goto: Navigation ... is interrupted by another navigation": every community write
 * page publishes and then navigates 650ms later by design. The acceptance drove the next
 * page.goto into that redirect. These checks pin the settle step that removes the race.
 */

const PP_START = 'const COMMUNITY_POST_PUBLISH_PATHS';
const PP_END = '/* === BOUNDED EVIDENCE HELPERS';
const ppStartAt = script.indexOf(PP_START);
const ppEndAt = script.indexOf(PP_END);
assert.ok(ppStartAt >= 0 && ppEndAt > ppStartAt, 'the post-publish settle helpers must exist');
const ppSource = script.slice(ppStartAt, ppEndAt);

const ppEvents = [];
const ppHelpers = new Function('withTimeout', 'events', 'emit', `
${ppSource}
return { isCommunityPostPublishDestination, waitForCommunityPostPublish, COMMUNITY_POST_PUBLISH_PATHS };
`)(runtime.withTimeout, ppEvents, (line) => line);

/* C. only the product-defined destinations are accepted, decoded from the real URL form. */
const DETAIL_URL = `https://danjion-qa.pages.dev/${encodeURI('13_이웃대화_글상세_댓글.html')}?apiBase=x&post=71a8300d-0000-4000-8000-000000000001`;
const FEED_URL = `https://danjion-qa.pages.dev/${encodeURI('12_이웃대화_첫화면.html')}?type=story&apiBase=x`;
const STORY_WRITE_URL = `https://danjion-qa.pages.dev/${encodeURI('15_단지이야기_글쓰기.html')}`;
const QUESTION_WRITE_URL = `https://danjion-qa.pages.dev/${encodeURI('16_궁금해요_글쓰기.html')}`;
const SHOP_URL = `https://danjion-qa.pages.dev/${encodeURI('01_이웃가게_발견.html')}`;

assert.equal(ppHelpers.isCommunityPostPublishDestination(DETAIL_URL), true, 'the post detail page is a valid destination');
assert.equal(ppHelpers.isCommunityPostPublishDestination(FEED_URL), true, 'the community feed fallback is a valid destination');
assert.equal(ppHelpers.isCommunityPostPublishDestination(STORY_WRITE_URL), false, 'a write page is not a post-publish destination');
assert.equal(ppHelpers.isCommunityPostPublishDestination(QUESTION_WRITE_URL), false, 'the question write page is not a destination');
assert.equal(ppHelpers.isCommunityPostPublishDestination(SHOP_URL), false, 'an unrelated page is not a destination');
assert.equal(ppHelpers.isCommunityPostPublishDestination('not a url'), false, 'garbage must not pass');
assert.equal(ppHelpers.isCommunityPostPublishDestination(undefined), false, 'a missing url must not pass');
assert.equal(ppHelpers.COMMUNITY_POST_PUBLISH_PATHS.length, 2, 'exactly the two product-defined destinations');

/* A/B. a write that lands on the write page must wait for the product redirect. */
function makeFakePage({ url, settleAfterMs, neverSettles = false }) {
  const calls = { waitForURL: 0 };
  return {
    calls,
    url: () => url,
    waitForURL: (predicate) => {
      calls.waitForURL += 1;
      if (neverSettles) return new Promise(() => {});
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          const target = `https://danjion-qa.pages.dev/${encodeURI('13_이웃대화_글상세_댓글.html')}?post=x`;
          if (predicate(target)) resolve(target); else reject(new Error('predicate rejected the destination'));
        }, settleAfterMs ?? 100);
      });
    }
  };
}

const waitingPage = makeFakePage({ url: STORY_WRITE_URL, settleAfterMs: 100 });
await ppHelpers.waitForCommunityPostPublish(waitingPage, 'COMMUNITY_STORY_POST_PUBLISH', 1_500);
assert.equal(waitingPage.calls.waitForURL, 1, 'POST_PUBLISH_NAV_WAIT: a write page must wait for the product redirect');
assert.ok(ppEvents.includes('COMMUNITY_STORY_POST_PUBLISH=SETTLED'), 'the settle must be observable in the evidence');

/* The redirect may already have completed before we look: that must pass without waiting. */
const settledPage = makeFakePage({ url: DETAIL_URL, settleAfterMs: 100 });
await ppHelpers.waitForCommunityPostPublish(settledPage, 'COMMUNITY_GREETING_POST_PUBLISH', 1_500);
assert.equal(settledPage.calls.waitForURL, 0, 'an already-settled redirect must not wait again');
assert.ok(ppEvents.includes('COMMUNITY_GREETING_POST_PUBLISH=ALREADY_SETTLED'), 'the already-settled case must be recorded');

const fallbackPage = makeFakePage({ url: FEED_URL, settleAfterMs: 100 });
await ppHelpers.waitForCommunityPostPublish(fallbackPage, 'COMMUNITY_TOGETHER_POST_PUBLISH', 1_500);
assert.equal(fallbackPage.calls.waitForURL, 0, 'the feed fallback is a settled destination too');

/* D. a redirect that never lands must fail closed, never be swallowed. */
await assert.rejects(
  () => ppHelpers.waitForCommunityPostPublish(makeFakePage({ url: QUESTION_WRITE_URL, neverSettles: true }), 'COMMUNITY_QUESTION_POST_PUBLISH', 40),
  /QA_830_STEP_TIMEOUT/,
  'NAV_TIMEOUT_FAIL_CLOSED: a navigation that never settles must fail closed'
);

/* I. event driven, not a fixed sleep, and not a catch-all retry. */
assert.ok(ppSource.includes('waitForURL('), 'the settle must be event driven');
assert.equal(ppSource.includes('setTimeout('), false, 'FIXED_SLEEP_ONLY=NO: the settle must not be a fixed sleep');
assert.equal(/catch\s*\(/.test(ppSource), false, 'the settle must not swallow the navigation error');

/* A(scope). every community write uses the same lifecycle, inside the loop. */
const loopStart = script.indexOf('for (const [label, route, kind] of community)');
assert.ok(loopStart > 0, 'the community loop must exist');
const loopBlock = script.slice(loopStart, script.indexOf('record(\'SESSION_AFTER\'', loopStart));
assert.ok(loopBlock.includes('await waitForCommunityPostPublish(page, `COMMUNITY_${label}_POST_PUBLISH`'),
  'GREETING/STORY/QUESTION/TOGETHER_FLOW_PROTECTED: the wait must sit in the shared community loop');
assert.equal(loopBlock.includes('if (result.ok)'), true, 'the wait must run only for an accepted write');
for (const label of ['GREETING', 'STORY', 'QUESTION', 'TOGETHER']) {
  assert.ok(loopBlock.includes(`['${label}'`) || script.includes(`['${label}'`), `${label} must stay covered`);
}

/* H. mutation proof: dropping the settle step must FAIL. */
const ppMutated = script.replace(
  '    if (result.ok) await waitForCommunityPostPublish(page, `COMMUNITY_${label}_POST_PUBLISH`, 15_000);\n',
  ''
);
assert.notEqual(ppMutated, script, 'the mutation must actually remove the settle step');
const ppMutatedLoop = ppMutated.slice(
  ppMutated.indexOf('for (const [label, route, kind] of community)'),
  ppMutated.indexOf("record('SESSION_AFTER'", ppMutated.indexOf('for (const [label, route, kind] of community)'))
);
assert.equal(ppMutatedLoop.includes('await waitForCommunityPostPublish(page,'), false,
  'MUTATION_PROOF_POST_PUBLISH_WAIT: removing the settle step must fail the contract');

/* E/F/G. the earlier policies stay in force. */
assert.equal(script.includes('FORBIDDEN_PRODUCT_POLICY_UNKNOWN_BODY_TIMEOUT'), true, '403 semantics preserved');
assert.equal(/record\('REVIEW_ACCEPTANCE', review\.ok/.test(script), true, 'ok-based acceptance preserved');
assert.ok(script.includes('const body = await json(response);'), 'DIRECT_CALL_FAIL_CLOSED preserved');

process.stdout.write('POST_PUBLISH_NAV_WAIT=PASS\n');
process.stdout.write('POST_PUBLISH_ALREADY_SETTLED=PASS\n');
process.stdout.write('POST_PUBLISH_DESTINATIONS_STRICT=PASS\n');
process.stdout.write('NAV_TIMEOUT_FAIL_CLOSED=PASS\n');
process.stdout.write('FIXED_SLEEP_ONLY=NO\n');
process.stdout.write('COMMUNITY_FLOWS_PROTECTED=PASS\n');
process.stdout.write('MUTATION_PROOF_POST_PUBLISH_WAIT=PASS\n');
