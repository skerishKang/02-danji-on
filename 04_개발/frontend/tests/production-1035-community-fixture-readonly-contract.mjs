import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../scripts/production-1035-community-fixture-readonly.mjs', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../../../.github/workflows/production-1035-community-fixture-readonly.yml', import.meta.url), 'utf8');

assert.ok(script.includes("const FRONTEND = 'https://danjion.pages.dev';"));
assert.ok(script.includes("const COMPLEX = 'banglim-myeongji-roadhill';"));
assert.ok(script.includes('HISTORICAL_POSTS'));
assert.ok(script.includes('HISTORICAL_COMMENTS'));
assert.ok(script.includes('markerFamilies'));
assert.ok(script.includes('authorFingerprint'));
assert.equal(script.includes('authorNickname'), false);
assert.equal(script.includes('DATABASE_URL'), false);
assert.equal(script.includes('DANJION_PRODUCTION_DB_URL'), false);
assert.equal(script.includes('/api/v1/admin/'), false);

const requestPosts = [...script.matchAll(/context\.request\.post\(/g)];
assert.equal(requestPosts.length, 1, 'only credential sign-in may POST');
assert.ok(script.includes("context.request.post(`${FRONTEND}/api/auth/sign-in/email`"));
for (const forbidden of ['context.request.patch(', 'context.request.delete(', 'context.request.put(']) {
  assert.equal(script.includes(forbidden), false, `${forbidden} must not exist`);
}
assert.ok(script.includes('request.get('), 'enumeration must use GET requests');
assert.equal(/request\.(post|patch|delete|put)\([^\n]*community/i.test(script), false, 'community writes are forbidden');
assert.equal(/delete\s+from|update\s+community_|insert\s+into/i.test(script), false, 'SQL mutation text is forbidden');
assert.ok(script.includes('PRODUCTION_1035_PRODUCT_DATA_MUTATION=0'));
assert.ok(script.includes('PRODUCTION_1035_DB_DIRECT_ACCESS=0'));
assert.ok(script.includes('PRODUCTION_1035_SECRET_OUTPUT=0'));

assert.ok(workflow.includes('workflow_dispatch:'));
assert.ok(workflow.includes('expected_main:'));
assert.ok(workflow.includes('run_live:'));
assert.ok(workflow.includes('environment: production'));
assert.ok(workflow.includes("DANJION_PRODUCTION_FRONTEND_URL: https://danjion.pages.dev"));
assert.ok(workflow.includes('DANJION_PRODUCTION_TEST_RESIDENT_EMAIL'));
assert.ok(workflow.includes('DANJION_PRODUCTION_TEST_RESIDENT_PASSWORD'));
assert.ok(workflow.includes('test -z "${DATABASE_URL:-}"'));
assert.ok(workflow.includes('test -z "${DANJION_PRODUCTION_DB_URL:-}"'));
assert.ok(workflow.includes("github.event_name == 'workflow_dispatch' && inputs.run_live"));
assert.equal(workflow.includes('schedule:'), false, 'no recurring Production enumeration');
assert.equal(workflow.includes('push:'), false, 'no automatic Production enumeration on push');

process.stdout.write('PRODUCTION_1035_READONLY_CONTRACT=PASS\n');
process.stdout.write('PRODUCT_DATA_MUTATION_PATH=ABSENT\n');
process.stdout.write('DIRECT_DB_ACCESS_PATH=ABSENT\n');
process.stdout.write('AUTO_LIVE_TRIGGER=ABSENT\n');
