import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const script = await readFile(new URL('04_개발/frontend/scripts/qa-830-authenticated-acceptance.mjs', root), 'utf8');
const workflow = await readFile(new URL('.github/workflows/qa-830-authenticated-acceptance.yml', root), 'utf8');

assert.match(script, /const FRONTEND = 'https:\/\/danjion-qa\.pages\.dev'/);
assert.match(script, /const API = 'https:\/\/padiem-danjion-api-qa\.padiem\.workers\.dev'/);
assert.doesNotMatch(script, /danjion\.pages\.dev|production|PRODUCTION_API/);
assert.match(script, /\/api\/auth\/get-session/);
assert.match(script, /AUTH_BRIDGE_PRESENT=\$\{Boolean\(headers\['x-danjion-auth-bridge'\]\)\}/,
  'the auth bridge must be evidenced by header presence');
assert.match(script, /APP_FACADE_PRESENT=\$\{facadePresent\}/,
  'the app facade must be evidenced by header presence');
assert.doesNotMatch(script, /AUTH_BRIDGE_HEADER=|APP_FACADE_HEADER=/,
  'raw header values must never be written into the evidence stream');
assert.ok(!script.includes("headers['x-danjion-auth-bridge'] ||") && !script.includes("'] || '-'"),
  'evidence must not fall back to printing a header value');
assert.match(script, /status === 401/);
assert.match(script, /RESIDENT_VERIFICATION_REQUIRED/);
assert.match(script, /HOUSEHOLD_ASSOCIATION_REQUIRED/);
for (const path of [
  '/reviews', '/api/v1/me/bookmarks', '/api/v1/me/inquiries', '/api/v1/me/shop-recommendations',
  '/community/posts'
]) assert.ok(script.includes(path), `missing acceptance API path ${path}`);
for (const label of ['REVIEW', 'BOOKMARK', 'INQUIRY', 'REPORT']) {
  assert.ok(script.includes(`'${label}_ACCEPTANCE'`), `missing acceptance result ${label}`);
}
assert.match(script, /record\(`\$\{label\}_ACCEPTANCE`/);
assert.match(script, /\[QA #830/);
assert.match(script, /QA_TARGET=NON_PRODUCTION_ONLY/);
assert.match(script, /SECRET_OUTPUT=NO/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /expected_main/);
assert.match(workflow, /inputs\.run_live/);
assert.match(workflow, /environment:\s*qa/);
assert.doesNotMatch(workflow, /environment:\s*production/);
assert.match(workflow, /!= 'https:\/\/danjion\.pages\.dev'/);
assert.match(workflow, /git rev-parse HEAD/);
assert.match(workflow, /git ls-remote origin refs\/heads\/main/);
assert.match(workflow, /DANJION_QA_RESIDENT_EMAIL/);
assert.match(workflow, /DANJION_QA_RESIDENT_PASSWORD/);
assert.match(workflow, /node --check 04_개발\/frontend\/scripts\/qa-830-authenticated-acceptance\.mjs/);

/* --- bookmark restore must be proven by readback, never assumed --- */
// BOOKMARK_INITIAL_STATE is decided from the real server list.
assert.match(script, /const bookmarkInitial = await call\(context\.request, 'BOOKMARK_INITIAL', '\/api\/v1\/me\/bookmarks'\)/,
  'initial bookmark state must be read from /api/v1/me/bookmarks');
assert.match(script, /const wasBookmarked = initialIds\.has\(businessId\)/,
  'wasBookmarked must be derived from the server list membership');
assert.match(script, /BOOKMARK_INITIAL_STATE = wasBookmarked \? 'BOOKMARKED' : 'NOT_BOOKMARKED'/,
  'BOOKMARK_INITIAL_STATE must be set from wasBookmarked');
// POST/DELETE must branch on the initial state, for both toggle and restore.
assert.match(script, /const toggleMethod = wasBookmarked \? 'DELETE' : 'POST'/,
  'toggle method must branch on initial state (BOOKMARKED -> DELETE)');
assert.match(script, /const restoreMethod = wasBookmarked \? 'POST' : 'DELETE'/,
  'restore method must invert the initial state (NOT_BOOKMARKED -> DELETE)');
// Restore must be followed by a real /api/v1/me/bookmarks readback.
assert.match(script, /const bookmarkFinal = await call\(context\.request, 'BOOKMARK_FINAL', '\/api\/v1\/me\/bookmarks'\)/,
  'restore must be followed by a final /api/v1/me/bookmarks readback');
assert.match(script, /const finalBookmarked = finalIds\.has\(businessId\)/,
  'final membership must be computed from the readback');
// BOOKMARK_RESTORED is decided by comparing final membership to the initial state.
assert.match(script, /const membershipRestored = bookmarkFinal\.auth && restoreOk && finalBookmarked === wasBookmarked/,
  'BOOKMARK_RESTORED must compare final membership against the initial state');
assert.match(script, /BOOKMARK_RESTORED = membershipRestored/,
  'BOOKMARK_RESTORED must be assigned from the verified comparison, not hardcoded');
assert.doesNotMatch(script, /BOOKMARK_RESTORED = true/,
  'BOOKMARK_RESTORED must never be unconditionally set to true');
// A 401 on either toggle or restore is an outright failure.
assert.match(script, /if \(toggleStatus === 401\) record\('BOOKMARK_TOGGLE_401', false, 'AUTH_REQUIRED'\)/,
  'a 401 on the toggle must be recorded as a failure');
assert.match(script, /if \(restoreStatus === 401\) record\('BOOKMARK_RESTORE_401', false, 'AUTH_REQUIRED'\)/,
  'a 401 on the restore must be recorded as a failure');
assert.match(script, /restoreOk = restoreStatus >= 200 && restoreStatus < 300/,
  'restore success must come from the response status, not from the request having been sent');
// The four bookmark evidence fields must be emitted in the bounded output.
for (const line of [
  'BOOKMARK_INITIAL_STATE=${BOOKMARK_INITIAL_STATE',
  'BOOKMARK_TOGGLE_METHOD=${BOOKMARK_TOGGLE_METHOD',
  'BOOKMARK_TOGGLE_AUTH=${BOOKMARK_TOGGLE_AUTH}',
  'BOOKMARK_RESTORED=${BOOKMARK_RESTORED}'
]) assert.ok(script.includes(line), `missing bounded bookmark evidence output ${line}`);

/* --- community selectors must be strict, with no fail-open swallow --- */
assert.ok(script.includes("page.locator('[data-kind=\"walk\"]').click({ timeout: 10_000 })"),
  'Together selector [data-kind="walk"] must be clicked strictly');
assert.doesNotMatch(script, /data-kind="walk"\][^\n]*\.catch\(/,
  'Together selector must not swallow its click failure with .catch()');
assert.doesNotMatch(script, /\.catch\(\(\) => \{\}\)/,
  'no silent .catch(() => {}) fail-open may remain in the acceptance script');

/* --- failure path must flush the same bounded evidence the success path emits --- */
const flusher = script.slice(script.indexOf('function flushEvidence('));
assert.ok(flusher.startsWith('function flushEvidence(heading) {'), 'flushEvidence must exist');
assert.match(flusher, /console\.log\(heading\);[\s\S]*?for \(const line of events\) console\.log\(line\);[\s\S]*?for \(const line of results\) console\.log\(line\);/,
  'flushEvidence must print every collected event and result');

const catchBlock = script.slice(script.indexOf('catch (error) {'));
assert.ok(catchBlock.length > 0, 'the run must keep a catch boundary');
assert.match(catchBlock, /flushEvidence\('=== QA #830 AUTHENTICATED ACCEPTANCE FAILURE EVIDENCE ==='\)/,
  'a failed run must still print its collected evidence');
assert.match(catchBlock, /emitBookmarkMarkers\(\)/,
  'a failed run must still report bookmark residue');
assert.match(catchBlock, /console\.error\(`QA_830_ACCEPTANCE_FAILED=\$\{boundedError\(error\)\}`\)/,
  'the failure marker must print after the evidence, bounded');
assert.match(catchBlock, /process\.exitCode = 1/, 'a failed run must exit non-zero');
assert.doesNotMatch(script, /QA_830_ACCEPTANCE_FAILED=\$\{error instanceof/,
  'the failure marker must never print a raw error message');

assert.match(script, /function boundedError\(error\) \{/, 'error text must pass through a bounded sanitizer');
assert.match(script, /UNPRINTABLE_EVIDENCE = \/cookie\|authorization\|bearer\|password\|secret\/i/,
  'the sanitizer must reject credential-bearing text');
assert.match(script, /TOKEN_SHAPED = \/eyJ/, 'the sanitizer must reject token-shaped text');
assert.match(script, /return 'REDACTED'/, 'the sanitizer must redact rather than print');

/* The business lookup must be evidenced before it can abort the run. */
const lookup = script.slice(
  script.indexOf("call(context.request, 'BUSINESSES'"),
  script.indexOf("throw new Error('QA_830_NO_SERVER_BUSINESS')")
);
assert.ok(lookup.includes("record('SERVER_BUSINESS_RESOLVED'"),
  'the business lookup disposition must be recorded before the throw');
assert.ok(lookup.includes("if (!businessId)"), 'an empty usable business set must stop the run');

/* No credential may reach the evidence stream. */
assert.doesNotMatch(script, /console\.\w+\([^)]*\$\{(email|password|jwt|cookie|token)\b/i,
  'credentials must never be printed');
assert.doesNotMatch(script, /storageState|context\.cookies\(/, 'session storage must never be dumped');

/* ============================================================
 * HARD BOUNDS — every wait in the script must carry its own upper bound.
 * Two consecutive runs hung for 30-60 minutes with no output, because several
 * awaits had no bound of their own and the evidence was buffered until the end.
 * These are checked both as source shape and, where possible, as runtime
 * behaviour: a string check alone cannot prove the helper actually fires.
 * ============================================================ */

/* 1. the bounding helper exists and is used, not merely declared */
assert.match(script, /async function withTimeout\(promise, ms, label\) \{/,
  'the script must expose a single bounding helper');
for (const boundSite of [
  /withTimeout\(\s*page\.evaluate\(/,
  /withTimeout\(\s*response\.json\(\)/,
]) {
  assert.match(script, boundSite, `an evaluate/body read must be wrapped in withTimeout (${boundSite})`);
}

/* 2. the bounds are named constants, not scattered magic numbers */
for (const constant of ['DOM_EVAL_TIMEOUT_MS', 'BODY_READ_TIMEOUT_MS', 'REQUEST_TIMEOUT_MS']) {
  /* numeric separators are allowed, so digits alone are not enough here */
  assert.match(script, new RegExp(`const ${constant} = [0-9_]+;`), `${constant} must be a named constant`);
}
assert.match(script, /withTimeout\([\s\S]{0,900}DOM_EVAL_TIMEOUT_MS/,
  'the DOM evaluation must use the named DOM bound');
assert.match(script, /withTimeout\([\s\S]{0,300}BODY_READ_TIMEOUT_MS/,
  'the body read must use the named body bound');

/* 3. network requests carry an explicit timeout */
assert.match(script, /timeout: REQUEST_TIMEOUT_MS/,
  'requests must carry an explicit timeout instead of relying on a client default');
assert.ok(
  (script.match(/timeout: REQUEST_TIMEOUT_MS/g) || []).length >= 2,
  'both the generic request path and the sign-in request must be bounded'
);
assert.match(script, /context\.setDefaultTimeout\(/,
  'locator actions must still carry a context-level default bound');

/* 4. teardown is bounded too — an unbound close hides a finished run */
assert.match(script, /withTimeout\(context\.close\(\)/, 'context.close() must be bounded');
assert.match(script, /withTimeout\(browser\.close\(\)/, 'browser.close() must be bounded');

/* 5. a wall-clock kill must still name the step it reached */
assert.match(script, /process\.on\(signalName,/,
  'the script must trap the wall-clock kill signal');
assert.match(script, /QA_830_RUN_WALL_CLOCK_TIMEOUT=YES/,
  'a wall-clock kill must emit its own marker');
assert.match(script, /QA_830_LAST_STEP=/,
  'a wall-clock kill must report the last announced step');
assert.match(script, /function step\(name\)/, 'steps must be announced through one tracked helper');

/* 6. runtime proof that the helper actually bounds — a string match cannot show this */
/* the file may be CRLF, so the closing brace must be matched line-ending agnostic */
const helperStart = script.indexOf('async function withTimeout(');
const helperEnd = /\r?\n}\r?\n/.exec(script.slice(helperStart));
assert.ok(helperEnd, 'the bounding helper must have a findable closing brace');
const withTimeoutSource = script.slice(helperStart, helperStart + helperEnd.index + helperEnd[0].length);
assert.ok(withTimeoutSource.startsWith('async function withTimeout('), 'the helper source must be extractable');
const makeWithTimeout = new Function(`${withTimeoutSource}\nreturn withTimeout;`);
const withTimeout = makeWithTimeout();

/* resolves normally when the work finishes first */
const fastValue = await withTimeout(Promise.resolve('done'), 1_000, 'FAST');
assert.equal(fastValue, 'done', 'a bounded helper must still return the resolved value');

/* rejects with a labelled error when the bound is exceeded — and fires on time.
   The message alone is not proof: a helper that honours a different, much larger
   delay would still produce the same text. */
let timedOut = null;
const boundMs = 40;
const slackMs = 1_000;
const startedAt = Date.now();
try {
  await withTimeout(new Promise(() => {}), boundMs, 'SLOW_OP');
} catch (error) {
  timedOut = error;
}
const elapsedMs = Date.now() - startedAt;
assert.ok(timedOut instanceof Error, 'an unbounded operation must be rejected, not waited on forever');
assert.match(String(timedOut.message), /^QA_830_STEP_TIMEOUT:SLOW_OP:40ms$/,
  'the rejection must name the step and the bound that fired');
assert.ok(elapsedMs < boundMs + slackMs,
  `the bound must actually fire at the requested delay (took ${elapsedMs}ms for a ${boundMs}ms bound)`);

/* the rejected label never leaks a value: it is built from fixed parts only */
assert.doesNotMatch(String(timedOut.message), /cookie|bearer|password|secret/i,
  'the timeout label must stay credential-free');

/* 7. the three-layer bound is completed by the workflow itself:
      per-operation (above) + node wall-clock + job timeout. */
assert.match(workflow, /timeout --signal=TERM --kill-after=15s 12m node scripts\/qa-830-authenticated-acceptance\.mjs/,
  'the live step must wrap the node process in an OS wall-clock bound');
const liveJob = workflow.slice(workflow.indexOf('  live-qa:'));
assert.match(liveJob, /timeout-minutes: 20/,
  'the live-qa job must carry a final job-level timeout safety net');

/* the OS bound must stay below the job bound, or the job bound is what fires first
   and the script never gets its SIGTERM chance to name the step */
const osMinutes = Number(/timeout --signal=TERM --kill-after=15s (\d+)m/.exec(workflow)?.[1]);
const jobMinutes = Number(/timeout-minutes: (\d+)/.exec(liveJob)?.[1]);
assert.ok(Number.isFinite(osMinutes) && Number.isFinite(jobMinutes), 'both bounds must be numeric');
assert.ok(osMinutes > 0 && osMinutes <= 15, 'the live wall-clock bound must stay within 15 minutes');
assert.ok(jobMinutes > osMinutes, 'the job bound must be strictly greater than the OS bound');

console.log('qa-830-authenticated-acceptance-contract: PASS');
