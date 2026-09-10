// Issue #305: guarded production migration/release gate.
// Repository inventory is never the apply set. Applied state comes only from
// production DB readback of ledger markers; when readback is unavailable the
// gate fails closed. Dev seed migrations (900/901/902) may exist in the
// repository but can never enter an apply set. Secret values are never printed.

import { readdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const CLASSES = ['schema', 'production_seed', 'dev_seed_prohibited'];

export class GateError extends Error {}

export function parseLedger(ledgerJson) {
  const ledger = typeof ledgerJson === 'string' ? JSON.parse(ledgerJson) : ledgerJson;
  if (!ledger || typeof ledger.migrations !== 'object' || !Array.isArray(ledger.prohibited_prefixes)) {
    throw new GateError('migration safety ledger is malformed');
  }
  return ledger;
}

export function classifyMigration(ledger, file) {
  const entry = ledger.migrations[file];
  if (!entry) {
    throw new GateError(`Unrecognized migration has no ledger classification; failing closed: ${file}`);
  }
  if (!CLASSES.includes(entry.class)) {
    throw new GateError(`Invalid ledger class "${entry.class}" for ${file}; failing closed`);
  }
  const prefix = file.split('_')[0];
  if (ledger.prohibited_prefixes.includes(prefix) && entry.class !== 'dev_seed_prohibited') {
    throw new GateError(`Prohibited-prefix migration ${file} is not classified dev_seed_prohibited; failing closed`);
  }
  if (entry.class === 'dev_seed_prohibited' && !ledger.prohibited_prefixes.includes(prefix)) {
    throw new GateError(`Migration ${file} is classified dev_seed_prohibited but its prefix is not declared prohibited; failing closed`);
  }
  if (entry.class !== 'dev_seed_prohibited' && entry.class !== 'production_seed' && !entry.marker) {
    throw new GateError(`Schema migration ${file} has no DB readback marker; failing closed`);
  }
  if (entry.class === 'production_seed' && entry.opt_in_required !== true) {
    throw new GateError(`Production seed ${file} must declare opt_in_required=true; failing closed`);
  }
  return entry;
}

export async function readRepositoryInventory(migrationsDir = join(backendRoot, 'migrations')) {
  const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
  return files;
}

export function markerToSql(marker) {
  switch (marker.kind) {
    case 'table':
      return `select to_regclass('${marker.schema}.${marker.name}') is not null`;
    case 'index':
      return `select to_regclass('${marker.schema}.${marker.name}') is not null`;
    case 'column': {
      const dotted = marker.table.includes('.')
        ? { schema: marker.table.split('.')[0], table: marker.table.split('.')[1] }
        : { schema: 'public', table: marker.table };
      return `select exists(select 1 from information_schema.columns where table_schema = '${dotted.schema}' and table_name = '${dotted.table}' and column_name = '${marker.name}')`;
    }
    case 'constraint':
      return `select exists(select 1 from pg_constraint where conname = '${marker.name}' and conrelid = '${marker.table}'::regclass)`;
    case 'function':
      return `select exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = '${marker.schema}' and p.proname = '${marker.name}')`;
    case 'data_probe':
      return marker.query;
    default:
      throw new GateError(`Unknown readback marker kind: ${marker.kind}`);
  }
}

export function createPsqlAppliedResolver(databaseUrl) {
  if (!databaseUrl) {
    throw new GateError('Applied-state readback requires the production DB authority; failing closed');
  }
  return async function readApplied(marker) {
    const sql = markerToSql(marker);
    const { stdout } = await execFileAsync(
      'psql',
      [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
      { env: { ...process.env } }
    );
    const value = stdout.trim();
    if (value !== 't' && value !== 'f') {
      throw new GateError('Applied-state readback returned an unusable value; failing closed');
    }
    return value === 't';
  };
}

// Core model:
//   ALL_MIGRATIONS  = repository inventory (may contain dev seeds)
//   PROHIBITED      = dev_seed_prohibited class (excluded from every apply set)
//   PRODUCTION_SAFE = schema + production_seed classes
//   APPLIED         = production DB readback per ledger marker (never file presence)
//   PENDING         = PRODUCTION_SAFE - APPLIED
//   APPLY_SET       = pending schema (+ pending production_seed only with opt-in)
export async function computeMigrationPlan({
  ledger,
  inventory,
  appliedResolver,
  targetSha,
  includeProductionSeed = false,
}) {
  if (!ledger) throw new GateError('migration safety ledger is required');
  if (!Array.isArray(inventory)) throw new GateError('repository inventory is required');
  if (!targetSha) throw new GateError('target Worker SHA is required; failing closed');

  const entries = [];
  const prohibited = [];
  for (const file of inventory) {
    const entry = classifyMigration(ledger, file);
    if (entry.class === 'dev_seed_prohibited') {
      prohibited.push(file);
      entries.push({ file, class: entry.class, applied: null, pending: false, in_apply_set: false });
      continue;
    }
    if (typeof appliedResolver !== 'function') {
      throw new GateError('Applied-state resolver is required before any production plan; failing closed');
    }
    let applied;
    try {
      applied = await appliedResolver(entry.marker ?? ledger.migrations[file].marker);
    } catch (cause) {
      throw new GateError(`Applied-state readback failed for ${file}; failing closed: ${cause.message}`);
    }
    if (typeof applied !== 'boolean') {
      throw new GateError(`Applied-state readback for ${file} was not conclusive; failing closed`);
    }
    const seedBlocked = entry.class === 'production_seed' && !includeProductionSeed;
    entries.push({
      file,
      class: entry.class,
      applied,
      pending: !applied,
      in_apply_set: !applied && !seedBlocked,
      deferred_opt_in: seedBlocked && !applied,
    });
  }

  const applySet = entries
    .filter(e => e.in_apply_set)
    .map(e => e.file)
    .sort();

  if (applySet.some(f => prohibited.includes(f))) {
    throw new GateError('Prohibited dev seed migration entered the apply set; failing closed');
  }

  return {
    target_sha: targetSha,
    repository_inventory_count: inventory.length,
    prohibited_excluded: prohibited,
    pending_schema: entries.filter(e => e.class === 'schema' && e.pending).map(e => e.file),
    pending_production_seed: entries.filter(e => e.class === 'production_seed' && e.pending).map(e => e.file),
    apply_set: applySet,
    entries,
  };
}

export function maskSecrets(text, secretValues = []) {
  let masked = String(text);
  for (const value of secretValues) {
    if (value) masked = masked.split(value).join('[REDACTED]');
  }
  return masked;
}

async function runCli() {
  const args = process.argv.slice(2);
  const mode = args[0];
  const ledger = parseLedger(await readFile(join(backendRoot, 'migration-safety-ledger.json'), 'utf8'));
  const inventory = await readRepositoryInventory();
  const targetSha = process.env.GITHUB_SHA || process.env.TARGET_SHA || '';
  const dbUrl = process.env.DANJION_PRODUCTION_DB_URL || '';
  const includeProductionSeed = args.includes('--include-production-seed');

  if (mode === 'inventory') {
    const prohibited = inventory.filter(f => classifyMigration(ledger, f).class === 'dev_seed_prohibited');
    const safe = inventory.filter(f => classifyMigration(ledger, f).class !== 'dev_seed_prohibited');
    console.log(JSON.stringify({
      target_sha: targetSha,
      repository_inventory_count: inventory.length,
      production_safe_count: safe.length,
      prohibited_in_repository_inventory: prohibited,
      note: 'Repository inventory is not the apply set; dev seeds may exist but never apply.',
    }, null, 2));
    return;
  }

  if (mode === 'plan' || mode === 'dry-run' || mode === 'apply') {
    const appliedResolver = createPsqlAppliedResolver(dbUrl);
    const plan = await computeMigrationPlan({ ledger, inventory, appliedResolver, targetSha, includeProductionSeed });
    console.log(maskSecrets(JSON.stringify({
      mode,
      target_sha: plan.target_sha,
      repository_inventory_count: plan.repository_inventory_count,
      prohibited_excluded: plan.prohibited_excluded,
      pending_schema: plan.pending_schema,
      pending_production_seed: plan.pending_production_seed,
      apply_set: plan.apply_set,
    }, null, 2), [dbUrl]));

    if (mode === 'apply') {
      if (!args.includes('--confirm-apply')) {
        throw new GateError('Apply mode requires explicit --confirm-apply authorization; failing closed');
      }
      for (const file of plan.apply_set) {
        console.log(`Applying pending migration: ${file}`);
        await execFileAsync('psql', [dbUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(backendRoot, 'migrations', file)]);
      }
      const verified = await computeMigrationPlan({ ledger, inventory, appliedResolver, targetSha, includeProductionSeed });
      if (verified.pending_schema.length > 0) {
        throw new GateError(`Schema readback verification failed; still pending: ${verified.pending_schema.join(', ')}`);
      }
      console.log('Migration apply + schema readback verification: PASS');
    }
    return;
  }

  throw new GateError(`Unknown mode "${mode ?? ''}"; expected inventory | plan | dry-run | apply`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli().catch(err => {
    console.error(maskSecrets(`::error::Production migration gate failed: ${err.message}`, [process.env.DANJION_PRODUCTION_DB_URL || '']));
    process.exitCode = 1;
  });
}
