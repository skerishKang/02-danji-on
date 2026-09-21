import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const workflow = await readFile(new URL('.github/workflows/qa-temporary-resident-acceptance.yml', root), 'utf8');
const script = await readFile(new URL('04_개발/backend/scripts/qa-temporary-resident-acceptance.mjs', root), 'utf8');

assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /expected_main:/);
assert.match(workflow, /run_live:/);
assert.match(workflow, /environment: qa/);
assert.match(workflow, /test "\$actual" = "\$expected"/);
assert.match(workflow, /test "\$remote" = "\$expected"/);
assert.match(workflow, /padiem-danjion-api-qa\.padiem\.workers\.dev/);
assert.match(workflow, /danjion-qa\.pages\.dev/);
assert.doesNotMatch(workflow, /environment:\s*production/);
assert.match(workflow, /padiem-danjion-api-production\.padiem\.workers\.dev/);
assert.match(workflow, /https:\/\/danjion\.pages\.dev/);
assert.match(workflow, /DANJION_QA_TEMP_RESIDENT_PASSWORD/);
assert.match(workflow, /confirm.*run_live|inputs\.run_live/);

assert.match(script, /QA_TEMP_RESIDENT/);
assert.match(script, /skerish_temp_resident_test@naver\.com/);
assert.match(script, /resident-verification-exemption/);
assert.match(script, /admin\/authority/);
assert.match(script, /resident-news/);
assert.match(script, /TEMPORARY_ADMISSION_NOT_GRANTED/);
assert.match(script, /PROTECTED_RESIDENT_GATE_/);
assert.match(script, /householdId/);
assert.match(script, /membershipId/);
assert.match(script, /HOUSEHOLD_MUTATION=NO/);
assert.match(script, /PRODUCTION_TARGET=NO/);
assert.match(script, /DATABASE_URL.*PRODUCTION_DATABASE_FORBIDDEN|DANJION_PRODUCTION_DB_URL/);
assert.doesNotMatch(script, /sign-up\/email/);
assert.doesNotMatch(script, /method:\s*['"](POST|PUT|PATCH|DELETE)['"][\s\S]{0,200}household/i);

console.log('qa-temporary-resident-acceptance-contract: PASS');
