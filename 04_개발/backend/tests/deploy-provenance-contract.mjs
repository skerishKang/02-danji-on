// Issue #384 contract: deployed-artifact identity provenance capture is
// deterministic, fail-closed on missing identity evidence, secret-safe, and
// wired additively into the guarded bootstrap workflow without any
// production deployment being executed here.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ProvenanceError,
  PROVENANCE_SCHEMA_VERSION,
  parseDeployOutput,
  extractDeploymentIdentity,
  extractVersionViewId,
  buildProvenanceRecord,
  serializeProvenance,
  assertNoSecrets,
  verifyPostDeployReadback,
} from '../scripts/deploy-provenance.mjs';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(backendRoot, '..', '..');

const VERSION_ID = 'bbee1b59-fcab-4293-a875-4d1b44c6ff10';
const DEPLOYMENT_ID = '3f2b7c11-9d4e-4a6b-8c2d-1e5f6a7b8c9d';
const SOURCE_SHA = '9f25800609fa831383f245403b3fbb7345ca05ac';
const TREE_DIGEST = `sha256:${'ab'.repeat(32)}`;

// --- deploy output parsing -------------------------------------------------

const deployLog = [
  'Worker Startup Time: 1 ms',
  `Current Version ID: ${VERSION_ID}`,
  'Deployed padiem-danjion-api-production triggers',
].join('\n');
assert.equal(parseDeployOutput(deployLog), VERSION_ID, 'deploy log must yield the Worker Version ID');

assert.throws(
  () => parseDeployOutput('Total Upload: 512 KiB'),
  err => err instanceof ProvenanceError && /failing closed/.test(err.message),
  'missing Version ID in deploy output must fail closed'
);
assert.throws(() => parseDeployOutput(''), ProvenanceError, 'empty deploy output must fail closed');

// --- deployments status identity -------------------------------------------

const statusJson = JSON.stringify({
  deployment: {
    id: DEPLOYMENT_ID,
    strategy: { percentage: 100 },
    versions: [{ version_id: VERSION_ID, percentage: 100 }],
  },
});
assert.deepEqual(
  extractDeploymentIdentity(statusJson),
  { deploymentId: DEPLOYMENT_ID, servedVersionIds: [VERSION_ID] },
  'deployments status must yield deployment ID and served version IDs'
);
assert.throws(() => extractDeploymentIdentity('{}'), ProvenanceError, 'missing deployment must fail closed');
assert.throws(
  () => extractDeploymentIdentity({ deployment: { id: DEPLOYMENT_ID, versions: [] } }),
  ProvenanceError,
  'empty served version list must fail closed'
);
assert.throws(
  () => extractDeploymentIdentity({ deployment: { id: 'not-a-uuid', versions: [{ version_id: VERSION_ID }] } }),
  ProvenanceError,
  'malformed deployment id must fail closed'
);
assert.equal(extractVersionViewId(JSON.stringify({ id: VERSION_ID, tag: 'x' })), VERSION_ID);
assert.throws(() => extractVersionViewId('not json'), ProvenanceError, 'unparseable versions view must fail closed');

// --- record build / serialize ------------------------------------------------

const recordInput = {
  capturedAt: '2026-09-11T12:00:00.000Z',
  sourceSha: SOURCE_SHA,
  sourceTreeDigest: TREE_DIGEST,
  workerName: 'padiem-danjion-api-production',
  workerVersionId: VERSION_ID,
  deploymentId: DEPLOYMENT_ID,
  servedVersionIds: [VERSION_ID],
};
const record = buildProvenanceRecord(recordInput);
assert.equal(record.schema_version, PROVENANCE_SCHEMA_VERSION);
assert.equal(record.source_sha, SOURCE_SHA);
assert.equal(record.worker_version_id, VERSION_ID);
assert.equal(record.deployment_id, DEPLOYMENT_ID);

assert.throws(
  () => buildProvenanceRecord({ ...recordInput, sourceSha: 'deadbeef' }),
  ProvenanceError,
  'short source sha must fail closed'
);
assert.throws(
  () => buildProvenanceRecord({ ...recordInput, sourceTreeDigest: 'md5:zzz' }),
  ProvenanceError,
  'malformed tree digest must fail closed'
);
assert.equal(buildProvenanceRecord({ ...recordInput, sourceTreeDigest: null }).source_tree_digest, null,
  'null tree digest is allowed (digest capture is best-effort)');

const serialized = serializeProvenance(record);
assert.deepEqual(
  Object.keys(JSON.parse(serialized)),
  ['schema_version', 'captured_at', 'source_sha', 'source_tree_digest', 'worker_name',
    'worker_version_id', 'deployment_id', 'served_version_ids'],
  'provenance serialization must use a stable key order'
);
assert.ok(serialized.endsWith('\n'));

// --- secret hygiene ------------------------------------------------------------

assert.equal(assertNoSecrets(serialized), true, 'whitelisted record must pass the secret scan');
assert.throws(
  () => assertNoSecrets(JSON.stringify({ BETTER_AUTH_SECRET: 'x'.repeat(64) })),
  ProvenanceError,
  'secret-bearing key must be refused'
);
assert.throws(
  () => assertNoSecrets(JSON.stringify({ note: 'hunter2supersecretvalue' }), ['hunter2supersecretvalue']),
  ProvenanceError,
  'known secret value must be refused'
);
assert.ok(!/hunter2/.test(serializeProvenance(record)), 'record must not carry arbitrary payload text');

// --- post-deploy readback verification -----------------------------------------

const goodReadback = {
  record,
  statusJson,
  versionViewJson: JSON.stringify({ id: VERSION_ID }),
};
assert.deepEqual(
  verifyPostDeployReadback(goodReadback),
  {
    verified: true,
    served_identity_matches_recorded_release: true,
    method: 'wrangler deployments status + wrangler versions view readback',
  },
  'matching readback must verify the recorded release identity'
);
assert.throws(
  () => verifyPostDeployReadback({ ...goodReadback, versionViewJson: JSON.stringify({ id: DEPLOYMENT_ID }) }),
  ProvenanceError,
  'versions view mismatch must fail closed'
);
assert.throws(
  () => verifyPostDeployReadback({
    ...goodReadback,
    statusJson: JSON.stringify({ deployment: { id: '44444444-4444-4444-4444-444444444444', versions: [{ version_id: VERSION_ID }] } }),
  }),
  ProvenanceError,
  'deployment id drift after capture must fail closed'
);
assert.throws(
  () => verifyPostDeployReadback({
    ...goodReadback,
    statusJson: JSON.stringify({ deployment: { id: DEPLOYMENT_ID, versions: [{ version_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }] } }),
  }),
  ProvenanceError,
  'recorded version rolled out of the served deployment must fail closed'
);

// --- workflow wiring (additive, no deployment executed by this test) ------------

const workflow = await readFile(join(repoRoot, '.github/workflows/production-worker-bootstrap.yml'), 'utf8');
const pkg = JSON.parse(await readFile(join(backendRoot, 'package.json'), 'utf8'));

assert.match(
  workflow,
  /wrangler deploy --env production --secrets-file[\s\S]*tee[^\n]*wrangler-deploy-output/,
  'deploy step must tee its output for provenance parsing while keeping the encrypted secret path'
);
assert.match(workflow, /deploy-provenance\.mjs capture/, 'workflow must capture provenance after deploy');
assert.match(workflow, /deploy-provenance\.mjs verify/, 'workflow must verify provenance readback');
assert.match(workflow, /wrangler deployments status --env production --json/, 'workflow must read deployment status identity');
assert.match(workflow, /wrangler versions view/, 'workflow must read back the deployed Worker Version ID');
assert.match(workflow, /actions\/upload-artifact@v4/, 'provenance evidence must be persisted as an artifact');
assert.match(workflow, /name: danjion-deploy-provenance-/, 'artifact name must bind the provenance record to the release');
assert.match(workflow, /actions: write/, 'job must be permitted to upload the provenance artifact');
assert.match(workflow, /source_sha/, 'provenance must bind the release source SHA');

const deployIdx = workflow.indexOf('Deploy production Worker with encrypted secrets');
const captureIdx = workflow.indexOf('Capture deployed artifact provenance');
const readbackIdx = workflow.indexOf('Verify deployed artifact provenance readback');
const smokeIdx = workflow.indexOf('Production read-only feature smoke');
assert.ok(deployIdx !== -1 && deployIdx < captureIdx && captureIdx < readbackIdx && readbackIdx < smokeIdx,
  'provenance capture/readback must sit between deploy and feature smoke');
assert.doesNotMatch(workflow, /set -x/, 'workflow must never shell-trace secret-bearing commands');

assert.equal(pkg.scripts['test:deploy-provenance'], 'node tests/deploy-provenance-contract.mjs');
assert.ok(pkg.scripts.check.includes('npm run test:deploy-provenance'), 'check chain must run the provenance contract');

console.log('deploy-provenance contract: all assertions passed');
