#!/usr/bin/env node
/**
 * DanjiOn #395 — COMPARISON-ONLY React V2 runtime preview orchestrator.
 *
 * Builds the V2 resident surface from the current checkout with
 * vite.v2-runtime-preview.config.ts, verifies the artifact carries no
 * production authority, writes the version-registry record for the KILO1
 * preview gateway (#397), and optionally serves it under /v2-runtime/.
 *
 *   node 04_개발/scripts/v2-runtime-preview.mjs build   [--expect-sha <prefix>]
 *   node 04_개발/scripts/v2-runtime-preview.mjs serve   [--port 4185]
 *
 * Windows note: vite is always invoked as
 * `process.execPath node_modules/vite/bin/vite.js` — never through
 * npm.cmd/.cmd shims, which EINVAL under spawnSync on Node 22 (#382 lesson).
 *
 * Safety invariants (enforced, not documented-only):
 *   - VITE_DATA_MODE / VITE_AUTH_MODE / VITE_STORAGE_MODE / VITE_API_BASE_URL
 *     and every secret-ish var are DELETED from the child env
 *   - VITE_UI_VARIANT=v2 is forced; gateway/V1/V2 URLs forced empty
 *   - built assets are scanned: any *.pages.dev / *.workers.dev / danjion.dev
 *     / padiem.kr reference fails the command
 *   - the registry record is fixed STATUS=COMPARISON_ONLY, MUTABLE=NO
 */
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PREVIEW_SUBPATH,
  PREVIEW_OUT_DIR,
  sanitizePreviewEnv,
  buildPreviewRegistryRecord,
  validatePreviewRegistryRecord,
  FORBIDDEN_BUNDLE_PATTERNS
} from './v2-runtime-preview-lib.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url)); // 04_개발/scripts
const AREA_DIR = dirname(SCRIPT_DIR); // 04_개발
const REPO_ROOT = dirname(AREA_DIR);
const FRONTEND_DIR = join(AREA_DIR, 'frontend');
const VITE_BIN = join(FRONTEND_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
const PREVIEW_CONFIG = 'vite.v2-runtime-preview.config.ts';
const REGISTRY_DIR = join(REPO_ROOT, 'preview', 'registry');
const REGISTRY_FILE = join(REGISTRY_DIR, 'v2-runtime.json');
const DEFAULT_PORT = 4185;

function die(msg) {
  console.error(`[v2-runtime-preview] FAIL: ${msg}`);
  process.exit(1);
}

function git(args) {
  const r = spawnSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });
  if (r.status !== 0) die(`git ${args.join(' ')} failed: ${r.stderr?.trim()}`);
  return r.stdout.trim();
}

function parseArgs(argv) {
  const cmd = argv[2];
  const opts = { port: DEFAULT_PORT, expectSha: null };
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === '--port') opts.port = Number.parseInt(argv[i + 1], 10) || opts.port;
    if (argv[i] === '--expect-sha') opts.expectSha = argv[i + 1];
  }
  return { cmd, opts };
}

function runViteBuild(env) {
  const r = spawnSync(process.execPath, [VITE_BIN, 'build', '--config', PREVIEW_CONFIG], {
    cwd: FRONTEND_DIR,
    env,
    stdio: 'inherit'
  });
  if (r.error) die(`vite build spawn failed: ${r.error.message}`);
  if (r.status !== 0) die(`vite build exited with ${r.status}`);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

function scanBundle() {
  const distDir = join(FRONTEND_DIR, PREVIEW_OUT_DIR);
  if (!existsSync(distDir)) die(`expected bundle dir missing: ${distDir}`);
  const text = /\.(html|js|css|map)$/i;
  const violations = [];
  let indexHtml = '';
  for (const file of walk(distDir)) {
    if (!text.test(file)) continue;
    const content = readFileSync(file, 'utf8');
    if (file.endsWith('index.html')) indexHtml = content;
    for (const pattern of FORBIDDEN_BUNDLE_PATTERNS) {
      if (pattern.test(content)) {
        violations.push(`${relative(distDir, file)} matches ${pattern}`);
      }
    }
  }
  if (violations.length) {
    die(`bundle contains production/live host references:\n  ${violations.join('\n  ')}`);
  }
  const refs = [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  const localRefs = refs.filter((r) => r.startsWith('/') && !r.startsWith(PREVIEW_SUBPATH));
  if (localRefs.length) {
    die(`bundle root-absolute asset refs outside ${PREVIEW_SUBPATH}: ${localRefs.join(', ')}`);
  }
  if (!refs.some((r) => r.startsWith(PREVIEW_SUBPATH))) {
    die(`index.html has no ${PREVIEW_SUBPATH}-prefixed asset refs`);
  }
  if (!indexHtml.includes('COMPARISON ONLY')) {
    die('index.html is missing the COMPARISON ONLY overlay');
  }
  if (!/name="robots"\s+content="noindex/i.test(indexHtml)) {
    die('index.html is missing the noindex robots meta');
  }
  console.log(`[v2-runtime-preview] bundle scan OK (${refs.length} asset refs under ${PREVIEW_SUBPATH}, no production hosts, overlay+noindex present)`);
}

function writeRegistry({ sha, branch }) {
  const record = buildPreviewRegistryRecord({
    sourceSha: sha,
    sourceBranch: branch,
    createdAt: new Date().toISOString(),
    bundlePath: relative(REPO_ROOT, join(FRONTEND_DIR, PREVIEW_OUT_DIR)).split(/[\\\\/]/).join('/'),
    buildCommand: `node 04_개발/scripts/v2-runtime-preview.mjs build`
  });
  const violations = validatePreviewRegistryRecord(record);
  if (violations.length) die(`registry record invalid: ${violations.join('; ')}`);
  mkdirSync(REGISTRY_DIR, { recursive: true });
  writeFileSync(REGISTRY_FILE, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`[v2-runtime-preview] registry written: ${relative(REPO_ROOT, REGISTRY_FILE)} (STATUS=${record.STATUS})`);
}


function main() {
  const { cmd, opts } = parseArgs(process.argv);
  if (!['build', 'serve'].includes(cmd)) {
    die(`unknown command "${cmd ?? ''}" — use: build | serve [--port ${DEFAULT_PORT}]`);
  }
  if (!existsSync(VITE_BIN)) {
    die(`vite not installed at ${relative(REPO_ROOT, VITE_BIN)} — run npm install --ignore-scripts in 04_開発/frontend first`);
  }
  const sha = git(['rev-parse', 'HEAD']);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (opts.expectSha && !sha.startsWith(opts.expectSha)) {
    die(`HEAD ${sha} does not match --expect-sha ${opts.expectSha} (comparison bundle must pin the reviewed source)`);
  }
  const dirty = git(['status', '--porcelain']);
  if (dirty) {
    console.warn('[v2-runtime-preview] WARN: working tree is dirty; SOURCE_SHA alone will not describe the artifact bytes');
  }
  const env = sanitizePreviewEnv(process.env);
  env.DANJION_PREVIEW_SHA = sha.slice(0, 12);
  env.DANJION_PREVIEW_BRANCH = branch;
  env.DANJION_PREVIEW_CAPTURED_AT = new Date().toISOString().slice(0, 16).replace('T', ' ');
  console.log(`[v2-runtime-preview] source=${sha.slice(0, 12)} branch=${branch} base=${PREVIEW_SUBPATH} mode=COMPARISON_ONLY`);
  runViteBuild(env);
  scanBundle();
  writeRegistry({ sha, branch });
  if (cmd === 'serve') {
    console.log(`[v2-runtime-preview] serving at http://127.0.0.1:${opts.port}${PREVIEW_SUBPATH}`);
    const child = spawn(
      process.execPath,
      [VITE_BIN, 'preview', '--config', PREVIEW_CONFIG, '--host', '127.0.0.1', '--port', String(opts.port), '--strictPort'],
      { cwd: FRONTEND_DIR, env, stdio: 'inherit' }
    );
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }
  console.log('[v2-runtime-preview] DONE (build only — nothing served, deployed, or merged)');
}

main();
