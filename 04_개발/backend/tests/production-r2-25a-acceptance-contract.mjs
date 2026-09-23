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
  'OBJECT_KEY_RETURNED=PASS',  'PUBLIC_OBJECT_READBACK=PASS',
  'UPLOAD_FIXTURE_BYTES_STABLE=PASS',
  'PUBLIC_READBACK_HTTP_200=PASS',
  'PUBLIC_READBACK_BYTE_LENGTH_MATCH=PASS',
  'PUBLIC_READBACK_SHA256_MATCH=PASS',
  'PUBLIC_READBACK_CONTENT_TYPE_SAFE=PASS',
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
// #955 byte integrity: the public readback must be raw-byte compared, never JSON-decoded.
assert.ok(script.includes('arrayBuffer()'), 'public readback must capture raw bytes');
assert.ok(!/readback\s*=\s*await request\(/.test(script), 'public readback must not use the JSON request helper');
assert.ok(script.includes("createHash('sha256')"), 'byte integrity must use SHA-256');
assert.ok(script.includes('evaluateReadbackIntegrity'), 'readback integrity evaluator missing');
assert.ok(script.includes("Object.freeze(['image/png'])"), 'safe readback media type allowlist missing');
assert.ok(script.includes('FIXTURE_EXPECTED_BYTE_LENGTH'), 'upload fixture length proof missing');
// sanitized logging only: no raw fixture bytes or hashes may ever be printed
assert.ok(
  !/console\.(log|error)\(\s*(UPLOAD_BYTES|UPLOAD_SHA256|readback\.bytes)/.test(script),
  'raw fixture bytes/hashes must never be logged',
);
// the offline executable regression test must exist and keep its fail-closed cases
const integrityTest = readFileSync(join(here, 'production-r2-25a-readback-integrity.test.mjs'), 'utf8');
for (const marker of [
  'CASE1_GOOD_200_PASSES=PASS',
  'TRUNCATED_200_FAILS_CLOSED=PASS',
  'SAME_LENGTH_WRONG_BYTES_FAILS_CLOSED=PASS',
  'EMPTY_200_FAILS_CLOSED=PASS',
  'HTTP_FAILURE_FAILS_CLOSED=PASS',
  'WRONG_CONTENT_TYPE_FAILS_CLOSED=PASS',
]) assert.ok(integrityTest.includes(marker), `offline integrity test marker missing: ${marker}`);
assert.ok(integrityTest.includes("from '../scripts/production-r2-25a-acceptance.mjs'"), 'offline test must execute the real helpers');
console.log('production-r2-25a-acceptance-contract: PASS');
