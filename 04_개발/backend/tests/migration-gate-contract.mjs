import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseLedger,
  classifyMigration,
  readRepositoryInventory,
  computeMigrationPlan,
  markerToSql,
  maskSecrets,
  GateError,
} from '../scripts/production-migration-gate.mjs';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(backendRoot, '..', '..');

const ledger = parseLedger(await readFile(join(backendRoot, 'migration-safety-ledger.json'), 'utf8'));
const inventory = await readRepositoryInventory();
const pkg = JSON.parse(await readFile(join(backendRoot, 'package.json'), 'utf8'));
const workflow = await readFile(join(repoRoot, '.github/workflows/production-worker-bootstrap.yml'), 'utf8');

const targetSha = 'eca67395936861fb561a152ddee6b3e4ed51fba2';

function resolverFromApplied(appliedSet) {
  return async marker => appliedSet.has(markerToSql(marker));
}

// 1. Repository may contain 900/901/902 without failing inventory.
assert.ok(inventory.includes('900_dev_seed.sql'), 'dev seeds are expected in the repository');
assert.ok(inventory.includes('901_dev_contacts.sql'));
assert.ok(inventory.includes('902_dev_unverified_resident.sql'));
const inventoryPlan = await computeMigrationPlan({
  ledger,
  inventory,
  appliedResolver: resolverFromApplied(new Set()),
  targetSha,
});
assert.deepEqual(inventoryPlan.prohibited_excluded, ['900_dev_seed.sql', '901_dev_contacts.sql', '902_dev_unverified_resident.sql']);

// 2/3/4. 900, 901, 902 excluded from apply set.
for (const prohibitedFile of ['900_dev_seed.sql', '901_dev_contacts.sql', '902_dev_unverified_resident.sql']) {
  assert.ok(!inventoryPlan.apply_set.includes(prohibitedFile), `${prohibitedFile} must never enter the apply set`);
  assert.equal(classifyMigration(ledger, prohibitedFile).class, 'dev_seed_prohibited');
}

// 5. Existing package scripts preserved.
assert.equal(pkg.scripts['test:backend-lane-reconciliation'], 'node tests/backend-lane-reconciliation-contract.mjs', 'backend-lane-reconciliation script must be preserved');
assert.equal(pkg.scripts['test:migration-gate'], 'node tests/migration-gate-contract.mjs', 'migration-gate script must be added separately');
const baseScripts = [
  'test:storage', 'test:storage-contract', 'test:contract', 'test:auth', 'test:auth-better-contract',
  'test:auth-email-recovery', 'test:auth-delete-boundary', 'test:signup-contact-production-binding',
  'test:production-bootstrap-safety', 'test:production-db-secret-bootstrap', 'test:authz-v2',
  'test:authz-v2-schema', 'test:authz-v2-migrations', 'test:operational-authz-v2',
  'test:admin-operational-rbac', 'test:admin-review-privacy-rbac', 'test:resident-verification-policy-hold',
  'test:household-family-lifecycle', 'test:account-lifecycle', 'test:resident-economy-household-v2',
  'test:business-image-reference-integrity', 'test:business-image-reference-delete-guard',
  'test:business-image-cross-system-atomicity', 'test:business-application-photos',
  'test:business-application-photos-replay', 'test:business-image-upload-pending',
  'test:business-image-background-reconciliation', 'test:business-image-upload-idempotency',
  'test:community-c2-schema', 'test:community-c3-resident-api', 'test:community-c4-moderation',
  'test:community-c6a-security', 'test:complex-news-channel', 'test:complex-news-channel-write',
  'test:business-category-benefit', 'test:saved-shops-server', 'test:community-replies',
  'test:community-notifications', 'test:resident-messages', 'test:resident-notifications',
  'test:resident-profile', 'test:resident-news', 'test:resident-summary', 'test:resident-settings',
  'test:resident-blocks', 'test:resident-activity', 'test:resident-safety-reports',
  'test:business-share', 'test:business-reviews', 'test:shop-recommendations',
  'test:category-approval-fail-closed', 'test:report-rb-schema', 'test:report-rb-runtime',
  'test:inquiries', 'test:security-abuse-rate-limit',
  'test:product-rate-limit-routes', 'test:backend-lane-reconciliation',
];
for (const script of baseScripts) {
  assert.ok(pkg.scripts[script], `existing script ${script} must not be removed`);
}

// 6. The authoritative test-runner manifest preserves every existing link and adds the gate.
//    `npm run check` is now a thin entrypoint that delegates to scripts/test-manifest-runner.mjs;
//    execution order and coverage live in the manifest, not a shell chain.
const manifestPath = join(backendRoot, '..', 'test-runner.manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.equal(manifest.scopes.backend.publicScript, 'check', 'backend manifest publicScript must be check');
const backendRunScripts = new Set(manifest.scopes.backend.run.map((s) => s.npm || s.id));
for (const script of [...baseScripts, 'typecheck', 'test:migration-gate']) {
  assert.ok(backendRunScripts.has(script), `manifest backend run must still include ${script}`);
}
assert.ok(backendRunScripts.has('test:backend-lane-reconciliation'), 'manifest must keep backend-lane-reconciliation');
assert.match(pkg.scripts.check, /test-manifest-runner\.mjs/, 'check must delegate to the test-manifest runner');
assert.ok(pkg.scripts.check.includes('--scope backend'), 'check must run the backend scope');
assert.ok(!pkg.scripts.check.includes('&&'), 'check must not reintroduce an && chain');

// 7. PENDING = PRODUCTION_SAFE - APPLIED.
const applied = new Set();
for (const file of inventory) {
  const entry = classifyMigration(ledger, file);
  if (entry.class === 'schema') applied.add(markerToSql(entry.marker));
}
const allAppliedPlan = await computeMigrationPlan({ ledger, inventory, appliedResolver: resolverFromApplied(applied), targetSha });
assert.deepEqual(allAppliedPlan.apply_set, [], 'fully-applied production has an empty schema apply set');
assert.equal(allAppliedPlan.pending_schema.length, 0);

const partialApplied = new Set(applied);
partialApplied.delete(markerToSql(ledger.migrations['044_application_photos.sql'].marker));
const partialPlan = await computeMigrationPlan({ ledger, inventory, appliedResolver: resolverFromApplied(partialApplied), targetSha });
assert.deepEqual(partialPlan.pending_schema, ['044_application_photos.sql'], 'pending is exactly safe minus applied');
assert.deepEqual(partialPlan.apply_set, ['044_application_photos.sql']);

// 8. Unknown migration classification fails closed.
await assert.rejects(
  computeMigrationPlan({
    ledger,
    inventory: [...inventory, '046_unclassified.sql'],
    appliedResolver: resolverFromApplied(applied),
    targetSha,
  }),
  err => err instanceof GateError && /no ledger classification/.test(err.message),
  'unknown migration must fail closed'
);

// 9. Applied-state unavailable fails closed.
await assert.rejects(
  computeMigrationPlan({ ledger, inventory, appliedResolver: undefined, targetSha }),
  err => err instanceof GateError && /Applied-state resolver is required/.test(err.message),
  'missing applied-state resolver must fail closed'
);
await assert.rejects(
  computeMigrationPlan({
    ledger,
    inventory,
    appliedResolver: async () => { throw new Error('db unreachable'); },
    targetSha,
  }),
  err => err instanceof GateError && /readback failed/.test(err.message),
  'unreachable production DB must fail closed'
);

// 10. production_seed distinguished from schema.
assert.equal(classifyMigration(ledger, '042_seed_banglim_pilot_production.sql').class, 'production_seed');
assert.deepEqual(
  classifyMigration(ledger, '042_seed_banglim_pilot_production.sql').marker,
  { kind: 'data_probe', query: "select exists(select 1 from complexes where slug = 'banglim-myeongji-roadhill')" },
  '042 production seed readback must use the exact complex slug inserted by migration 042'
);
assert.equal(classifyMigration(ledger, '041_business_category_benefit_contract.sql').class, 'schema');

// 11. 042 is not silently treated as an ordinary schema apply.
const seedPendingPlan = await computeMigrationPlan({ ledger, inventory, appliedResolver: resolverFromApplied(new Set()), targetSha });
assert.ok(seedPendingPlan.pending_production_seed.includes('042_seed_banglim_pilot_production.sql'));
assert.ok(!seedPendingPlan.apply_set.includes('042_seed_banglim_pilot_production.sql'), '042 must not auto-enter the apply set');
assert.ok(seedPendingPlan.entries.find(e => e.file === '042_seed_banglim_pilot_production.sql').deferred_opt_in === true);
const seedOptInPlan = await computeMigrationPlan({
  ledger,
  inventory,
  appliedResolver: resolverFromApplied(new Set()),
  targetSha,
  includeProductionSeed: true,
});
assert.ok(seedOptInPlan.apply_set.includes('042_seed_banglim_pilot_production.sql'), '042 applies only with explicit opt-in');

// 12. 045 (PR #304, merged) is classified and flows through the gate; later migrations need no code rewrite.
assert.equal(classifyMigration(ledger, '045_application_documents.sql').class, 'schema');
const plan045 = await computeMigrationPlan({ ledger, inventory, appliedResolver: resolverFromApplied(new Set()), targetSha });
assert.ok(plan045.apply_set.includes('045_application_documents.sql'), '045 flows through the gate automatically once classified');
// 12b. 046 (Report R-B, this PR) is classified as an ordinary schema
// migration with a reliable column readback marker and flows through.
assert.equal(classifyMigration(ledger, '046_report_rb_schema.sql').class, 'schema');
assert.deepEqual(classifyMigration(ledger, '046_report_rb_schema.sql').marker,
  { kind: 'column', table: 'shop_recommendations', name: 'resolved_category_id' },
  '046 readback marker must be the R-B authority column');
const plan046 = await computeMigrationPlan({ ledger, inventory, appliedResolver: resolverFromApplied(new Set()), targetSha });
assert.ok(plan046.apply_set.includes('046_report_rb_schema.sql'), '046 flows through the gate automatically once classified');
const futureLedger = JSON.parse(JSON.stringify(ledger));
futureLedger.migrations['047_future_pr.sql'] = {
  class: 'schema',
  marker: { kind: 'table', schema: 'public', name: 'future_pr_table' },
};
const futurePlan = await computeMigrationPlan({
  ledger: futureLedger,
  inventory: [...inventory, '047_future_pr.sql'],
  appliedResolver: resolverFromApplied(new Set()),
  targetSha,
});
assert.ok(futurePlan.apply_set.includes('047_future_pr.sql'), 'later migrations flow through the gate automatically once classified');
assert.equal(classifyMigration(ledger, '047_community_greeting_kind.sql').class, 'schema', 'the reserved 047 leaf is registered with no hard-coded gate case');
const plan047 = await computeMigrationPlan({ ledger, inventory, appliedResolver: resolverFromApplied(new Set()), targetSha });
assert.ok(plan047.apply_set.includes('047_community_greeting_kind.sql'), '047 enters the pending apply set only via its constraint marker readback');

// 13. Target SHA recorded.
assert.equal(inventoryPlan.target_sha, targetSha);
await assert.rejects(
  computeMigrationPlan({ ledger, inventory, appliedResolver: resolverFromApplied(applied), targetSha: '' }),
  err => err instanceof GateError && /target Worker SHA/.test(err.message),
  'missing target SHA must fail closed'
);

// 14. Deploy occurs only after the migration gate.
const deployIdx = workflow.indexOf('name: Deploy production Worker');
const gateIdx = workflow.indexOf('name: Production migration gate');
const planIdx = workflow.indexOf('name: Migration inventory and classification');
assert.ok(planIdx > -1 && gateIdx > -1, 'workflow must define inventory and gate steps');
assert.ok(planIdx < gateIdx && gateIdx < deployIdx, 'migration gate must run before Worker deploy');
assert.ok(workflow.indexOf('test:migration-gate') < deployIdx, 'source-side gate test must precede deploy');
const applyIdx = workflow.indexOf('name: Apply pending production-safe migrations');
const verifyIdx = workflow.indexOf('name: Verify production schema readback before deploy');
assert.ok(applyIdx > gateIdx && applyIdx < deployIdx, 'apply step runs between gate and deploy');
assert.ok(verifyIdx > applyIdx && verifyIdx < deployIdx, 'schema readback verification runs after apply and before deploy');

// 15. No secret values emitted.
const fakeDbUrl = 'postgres://user:sup3rs3cr3t@prod-host:5432/danjion';
const emitted = maskSecrets(`connecting to ${fakeDbUrl} failed`, [fakeDbUrl]);
assert.ok(!emitted.includes('sup3rs3cr3t'), 'secret values must never appear in gate output');
assert.ok(emitted.includes('[REDACTED]'));
assert.doesNotMatch(workflow, /set -x/, 'workflow must never shell-trace secret-bearing commands');
assert.match(workflow, /Secret values were not printed/);

// 16. Dry-run performs no mutation.
assert.match(workflow, /dry_run/, 'workflow must support a dry-run mode');
assert.match(workflow, /--confirm-apply/, 'apply must require explicit authorization flag');
const dryRunGate = workflow.slice(workflow.indexOf('name: Production migration gate'), applyIdx);
assert.ok(!dryRunGate.includes('psql') || dryRunGate.includes('readback'), 'gate step itself only reads state');
assert.match(workflow, /MIGRATION_APPLY_CONFIRMED/, 'apply requires an explicit confirmation input');

console.log('Migration gate contract: PASS');
console.log(`  Repository inventory: ${inventory.length} (prohibited dev seeds allowed in repo: ${inventoryPlan.prohibited_excluded.length})`);
console.log(`  Production-safe schema: ${inventory.filter(f => classifyMigration(ledger, f).class === 'schema').length}`);
console.log(`  Production seed (opt-in): ${inventory.filter(f => classifyMigration(ledger, f).class === 'production_seed').length}`);
console.log(`  Target SHA: ${targetSha}`);
console.log('  Pending model = production_safe - applied; unknown/unreadable state fails closed');
