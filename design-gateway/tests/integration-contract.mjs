#!/usr/bin/env node
/**
 * Integration contract (#395): validates the mount/assembly boundary between
 * the gateway and version bundles (KILO2/KILO3 deliverables per
 * INTEGRATION_CONTRACT.md). Mounted bundles are checked for provenance and
 * self-containment; assembled bundles are checked against canonical sources.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadAndValidateRegistry, repoPath } from '../scripts/registry-lib.mjs';

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

const registry = loadAndValidateRegistry();

// No unmanaged preview bundles may exist outside the registry.
const bundlesRoot = repoPath('design-gateway', 'preview-bundles');
const bundleDirs = existsSync(bundlesRoot)
  ? readdirSync(bundlesRoot).filter((name) => {
      try { return statSync(join(bundlesRoot, name)).isDirectory(); } catch { return false; }
    })
  : [];
const registryIds = new Set(registry.versions.map((v) => v.id));
for (const dir of bundleDirs) {
  assert(registryIds.has(dir), `preview-bundles/${dir} must be registered in versions.json (no unmanaged previews)`);
}

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

for (const version of registry.versions) {
  const b = version.bundle;

  if (b.mode === 'assembled') {
    const sourceDir = repoPath(...b.sourceDir.split('/'));
    assert(existsSync(sourceDir), `${version.id}: assembled sourceDir exists (${b.sourceDir})`);
    assert(existsSync(join(sourceDir, b.entry)), `${version.id}: assembled entry exists (${b.entry})`);
    continue;
  }

  // mounted
  const mountDir = repoPath(...b.mountPath.split('/'));
  assert(existsSync(mountDir), `${version.id}: mount directory exists (${b.mountPath})`);
  if (b.state !== 'READY') continue;

  assert(b.entry === 'index.html', `${version.id}: mounted bundle entry must be index.html`);
  assert(existsSync(join(mountDir, 'index.html')), `${version.id}: mounted index.html present`);

  const infoPath = join(mountDir, 'BUILD_INFO.json');
  assert(existsSync(infoPath), `${version.id}: BUILD_INFO.json provenance marker required`);
  if (existsSync(infoPath)) {
    const info = JSON.parse(readFileSync(infoPath, 'utf8'));
    assert(info.sourceSha === version.source.sha, `${version.id}: BUILD_INFO.sourceSha must equal registry source.sha`);
    assert(typeof info.builder === 'string' && info.builder.length > 0, `${version.id}: BUILD_INFO.builder required`);
  }

  // Self-containment: relative assets only, no absolute origins in bundle code.
  const ABS_ROOT_HTML = /(?:src|href)\s*=\s*["']\//i;
  const ABS_ROOT_CSS = /url\(\s*["']?\//i;
  const ABS_ORIGIN = /https?:\/\//i;
  for (const file of walkFiles(mountDir)) {
    if (!/\.(html|css|js|mjs)$/i.test(file)) continue;
    const rel = file.slice(mountDir.length + 1);
    const text = readFileSync(file, 'utf8');
    assert(!ABS_ROOT_HTML.test(text) && !ABS_ROOT_CSS.test(text),
      `${version.id}: ${rel} must use relative asset paths (no absolute-root refs)`);
    assert(!ABS_ORIGIN.test(text),
      `${version.id}: ${rel} must not embed absolute http(s) origins (mock/read-only data only)`);
  }
}

if (failures > 0) {
  console.error(`integration-contract: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`integration-contract: PASS (${registry.versions.length} versions; mounted dirs: ${bundleDirs.join(', ') || 'none'})`);
