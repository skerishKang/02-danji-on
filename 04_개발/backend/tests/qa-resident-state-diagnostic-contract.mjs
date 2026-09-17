import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const workflow = await readFile(new URL('.github/workflows/qa-resident-state-diagnostic.yml', root), 'utf8');
const script = await readFile(new URL('04_개발/backend/scripts/qa-resident-state-diagnostic.mjs', root), 'utf8');

assert.match(workflow, /pull_request:/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /environment:\s*qa/);
assert.doesNotMatch(workflow, /environment:\s*production/);
assert.match(workflow, /expected_main/);
assert.match(workflow, /git ls-remote origin refs\/heads\/main/);
assert.match(workflow, /inputs\.run_live/);

for (const required of ['DANJION_QA_API_URL','DANJION_QA_FRONTEND_URL','DANJION_QA_EMAIL','DANJION_QA_PASSWORD']) {
  assert.ok(workflow.includes(required), `missing ${required}`);
}
for (const forbidden of ['DATABASE_URL:', 'DANJION_QA_DATABASE_URL', 'padiem-danjion-api-production', 'danjion.pages.dev']) {
  assert.ok(!workflow.includes(forbidden), `diagnostic must not carry DB/Production authority: ${forbidden}`);
}

assert.match(script, /createHouseholdClaimBridge/);
assert.match(script, /page19Bridge\.getSnapshot\(\)/);
assert.match(script, /page26Bridge\.getSnapshot\(\)/);
assert.match(script, /Promise\.all/);
assert.match(script, /JSON\.stringify\(page19\) !== JSON\.stringify\(page26\)/);
assert.match(script, /SAME_SESSION_SAME_SNAPSHOT/);
assert.match(script, /QA_API_HOST = 'padiem-danjion-api-qa\.padiem\.workers\.dev'/);
assert.match(script, /QA_FRONTEND_HOST = 'danjion-qa\.pages\.dev'/);
assert.match(script, /COMPLEX_SLUG = 'qa-synthetic-complex'/);
assert.doesNotMatch(script, /banglim-myeongji-roadhill/);
assert.doesNotMatch(script, /DATABASE_URL/);

const allowedLogs = [
  'HTTP_STATUS=',
  'RESULT_OK=',
  'ERROR_CODE=',
  'AUTH_BRIDGE_DISPOSITION=SAME_SESSION_SAME_SNAPSHOT',
  'MY_MEMBERSHIP_STATUS=',
  'RESIDENT_VERIFIED='
];
for (const output of allowedLogs) assert.ok(script.includes(output), `missing safe output ${output}`);

for (const sensitive of [
  'console.log(email', 'console.log(password', 'console.log(jwt', 'console.log(cookie',
  'console.log(subject', 'buildingCode', 'unitCode', 'membershipId', 'displayName'
]) {
  assert.ok(!script.includes(sensitive), `privacy-sensitive diagnostic output/reference forbidden: ${sensitive}`);
}

assert.match(script, /\/api\/auth\/sign-in\/email/);
assert.match(script, /\/api\/auth\/get-session/);
assert.match(script, /\/api\/auth\/token/);
assert.match(script, /\/api\/v1\/me/);

console.log('qa-resident-state-diagnostic-contract: PASS');
