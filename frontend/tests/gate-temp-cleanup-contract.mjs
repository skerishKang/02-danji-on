import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Issue #355 [Leaf: gate temp lifecycle]: the top-level frontend contract gate must
// leave zero repo-root ".toplevel-frontend-gate-*" directories behind on the PASS path,
// on a forced failing path, and after a hard-killed run is reclaimed by the next run.
// All runtime probes run the gate inside an isolated os.tmpdir() sandbox root so this
// leaf never sweeps or races a concurrently running parent gate's own temp dir.
// Run: node frontend/tests/gate-temp-cleanup-contract.mjs

const GATE = path.join(import.meta.dirname, 'toplevel-frontend-contract-gate.mjs');
const PREFIX = '.toplevel-frontend-gate-';

/* --- source contract: deterministic bounded location + robust cleanup --- */
const src = await import('node:fs/promises').then((m) => m.readFile(GATE, 'utf8'));
assert.ok(src.includes(`TMP_PREFIX = '${PREFIX}'`), 'gate must create the temp dir under the fixed bounded prefix');
assert.ok(src.includes('const sweepStale') && src.includes('sweepStale();\nconst tmp = mkdtempSync'),
  'gate must sweep stale prefix dirs before creating its own (reclaims kill-leaked runs)');
assert.ok(src.includes('const removeTree'), 'gate must use the retrying removeTree cleanup');
assert.ok(/for \(let attempt = 0; attempt < \d+; attempt\+\+\)/.test(src) && src.includes("e.code === 'ENOENT'"),
  'removeTree must retry transient Windows locks (EBUSY/EPERM) and tolerate ENOENT');
assert.ok(src.includes("process.once(sig") && src.includes("['SIGINT', 'SIGTERM']"),
  'gate must clean its temp dir on SIGINT/SIGTERM instead of leaking past finally');
assert.ok(/finally\s*\{\s*removeTree\(tmp\);/.test(src), 'finally must use the robust removeTree');
assert.ok(src.includes('TOPLEVEL_FRONTEND_GATE_PASS') && src.includes('TOPLEVEL_FRONTEND_GATE_FAIL'),
  'gate output contract must remain unchanged');

/* --- sandbox harness --- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prefixDirs = (dir) => readdirSync(dir).filter((n) => n.startsWith(PREFIX));
const retryRemove = (target) => {
  for (let i = 0; i < 10; i++) {
    try { rmSync(target, { recursive: true, force: true }); return; }
    catch (e) { if (e.code === 'ENOENT') return; sleepSync(60); }
  }
  try { rmSync(target, { recursive: true, force: true }); } catch {}
};
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { const until = Date.now() + ms; while (Date.now() < until) {} }
}
function makeSandbox({ failingContract = false, slowContract = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'danjion-gate-temp-355-'));
  mkdirSync(path.join(root, 'frontend', 'assets'), { recursive: true });
  mkdirSync(path.join(root, 'frontend', 'tests'), { recursive: true });
  writeFileSync(path.join(root, 'frontend', 'assets', 'a.js'), 'export const a=1;\n');
  writeFileSync(path.join(root, 'frontend', 'index.html'), '<!doctype html><script>const x=1;</script>\n');
  cpSync(GATE, path.join(root, 'frontend', 'tests', 'toplevel-frontend-contract-gate.mjs'));
  writeFileSync(path.join(root, 'frontend', 'tests', 'dummy-pass-contract.mjs'), "console.log('dummy pass');\n");
  if (failingContract) {
    writeFileSync(path.join(root, 'frontend', 'tests', 'dummy-fail-contract.mjs'), "console.log('forced failure');\nprocess.exit(1);\n");
  }
  if (slowContract) {
    writeFileSync(path.join(root, 'frontend', 'tests', 'dummy-slow-contract.mjs'),
      "if (process.env.DANJION_GATE_SLOW_KILL) { const until = Date.now() + 8000; while (Date.now() < until) {} }\nconsole.log('dummy slow done');\n");
  }
  return root;
}
const runGate = (root, env = {}) => spawnSync(process.execPath, ['frontend/tests/toplevel-frontend-contract-gate.mjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });

/* --- PASS path: exit 0, output contract intact, zero temp dirs remain --- */
const okRoot = makeSandbox();
try {
  const r = runGate(okRoot);
  assert.equal(r.status, 0, `gate PASS run must exit 0:\n${r.stdout || ''}${r.stderr || ''}`);
  assert.ok(r.stdout.includes('TOPLEVEL_FRONTEND_GATE_PASS'), 'gate must keep the PASS output contract');
  assert.ok(r.stdout.includes('checked 1 asset scripts, 1 inline script blocks in 1 html files, 1 leaf contracts'),
    `gate must keep the checked-counts output line, got:\n${r.stdout}`);
  assert.deepEqual(prefixDirs(okRoot), [], 'no temp dir may remain after a PASS run');
} finally { retryRemove(okRoot); }

/* --- forced failure path: failing contract -> exit 1, still zero temp dirs --- */
const failRoot = makeSandbox({ failingContract: true });
try {
  const r = runGate(failRoot);
  assert.equal(r.status, 1, 'gate must still exit 1 when a leaf contract fails');
  assert.ok(r.stderr.includes('TOPLEVEL_FRONTEND_GATE_FAIL'), 'gate must keep the FAIL output contract');
  assert.ok(r.stdout.includes('FAIL contract frontend/tests/dummy-fail-contract.mjs'), 'failing leaf must be reported');
  assert.deepEqual(prefixDirs(failRoot), [], 'no temp dir may remain after a forced failing run');
} finally { retryRemove(failRoot); }

/* --- hard-kill path: leaked dir is reclaimed by the next completed run --- */
const killRoot = makeSandbox({ slowContract: true });
try {
  const child = spawn(process.execPath, ['frontend/tests/toplevel-frontend-contract-gate.mjs'], { cwd: killRoot, env: { ...process.env, DANJION_GATE_SLOW_KILL: '1' } });
  const exited = new Promise((r) => child.once('exit', r));
  let seen = false;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (prefixDirs(killRoot).length >= 1) { seen = true; break; }
    await sleep(25);
  }
  assert.ok(seen, 'the running gate must create its bounded prefix temp dir');
  child.kill('SIGKILL');
  await exited;
  const afterKill = prefixDirs(killRoot);
  assert.ok(afterKill.length >= 1, 'a hard-killed run must demonstrably leak the prefix dir (pre-fix failure mode)');
  const rerun = runGate(killRoot);
  assert.equal(rerun.status, 0, `reclaimed run must pass:\n${rerun.stdout || ''}${rerun.stderr || ''}`);
  assert.deepEqual(prefixDirs(killRoot), [], 'no repo-root temp dir may remain after the next completed run reclaims the leak');
} finally { retryRemove(killRoot); }

console.log('gate-temp-cleanup-contract: PASS');
