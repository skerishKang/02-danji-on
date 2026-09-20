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
console.log('qa-830-authenticated-acceptance-contract: PASS');
