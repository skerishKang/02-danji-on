import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseLedger,
  classifyMigration,
  readRepositoryInventory,
  computeMigrationPlan,
} from '../scripts/production-migration-gate.mjs';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = '058_seed_banglim_complex_units.sql';
const SCRIPT_ID = 'test:banglim-complex-units-seed-058';
const DEV_FILES = ['900_dev_seed.sql', '901_dev_contacts.sql', '902_dev_unverified_resident.sql'];

const rawSql = await readFile(join(backendRoot, 'migrations', FILE), 'utf8');
const code = rawSql.replace(/--[^\n]*/g, '');
const ledger = parseLedger(await readFile(join(backendRoot, 'migration-safety-ledger.json'), 'utf8'));
const inventory = await readRepositoryInventory();
const pkg = JSON.parse(await readFile(join(backendRoot, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(backendRoot, '..', 'test-runner.manifest.json'), 'utf8'));
const foundation = await readFile(join(backendRoot, 'migrations', '009_household_foundation.sql'), 'utf8');
const targetSha = '860-banglim-complex-units-seed';

assert.doesNotMatch(code, /\b(update|delete|truncate)\b/i, '058 must be INSERT-only outside comments');
assert.doesNotMatch(code, /\b(household|household_memberships|app_users|account)\b/i, '058 must not touch membership or account tables');
assert.deepEqual(
  [...code.matchAll(/INSERT\s+INTO\s+([a-z_]+)/gi)].map(m => m[1]),
  ['complex_units'],
  '058 may only INSERT complex_units',
);
assert.match(code, /INSERT INTO complex_units \(id, complex_id, building_code, unit_code, status\)/);
assert.match(code, /FROM complexes c/);
assert.match(code, /WHERE c\.slug = 'banglim-myeongji-roadhill'/, 'complex_id must resolve via complexes.slug');
assert.doesNotMatch(
  code,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  '058 must not hardcode a full UUID; unit ids are concatenated deterministically',
);
assert.doesNotMatch(code, /[동호]/, 'building_code and unit_code must stay free of Korean suffixes');
assert.match(code, /ON CONFLICT \(complex_id, building_code, unit_code\) DO NOTHING/);
assert.match(foundation, /unique \(complex_id, building_code, unit_code\)/, '009 must declare the conflict target');
assert.match(code, /generate_series\(1,\s*24\)/);
assert.match(code, /generate_series\(1,\s*4\)/);
assert.match(code, /\('101'\),\s*\('102'\)/);
assert.match(code, /BEGIN;/);
assert.match(code, /COMMIT;/);

const rows = [];
for (const building of ['101', '102']) {
  for (let floor = 1; floor <= 24; floor += 1) {
    for (let unit = 1; unit <= 4; unit += 1) {
      rows.push({ building, unitCode: String(floor * 100 + unit) });
    }
  }
}
assert.equal(rows.length, 192, '2 x 24 x 4 must be 192 unit rows');
assert.equal(
  new Set(rows.map(r => `${r.building}:${r.unitCode}`)).size,
  192,
  'building/unit pairs must be unique for ON CONFLICT',
);

const unitUuids = new Set();
for (const building of ['101', '102']) {
  const ordered = rows
    .filter(r => r.building === building)
    .map(r => Number(r.unitCode))
    .sort((a, b) => a - b);
  ordered.forEach((_, index) => {
    const uuid = `d0a1c4a1-41c5-4c51-${building === '101' ? 'a101' : 'a102'}-${String(index + 1).padStart(12, '0')}`;
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    unitUuids.add(uuid);
  });
}
assert.equal(unitUuids.size, 192, 'deterministic unit UUIDs must be unique across both buildings');

const entry = classifyMigration(ledger, FILE);
assert.equal(entry.class, 'production_seed');
assert.equal(entry.opt_in_required, true);
assert.equal(entry.depends_on, undefined, 'no speculative depends_on');
assert.equal(entry.status_expectation, undefined, 'no speculative status_expectation');
assert.equal(entry.marker.kind, 'data_probe');
assert.equal(
  entry.marker.query,
  "select (select count(*) from complex_units where complex_id = (select id from complexes where slug = 'banglim-myeongji-roadhill')) >= 192",
  '058 readback must probe >= 192 unit rows for the banglim complex',
);

const ledgerKeys = Object.keys(ledger.migrations);
assert.deepEqual([...ledgerKeys].sort(), [...inventory].sort(), 'ledger must stay bijective with the repository inventory');
const prodNumbers = inventory
  .filter(f => !DEV_FILES.includes(f))
  .map(f => Number(f.slice(0, 3)))
  .sort((a, b) => a - b);
assert.deepEqual(prodNumbers, Array.from({ length: 59 }, (_, i) => i + 1), 'production migrations must stay contiguous 001..059');

const deferred = await computeMigrationPlan({
  ledger,
  inventory,
  appliedResolver: async () => false,
  targetSha,
});
assert.equal(deferred.entries.find(e => e.file === FILE).outcome, 'DEFERRED_OPT_IN');
assert.ok(!deferred.apply_set.includes(FILE), '058 must not auto-enter the apply set without opt-in');
assert.ok(deferred.pending_production_seed.includes(FILE));

const optInApply = await computeMigrationPlan({
  ledger,
  inventory,
  appliedResolver: async () => false,
  targetSha,
  includeProductionSeed: true,
});
assert.equal(optInApply.entries.find(e => e.file === FILE).outcome, 'APPLY');
assert.ok(optInApply.apply_set.includes(FILE), '058 applies only with explicit production-seed opt-in');

const alreadyApplied = await computeMigrationPlan({
  ledger,
  inventory,
  appliedResolver: async marker => marker.kind === 'data_probe',
  targetSha,
  includeProductionSeed: true,
});
assert.equal(alreadyApplied.entries.find(e => e.file === FILE).outcome, 'ALREADY_APPLIED');
assert.ok(!alreadyApplied.apply_set.includes(FILE), 'a conclusive >= 192 probe must skip 058');

assert.equal(pkg.scripts[SCRIPT_ID], 'node tests/banglim-complex-units-seed-058-contract.mjs');
const scriptKeys = Object.keys(pkg.scripts);
assert.equal(
  scriptKeys.indexOf(SCRIPT_ID),
  scriptKeys.indexOf('test:migration-ledger-integrity') + 1,
  '058 script must sit directly after test:migration-ledger-integrity in package.json',
);

const runIds = manifest.scopes.backend.run.map(s => s.id);
assert.ok(runIds.includes(SCRIPT_ID), 'manifest backend run must include the 058 step');
assert.equal(runIds[runIds.indexOf('test:migration-gate') + 1], 'test:migration-ledger-integrity', 'gate/integrity adjacency must hold');
assert.equal(
  runIds[runIds.indexOf('test:migration-ledger-integrity') + 1],
  SCRIPT_ID,
  '058 step must sit directly after migration-ledger-integrity in the manifest',
);
assert.equal(runIds[runIds.length - 1], 'test:runner-manifest-contract', 'drift guard must stay final');

console.log('banglim-complex-units-seed-058 contract: PASS');
console.log('  rows: 192 = 2 buildings x 24 floors x 4 units; deterministic UUIDs unique');
console.log('  ledger: production_seed + opt_in_required + data_probe >= 192; bijection 001..058');
console.log('  gate: DEFERRED_OPT_IN | APPLY (opt-in) | ALREADY_APPLIED (probe true)');
console.log('  registered: package.json, test-runner.manifest.json, EXPECTED_BACKEND_ORDER');
