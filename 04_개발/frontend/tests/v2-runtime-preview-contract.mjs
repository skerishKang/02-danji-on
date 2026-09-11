#!/usr/bin/env node
/**
 * Contract test for the #395 COMPARISON-ONLY React V2 runtime preview.
 *
 * Guards the KILO1 design-gateway integration contract (#399) WITHOUT needing
 * a fresh build:
 *   1. env sanitizer: live/production authority vars can never reach the build
 *   2. B4 sanitizer transforms: origin escaping keeps runtime values, the
 *      gateway origin scan passes, and CSS @import stripping is targeted
 *   3. registry record + BUILD_INFO provenance: 40-hex source authority pin,
 *      fixed STATUS=COMPARISON_ONLY / MUTABLE=NO, mount/builder/consumer fields
 *   4. zero-touch: the preview layer never leaked into the production build
 *      config, the live-build gate, or the app entry sources
 * Plus optional checks when the built artifact and the gateway mount exist.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PREVIEW_SUBPATH,
  PREVIEW_BASE,
  PREVIEW_OUT_DIR,
  PREVIEW_STATUS,
  GATEWAY_MOUNT_DIR,
  BUILD_INFO_FILE,
  BUILDER_ID,
  GATEWAY_CONSUMER,
  GATEWAY_SCAN_REGEXES,
  FORBIDDEN_PREVIEW_ENV,
  sanitizePreviewEnv,
  escapeAbsoluteOriginsInJs,
  stripExternalCssImports,
  buildBundleInfo,
  validateBundleInfo,
  scanGatewayBundle,
  buildPreviewRegistryRecord,
  validatePreviewRegistryRecord,
  FORBIDDEN_BUNDLE_PATTERNS
} from '../../scripts/v2-runtime-preview-lib.mjs';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(TESTS_DIR, '..');
const REPO_ROOT = resolve(FRONTEND_DIR, '..', '..');
const AUTHORITY_SHA = 'f23c4e1f5622a2313c51c94d2ac54df568b2ea9a';

let count = 0;
function test(name, fn) {
  fn();
  count += 1;
  console.log(`ok - ${name}`);
}

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
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

test('B4 origin escape keeps runtime string values and kills the gateway scan', () => {
  const literals = [
    '"http://www.w3.org/2000/svg"',
    '"https://react.dev/errors/"',
    '"https://images.unsplash.com/photo-x?w=800"'
  ];
  for (const lit of literals) {
    const escaped = escapeAbsoluteOriginsInJs(lit);
    assert.ok(!GATEWAY_SCAN_REGEXES.absOrigin.test(escaped), `escaped output still matches abs origin: ${escaped}`);
    assert.equal(escaped, lit.replace(/(https?):\/\//g, (_m, s) => `${s}:\\u002F\\u002F`));
    // \u002F is the in-string escape for '/', so the evaluated value is identical.
    assert.equal(eval(escaped), eval(lit), `runtime value changed for: ${lit}`);
    assert.equal(escapeAbsoluteOriginsInJs(escaped), escaped, 'escape must be idempotent');
  }
  const code = 'const svgNs="http://www.w3.org/2000/svg";decode("https://react.dev/errors/"+c);';
  const out = escapeAbsoluteOriginsInJs(code);
  assert.ok(!GATEWAY_SCAN_REGEXES.absOrigin.test(out), 'embedded origins survive inside minified code');
});

test('B4 CSS strip removes only external @import statements', () => {
  const css = `@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/x.css');\n@import './local.css';\n@import url(./relative.css);\n.a{background:url(/field-demo/x.jpg)}`;
  const out = stripExternalCssImports(css);
  assert.ok(!GATEWAY_SCAN_REGEXES.absOrigin.test(out), 'external @import survived the strip');
  assert.ok(out.includes("@import './local.css'"), 'local @import must be preserved');
  assert.ok(out.includes('url(./relative.css)'), 'relative url() must be preserved');
  assert.ok(out.includes('url(/field-demo/x.jpg)'), 'non-@import url() must be untouched by the strip');
});

test('BUILD_INFO enforces the 40-hex source authority pin', () => {
  const info = buildBundleInfo({
    sourceSha: AUTHORITY_SHA,
    sourceRef: 'main',
    builtAt: '2026-09-11T12:00:00.000Z',
    builder: BUILDER_ID
  });
  assert.deepEqual(validateBundleInfo(info, { expectedSourceSha: AUTHORITY_SHA }), []);
  assert.throws(() => buildBundleInfo({ sourceSha: 'f23c4e1', sourceRef: 'main', builtAt: 'x', builder: 'KILO3' }), /40-hex/);
  const bad = validateBundleInfo({ ...info, sourceSha: 'dead' }, { expectedSourceSha: AUTHORITY_SHA });
  assert.ok(bad.some((v) => v.includes('sourceSha')), 'short sha must violate');
  assert.ok(validateBundleInfo({ ...info, sourceRef: '' }).some((v) => v.includes('sourceRef')));
  assert.ok(validateBundleInfo({ ...info, builtAt: 'yesterday' }).some((v) => v.includes('builtAt')));
});

test('registry record satisfies the KILO1 gateway contract', () => {
  const record = buildPreviewRegistryRecord({
    sourceSha: AUTHORITY_SHA,
    sourceBranch: 'kilo3/395-v2-runtime-preview',
    buildSha: '8e277c6174456e3e32d8459f85a50c73134a9ff9',
    createdAt: '2026-09-11T12:00:00.000Z',
    bundlePath: `04_개발/frontend/${PREVIEW_OUT_DIR}`,
    buildCommand: 'node 04_개발/scripts/v2-runtime-preview.mjs build'
  });
  for (const key of ['VERSION_NAME', 'SOURCE_SHA', 'SOURCE_PATH', 'SOURCE_BRANCH', 'BUILD_SHA', 'CREATED_AT', 'STATUS', 'MUTABLE', 'DO_NOT_MERGE', 'MOUNT_PATH', 'BUILDER', 'GATEWAY_CONSUMER']) {
    assert.equal(typeof record[key], 'string', `registry.${key} required`);
    assert.ok(record[key].length > 0, `registry.${key} must not be empty`);
  }
  assert.equal(record.STATUS, PREVIEW_STATUS);
  assert.equal(record.MUTABLE, 'NO');
  assert.equal(record.SUBPATH, PREVIEW_SUBPATH);
  assert.equal(record.MOUNT_PATH, GATEWAY_MOUNT_DIR);
  assert.equal(record.BUILDER, BUILDER_ID);
  assert.equal(record.GATEWAY_CONSUMER, GATEWAY_CONSUMER);
  assert.deepEqual(validatePreviewRegistryRecord(record), []);
});

test('registry builder rejects a non-40-hex source authority sha', () => {
  assert.throws(
    () => buildPreviewRegistryRecord({ sourceSha: 'main-latest', sourceBranch: 'x', buildSha: 'y', createdAt: 'z', bundlePath: 'w', buildCommand: 'v' }),
    /40-hex/
  );
});

test('registry validator fails a promoted, mutable, or mis-pinned record', () => {
  const record = buildPreviewRegistryRecord({
    sourceSha: AUTHORITY_SHA,
    sourceBranch: 'kilo3/395-v2-runtime-preview',
    buildSha: '8e277c6174456e3e32d8459f85a50c73134a9ff9',
    createdAt: '2026-09-11T12:00:00.000Z',
    bundlePath: 'x',
    buildCommand: 'y'
  });
  const violations = validatePreviewRegistryRecord({
    ...record,
    STATUS: 'PRODUCTION',
    MUTABLE: 'YES',
    SOURCE_SHA: 'zzzzzzz',
    SUBPATH: '/',
    MOUNT_PATH: 'somewhere/else'
  });
  assert.ok(violations.some((v) => v.includes('STATUS')), 'must reject PRODUCTION status');
  assert.ok(violations.some((v) => v.includes('MUTABLE')), 'must reject MUTABLE=YES');
  assert.ok(violations.some((v) => v.includes('SOURCE_SHA')), 'must reject non-hex sha');
  assert.ok(violations.some((v) => v.includes('SUBPATH')), 'must reject root subpath');
  assert.ok(violations.some((v) => v.includes('MOUNT_PATH')), 'must reject foreign mount path');
});

test('preview vite config is gateway-contract shaped', () => {
  const cfg = readFileSync(join(FRONTEND_DIR, 'vite.v2-runtime-preview.config.ts'), 'utf8');
  assert.ok(cfg.includes('envDir: false'), 'config must disable .env file loading');
  assert.ok(cfg.includes('base: PREVIEW_BASE'), 'config must use the relative gateway base (B3)');
  assert.ok(PREVIEW_BASE === './', 'PREVIEW_BASE must be ./ so the mount works under any subpath');
  assert.ok(cfg.includes(`outDir: PREVIEW_OUT_DIR`), 'config must write to the dedicated preview outDir');
  assert.ok(cfg.includes('resident:'), 'config must build the resident entry');
  assert.ok(!cfg.includes('operations:'), 'operator surfaces must be excluded from the comparison bundle');
  assert.ok(cfg.includes('noindex'), 'config must inject noindex for preview pages');
  assert.ok(cfg.includes('COMPARISON ONLY'), 'config must inject the comparison overlay');
  assert.ok(cfg.includes('v2-runtime-preview-sw-stub'), 'config must alias the demo service worker to the stub (B7)');
  assert.ok(cfg.includes('escapeAbsoluteOriginsInJs'), 'config must escape absolute origins in JS chunks (B4)');
  assert.ok(cfg.includes('stripExternalCssImports'), 'config must strip external CSS imports (B4/B5)');
});

test('service worker stub exists and registers nothing', () => {
  const stub = readFileSync(join(FRONTEND_DIR, 'v2-runtime-preview-sw-stub.ts'), 'utf8');
  assert.ok(/export async function installDemoServiceWorker/.test(stub), 'stub must keep the exported entry point');
  assert.ok(!/navigator\s*\.\s*serviceWorker|\.register\s*\(/.test(stub), 'stub must not register or touch a service worker');
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

test('built artifact (when present) uses the relative gateway base', () => {
  const distIndex = join(FRONTEND_DIR, PREVIEW_OUT_DIR, 'index.html');
  if (!existsSync(distIndex)) {
    console.log('   (skip: no built bundle yet — run: node ../scripts/v2-runtime-preview.mjs build)');
    return;
  }
  const html = readFileSync(distIndex, 'utf8');
  assert.ok(html.includes('COMPARISON ONLY'), 'built index.html must carry the comparison overlay');
  assert.ok(/name="robots"\s+content="noindex/i.test(html), 'built index.html must be noindex');
  assert.ok(!GATEWAY_SCAN_REGEXES.absRootHtml.test(html), 'built index.html must not use absolute-root refs (B3)');
  assert.ok(!GATEWAY_SCAN_REGEXES.absOrigin.test(html), 'built index.html must not embed absolute origins (B4)');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.some((r) => r.startsWith('./assets/')), 'built index.html must reference ./assets bundles');
  assert.ok(!existsSync(join(FRONTEND_DIR, PREVIEW_OUT_DIR, 'demo-sw.js')), 'demo-sw.js must not ship (B7)');
});

test('gateway mount (when present) passes the mirrored B1–B7 scan', () => {
  const mountDir = join(REPO_ROOT, ...GATEWAY_MOUNT_DIR.split('/'));
  const infoPath = join(mountDir, BUILD_INFO_FILE);
  if (!existsSync(infoPath)) {
    console.log(`   (skip: no mounted bundle at ${GATEWAY_MOUNT_DIR} yet — run the build command first)`);
    return;
  }
  const info = JSON.parse(readFileSync(infoPath, 'utf8'));
  const violations = scanGatewayBundle(mountDir, {
    expectedSourceSha: info.sourceSha,
    walk: (d) => walkFiles(d),
    read: (f) => readFileSync(f, 'utf8'),
    exists: (f) => existsSync(f)
  });
  assert.deepEqual(violations, [], 'mounted bundle must satisfy the KILO1 B1–B7 mirror scan');
  assert.match(info.sourceSha, /^[0-9a-f]{40}$/, 'BUILD_INFO must pin a full 40-hex source authority sha');
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
  assert.equal(record.MOUNT_PATH, GATEWAY_MOUNT_DIR);
});

console.log(`\nV2 runtime preview contract: ${count} assertion groups passed`);
