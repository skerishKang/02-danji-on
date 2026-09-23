import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const workflow = await readFile(
  new URL('../../.github/workflows/provision-production-r2-bucket.yml', root),
  'utf8',
);

const must = (re, msg) => assert.match(workflow, re, msg);
const mustNot = (needle, msg) =>
  assert.ok(!workflow.includes(needle), msg ?? `forbidden ${needle}`);

// --- dispatch-only + explicit authorization inputs ---
must(/workflow_dispatch:/, 'workflow must be dispatch-capable');
must(/expected_main:/, 'dispatch must require exact main');
must(/confirm_production:/, 'dispatch must require explicit production confirm');
must(
  /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.confirm_production \}\}/,
  'provisioning job must run only on dispatch with explicit confirm',
);

// --- no automatic or push/PR triggers ---
mustNot('\n  schedule:', 'automatic schedule forbidden');
mustNot('\n  push:', 'push trigger forbidden');
mustNot('\n  pull_request:', 'PR trigger forbidden');

// --- exact-main guard ---
must(
  /git ls-remote origin refs\/heads\/main/,
  'must fresh-read remote main for exact-main guard',
);
must(/EXACT_MAIN_GUARD=PASS/, 'exact-main guard must report PASS');

// --- production environment + sanctioned Cloudflare credential names ---
must(/environment:\s*production/, 'provisioning must use production environment');
must(
  /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/,
  'must reuse sanctioned Cloudflare token secret name',
);
must(
  /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/,
  'must reuse sanctioned Cloudflare account-id secret name',
);
must(
  /if \[ "\$account_name" != "Padiem" \]/,
  'Padiem account guard must fail closed',
);
must(/CLOUDFLARE_ACCOUNT_GUARD=PASS/, 'account guard must report PASS');

// --- bounded target: danjion-storage exactly once for create ---
must(/TARGET_BUCKET_EXACT=danjion-storage/, 'target bucket marker must be exact');
assert.ok(
  workflow.includes('danjion-storage') && !workflow.includes('danjion-storage-qa-create'),
  'workflow must reference canonical buckets only',
);
const creates = workflow.match(/\{"name":"danjion-storage"\}/g) || [];
assert.equal(creates.length, 1, 'exactly one bounded create payload for danjion-storage');
must(/BUCKET_CREATE=SKIPPED_ALREADY_EXISTS/, 'existing bucket must skip create');
must(/PRODUCTION_BUCKET_AFTER=PRESENT/, 'post-create readback must confirm presence');
must(/QA_BUCKET_PRESERVED=YES/, 'QA bucket danjion-storage-qa must stay preserved');
must(/danjion-storage-qa/, 'QA bucket name must be present for preservation check');

// --- forbidden mutations: objects, deletes, deploys, DB, secrets output ---
for (const needle of [
  'r2 object put',
  'r2 object delete',
  'buckets delete',
  'wrangler deploy',
  'pages deploy',
  'wrangler secret put',
  'DANJION_PRODUCTION_DB_URL',
  'migration-gate',
  'production-migration-gate',
]) {
  mustNot(needle, `workflow must not carry authority: ${needle}`);
}
mustNot('danjion-storage-qa"', 'workflow must never target QA bucket for create');
assert.ok(
  !/echo[^\\n]*(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID)=\$\{/m.test(workflow),
  'workflow must never print credential values',
);

// --- safe output markers only ---
for (const marker of [
  'EXACT_MAIN_GUARD=PASS',
  'CLOUDFLARE_ACCOUNT_GUARD=PASS',
  'PRODUCTION_BUCKET_BEFORE=',
  'BUCKET_CREATE=',
  'PRODUCTION_BUCKET_AFTER=PRESENT',
  'QA_BUCKET_PRESERVED=YES',
]) {
  must(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing safe marker ${marker}`);
}

console.log('production-r2-bucket-provision-contract: PASS');
