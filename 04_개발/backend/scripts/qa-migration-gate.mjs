import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  GateError,
  classifyMigration,
  computeMigrationPlan,
  createPsqlAppliedResolver,
  parseLedger,
  readRepositoryInventory
} from './production-migration-gate.mjs';

const execFileAsync = promisify(execFile);
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function requiredQaDatabaseUrl() {
  const value = String(process.env.DANJION_QA_DATABASE_URL || '').trim();
  if (!value) throw new GateError('DANJION_QA_DATABASE_URL is required; refusing QA migration work');
  return value;
}

async function qaPlan(databaseUrl) {
  const ledger = parseLedger(await readFile(join(backendRoot, 'migration-safety-ledger.json'), 'utf8'));
  const inventory = await readRepositoryInventory();
  const resolver = createPsqlAppliedResolver(databaseUrl);
  const plan = await computeMigrationPlan({
    ledger,
    inventory,
    appliedResolver: resolver,
    targetSha: process.env.GITHUB_SHA || process.env.TARGET_SHA || 'qa-local',
    includeProductionSeed: false
  });

  for (const file of plan.apply_set) {
    const entry = classifyMigration(ledger, file);
    if (entry.class !== 'schema') {
      throw new GateError(`QA apply set contains non-schema migration: ${file}`);
    }
  }
  return { ledger, inventory, resolver, plan };
}

async function main() {
  const mode = process.argv[2] || 'plan';
  if (!['plan', 'apply'].includes(mode)) throw new GateError('Expected plan or apply');
  const databaseUrl = requiredQaDatabaseUrl();
  const { ledger, inventory, resolver, plan } = await qaPlan(databaseUrl);

  console.log(JSON.stringify({
    environment: 'qa',
    target_sha: plan.target_sha,
    pending_schema_count: plan.pending_schema.length,
    deferred_production_seed_count: plan.pending_production_seed.length,
    apply_set: plan.apply_set
  }, null, 2));

  if (mode !== 'apply') return;
  if (!process.argv.includes('--confirm-qa-apply')) {
    throw new GateError('QA apply requires --confirm-qa-apply');
  }

  for (const file of plan.apply_set) {
    await execFileAsync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(backendRoot, 'migrations', file)]);
  }

  const verified = await computeMigrationPlan({
    ledger,
    inventory,
    appliedResolver: resolver,
    targetSha: plan.target_sha,
    includeProductionSeed: false
  });
  if (verified.pending_schema.length) {
    throw new GateError(`QA schema verification failed; pending: ${verified.pending_schema.join(', ')}`);
  }
  if (verified.apply_set.length) {
    throw new GateError(`QA schema verification left apply entries: ${verified.apply_set.join(', ')}`);
  }
  console.log('QA schema migration apply + readback: PASS');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`::error::QA migration gate failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
