import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const script = await readFile(new URL('04_개발/frontend/scripts/qa-830-authenticated-acceptance.mjs', root), 'utf8');
const workflow = await readFile(new URL('.github/workflows/qa-830-authenticated-acceptance.yml', root), 'utf8');

assert.match(script, /const FRONTEND = 'https:\/\/danjion-qa\.pages\.dev'/);
assert.match(script, /const API = 'https:\/\/padiem-danjion-api-qa\.padiem\.workers\.dev'/);
assert.doesNotMatch(script, /danjion\.pages\.dev|production|PRODUCTION_API/);
assert.match(script, /\/api\/auth\/get-session/);
assert.match(script, /AUTH_BRIDGE_HEADER/);
assert.match(script, /APP_FACADE_HEADER/);
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

console.log('qa-830-authenticated-acceptance-contract: PASS');
