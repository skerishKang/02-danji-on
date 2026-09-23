import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const script = readFileSync(join(here, '..', 'scripts', 'production-r2-25a-acceptance.mjs'), 'utf8');
const workflow = readFileSync(join(root, '.github', 'workflows', 'production-r2-25a-acceptance.yml'), 'utf8');

for (const marker of [
  'PRODUCTION_ONLY_EXACT_TARGET_GUARD=PASS',
  'ONE_PREEXISTING_ACCEPTANCE_ACCOUNT_ONLY=YES',
  'ACCOUNT_PROVISIONING=0',
  'HOUSEHOLD_PROVISIONING=0',
  'AUTO_RETRY_FOR_MUTATIONS=0',
  'R2_OBJECT_UPLOAD=PASS',
  'OBJECT_KEY_RETURNED=PASS',
  'PUBLIC_OBJECT_READBACK=PASS',
  'BUSINESS_APPLICATION_CREATE=PASS',
  'INVALID_REFERENCE_REJECTION=PASS',
  'REFERENCED_OBJECT_DELETE_GUARD=PASS'
]) assert.ok(script.includes(marker), `script marker missing: ${marker}`);
for (const host of ['padiem-danjion-api-production.padiem.workers.dev', 'danjion.pages.dev']) assert.ok(script.includes(host), `production target missing: ${host}`);
for (const forbidden of ['DANJION_QA_', 'wrangler deploy']) assert.ok(!workflow.includes(forbidden), `workflow carries forbidden authority/input: ${forbidden}`);
assert.ok(!/DANJION_PRODUCTION_DB_URL:\s*\$\{\{/.test(workflow), 'workflow must not bind production DB secret');
assert.match(workflow, /test -z "\$\{DATABASE_URL:-\}"/);
assert.match(workflow, /test -z "\$\{DANJION_PRODUCTION_DB_URL:-\}"/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /expected_main:/);
assert.match(workflow, /run_live:/);
assert.match(workflow, /environment:\s*production/);
assert.match(workflow, /git ls-remote origin refs\/heads\/main/);
assert.match(workflow, /DANJION_PRODUCTION_25A_EMAIL/);
assert.match(workflow, /DANJION_PRODUCTION_25A_PASSWORD/);
assert.match(workflow, /if:.*inputs\.run_live/);
console.log('production-r2-25a-acceptance-contract: PASS');
