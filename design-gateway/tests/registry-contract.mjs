#!/usr/bin/env node
/**
 * Registry contract (#395): the version registry is the single source of truth
 * for what the gateway exposes. Schema, attribution, and authority invariants
 * are enforced here — fail closed.
 */
import { loadRegistry, validateRegistry, STATUSES } from '../scripts/registry-lib.mjs';

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

const registry = loadRegistry();
const errors = validateRegistry(registry);
assert(errors.length === 0, `registry validation clean (${errors.join(' | ')})`);

const byId = Object.fromEntries(registry.versions.map((v) => [v.id, v]));

// Retained set matches the owner-approved gateway shape.
for (const id of ['v2-runtime', 'v3-current', 'legacy-a', 'legacy-b', 'pr378']) {
  assert(byId[id], `retained version present: ${id}`);
}

// Status distribution: the gateway grants NO production authority. Exactly one
// DESIGN_AUTHORITY anchors the surface; every other retained version is
// COMPARISON_ONLY. (v2-runtime is a comparison build, never promoted here.)
assert(byId['v2-runtime']?.status === 'COMPARISON_ONLY', 'v2-runtime is COMPARISON_ONLY (never promoted here)');
assert(byId['v3-current']?.status === 'DESIGN_AUTHORITY', 'v3-current is the DESIGN_AUTHORITY entry');
assert(byId['legacy-a']?.status === 'COMPARISON_ONLY', 'legacy-a is COMPARISON_ONLY');
assert(byId['legacy-b']?.status === 'COMPARISON_ONLY', 'legacy-b is COMPARISON_ONLY');
assert(byId['pr378']?.status === 'COMPARISON_ONLY', 'pr378 is COMPARISON_ONLY');
assert(
  registry.versions.every((v) => v.status !== 'PRODUCTION'),
  'no entry may carry PRODUCTION status (gateway grants no production authority)'
);

// Frozen / do-not-merge semantics.
assert(byId['pr378']?.doNotMerge === true, 'pr378 carries DO_NOT_MERGE');
assert(byId['pr378']?.frozen === true, 'pr378 is frozen');
for (const id of ['v2-runtime', 'v3-current', 'legacy-a', 'legacy-b']) {
  assert(byId[id]?.frozen === true, `${id} is frozen (read-only comparison/authority snapshot)`);
  assert(byId[id]?.doNotMerge === false, `${id} is not doNotMerge`);
}

// Every entry must display the full required card fields.
for (const v of registry.versions) {
  for (const field of ['name', 'status', 'runtime', 'frozen', 'doNotMerge', 'notes']) {
    assert(v[field] !== undefined, `${v.id}: card field ${field}`);
  }
  for (const field of ['path', 'ref', 'sha', 'capturedAt']) {
    assert(v.source?.[field], `${v.id}: card field source.${field}`);
  }
  assert(STATUSES.includes(v.status), `${v.id}: status in enum`);
}

// Attribution: main-derived entries pinned to CURRENT_MAIN; pr378 to its branch head.
const CURRENT_MAIN = 'f23c4e1f5622a2313c51c94d2ac54df568b2ea9a';
assert(registry.gateway.capturedFromMain === CURRENT_MAIN, 'gateway capturedFromMain = CURRENT_MAIN');
assert(byId['pr378'].source.sha === 'b618cad4abb4d966181f3ab7fcac2e7c2ebcc7f3', 'pr378 pinned to PR #378 head sha');
assert(byId['pr378'].source.ref.includes('378'), 'pr378 ref points at PR #378');
for (const id of ['v2-runtime', 'v3-current', 'legacy-a', 'legacy-b']) {
  assert(byId[id].source.sha === CURRENT_MAIN, `${id} pinned to CURRENT_MAIN`);
}

// Bundle boundary (integration): v2-runtime is the only mounted bundle, delivered
// READY by KILO3 at its canonical mount path. Every other retained version is
// assembled from KILO2's frozen package under design-gateway/versions/<id>.
assert(byId['v2-runtime'].bundle.mode === 'mounted', 'v2-runtime bundle is mounted (KILO3 deliverable)');
assert(byId['v2-runtime'].bundle.state === 'READY', 'v2-runtime bundle READY (KILO3 bundle delivered)');
assert(
  byId['v2-runtime'].bundle.mountPath === 'design-gateway/preview-bundles/v2-runtime',
  'v2-runtime mounted at canonical preview-bundles path'
);
for (const id of ['v3-current', 'legacy-a', 'legacy-b', 'pr378']) {
  assert(byId[id].bundle.mode === 'assembled', `${id} bundle is assembled from KILO2 package`);
  assert(byId[id].bundle.state === 'READY', `${id} bundle READY`);
  assert(byId[id].bundle.sourceDir === `design-gateway/versions/${id}`, `${id} assembles from design-gateway/versions/${id}`);
}
assert(byId['pr378'].bundle.entry === 'site/index.html', 'pr378 entry is site/index.html');

if (failures > 0) {
  console.error(`registry-contract: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`registry-contract: PASS (${registry.versions.length} versions, statuses ${STATUSES.join('|')})`);
