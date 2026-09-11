// Issue #375-M (F13): bounded migration-ledger integrity contract.
// Centralized proof that the repository-declaration ledger and the fail-closed
// reconciliation model stay explicit and deterministic. All applied-state tests
// use in-memory fixtures; no production DB is contacted and no row data is read.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseLedger,
  classifyMigration,
  readRepositoryInventory,
  computeMigrationPlan,
  markerToSql,
  isCatalogOnlyMarker,
  GateError,
  OUTCOMES,
} from '../scripts/production-migration-gate.mjs';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = join(backendRoot, 'migration-safety-ledger.json');
const ledger = parseLedger(await readFile(ledgerPath, 'utf8'));
const ledgerRaw = await readFile(ledgerPath, 'utf8');
const inventory = await readRepositoryInventory();
const pkg = JSON.parse(await readFile(join(backendRoot, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(backendRoot, '..', 'test-runner.manifest.json'), 'utf8'));
const targetSha = 'f1300000000000000000000000000000000000ff';

const DEV_FILES = ['900_dev_seed.sql', '901_dev_contacts.sql', '902_dev_unverified_resident.sql'];
const number = f => Number(f.split('_')[0]);
const outcomeOf = (plan, file) => plan.entries.find(e => e.file === file).outcome;

// Rule 0: the outcome vocabulary is exactly the explicit F13 enum.
assert.deepEqual(
  [...OUTCOMES].sort(),
  ['ALREADY_APPLIED', 'APPLY', 'BLOCKED_DEPENDENCY', 'DEFERRED_OPT_IN', 'DEV_ONLY_FORBIDDEN', 'SCHEMA_PRESENT_SKIP', 'UNKNOWN_FAIL_CLOSED'].sort(),
  'OUTCOMES must be exactly the seven explicit deterministic outcomes'
);

// Rule 1: every production migration is declared in the ledger exactly once (bijection).
const ledgerKeys = Object.keys(ledger.migrations);
assert.equal(new Set(ledgerKeys).size, ledgerKeys.length, 'ledger keys must be unique');
assert.deepEqual([...ledgerKeys].sort(), [...inventory].sort(), 'ledger declarations must be bijective with the repository migration inventory');
assert.ok(ledger.description.includes('Repository inventory is not the apply set'), 'ledger must keep the REPOSITORY_DECLARATION vs LIVE_APPLIED_STATE distinction');

// Rule 2: an undeclared production migration can never slip in silently.
await assert.rejects(
  computeMigrationPlan({ ledger, inventory: [...inventory, '049_unregistered.sql'], appliedResolver: async () => false, targetSha }),
  err => err instanceof GateError && /no ledger classification/.test(err.message),
  'undeclared migration must fail closed'
);

// Rule 3: 900/901/902 are prohibited from every production plan.
assert.deepEqual(ledger.prohibited_prefixes, ['900', '901', '902'], 'dev-only prefixes must stay exactly 900/901/902');
const emptyPlan = await computeMigrationPlan({ ledger, inventory, appliedResolver: async () => false, targetSha });
assert.deepEqual(emptyPlan.prohibited_excluded, DEV_FILES);
for (const file of DEV_FILES) {
  assert.equal(outcomeOf(emptyPlan, file), 'DEV_ONLY_FORBIDDEN', `${file} must reconcile to DEV_ONLY_FORBIDDEN`);
  assert.ok(!emptyPlan.apply_set.includes(file), `${file} must never enter the apply set`);
  assert.ok(!emptyPlan.next_safe_plan.includes(file), `${file} must never enter next_safe_plan`);
}
const devAsSchema = JSON.parse(JSON.stringify(ledger));
devAsSchema.migrations['900_dev_seed.sql'] = { class: 'schema', marker: { kind: 'table', schema: 'public', name: 'dev_seed_marker' } };
assert.throws(() => classifyMigration(devAsSchema, '900_dev_seed.sql'), err => err instanceof GateError && /failing closed/.test(err.message), 'a prohibited-prefix file may not be reclassified as production-safe');
const schemaAsDev = JSON.parse(JSON.stringify(ledger));
schemaAsDev.migrations['001_initial_schema.sql'] = { class: 'dev_seed_prohibited', reason: 'misclassification fixture' };
assert.throws(() => classifyMigration(schemaAsDev, '001_initial_schema.sql'), err => err instanceof GateError && /not declared prohibited/.test(err.message), 'dev_seed_prohibited requires a prohibited prefix');

// Rule 4: filenames and numeric ids are unique — duplicate JSON keys are detected in raw text.
const rawKeyMatches = [...ledgerRaw.matchAll(/"(\d{3}_[^"]+\.sql)"\s*:/g)].map(m => m[1]);
assert.equal(new Set(rawKeyMatches).size, rawKeyMatches.length, 'duplicate ledger keys must be impossible (JSON.parse would silently collapse them)');
const numericPrefixes = inventory.map(number);
assert.equal(new Set(numericPrefixes).size, numericPrefixes.length, 'two migrations may not share a numeric id');
assert.deepEqual([...new Set(inventory)].length, inventory.length, 'inventory filenames must be unique');

// Rule 5: ordering is deterministic numeric, contiguous, and immune to ledger insertion order.
const prodPrefixes = inventory.filter(f => !DEV_FILES.includes(f)).map(number).sort((a, b) => a - b);
assert.deepEqual(prodPrefixes, Array.from({ length: 48 }, (_, i) => i + 1), 'production migrations must stay contiguous 001..048');
for (const f of inventory) assert.match(f, /^\d{3}_/, `${f} must keep 3-digit zero-padded numeric ordering`);
assert.deepEqual([...inventory].sort(), [...inventory].sort((a, b) => number(a) - number(b)), 'lexicographic order must equal numeric order');
const reversedLedger = { ...ledger, migrations: Object.fromEntries(Object.entries(ledger.migrations).reverse()) };
const reversedPlan = await computeMigrationPlan({ ledger: reversedLedger, inventory, appliedResolver: async () => false, targetSha });
assert.deepEqual(reversedPlan.apply_set, emptyPlan.apply_set, 'ledger insertion order must never reorder the apply sequence');

// Rule 6: unknown live state always fails closed (UNKNOWN_FAIL_CLOSED).
await assert.rejects(
  computeMigrationPlan({ ledger, inventory, appliedResolver: undefined, targetSha }),
  err => err instanceof GateError && /Applied-state resolver is required/.test(err.message) && /UNKNOWN_FAIL_CLOSED/.test(err.message),
  'missing resolver must fail closed'
);
await assert.rejects(
  computeMigrationPlan({ ledger, inventory, appliedResolver: async () => { throw new Error('db unreachable'); }, targetSha }),
  err => err instanceof GateError && /readback failed/.test(err.message) && /UNKNOWN_FAIL_CLOSED/.test(err.message),
  'unreachable DB must fail closed'
);
for (const inconclusive of [undefined, null, 't', 1, 'true']) {
  await assert.rejects(
    computeMigrationPlan({ ledger, inventory, appliedResolver: async () => inconclusive, targetSha }),
    err => err instanceof GateError && /not conclusive/.test(err.message) && /UNKNOWN_FAIL_CLOSED/.test(err.message),
    `inconclusive readback value ${JSON.stringify(inconclusive)} must fail closed`
  );
}

// Rules 7/8 fixtures: explicit supersession and explicit dependencies only.
const FIXTURE = {
  $schema: 'migration-safety-ledger-fixture',
  description: 'in-memory fixture; never touches a database',
  prohibited_prefixes: ['900', '901', '902'],
  migrations: {
    '001_alpha.sql': { class: 'schema', marker: { kind: 'table', schema: 'public', name: 'alpha' } },
    '002_beta.sql': { class: 'schema', marker: { kind: 'table', schema: 'public', name: 'beta' }, status_expectation: 'superseded_by:001_alpha.sql' },
    '003_gamma.sql': { class: 'schema', marker: { kind: 'table', schema: 'public', name: 'gamma' }, depends_on: ['002_beta.sql'] },
    '004_delta.sql': { class: 'schema', marker: { kind: 'table', schema: 'public', name: 'delta' } },
    '005_seed.sql': { class: 'production_seed', opt_in_required: true, marker: { kind: 'data_probe', query: 'select exists(select 1 from alpha where k = 1)' } },
    '900_dev.sql': { class: 'dev_seed_prohibited', reason: 'dev-only fixture' },
  },
};
const FIXTURE_FILES = Object.keys(FIXTURE.migrations).sort();
const fixtureResolver = applied => async marker => applied.has(marker.name ?? marker.query);

// Rule 7: SCHEMA_PRESENT_SKIP only with an explicit declaration; present-but-undeclared is ALREADY_APPLIED.
const noneApplied = await computeMigrationPlan({ ledger: FIXTURE, inventory: FIXTURE_FILES, appliedResolver: fixtureResolver(new Set()), targetSha });
assert.equal(outcomeOf(noneApplied, '001_alpha.sql'), 'APPLY');
assert.equal(outcomeOf(noneApplied, '002_beta.sql'), 'APPLY', 'a supersession declaration must not suppress APPLY while the marker is absent');
const bothApplied = await computeMigrationPlan({ ledger: FIXTURE, inventory: FIXTURE_FILES, appliedResolver: fixtureResolver(new Set(['alpha', 'beta'])), targetSha });
assert.equal(outcomeOf(bothApplied, '001_alpha.sql'), 'ALREADY_APPLIED', 'present without declaration is ALREADY_APPLIED, never a guessed skip');
assert.equal(outcomeOf(bothApplied, '002_beta.sql'), 'SCHEMA_PRESENT_SKIP', 'present with explicit supersession is an explicit skip');
assert.ok(!bothApplied.apply_set.includes('002_beta.sql'));
for (const bad of [
  ['bad format', 'supersedes:001_alpha.sql'],
  ['self reference', 'superseded_by:002_beta.sql'],
  ['undeclared target', 'superseded_by:777_missing.sql'],
  ['higher-numbered target', 'superseded_by:004_delta.sql'],
]) {
  const l = JSON.parse(JSON.stringify(FIXTURE));
  l.migrations['002_beta.sql'].status_expectation = bad[1];
  assert.throws(() => classifyMigration(l, '002_beta.sql'), err => err instanceof GateError, `invalid supersession (${bad[0]}) must fail closed`);
}
const devSupersede = JSON.parse(JSON.stringify(FIXTURE));
devSupersede.migrations['002_beta.sql'].status_expectation = 'superseded_by:900_dev.sql';
assert.throws(() => classifyMigration(devSupersede, '002_beta.sql'), err => err instanceof GateError && /dev-only/.test(err.message), 'dev-only migrations may never be supersession targets');

// Rule 8: declared dependencies cannot silently drift; unapplied dependency blocks.
assert.equal(outcomeOf(noneApplied, '003_gamma.sql'), 'BLOCKED_DEPENDENCY', '003 must block while its dependency is not applied');
assert.ok(!noneApplied.apply_set.includes('003_gamma.sql'), 'blocked migrations never enter the apply set');
assert.equal(noneApplied.entries.find(e => e.file === '003_gamma.sql').pending, true, 'blocked entries stay pending');
assert.equal(outcomeOf(bothApplied, '003_gamma.sql'), 'APPLY', 'an explicit SCHEMA_PRESENT_SKIP dependency satisfies the dependent');
assert.ok(bothApplied.apply_set.includes('003_gamma.sql'));
for (const bad of [
  ['undeclared dep', ['777_missing.sql']],
  ['higher-numbered dep', ['004_delta.sql']],
  ['empty list', []],
  ['not a list', '001_alpha.sql'],
]) {
  const l = JSON.parse(JSON.stringify(FIXTURE));
  l.migrations['003_gamma.sql'].depends_on = bad[1];
  assert.throws(() => classifyMigration(l, '003_gamma.sql'), err => err instanceof GateError, `invalid depends_on (${bad[0]}) must fail closed`);
}
const depNotInInventory = JSON.parse(JSON.stringify(FIXTURE));
depNotInInventory.migrations['003_gamma.sql'].depends_on = ['001_alpha.sql'];
await assert.rejects(
  computeMigrationPlan({ ledger: depNotInInventory, inventory: ['003_gamma.sql'], appliedResolver: fixtureResolver(new Set()), targetSha }),
  err => err instanceof GateError && /not in the repository inventory/.test(err.message),
  'a declared dependency missing from the inventory must fail closed'
);
// The real ledger currently carries no speculative declarations: supersession/depends_on stay explicit-only.
for (const key of ledgerKeys) {
  assert.equal(ledger.migrations[key].status_expectation, undefined, `${key} must not carry an undeclared-by-history supersession`);
  assert.equal(ledger.migrations[key].depends_on, undefined, `${key} must not carry speculative dependencies`);
}

// Rule 9: existing gate semantics remain safe (production_seed opt-in, pending model, apply-set identity).
assert.equal(outcomeOf(emptyPlan, '042_seed_banglim_pilot_production.sql'), 'DEFERRED_OPT_IN', 'production seed without opt-in defers explicitly');
assert.ok(!emptyPlan.apply_set.includes('042_seed_banglim_pilot_production.sql'));
const optInPlan = await computeMigrationPlan({ ledger, inventory, appliedResolver: async () => false, targetSha, includeProductionSeed: true });
assert.equal(outcomeOf(optInPlan, '042_seed_banglim_pilot_production.sql'), 'APPLY');
const schemaFiles = inventory.filter(f => classifyMigration(ledger, f).class === 'schema');
assert.deepEqual(emptyPlan.apply_set, [...schemaFiles].sort(), 'with nothing applied the explicit plan equals every schema migration, ordered');
assert.deepEqual(emptyPlan.next_safe_plan, emptyPlan.apply_set, 'next_safe_plan must equal the ordered APPLY list');
const appliedAllPlan = await computeMigrationPlan({
  ledger,
  inventory,
  appliedResolver: async marker => (marker.kind === 'data_probe' ? false : true),
  targetSha,
});
assert.deepEqual(appliedAllPlan.apply_set, [], 'fully applied production has an empty safe plan');
for (const e of appliedAllPlan.entries) {
  if (e.class === 'schema') assert.equal(e.outcome, 'ALREADY_APPLIED');
  if (e.class === 'production_seed') assert.equal(e.outcome, 'DEFERRED_OPT_IN');
}
for (const e of emptyPlan.entries) {
  assert.ok(OUTCOMES.includes(e.outcome), `entry ${e.file} outcome ${e.outcome} must come from the explicit enum`);
  assert.equal(e.in_apply_set, e.outcome === 'APPLY', 'apply-set membership must equal outcome APPLY exactly');
}

// Rule 10: reconciliation reads schema/catalog only — never row data.
for (const key of ledgerKeys) {
  const entry = ledger.migrations[key];
  if (entry.class === 'schema') {
    assert.ok(isCatalogOnlyMarker(entry.marker), `${key} schema marker must be catalog-only, got ${entry.marker?.kind}`);
    assert.match(
      markerToSql(entry.marker),
      /^select (to_regclass\(|exists\(select 1 from (information_schema\.columns|pg_constraint|pg_proc)\b)/,
      `${key} marker SQL must only query catalog relations`
    );
  }
  if (entry.marker?.kind === 'data_probe') {
    assert.equal(entry.class, 'production_seed', 'row-existence probes are reserved for explicit production seeds');
  }
}

// F8 integration: stable script + manifest step directly after test:migration-gate, guard stays final.
assert.equal(pkg.scripts['test:migration-ledger-integrity'], 'node tests/migration-ledger-integrity-contract.mjs');
assert.match(pkg.scripts.check, /test-manifest-runner\.mjs/, 'check must keep delegating to the runner');
assert.ok(!pkg.scripts.check.includes('&&'), 'no raw && chain may be restored');
const runIds = manifest.scopes.backend.run.map(s => s.id);
assert.ok(runIds.includes('test:migration-ledger-integrity'), 'manifest must include the integrity step');
assert.equal(runIds[runIds.indexOf('test:migration-gate') + 1], 'test:migration-ledger-integrity', 'integrity step must sit directly after the migration-gate step');
assert.equal(runIds[runIds.length - 1], 'test:runner-manifest-contract', 'the drift guard must stay final');

// Offline CLI smoke: inventory mode needs no DB and prints no apply decisions.
const { stdout } = await new Promise((res, rej) => {
  execFile(process.execPath, [join(backendRoot, 'scripts', 'production-migration-gate.mjs'), 'inventory'], { cwd: backendRoot }, (err, out) => (err ? rej(err) : res({ stdout: out })));
});
const cli = JSON.parse(stdout);
assert.equal(cli.repository_inventory_count, inventory.length);
assert.deepEqual(cli.prohibited_in_repository_inventory, DEV_FILES);
assert.ok(!('apply_set' in cli), 'inventory mode must not emit an apply set');

console.log('migration-ledger-integrity contract: PASS');
console.log(`  bijection: ${ledgerKeys.length} ledger keys == ${inventory.length} inventory files`);
console.log(`  production applicable: ${schemaFiles.length} schema + 1 production_seed | dev-only: ${DEV_FILES.length}`);
console.log('  outcomes: APPLY | ALREADY_APPLIED | SCHEMA_PRESENT_SKIP | DEV_ONLY_FORBIDDEN | BLOCKED_DEPENDENCY | DEFERRED_OPT_IN | UNKNOWN_FAIL_CLOSED');
console.log('  all applied-state probes above are in-memory fixtures; no DB was contacted, no row data read');
