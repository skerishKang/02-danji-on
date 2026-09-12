#!/usr/bin/env node
/**
 * Build-output contract (#395): runs AFTER scripts/build.mjs and asserts the
 * dist/ artifact layout matches the owner-approved gateway shape:
 *   /            landing
 *   /<version>/  one stable subpath per retained version (READY bundles only)
 *   /final/      single sibling-facing FINAL surface
 *   /history/    full HISTORY / COMPARE archive
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadAndValidateRegistry, DIST_DIR } from '../scripts/registry-lib.mjs';

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

const registry = loadAndValidateRegistry();
const REPO_ROOT = resolve(DIST_DIR, '..', '..');

const rootShellPath = join(DIST_DIR, 'index.html');
const rootShell = existsSync(rootShellPath) ? readFileSync(rootShellPath, 'utf8') : '';
const rootChoices = [...rootShell.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/gi)].map((match) => match[1]);
assert(rootChoices.length === 2, 'root exposes exactly two primary choices');
assert(rootChoices.includes('./final/'), 'root FINAL choice links to ./final/');
assert(rootChoices.includes('./history/'), 'root HISTORY choice links to ./history/');
assert(!rootShell.includes('id="cards"'), 'root does not retain the legacy version-card container');
assert(!rootShell.includes('./v2-runtime/'), 'root does not directly list retained version routes');

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

// Spot-check assembled/mounted content actually came from the merged producer
// packages under design-gateway/versions/* (KILO2) and preview-bundles/v2-runtime
// (KILO3), not from any unmanaged fork.
assert(existsSync(join(DIST_DIR, 'v3-current', 'index.html')), 'v3-current assembled from versions/v3-current');
assert(existsSync(join(DIST_DIR, 'legacy-a', 'index.html')), 'legacy-a exposes index.html');
assert(existsSync(join(DIST_DIR, 'legacy-b', 'index.html')), 'legacy-b exposes index.html');
assert(existsSync(join(DIST_DIR, 'pr378', 'site', 'index.html')), 'pr378 exposes site/index.html');
assert(existsSync(join(DIST_DIR, 'v2-runtime', 'index.html')), 'v2-runtime mounted bundle copied to dist');
assert(existsSync(join(DIST_DIR, 'sibling-review', 'index.html')), 'sibling-review entry copied to dist');

// #407 sibling-handoff parity: these pages must remain byte-identical to the
// canonical frontend source and must survive the assembled v3-current copy.
for (const file of ['01_이웃가게_발견_v2.html', '03_주민혜택_쿠폰_v2.html']) {
  const sourcePath = join(REPO_ROOT, 'frontend', file);
  const packagePath = join(REPO_ROOT, 'design-gateway', 'versions', 'v3-current', file);
  const distPath = join(DIST_DIR, 'v3-current', file);
  assert(existsSync(sourcePath), `canonical handoff source exists: frontend/${file}`);
  assert(existsSync(packagePath), `v3-current package keeps ${file}`);
  assert(existsSync(distPath), `dist/v3-current keeps ${file}`);
  if (existsSync(sourcePath) && existsSync(packagePath)) {
    assert(readFileSync(sourcePath).equals(readFileSync(packagePath)), `${file} package is byte-identical to frontend source`);
  }
  if (existsSync(sourcePath) && existsSync(distPath)) {
    assert(readFileSync(sourcePath).equals(readFileSync(distPath)), `${file} dist output is byte-identical to frontend source`);
  }
}

// FINAL surface (#401): single sibling-facing presentation, registry-external.
// Frames the one DESIGN_AUTHORITY bundle; carries no history/comparison cards.
const finalDir = join(DIST_DIR, 'final');
assert(existsSync(join(finalDir, 'index.html')), 'dist/final/index.html (FINAL surface) exists');
assert(existsSync(join(finalDir, 'final.css')), 'dist/final/final.css exists');
assert(existsSync(join(finalDir, 'final.js')), 'dist/final/final.js exists');
const finalSourcePath = join(finalDir, 'FINAL_SOURCE.json');
assert(existsSync(finalSourcePath), 'dist/final/FINAL_SOURCE.json provenance sidecar exists');
const authority = registry.versions.find((v) => v.status === 'DESIGN_AUTHORITY');
if (authority && existsSync(finalSourcePath)) {
  const prov = JSON.parse(readFileSync(finalSourcePath, 'utf8'));
  assert(prov.sha === authority.source.sha, 'FINAL provenance sha equals DESIGN_AUTHORITY source.sha');
  assert(prov.authorityVersionId === authority.id, 'FINAL provenance anchors the DESIGN_AUTHORITY version');
  assert(prov.environment === 'NON_PRODUCTION', 'FINAL surface is NON_PRODUCTION');
}
const finalShell = existsSync(join(finalDir, 'index.html'))
  ? readFileSync(join(finalDir, 'index.html'), 'utf8')
  : '';
assert(/<iframe[^>]+src="\.\.\/v3-current\/index\.html"/.test(finalShell),
  'FINAL frames the v3-current authority entry (no re-invented presentation)');
assert(!/id="cards"|\.\/gateway\.js|레지스트리 로딩|COMPARISON_ONLY|DESIGN_AUTHORITY/.test(finalShell),
  'FINAL surface carries no history/comparison cards or gateway registry chrome');

// HISTORY surface (#402): producer output is mounted unchanged and retains its
// own 19-entry registry plus existing-route links.
const historyDir = join(DIST_DIR, 'history');
assert(existsSync(join(historyDir, 'index.html')), 'dist/history/index.html exists');
assert(existsSync(join(historyDir, 'registry.json')), 'dist/history/registry.json exists');
assert(existsSync(join(historyDir, '_headers')), 'dist/history/_headers exists');
if (existsSync(join(historyDir, 'registry.json'))) {
  const historyRegistry = JSON.parse(readFileSync(join(historyDir, 'registry.json'), 'utf8'));
  assert(historyRegistry.entries.length === 19, 'HISTORY keeps all 19 candidates');
  assert(historyRegistry.entries.filter((entry) => !entry.existing_route).length === 14,
    'HISTORY keeps all 14 new bundles');
  assert(historyRegistry.entries.some((entry) => entry.slug === 'pr378-frozen' && entry.do_not_merge === true),
    'HISTORY keeps PR #378 frozen / DO_NOT_MERGE');
}
const historyShell = existsSync(join(historyDir, 'index.html'))
  ? readFileSync(join(historyDir, 'index.html'), 'utf8')
  : '';
assert(/<meta name="robots" content="noindex, nofollow">/.test(historyShell),
  'HISTORY keeps noindex meta');

if (failures > 0) {
  console.error(`build-output-contract: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`build-output-contract: PASS (${registry.versions.length} registry entries; dist layout verified)`);
