#!/usr/bin/env node
/**
 * Contract test for the #395 COMPARISON-ONLY React V2 runtime preview.
 *
 * Guards three things WITHOUT needing a built artifact:
 *   1. env sanitizer: live/production authority vars can never reach the build
 *   2. registry record: KILO1 gateway (#397) contract fields + fixed
 *      STATUS=COMPARISON_ONLY / MUTABLE=NO
 *   3. zero-touch: the preview layer never leaked into the production build
 *      config, the live-build gate, or the app entry sources
 * Plus optional checks when a bundle/registry artifact exists on disk.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PREVIEW_SUBPATH,
  PREVIEW_OUT_DIR,
  PREVIEW_STATUS,
  FORBIDDEN_PREVIEW_ENV,
  sanitizePreviewEnv,
  buildPreviewRegistryRecord,
  validatePreviewRegistryRecord,
  FORBIDDEN_BUNDLE_PATTERNS
} from '../../scripts/v2-runtime-preview-lib.mjs';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(TESTS_DIR, '..');
const REPO_ROOT = resolve(FRONTEND_DIR, '..', '..');

let count = 0;
function test(name, fn) {
  fn();
  count += 1;
  console.log(`ok - ${name}`);
}

test('sanitizer deletes every live-authority / secret env var', () => {
  const base = {
    PATH: 'x',
    VITE_DATA_MODE: 'api',
    VITE_AUTH_MODE: 'danjion',
    VITE_STORAGE_MODE: 'drive',
    VITE_API_BASE_URL: 'https://prod.example.workers.dev',
    VITE_AUTH_BASE_URL: 'https://prod.example.workers.dev',
    VITE_COMPLEX_SLUG: '방림명지로드힐',
    NEON_CONNECTION_STRING: 'postgres://secret',
    BETTER_AUTH_SECRET: 'sekret',
    GOOGLE_CLIENT_SECRET: 'sekret',
    DATABASE_URL: 'postgres://secret'
  };
  const frozenCopy = { ...base };
  const env = sanitizePreviewEnv(base);
  assert.deepEqual(base, frozenCopy, 'sanitizer must not mutate the input env');
  for (const name of FORBIDDEN_PREVIEW_ENV) {
    assert.ok(!(name in env), `${name} must be deleted from the preview env`);
  }
  assert.equal(env.VITE_UI_VARIANT, 'v2');
  assert.equal(env.VITE_V1_URL, '');
  assert.equal(env.VITE_V2_URL, '');
  assert.equal(env.VITE_GATEWAY_URL, '');
  assert.equal(env.PATH, 'x', 'unrelated vars pass through');
});

test('sanitizer covers the exact five VITE authority levers', () => {
  for (const name of [
    'VITE_DATA_MODE',
    'VITE_AUTH_MODE',
    'VITE_STORAGE_MODE',
    'VITE_API_BASE_URL',
    'VITE_AUTH_BASE_URL'
  ]) {
    assert.ok(FORBIDDEN_PREVIEW_ENV.includes(name), `${name} must be in FORBIDDEN_PREVIEW_ENV`);
  }
});

test('registry record satisfies the KILO1 gateway contract', () => {
  const record = buildPreviewRegistryRecord({
    sourceSha: 'f23c4e1a1b2c3d4e5f60718293a4b5c6d7e8f901',
    sourceBranch: 'kilo3/395-v2-runtime-preview',
    createdAt: '2026-09-11T12:00:00.000Z',
    bundlePath: `04_개발/frontend/${PREVIEW_OUT_DIR}`,
    buildCommand: 'node 04_개발/scripts/v2-runtime-preview.mjs build'
  });
  for (const key of ['VERSION_NAME', 'SOURCE_SHA', 'SOURCE_PATH', 'SOURCE_BRANCH', 'CREATED_AT', 'STATUS', 'MUTABLE', 'DO_NOT_MERGE']) {
    assert.equal(typeof record[key], 'string', `registry.${key} required`);
    assert.ok(record[key].length > 0, `registry.${key} must not be empty`);
  }
  assert.equal(record.STATUS, PREVIEW_STATUS);
  assert.equal(record.MUTABLE, 'NO');
  assert.equal(record.SUBPATH, PREVIEW_SUBPATH);
  assert.deepEqual(validatePreviewRegistryRecord(record), []);
});

test('registry builder rejects a non-git SOURCE_SHA', () => {
  assert.throws(
    () => buildPreviewRegistryRecord({ sourceSha: 'main-latest', sourceBranch: 'x', createdAt: 'y', bundlePath: 'z', buildCommand: 'w' }),
    /git sha/
  );
});

test('registry validator fails a promoted or mutable record', () => {
  const record = buildPreviewRegistryRecord({
    sourceSha: 'f23c4e1a',
    sourceBranch: 'kilo3/395-v2-runtime-preview',
    createdAt: '2026-09-11T12:00:00.000Z',
    bundlePath: 'x',
    buildCommand: 'y'
  });
  const violations = validatePreviewRegistryRecord({ ...record, STATUS: 'PRODUCTION', MUTABLE: 'YES', SOURCE_SHA: 'zzzzzzz', SUBPATH: '/' });
  assert.ok(violations.some((v) => v.includes('STATUS')), 'must reject PRODUCTION status');
  assert.ok(violations.some((v) => v.includes('MUTABLE')), 'must reject MUTABLE=YES');
  assert.ok(violations.some((v) => v.includes('SOURCE_SHA')), 'must reject non-hex sha');
  assert.ok(violations.some((v) => v.includes('SUBPATH')), 'must reject root subpath');
});

test('preview vite config mounts the subpath and disables .env loading', () => {
  const cfg = readFileSync(join(FRONTEND_DIR, 'vite.v2-runtime-preview.config.ts'), 'utf8');
  assert.ok(cfg.includes('envDir: false'), 'config must disable .env file loading');
  assert.ok(cfg.includes('base: PREVIEW_SUBPATH'), 'config must mount base from the shared lib');
  assert.ok(cfg.includes(`outDir: PREVIEW_OUT_DIR`), 'config must write to the dedicated preview outDir');
  assert.ok(cfg.includes('resident:'), 'config must build the resident entry');
  assert.ok(!cfg.includes('operations:'), 'operator surfaces must be excluded from the comparison bundle');
  assert.ok(cfg.includes('noindex'), 'config must inject noindex for preview pages');
  assert.ok(cfg.includes('COMPARISON ONLY'), 'config must inject the comparison overlay');
});

test('production build path is zero-touch', () => {
  const prod = readFileSync(join(FRONTEND_DIR, 'vite.config.ts'), 'utf8');
  assert.ok(!prod.includes('v2-runtime'), 'production vite config must not reference the preview');
  assert.ok(!/^\s*base:/m.test(prod), 'production vite config must keep the default base');
  const gate = readFileSync(join(FRONTEND_DIR, 'scripts', 'assert-live-build-env.mjs'), 'utf8');
  assert.ok(!gate.includes('v2-runtime'), 'live-build gate must not reference the preview');
  for (const rel of ['src/main.tsx', 'src/v2/integration/v2-live-data.ts', 'src/auth.ts', 'src/ui-variant.tsx']) {
    const src = readFileSync(join(FRONTEND_DIR, rel), 'utf8');
    assert.ok(!src.includes('v2-runtime'), `${rel} must not reference the preview`);
  }
});

test('forbidden bundle patterns cover production/live hosts', () => {
  const joined = FORBIDDEN_BUNDLE_PATTERNS.map((p) => p.source).join('|');
  for (const host of ['pages.dev', 'workers.dev', 'danjion.dev', 'padiem.kr']) {
    assert.ok(joined.includes(host.replace(/\./g, '\\.')), `bundle scan must block ${host}`);
  }
});

test('built artifact (when present) is subpath-safe and labeled', () => {
  const distIndex = join(FRONTEND_DIR, PREVIEW_OUT_DIR, 'index.html');
  if (!existsSync(distIndex)) {
    console.log('   (skip: no built bundle yet — run: node ../scripts/v2-runtime-preview.mjs build)');
    return;
  }
  const html = readFileSync(distIndex, 'utf8');
  assert.ok(html.includes('COMPARISON ONLY'), 'built index.html must carry the comparison overlay');
  assert.ok(/name="robots"\s+content="noindex/i.test(html), 'built index.html must be noindex');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((r) => r.startsWith('/'));
  assert.ok(refs.length > 0, 'built index.html must reference bundled assets');
  for (const ref of refs) {
    assert.ok(ref.startsWith(PREVIEW_SUBPATH), `root-absolute ref outside ${PREVIEW_SUBPATH}: ${ref}`);
  }
});

test('committed registry (when present) validates against the contract', () => {
  const registryFile = join(REPO_ROOT, 'preview', 'registry', 'v2-runtime.json');
  if (!existsSync(registryFile)) {
    console.log('   (skip: no registry artifact yet — run the build command first)');
    return;
  }
  const record = JSON.parse(readFileSync(registryFile, 'utf8'));
  assert.deepEqual(validatePreviewRegistryRecord(record), [], 'committed registry must satisfy the contract');
  assert.equal(record.SERVES_PRODUCTION_TRAFFIC, 'NO');
});

console.log(`\nV2 runtime preview contract: ${count} assertions groups passed`);
