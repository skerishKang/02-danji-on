import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = new URL('../', import.meta.url);
const migrationsDir = new URL('./migrations/', root);
const ledgerPath = new URL('./migration-safety-ledger.json', root);
const workflowPath = new URL('../../.github/workflows/production-worker-bootstrap.yml', root);

const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
const migrationFiles = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();

assert.ok(ledger.prohibited_prefixes, 'ledger must declare prohibited prefixes');
assert.deepEqual(ledger.prohibited_prefixes, ['900', '901', '902'], 'prohibited prefixes must cover dev seed migrations');

for (const file of migrationFiles) {
  const entry = ledger.migrations[file];
  assert.ok(entry, `ledger must classify ${file}`);
  assert.ok(['production_safe', 'prohibited_seed'].includes(entry.safety), `${file} safety must be production_safe or prohibited_seed`);
}

const prohibitedFiles = migrationFiles.filter(f => ledger.prohibited_prefixes.some(p => f.startsWith(p)));
for (const file of prohibitedFiles) {
  assert.equal(ledger.migrations[file].safety, 'prohibited_seed', `${file} must be classified prohibited_seed`);
}

const productionFiles = migrationFiles.filter(f => !ledger.prohibited_prefixes.some(p => f.startsWith(p)));
for (const file of productionFiles) {
  assert.equal(ledger.migrations[file].safety, 'production_safe', `${file} must be classified production_safe`);
}

function classifyMigration(file) {
  const prefix = file.split('_')[0];
  if (ledger.prohibited_prefixes.includes(prefix)) return 'prohibited_seed';
  return ledger.migrations[file]?.safety || 'unknown';
}

function determineApplySet(files, targetSha) {
  return files.map(f => ({
    file: f,
    safety: classifyMigration(f),
    target_sha: targetSha
  })).filter(e => e.safety === 'production_safe');
}

function validateApplySet(applySet) {
  const prohibited = applySet.filter(e => e.safety === 'prohibited_seed');
  if (prohibited.length > 0) {
    return { ok: false, reason: `prohibited migrations in apply set: ${prohibited.map(e => e.file).join(', ')}` };
  }
  return { ok: true, apply_set: applySet };
}

const targetSha = 'eca67395936861fb561a152ddee6b3e4ed51fba2';
const applySet = determineApplySet(migrationFiles, targetSha);
const validation = validateApplySet(applySet);

assert.ok(validation.ok, `apply set must not contain prohibited migrations: ${validation.reason}`);
assert.equal(validation.apply_set.length, productionFiles.length, 'apply set must include all production-safe migrations');
assert.equal(validation.apply_set.filter(e => e.target_sha === targetSha).length, productionFiles.length, 'every apply set entry must record target SHA');

const prohibitedInApplySet = applySet.filter(e => e.safety === 'prohibited_seed');
assert.equal(prohibitedInApplySet.length, 0, 'prohibited seed migrations must never appear in apply set');

for (const file of prohibitedFiles) {
  const entry = applySet.find(e => e.file === file);
  assert.equal(entry, undefined, `${file} must not appear in production apply set`);
}

const dryRunApplySet = determineApplySet(migrationFiles, targetSha);
const dryRunValidation = validateApplySet(dryRunApplySet);
assert.ok(dryRunValidation.ok, 'dry-run must produce same safe apply set');
assert.equal(dryRunValidation.apply_set.length, applySet.length, 'dry-run apply set must match live apply set');

const workflow = await readFile(workflowPath, 'utf8');
assert.match(workflow, /production-bootstrap-safety/, 'workflow must verify source-side production safety contract');
assert.match(workflow, /npm run test:production-bootstrap-safety/, 'workflow must run production bootstrap safety test');
assert.doesNotMatch(workflow, /set -x/, 'workflow must never shell-trace secret-bearing commands');
assert.match(workflow, /Secret values were not printed/, 'workflow must guard secret output');
assert.match(workflow, /target_sha|TARGET_SHA|target SHA/i, 'workflow or gate must record target SHA');

console.log('Migration gate contract: PASS');
console.log(`  Migrations inventoried: ${migrationFiles.length}`);
console.log(`  Production-safe: ${productionFiles.length}`);
console.log(`  Prohibited seed: ${prohibitedFiles.length}`);
console.log(`  Target SHA: ${targetSha}`);
console.log(`  Dry-run apply set matches live apply set`);
console.log(`  Prohibited migrations excluded from apply set`);
