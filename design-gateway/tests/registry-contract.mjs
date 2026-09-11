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

// Status distribution: one production comparison, one design authority.
assert(byId['v2-runtime']?.status === 'PRODUCTION', 'v2-runtime is the PRODUCTION comparison entry');
assert(byId['v3-current']?.status === 'DESIGN_AUTHORITY', 'v3-current is the DESIGN_AUTHORITY entry');
assert(byId['pr378']?.status === 'COMPARISON_ONLY', 'pr378 is COMPARISON_ONLY');
assert(byId['legacy-a']?.status === 'ARCHIVED', 'legacy-a is ARCHIVED');

// Frozen / do-not-merge semantics.
assert(byId['pr378']?.doNotMerge === true, 'pr378 carries DO_NOT_MERGE');
assert(byId['pr378']?.frozen === true, 'pr378 is frozen');
assert(byId['legacy-a']?.frozen === true, 'legacy-a is frozen (archived variant)');
assert(byId['legacy-b']?.frozen === true, 'legacy-b is frozen (comparison variant)');
assert(
  registry.versions.filter((v) => v.status === 'PRODUCTION').every((v) => v.doNotMerge === false),
  'no PRODUCTION entry may be doNotMerge'
);

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
assert(byId['pr378'].source.ref === 'deploy/v3-preview', 'pr378 pinned to deploy/v3-preview ref');
for (const id of ['v2-runtime', 'v3-current', 'legacy-a', 'legacy-b']) {
  assert(byId[id].source.sha === CURRENT_MAIN, `${id} pinned to CURRENT_MAIN`);
}

// Mounted bundles must live at their canonical mount path (integration boundary).
assert(byId['v2-runtime'].bundle.mode === 'mounted', 'v2-runtime bundle is mounted (KILO2 deliverable)');
assert(byId['v2-runtime'].bundle.state === 'PENDING', 'v2-runtime bundle PENDING until KILO2 delivers');
assert(byId['pr378'].bundle.mode === 'mounted', 'pr378 bundle is mounted (branch source)');
assert(byId['pr378'].bundle.state === 'PENDING', 'pr378 bundle PENDING until artifact bundle delivered');

if (failures > 0) {
  console.error(`registry-contract: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`registry-contract: PASS (${registry.versions.length} versions, statuses ${STATUSES.join('|')})`);
