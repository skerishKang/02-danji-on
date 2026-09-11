#!/usr/bin/env node
/**
 * Build-output contract (#395): runs AFTER scripts/build.mjs and asserts the
 * dist/ artifact layout matches the owner-approved gateway shape:
 *   /            landing
 *   /<version>/  one stable subpath per retained version (READY bundles only)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAndValidateRegistry, DIST_DIR } from '../scripts/registry-lib.mjs';

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

const registry = loadAndValidateRegistry();

assert(existsSync(join(DIST_DIR, 'index.html')), 'dist/index.html (landing) exists');
assert(existsSync(join(DIST_DIR, 'gateway.js')), 'dist/gateway.js exists');
assert(existsSync(join(DIST_DIR, 'gateway.css')), 'dist/gateway.css exists');
assert(existsSync(join(DIST_DIR, '_headers')), 'dist/_headers exists');
assert(
  readFileSync(join(DIST_DIR, '_headers'), 'utf8').includes('noindex'),
  'dist/_headers keeps noindex'
);

const distRegistryPath = join(DIST_DIR, 'registry', 'versions.json');
assert(existsSync(distRegistryPath), 'dist/registry/versions.json exists');
const distRegistry = JSON.parse(readFileSync(distRegistryPath, 'utf8'));
assert(
  JSON.stringify(distRegistry) === JSON.stringify(registry),
  'dist registry snapshot equals source registry'
);

for (const version of registry.versions) {
  const dir = join(DIST_DIR, version.id);
  if (version.bundle.mode === 'mounted' && version.bundle.state !== 'READY') {
    assert(!existsSync(dir), `PENDING bundle ${version.id} must not appear in dist`);
    continue;
  }
  assert(existsSync(dir), `dist/${version.id}/ exists (stable subpath)`);
  assert(existsSync(join(dir, version.bundle.entry)), `dist/${version.id}/${version.bundle.entry} (entry)`);
}

// Spot-check assembled content actually came from canonical sources.
assert(existsSync(join(DIST_DIR, 'v3-current', 'index.html')), 'v3-current assembled from frontend/');
assert(existsSync(join(DIST_DIR, 'legacy-a', 'index2.html')), 'legacy-a exposes index2.html');
assert(existsSync(join(DIST_DIR, 'legacy-a', 'app2.html')), 'legacy-a exposes app2.html');
assert(
  existsSync(join(DIST_DIR, 'legacy-b', '01_단지온_v5_반응형기능기준.html')),
  'legacy-b exposes v5 entry'
);

if (failures > 0) {
  console.error(`build-output-contract: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`build-output-contract: PASS (${registry.versions.length} registry entries; dist layout verified)`);
