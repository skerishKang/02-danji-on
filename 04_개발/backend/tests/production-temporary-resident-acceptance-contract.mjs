import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const workflow = await readFile(new URL('.github/workflows/production-temporary-resident-acceptance.yml', root), 'utf8');
const script = await readFile(new URL('04_개발/backend/scripts/production-temporary-resident-acceptance.mjs', root), 'utf8');

assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /expected_main:/);
assert.match(workflow, /run_live:/);
assert.match(workflow, /environment: production/);
assert.match(workflow, /padiem-danjion-api-production\.padiem\.workers\.dev/);
assert.match(workflow, /danjion\.pages\.dev/);
assert.match(workflow, /DANJION_PRODUCTION_TEMP_RESIDENT_PASSWORD/);
assert.match(workflow, /DANJION_PRODUCTION_TEMP_RESIDENT_EMAIL/);
assert.match(workflow, /test "\$actual" = "\$expected"/);
assert.match(workflow, /test "\$remote" = "\$expected"/);
assert.match(workflow, /DATABASE_URL.*PRODUCTION_DB_URL|PRODUCTION_DB_URL.*DATABASE_URL/);
assert.doesNotMatch(workflow, /sign-up|wrangler deploy/i);

assert.match(script, /PROD_TEMP_RESIDENT/);
assert.match(script, /resident-verification-exemption/);
assert.match(script, /resident-news/);
assert.match(script, /TEMPORARY_ADMISSION_NOT_GRANTED/);
assert.match(script, /HOUSEHOLD_MUTATION=NO/);
assert.match(script, /ACCOUNT_PROVISIONING=NO/);
assert.doesNotMatch(script, /sign-up\/email/);
assert.doesNotMatch(script, /psql|drizzle|sql`|INSERT INTO|UPDATE .* SET|DELETE FROM/i);

console.log('production-temporary-resident-acceptance-contract: PASS');
