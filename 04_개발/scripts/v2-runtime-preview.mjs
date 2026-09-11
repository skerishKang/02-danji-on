#!/usr/bin/env node
/**
 * DanjiOn #395 — COMPARISON-ONLY React V2 runtime preview orchestrator.
 *
 * Builds the V2 resident surface from the current checkout with
 * vite.v2-runtime-preview.config.ts, verifies the artifact carries no
 * production authority, packages the KILO1 (#399) gateway mount bundle with
 * B1–B7 provenance, writes the version-registry record, and optionally serves
 * the mounted bundle under /v2-runtime/ for local QA.
 *
 *   node 04_개발/scripts/v2-runtime-preview.mjs build   [--expect-sha <prefix>] [--source-sha <40-hex>]
 *   node 04_개발/scripts/v2-runtime-preview.mjs serve   [--port 4185]
 *
 * Attribution rules (KILO1 integration contract B2):
 *   - SOURCE_SHA pins the source authority commit (main) the app sources were
 *     built from; default = merge-base(HEAD, origin/main), overridable with
 *     --source-sha. The build fails if 04_개발/frontend/src differs between
 *     SOURCE_SHA and HEAD, so the pin can never drift from the built bytes.
 *   - SOURCE_BRANCH / BUILD_SHA carry the preview branch metadata separately.
 *
 * Windows note: vite is always invoked as
 * `process.execPath node_modules/vite/bin/vite.js` — never through
 * npm.cmd/.cmd shims, which EINVAL under spawnSync on Node 22 (#382 lesson).
 *
 * Safety invariants (enforced, not documented-only):
 *   - VITE_DATA_MODE / VITE_AUTH_MODE / VITE_STORAGE_MODE / VITE_API_BASE_URL
 *     and every secret-ish var are DELETED from the child env
 *   - VITE_UI_VARIANT=v2 is forced; gateway/V1/V2 URLs forced empty
 *   - built assets are scanned: production/live host references, absolute
 *     http(s) origins, absolute-root asset refs, or service worker code all
 *     fail the command
 *   - the mounted bundle is re-scanned against KILO1's B1–B7 mirror rules
 *   - the registry record is fixed STATUS=COMPARISON_ONLY, MUTABLE=NO
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  createReadStream
} from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, relative, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PREVIEW_SUBPATH,
  PREVIEW_OUT_DIR,
  GATEWAY_MOUNT_DIR,
  BUILD_INFO_FILE,
  sanitizePreviewEnv,
  buildPreviewRegistryRecord,
  validatePreviewRegistryRecord,
  buildBundleInfo,
  scanGatewayBundle,
  FORBIDDEN_BUNDLE_PATTERNS,
  FORBIDDEN_BUNDLE_NEEDLES,
  GATEWAY_SCAN_REGEXES
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

function git(args, { allowFail = false } = {}) {
  const r = spawnSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });
  if (r.status !== 0) {
    if (allowFail) return null;
    die(`git ${args.join(' ')} failed: ${r.stderr?.trim()}`);
  }
  return r.stdout.trim();
}

function parseArgs(argv) {
  const cmd = argv[2];
  const opts = { port: DEFAULT_PORT, expectSha: null, sourceSha: null };
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === '--port') opts.port = Number.parseInt(argv[i + 1], 10) || opts.port;
    if (argv[i] === '--expect-sha') opts.expectSha = argv[i + 1];
    if (argv[i] === '--source-sha') opts.sourceSha = argv[i + 1];
  }
  return { cmd, opts };
}

/**
 * The source authority commit the built app sources come from. NOT the
 * preview branch head: branch metadata lives in SOURCE_BRANCH/BUILD_SHA.
 */
function resolveSourceSha({ override, buildSha }) {
  let sourceSha = override;
  if (!sourceSha) {
    sourceSha = git(['merge-base', 'HEAD', 'origin/main'], { allowFail: true });
    if (!sourceSha || !/^[0-9a-f]{40}$/.test(sourceSha)) sourceSha = buildSha;
  }
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) die(`SOURCE_SHA must be a full 40-hex sha, got: ${sourceSha}`);
  const exists = spawnSync('git', ['-C', REPO_ROOT, 'cat-file', '-e', `${sourceSha}^{commit}`], { encoding: 'utf8' });
  if (exists.status !== 0) {
    die(`SOURCE_SHA ${sourceSha} is not a commit in this repository`);
  }
  const drift = git(['diff', '--name-only', `${sourceSha}..HEAD`, '--', '04_개발/frontend/src'], { allowFail: true });
  if (drift === null) die(`cannot compare SOURCE_SHA ${sourceSha} with HEAD`);
  if (drift.trim().length > 0) {
    die(`SOURCE_SHA ${sourceSha} does not describe the built app sources; 04_개발/frontend/src differs:\n  ${drift.split('\n').join('\n  ')}`);
  }
  return sourceSha;
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
  // B7: the demo service worker must not ship in the comparison artifact.
  const demoSw = join(distDir, 'demo-sw.js');
  if (existsSync(demoSw)) rmSync(demoSw);

  const text = /\.(html|js|css|map)$/i;
  const violations = [];
  let indexHtml = '';
  for (const file of walk(distDir)) {
    const content = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN_BUNDLE_PATTERNS) {
      if (pattern.test(content)) violations.push(`${relative(distDir, file)} matches ${pattern}`);
    }
    for (const needle of FORBIDDEN_BUNDLE_NEEDLES) {
      if (content.includes(needle)) violations.push(`${relative(distDir, file)} contains ${needle}`);
    }
    if (!text.test(file)) continue;
    if (GATEWAY_SCAN_REGEXES.absOrigin.test(content)) {
      violations.push(`${relative(distDir, file)} contains an absolute http(s) origin (B4)`);
    }
    if (GATEWAY_SCAN_REGEXES.absRootHtml.test(content)) {
      violations.push(`${relative(distDir, file)} has absolute-root src/href refs (B3)`);
    }
    if (GATEWAY_SCAN_REGEXES.absRootCss.test(content)) {
      violations.push(`${relative(distDir, file)} has absolute-root url() refs (B3)`);
    }
    if (/navigator\s*\.\s*serviceWorker|serviceWorker\s*\.register|importScripts\s*\(/.test(content) || /demo-sw/i.test(content)) {
      violations.push(`${relative(distDir, file)} registers or uses a service worker (B7)`);
    }
    if (file.endsWith('index.html')) indexHtml = content;
  }
  if (violations.length) {
    die(`bundle scan failed (production leakage / contract violation):\n  ${violations.join('\n  ')}`);
  }
  const refs = [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  if (!refs.some((r) => r.startsWith('./'))) {
    die('index.html has no bundle-relative asset refs (B3 expects base ./)');
  }
  if (!indexHtml.includes('COMPARISON ONLY')) {
    die('index.html is missing the COMPARISON ONLY overlay');
  }
  if (!/name="robots"\s+content="noindex/i.test(indexHtml)) {
    die('index.html is missing the noindex robots meta');
  }
  console.log(`[v2-runtime-preview] bundle scan OK (${refs.length} bundle-relative asset refs, no absolute origins, no production hosts, overlay+noindex present, no service worker)`);
  return distDir;
}

function writeRegistry({ sourceSha, sourceBranch, buildSha }) {
  const record = buildPreviewRegistryRecord({
    sourceSha,
    sourceBranch,
    buildSha,
    createdAt: new Date().toISOString(),
    bundlePath: relative(REPO_ROOT, join(FRONTEND_DIR, PREVIEW_OUT_DIR)).split(sep).join('/'),
    buildCommand: 'node 04_개발/scripts/v2-runtime-preview.mjs build'
  });
  const violations = validatePreviewRegistryRecord(record);
  if (violations.length) die(`registry record invalid: ${violations.join('; ')}`);
  mkdirSync(REGISTRY_DIR, { recursive: true });
  writeFileSync(REGISTRY_FILE, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`[v2-runtime-preview] registry written: ${relative(REPO_ROOT, REGISTRY_FILE)} (STATUS=${record.STATUS}, SOURCE_SHA=${sourceSha.slice(0, 12)} pinned to source authority)`);
}

/**
 * KILO1 (#399) handoff: copy the scanned artifact into the gateway mount
 * point and stamp the B2 provenance marker, then re-scan the mounted copy
 * against the mirrored B1–B7 + gateway safety rules.
 *
 * Manual copy: fs.cpSync fast-fails (0xC0000409) under Node 22 on this
 * Windows/E: drive setup, so walk + byte-for-byte file copies instead.
 */
function copyTree(srcDir, dstDir) {
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dst = join(dstDir, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else writeFileSync(dst, readFileSync(src));
  }
}
function packageMount({ sourceSha, sourceBranch, distDir }) {
  const mountDir = join(REPO_ROOT, ...GATEWAY_MOUNT_DIR.split('/'));
  rmSync(mountDir, { recursive: true, force: true });
  copyTree(distDir, mountDir);
  const info = buildBundleInfo({
    sourceSha,
    sourceRef: sourceBranch,
    builtAt: new Date().toISOString(),
    builder: 'KILO3'
  });
  writeFileSync(join(mountDir, BUILD_INFO_FILE), `${JSON.stringify(info, null, 2)}\n`);
  const violations = scanGatewayBundle(mountDir, {
    expectedSourceSha: sourceSha,
    walk: (d) => [...walk(d)],
    read: (f) => readFileSync(f, 'utf8'),
    exists: (f) => existsSync(f)
  });
  if (violations.length) {
    die(`gateway mount bundle failed the KILO1 B1–B7 mirror scan:\n  ${violations.join('\n  ')}`);
  }
  console.log(`[v2-runtime-preview] gateway mount packaged: ${GATEWAY_MOUNT_DIR}/ (B1–B7 mirror scan OK, ${BUILD_INFO_FILE} pins source=${sourceSha.slice(0, 12)})`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

/** Local-only static server for the exact gateway-mounted artifact. */
function serveMount(port, mountDir) {
  const root = resolve(mountDir);
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/') {
      res.writeHead(302, { location: PREVIEW_SUBPATH });
      res.end();
      return;
    }
    if (!url.startsWith(PREVIEW_SUBPATH)) {
      res.writeHead(404, { 'x-robots-tag': 'noindex, nofollow' });
      res.end('not found');
      return;
    }
    let rel = url.slice(PREVIEW_SUBPATH.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const full = resolve(root, rel);
    if (full !== root && !full.startsWith(root + sep)) {
      res.writeHead(403, { 'x-robots-tag': 'noindex, nofollow' });
      res.end('forbidden');
      return;
    }
    if (!existsSync(full) || !statSync(full).isFile()) {
      res.writeHead(404, { 'x-robots-tag': 'noindex, nofollow' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream',
      'x-robots-tag': 'noindex, nofollow',
      'cache-control': 'no-store'
    });
    createReadStream(full).pipe(res);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`[v2-runtime-preview] serving the gateway mount at http://127.0.0.1:${port}${PREVIEW_SUBPATH} (comparison only, nothing deployed)`);
  });
  return server;
}

function main() {
  const { cmd, opts } = parseArgs(process.argv);
  if (!['build', 'serve'].includes(cmd)) {
    die(`unknown command "${cmd ?? ''}" — use: build | serve [--port ${DEFAULT_PORT}]`);
  }
  if (!existsSync(VITE_BIN)) {
    die(`vite not installed at ${relative(REPO_ROOT, VITE_BIN)} — run npm install --ignore-scripts in 04_개발/frontend first`);
  }
  const buildSha = git(['rev-parse', 'HEAD']);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (opts.expectSha && !buildSha.startsWith(opts.expectSha)) {
    die(`HEAD ${buildSha} does not match --expect-sha ${opts.expectSha} (comparison bundle must pin the reviewed source)`);
  }
  const sourceSha = resolveSourceSha({ override: opts.sourceSha, buildSha });
  const dirty = git(['status', '--porcelain']);
  if (dirty) {
    console.warn('[v2-runtime-preview] WARN: working tree is dirty; SOURCE_SHA alone will not describe the artifact bytes');
  }
  const env = sanitizePreviewEnv(process.env);
  env.DANJION_PREVIEW_SOURCE_SHA = sourceSha;
  env.DANJION_PREVIEW_BUILD_SHA = buildSha.slice(0, 12);
  env.DANJION_PREVIEW_BRANCH = branch;
  env.DANJION_PREVIEW_CAPTURED_AT = new Date().toISOString().slice(0, 16).replace('T', ' ');
  console.log(`[v2-runtime-preview] source=${sourceSha.slice(0, 12)} (authority) build=${buildSha.slice(0, 12)} branch=${branch} base=./ mode=COMPARISON_ONLY`);
  runViteBuild(env);
  const distDir = scanBundle();
  writeRegistry({ sourceSha, sourceBranch: branch, buildSha });
  packageMount({ sourceSha, sourceBranch: branch, distDir });
  if (cmd === 'serve') {
    serveMount(opts.port, join(REPO_ROOT, ...GATEWAY_MOUNT_DIR.split('/')));
    return;
  }
  console.log('[v2-runtime-preview] DONE (build only — nothing served, deployed, or merged)');
}

main();
