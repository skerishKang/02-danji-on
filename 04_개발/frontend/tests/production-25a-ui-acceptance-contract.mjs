import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../../.github/workflows/production-25a-ui-acceptance.yml', import.meta.url), 'utf8');
const script = await readFile(new URL('../scripts/production-25a-ui-acceptance.mjs', import.meta.url), 'utf8');
const page = await readFile(new URL('../../../frontend/25A_신청제보.html', import.meta.url), 'utf8');

assert.match(workflow, /pull_request:/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /expected_main:/);
assert.match(workflow, /run_live:/);
assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.run_live/);
assert.match(workflow, /environment:\s*production/);
assert.match(workflow, /ref:\s*main/);
assert.match(workflow, /git ls-remote origin refs\/heads\/main/);
assert.match(workflow, /PRODUCTION_809_EXACT_MAIN_GUARD=PASS/);
assert.match(workflow, /PRODUCTION_809_ONE_ACCOUNT_GUARD=PASS/);

for (const token of [
  'DANJION_PRODUCTION_25A_EMAIL',
  'DANJION_PRODUCTION_25A_PASSWORD',
  'https://danjion.pages.dev',
]) assert.ok(workflow.includes(token), `workflow must bind ${token}`);

for (const forbidden of [
  'DANJION_PRODUCTION_DB_URL: ${{',
  'DATABASE_URL: ${{',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'wrangler deploy',
  'pages deploy',
  'sign-up/email',
]) assert.ok(!workflow.includes(forbidden), `workflow must not contain ${forbidden}`);

assert.match(workflow, /test -z "\$\{DATABASE_URL:-\}"/);
assert.match(workflow, /test -z "\$\{DANJION_PRODUCTION_DB_URL:-\}"/);

assert.ok(script.includes("const EXPECTED_FRONTEND_HOST = 'danjion.pages.dev'"));
assert.match(script, /context\.request\.post\(`\$\{frontendBase\}\/api\/auth\/sign-in\/email`/);
assert.match(script, /context\.request\.get\(`\$\{frontendBase\}\/api\/auth\/get-session`/);
assert.match(script, /page\.goto\(new URL\(LIVE_PAGE/);
assert.ok(script.includes("redirect: 'follow'"));
assert.ok(script.includes('LIVE_PAGE_REDIRECT_TARGET_INVALID'));
assert.match(script, /liveFinalUrl\.hostname !== EXPECTED_FRONTEND_HOST/);
assert.ok(!script.includes("redirect: 'manual'"));
assert.ok(!script.includes('padiem-danjion-api-qa.padiem.workers.dev'));
assert.ok(!script.includes('danjion-qa.pages.dev'));

for (const marker of [
  'LIVE_SOURCE_BYTE_PARITY',
  'PHOTO_ADD_AFTER_1',
  'PHOTO_ADD_AFTER_2',
  'PHOTO_MAX_3_DISABLED',
  'PHOTO_FOURTH_CAPPED',
  'PHOTO_DELETE_REENABLE',
  'PHOTO_READD_TO_3',
  'PHOTO_FINAL_SUBMIT_COUNT_1',
  'OWNER_PROOF_1',
]) assert.ok(script.includes(marker), `missing UI marker ${marker}`);

assert.match(script, /setInputFiles/);
assert.match(script, /#photosList \.file-remove/);
assert.match(script, /3 \/ 3장/);
assert.match(script, /2 \/ 3장/);
assert.match(script, /1 \/ 3장/);

for (const marker of [
  'UI_STORAGE_UPLOAD_2X201',
  'UI_APPLICATION_CREATE_201',
  'UI_SUCCESS_TOAST',
  'GENERIC_PHOTO_UPLOAD_FAILURE_VISIBLE',
  'PRODUCTION_809_UI_ACCEPTANCE',
  'ACCOUNT_PROVISIONING=0',
  'HOUSEHOLD_PROVISIONING=0',
  'AUTO_RETRY_FOR_MUTATIONS=0',
  'SECRET_OUTPUT=0',
]) assert.ok(script.includes(marker), `missing acceptance marker ${marker}`);

assert.match(script, /\/api\/v1\/storage\/objects/);
assert.match(script, /\/api\/v1\/me\/business-applications/);
assert.ok(script.includes('storageResponses.length !== 2'));
assert.ok(script.includes('applicationResponses.length !== 1'));
assert.ok(script.includes('GENERIC_PHOTO_FAILURE'));

for (const forbiddenLog of [
  'console.log(email',
  'console.log(password',
  'console.log(sessionJson',
  'console.log(objectKey',
  'storageState(',
]) assert.ok(!script.includes(forbiddenLog), `script must not emit ${forbiddenLog}`);

for (const token of [
  'data-file-add="photos"',
  'bindAccumulatingFiles',
  'uploadBusinessImage',
  'uploadApplicationDocument',
  'createOwnerApplication',
  '사진 업로드에 실패했습니다.',
]) assert.ok(page.includes(token), `25A page contract missing ${token}`);

console.log('production-25a-ui-acceptance-contract: PASS');
