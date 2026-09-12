#!/usr/bin/env node
/**
 * Design gateway build (#395) — deterministic, no network, no dependencies.
 *
 * Assembles dist/ for the dedicated NON-PRODUCTION Cloudflare Pages project:
 *   dist/index.html + gateway shell        (landing, cards from registry)
 *   dist/registry/versions.json            (registry snapshot)
 *   dist/<versionId>/...                   (one stable subpath per retained version)
 *   dist/final/...                          (single sibling-facing FINAL surface, #401)
 *   dist/history/...                        (full HISTORY / COMPARE archive, #402)
 *
 * Bundle sources:
 *   mode=assembled  -> copied from the canonical in-repo sourceDir (read-only)
 *   mode=mounted    -> copied from preview-bundles/<id>/ when state=READY
 *                      (KILO2/KILO3 deliverables per INTEGRATION_CONTRACT)
 *   mounted PENDING -> skipped; the landing card shows PENDING status
 */
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  loadAndValidateRegistry, GATEWAY_ROOT, REPO_ROOT, DIST_DIR, repoPath
} from './registry-lib.mjs';

function fail(msg) {
  console.error(`BUILD FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function bundleReady(version) {
  const b = version.bundle;
  if (b.mode === 'assembled') return true;
  if (b.state !== 'READY') return false;
  const dir = repoPath(...b.mountPath.split('/'));
  const entry = join(dir, b.entry);
  const info = join(dir, 'BUILD_INFO.json');
  if (!existsSync(entry)) fail(`mounted bundle ${version.id}: entry ${b.entry} missing`);
  if (!existsSync(info)) fail(`mounted bundle ${version.id}: BUILD_INFO.json missing`);
  const parsed = JSON.parse(readFileSync(info, 'utf8'));
  if (parsed.sourceSha !== version.source.sha) {
    fail(`mounted bundle ${version.id}: BUILD_INFO.sourceSha ${parsed.sourceSha} != registry ${version.source.sha}`);
  }
  return true;
}

const registry = loadAndValidateRegistry();

rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(DIST_DIR, { recursive: true });

cpSync(join(GATEWAY_ROOT, 'gateway'), DIST_DIR, { recursive: true });
mkdirSync(join(DIST_DIR, 'registry'), { recursive: true });
cpSync(join(GATEWAY_ROOT, 'registry', 'versions.json'), join(DIST_DIR, 'registry', 'versions.json'));

const summary = [];
for (const version of registry.versions) {
  const target = join(DIST_DIR, version.id);
  if (!bundleReady(version)) {
    summary.push({ id: version.id, mode: version.bundle.mode, state: version.bundle.state, dist: '(pending — not built)' });
    continue;
  }
  const sourceDir = version.bundle.mode === 'assembled'
    ? repoPath(...version.bundle.sourceDir.split('/'))
    : repoPath(...version.bundle.mountPath.split('/'));
  if (!existsSync(sourceDir)) fail(`${version.id}: source dir not found: ${sourceDir}`);
  mkdirSync(target, { recursive: true });
  cpSync(sourceDir, target, {
    recursive: true,
    filter: (src) => !src.endsWith('.gitkeep')
  });
  summary.push({ id: version.id, mode: version.bundle.mode, state: version.bundle.state, dist: `/${version.id}/` });
}

// FINAL surface (#401): a single sibling-facing presentation, deliberately OUTSIDE
// the version registry so it never appears as a comparison/history card on the root
// landing. It frames the one DESIGN_AUTHORITY bundle (V3 current = frontend/) in a
// thin shell and records that authority's provenance as a build-time sidecar derived
// from the registry — never hardcoded, so provenance cannot drift from the authority.
const authority = registry.versions.find((v) => v.status === 'DESIGN_AUTHORITY');
if (!authority) fail('no DESIGN_AUTHORITY entry to anchor the FINAL surface');
const finalDir = join(DIST_DIR, 'final');
cpSync(join(GATEWAY_ROOT, 'final'), finalDir, { recursive: true });
writeFileSync(
  join(finalDir, 'FINAL_SOURCE.json'),
  JSON.stringify({
    surface: 'final',
    issue: 401,
    environment: registry.gateway.environment,
    authorityVersionId: authority.id,
    authorityName: authority.name,
    runtime: authority.runtime,
    path: authority.source.path,
    ref: authority.source.ref,
    sha: authority.source.sha,
    capturedAt: authority.source.capturedAt,
    authorityBasis: 'frontend/README_V3_PROMOTION_20260906.md',
    presentation: '/final/index.html frames /' + authority.id + '/' + authority.bundle.entry
  }, null, 2) + '\n'
);
summary.push({ id: 'final', mode: 'shell', state: 'READY', dist: `/final/ -> /${authority.id}/` });

// HISTORY surface (#402): consume the producer's complete archive unchanged.
// This integration only mounts the existing producer output at /history/.
const historyDir = join(DIST_DIR, 'history');
cpSync(join(GATEWAY_ROOT, 'history'), historyDir, { recursive: true });
summary.push({ id: 'history', mode: 'archive', state: 'READY', dist: '/history/' });

// Sibling review entry (#413): keep the explicit review page available as a
// stable child route. The review-only deployment workflow may promote this
// already-built page to dist/index.html for the fixed danjion-review root.
const siblingReviewDir = join(DIST_DIR, 'sibling-review');
cpSync(join(GATEWAY_ROOT, 'gateway', 'sibling-review'), siblingReviewDir, { recursive: true });
summary.push({ id: 'sibling-review', mode: 'entry', state: 'READY', dist: '/sibling-review/' });

console.log('design-gateway build OK (non-production artifact only)');
console.log(`registry: ${registry.versions.length} versions | capturedFromMain: ${registry.gateway.capturedFromMain.slice(0, 7)}`);
for (const row of summary) {
  console.log(`  ${row.id.padEnd(12)} ${row.mode.padEnd(9)} ${row.state.padEnd(7)} -> ${row.dist}`);
}
console.log('DEPLOY: none performed. Publishing is a separate approved gate (see README).');
