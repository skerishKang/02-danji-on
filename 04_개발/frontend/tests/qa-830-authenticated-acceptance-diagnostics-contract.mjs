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
  MAX_SAMPLES, MAX_DOM_KEYS, HYDRATION_TIMEOUT_MS };`)();
const { boundedText, boundedError, errorDetail, pushSample, originAndPathname, isBusinessDiscovery } = helpers;

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
assert.match(script, /diagnostics\.businessRequestOrigin = endpoint\.origin;/,
  'the discovery origin must actually be captured from the response');
assert.match(script, /diagnostics\.businessResponseStatus = response\.status\(\);/,
  'the discovery status must actually be captured from the response');
assert.match(script, /diagnostics\.businessRequestFailed = true;/,
  'a failed discovery request must be flagged, not only sampled');
/*
 * Bypass must be ruled out by mechanism, not by English: the script legitimately
 * documents "no fail-open skip" in a comment, and a word-level scan would match
 * the prose that forbids the thing.
 */
assert.doesNotMatch(script, /page\.route\(|force:\s*true|\.skip\(|test\.skip|bypass|stubResponse|continue:\s*false/i,
  'no request interception, forced click, skipping or bypass may appear');

console.log('qa-830-authenticated-acceptance-diagnostics-contract: PASS');
