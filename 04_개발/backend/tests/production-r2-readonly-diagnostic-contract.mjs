import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const workflow = await readFile(
  new URL('../../.github/workflows/production-r2-readonly-diagnostic.yml', root),
  'utf8',
);

const must = (re, msg) => assert.match(workflow, re, msg);
const mustNot = (needle, msg) =>
  assert.ok(!workflow.includes(needle), msg ?? `forbidden ${needle}`);

// --- dispatch-only + explicit authorization input ---
must(/workflow_dispatch:/, 'workflow must be dispatch-capable');
must(/expected_main:/, 'dispatch must require exact main');
must(
  /github\.event_name == 'workflow_dispatch'/,
  'diagnostic job must run only on dispatch',
);

// --- no automatic or push/PR triggers ---
mustNot('\n  schedule:', 'automatic schedule forbidden');
mustNot('\n  push:', 'push trigger forbidden');
mustNot('\n  pull_request:', 'PR trigger forbidden');

// --- exact-main + production environment ---
must(/git ls-remote origin refs\/heads\/main/, 'must fresh-read remote main');
must(/EXACT_MAIN_GUARD=PASS/, 'exact-main guard must report PASS');
must(/environment:\s*production/, 'diagnostic must use production environment');
must(
  /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/,
  'must reuse sanctioned Cloudflare token secret name',
);
must(
  /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/,
  'must reuse sanctioned Cloudflare account-id secret name',
);
must(/CLOUDFLARE_ACCOUNT_GUARD=PASS/, 'account guard must report PASS');

// --- read-only diagnostic markers ---
must(/R2_LIST_HTTP_STATUS=/, 'canonical list must report HTTP status');
must(/R2_LIST_SUCCESS=/, 'canonical list must report success flag');
must(/R2_LIST_ERROR_CODE=/, 'canonical list failure must sanitize error code');
must(/R2_LIST_ERROR_MESSAGE=/, 'canonical list failure must sanitize error message');
must(/R2_FILTERED_LIST_HTTP_STATUS=/, 'filtered probe must report HTTP status');
must(/R2_FILTERED_LIST_SUCCESS=/, 'filtered probe must report success flag');
must(/PRODUCTION_BUCKET_PRESENT=/, 'must report production bucket presence');
must(/QA_BUCKET_PRESENT=/, 'must report QA bucket presence');
must(/r2\/buckets\?name_contains=danjion-storage&per_page=100/, 'presence readback must be filtered');

// --- GET-only: no mutating methods or deploys ---
for (const needle of [
  '-X POST',
  '-X PUT',
  '-X PATCH',
  '-X DELETE',
  '--data ',
  'wrangler deploy',
  'pages deploy',
  'wrangler secret put',
  'r2 object',
  'buckets delete',
  'DANJION_PRODUCTION_DB_URL',
  'migration-gate',
  'production-migration-gate',
]) {
  mustNot(needle, `workflow must not carry authority: ${needle}`);
}
assert.ok(
  !/echo[^\\n]*(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID)=\$\{/m.test(workflow),
  'workflow must never print credential values',
);

console.log('production-r2-readonly-diagnostic-contract: PASS');
