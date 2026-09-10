import { readdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Issue #339 [CI governance]: repository-level non-production gate for top-level frontend/**.
// 1) syntax-checks every frontend/assets/**/*.js
// 2) syntax-checks every inline <script> block in every frontend/**/*.html
// 3) runs every frontend/tests/*-contract.mjs leaf contract (when present)
// Zero dependencies, no network, no production mutation.
// Run from repo root: node frontend/tests/toplevel-frontend-contract-gate.mjs

const root = process.cwd();
const FRONTEND = path.join(root, 'frontend');
const SELF = 'toplevel-frontend-contract-gate.mjs';

const walk = (dir, filter) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, filter));
    else if (filter(entry.name)) out.push(p);
  }
  return out;
};

const rel = (p) => path.relative(root, p).replaceAll('\\', '/');
const node = (args) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });

let failures = 0;
const report = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `\n${detail}` : ''}`);
};

// Issue #355 [test-harness lifecycle]: the repo-root temp dir is bounded by this
// fixed prefix. Two real-world leak paths defeated the plain finally-rmSync:
// (1) Windows transient locks (EBUSY/EPERM) -> rmSync throws and leaves the tree;
// (2) SIGINT/SIGTERM kills -> finally never executes, so the next run inherits a
// stale dir. removeTree retries with a short bounded backoff and never masks the
// original error; sweepStale reclaims any prefix dir before this run creates its
// own, so no .toplevel-frontend-gate-* directory remains after a completed run.
// Concurrency note: parallel gate runs in one checkout are not supported (as before).
const TMP_PREFIX = '.toplevel-frontend-gate-';
const sleepSync = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { const until = Date.now() + ms; while (Date.now() < until) {} }
};
const removeTree = (dir) => {
  for (let attempt = 0; attempt < 10; attempt++) {
    try { rmSync(dir, { recursive: true, force: true }); return; }
    catch (e) {
      if (e.code === 'ENOENT') return;
      sleepSync(50 * (attempt + 1));
    }
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
};
const sweepStale = () => {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(TMP_PREFIX)) removeTree(path.join(root, entry.name));
  }
};
sweepStale();
const tmp = mkdtempSync(path.join(root, TMP_PREFIX));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => { removeTree(tmp); process.exit(sig === 'SIGINT' ? 130 : 143); });
}
try {
  const jsFiles = walk(FRONTEND, (n) => n.endsWith('.js'))
    .filter((p) => rel(p).startsWith('frontend/assets/'));
  for (const f of jsFiles) {
    const r = node(['--check', f]);
    report(r.status === 0, `syntax ${rel(f)}`, r.stderr);
  }

  const htmlFiles = walk(FRONTEND, (n) => n.toLowerCase().endsWith('.html'));
  let inlineCount = 0;
  for (const f of htmlFiles) {
    const html = readFileSync(f, 'utf8');
    const re = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m, i = 0;
    while ((m = re.exec(html)) !== null) {
      i++; inlineCount++;
      const p = path.join(tmp, `${path.basename(f)}.s${i}.js`);
      writeFileSync(p, m[1]);
      const r = node(['--check', p]);
      report(r.status === 0, `syntax ${rel(f)} inline#${i}`, r.stderr);
    }
  }

  const testsDir = path.join(FRONTEND, 'tests');
  const contracts = readdirSync(testsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('-contract.mjs') && e.name !== SELF)
    .map((e) => path.join(testsDir, e.name))
    .sort();
  for (const c of contracts) {
    const r = node([c]);
    report(r.status === 0, `contract ${rel(c)}`, `${r.stdout || ''}${r.stderr || ''}`);
  }

  console.log(`checked ${jsFiles.length} asset scripts, ${inlineCount} inline script blocks in ${htmlFiles.length} html files, ${contracts.length} leaf contracts`);
} finally {
  removeTree(tmp);
}

if (failures) {
  console.error(`TOPLEVEL_FRONTEND_GATE_FAIL (${failures} failure(s))`);
  process.exit(1);
}
console.log('TOPLEVEL_FRONTEND_GATE_PASS');
