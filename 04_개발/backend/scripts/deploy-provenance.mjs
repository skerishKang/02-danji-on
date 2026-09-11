// Issue #384: bounded deployed-artifact identity/provenance capture.
// Pure, offline parsing of provider command output (wrangler deploy log,
// `wrangler deployments status --json`, `wrangler versions view --json`).
// The capture step is additive to the bootstrap workflow and never performs
// any deployment or mutation itself. If expected identity evidence is missing
// the script fails closed. Secret values are never serialized or printed.

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export class ProvenanceError extends Error {}

export const PROVENANCE_SCHEMA_VERSION = 'danjion-deploy-provenance/v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SOURCE_SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const SECRETISH_KEY_RE = /(secret|token|password|credential|api[_-]?key|database[_-]?url)/i;

function requireUuid(value, label) {
  if (typeof value !== 'string' || !UUID_RE.test(value.toLowerCase())) {
    throw new ProvenanceError(`${label} is missing or malformed; failing closed`);
  }
  return value.toLowerCase();
}

// Deterministic parse of `npx wrangler deploy` stdout/stderr capture.
// The provider prints "Current Version ID: <uuid>" after a successful deploy.
export function parseDeployOutput(text) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new ProvenanceError('deploy output capture is empty; failing closed');
  }
  const matches = [...text.matchAll(/Current Version ID:\s*([0-9a-fA-F-]{36})/g)];
  if (matches.length === 0) {
    throw new ProvenanceError('deploy output does not contain a Worker Version ID; failing closed');
  }
  return requireUuid(matches.at(-1)[1], 'worker_version_id (deploy output)');
}

// Deterministic extraction from `wrangler deployments status --json`.
// Required shape: { deployment: { id, versions: [{ version_id }, ...] } }.
export function extractDeploymentIdentity(statusJson) {
  let status;
  try {
    status = typeof statusJson === 'string' ? JSON.parse(statusJson) : statusJson;
  } catch {
    throw new ProvenanceError('deployments status output is not valid JSON; failing closed');
  }
  const deployment = status?.deployment;
  if (!deployment || typeof deployment !== 'object') {
    throw new ProvenanceError('deployments status output has no current deployment; failing closed');
  }
  const deploymentId = requireUuid(deployment.id, 'deployment_id');
  if (!Array.isArray(deployment.versions) || deployment.versions.length === 0) {
    throw new ProvenanceError('deployments status deployment has no versions; failing closed');
  }
  const servedVersionIds = deployment.versions.map((entry, index) =>
    requireUuid(entry?.version_id, `served version_id[${index}]`)
  );
  return { deploymentId, servedVersionIds };
}

// Deterministic extraction from `wrangler versions view <id> --json`.
export function extractVersionViewId(versionViewJson) {
  let view;
  try {
    view = typeof versionViewJson === 'string' ? JSON.parse(versionViewJson) : versionViewJson;
  } catch {
    throw new ProvenanceError('versions view output is not valid JSON; failing closed');
  }
  return requireUuid(view?.id, 'version view id');
}

export function buildProvenanceRecord({
  capturedAt,
  sourceSha,
  sourceTreeDigest,
  workerName,
  workerVersionId,
  deploymentId,
  servedVersionIds,
}) {
  if (typeof sourceSha !== 'string' || !SOURCE_SHA_RE.test(sourceSha.toLowerCase())) {
    throw new ProvenanceError('source_sha is missing or malformed; failing closed');
  }
  if (sourceTreeDigest !== null && (typeof sourceTreeDigest !== 'string' || !DIGEST_RE.test(sourceTreeDigest))) {
    throw new ProvenanceError('source_tree_digest must be null or sha256:<64 hex>; failing closed');
  }
  if (typeof workerName !== 'string' || !/^[a-z0-9-]{1,64}$/.test(workerName)) {
    throw new ProvenanceError('worker_name is missing or malformed; failing closed');
  }
  if (!Array.isArray(servedVersionIds) || servedVersionIds.length === 0) {
    throw new ProvenanceError('served_version_ids is empty; failing closed');
  }
  return {
    schema_version: PROVENANCE_SCHEMA_VERSION,
    captured_at: typeof capturedAt === 'string' && !Number.isNaN(Date.parse(capturedAt))
      ? new Date(capturedAt).toISOString()
      : (() => { throw new ProvenanceError('captured_at is missing or malformed; failing closed'); })(),
    source_sha: sourceSha.toLowerCase(),
    source_tree_digest: sourceTreeDigest,
    worker_name: workerName,
    worker_version_id: requireUuid(workerVersionId, 'worker_version_id'),
    deployment_id: requireUuid(deploymentId, 'deployment_id'),
    served_version_ids: servedVersionIds.map((id) => requireUuid(id, 'served version id')),
  };
}

// Stable serialization: fixed key order, deterministic across runs.
export function serializeProvenance(record) {
  const ordered = [
    'schema_version',
    'captured_at',
    'source_sha',
    'source_tree_digest',
    'worker_name',
    'worker_version_id',
    'deployment_id',
    'served_version_ids',
  ];
  for (const key of ordered) {
    if (!(key in record)) {
      throw new ProvenanceError(`provenance record is missing required key ${key}; failing closed`);
    }
  }
  const out = {};
  for (const key of ordered) out[key] = record[key];
  return `${JSON.stringify(out, null, 2)}\n`;
}

// Defense-in-depth: the record is whitelist-built, but refuse to serialize
// anything that looks like a secret key or matches a known secret value.
export function assertNoSecrets(serialized, secretValues = []) {
  for (const key of Object.keys(JSON.parse(serialized))) {
    if (SECRETISH_KEY_RE.test(key)) {
      throw new ProvenanceError(`provenance record declares secret-bearing key "${key}"; refusing to persist`);
    }
  }
  for (const value of secretValues) {
    if (typeof value === 'string' && value.length >= 8 && serialized.includes(value)) {
      throw new ProvenanceError('provenance record contains a known secret value; refusing to persist');
    }
  }
  return true;
}

export function verifyPostDeployReadback({ record, statusJson, versionViewJson }) {
  const identity = extractDeploymentIdentity(statusJson);
  const viewedVersionId = extractVersionViewId(versionViewJson);
  if (viewedVersionId !== record.worker_version_id) {
    throw new ProvenanceError('versions view readback does not match the recorded Worker Version ID; failing closed');
  }
  if (identity.deploymentId !== record.deployment_id) {
    throw new ProvenanceError('current deployment ID readback does not match the recorded deployment ID; failing closed');
  }
  if (!identity.servedVersionIds.includes(record.worker_version_id)) {
    throw new ProvenanceError('recorded Worker Version ID is not present in the served deployment; failing closed');
  }
  return {
    verified: true,
    served_identity_matches_recorded_release: true,
    method: 'wrangler deployments status + wrangler versions view readback',
  };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[i + 1];
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  try {
    if (command === 'capture') {
      const deployText = await readFile(args['deploy-log'], 'utf8');
      const statusText = await readFile(args['status-file'], 'utf8');
      const workerVersionId = parseDeployOutput(deployText);
      const { deploymentId, servedVersionIds } = extractDeploymentIdentity(statusText);
      if (!servedVersionIds.includes(workerVersionId)) {
        throw new ProvenanceError('deployed version is not in the served deployment list; failing closed');
      }
      const record = buildProvenanceRecord({
        capturedAt: args['captured-at'] || new Date().toISOString(),
        sourceSha: args['source-sha'],
        sourceTreeDigest: args['source-tree-digest'] || null,
        workerName: args['worker-name'],
        workerVersionId,
        deploymentId,
        servedVersionIds,
      });
      const serialized = serializeProvenance(record);
      assertNoSecrets(serialized);
      await writeFile(args.out, serialized, 'utf8');
      console.log(`provenance captured: source_sha=${record.source_sha} worker_version_id=${record.worker_version_id} deployment_id=${record.deployment_id}`);
      console.log('Deploy provenance capture: PASS (no secret values printed)');
      return;
    }
    if (command === 'verify') {
      const record = JSON.parse(await readFile(args.record, 'utf8'));
      const statusText = await readFile(args['status-file'], 'utf8');
      const versionViewText = await readFile(args['version-view-file'], 'utf8');
      const result = verifyPostDeployReadback({ record, statusJson: statusText, versionViewJson: versionViewText });
      console.log(`post-deploy readback: verified=${result.verified} served_identity_matches_recorded_release=${result.served_identity_matches_recorded_release}`);
      console.log('Deploy provenance readback verification: PASS');
      return;
    }
    throw new ProvenanceError(`unknown provenance command: ${String(command ?? '')}`);
  } catch (error) {
    if (error instanceof ProvenanceError) {
      console.error(`deploy-provenance failed closed: ${error.message}`);
    } else {
      console.error('deploy-provenance failed closed: unexpected error (details withheld)');
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
