#!/usr/bin/env node
/**
 * DanjiOn Test Manifest Runner
 *
 * Deterministic executor for 04_開発/test-runner.manifest.json. It replaces the
 * backend `check` and frontend `typecheck` shell `&&` mega-chains with a single
 * ordered manifest so suites can be appended without growing a shell chain.
 *
 * Modes:
 *   run --scope backend|frontend|all   Execute ordered run steps (fail-fast).
 *   --list  [--scope backend|frontend|all]
 *                                    Print the ordered suite map (run + ci_only).
 *   --check                          Validate manifest integrity; execute nothing.
 *
 * Invariants:
 *   - deterministic order (manifest array order is the source of truth)
 *   - fail-fast: the first non-zero step stops the run and its exit code propagates
 *   - no `&&`/`||`/`;` shell operators anywhere in a step
 *   - no silent skip: every step must resolve to an executable command
 *   - ci_only steps are inventory-only and are NEVER executed here
 *   - no migration / network / db-execution command is permitted in a run step
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url)); // .../04_개발/scripts
const AREA_DIR = dirname(SCRIPT_DIR); // .../04_開発
const REPO_ROOT = dirname(AREA_DIR); // worktree/repo root (packageDir is relative to this)
const MANIFEST_PATH = join(AREA_DIR, 'test-runner.manifest.json');
const SCHEMA_ID = 'danjion-test-runner-manifest-v1';

class ManifestError extends Error {}

function loadManifest() {
  let raw;
  try {
    raw = readFileSync(MANIFEST_PATH, 'utf8');
  } catch (e) {
    throw new ManifestError(`cannot read manifest at ${MANIFEST_PATH}: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new ManifestError(`manifest is not valid JSON: ${e.message}`);
  }
}

function scopePkgDir(manifest, scopeName) {
  const sc = manifest.scopes[scopeName];
  if (!sc) throw new ManifestError(`unknown scope: ${scopeName}`);
  return join(REPO_ROOT, sc.packageDir);
}

function readPackageScripts(manifest, scopeName) {
  const pkgDir = scopePkgDir(manifest, scopeName);
  const pkgPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new ManifestError(`package.json not found for scope ${scopeName}: ${pkgPath}`);
  }
  return { pkg: JSON.parse(readFileSync(pkgPath, 'utf8')), pkgDir };
}

function stepLabel(step) {
  if (step.npm) return `npm run ${step.npm}`;
  if (step.command) return step.command;
  throw new ManifestError(`step ${step.id} has neither npm nor command`);
}

// Unambiguous execution verbs that must never appear in a run step's command body.
const FORBIDDEN = /\bpsql\b|\bmigrate\s+(deploy|latest|up|apply|down|undo)\b|migration:|knex|prisma\s+migrate|\bcurl\b|\bwget\b|https?:\/\//i;

function validate(manifest) {
  const problems = [];
  if (manifest.$schema !== SCHEMA_ID) {
    problems.push(`unexpected $schema: ${manifest.$schema} (expected ${SCHEMA_ID})`);
  }
  if (!manifest.scopes || !manifest.scopes.backend || !manifest.scopes.frontend) {
    problems.push('scopes.backend and scopes.frontend are required');
  }
  for (const scopeName of Object.keys(manifest.scopes || {})) {
    const sc = manifest.scopes[scopeName];
    if (!sc.packageDir) problems.push(`scope ${scopeName}: packageDir required`);
    if (!sc.publicScript) problems.push(`scope ${scopeName}: publicScript required`);
    if (!Array.isArray(sc.run) || sc.run.length === 0) {
      problems.push(`scope ${scopeName}: run[] required and non-empty`);
      continue;
    }
    let pkg;
    try {
      ({ pkg } = readPackageScripts(manifest, scopeName));
    } catch (e) {
      problems.push(`scope ${scopeName}: ${e.message}`);
      continue;
    }
    const scripts = pkg.scripts || {};
    const seen = new Set();
    for (const step of sc.run) {
      if (!step.id) problems.push(`scope ${scopeName}: step missing id`);
      if (seen.has(step.id)) problems.push(`scope ${scopeName}: duplicate step id ${step.id}`);
      seen.add(step.id);
      if (!step.npm && !step.command) {
        problems.push(`scope ${scopeName}: step ${step.id} is not executable (no silent skip)`);
        continue;
      }
      if (step.npm === sc.publicScript) {
        problems.push(`scope ${scopeName}: step ${step.id} re-invokes public entrypoint ${sc.publicScript} (recursion)`);
      }
      if (step.npm && !Object.prototype.hasOwnProperty.call(scripts, step.npm)) {
        problems.push(`scope ${scopeName}: step ${step.id} references missing npm script "${step.npm}"`);
      }
      const effective = step.command || (step.npm ? scripts[step.npm] : '');
      if (/&&|\|\||[;|`$()]/.test(effective || '')) {
        problems.push(`scope ${scopeName}: step ${step.id} must be a single command (no shell operators): ${effective}`);
      }
      if (FORBIDDEN.test(effective || '')) {
        problems.push(`scope ${scopeName}: step ${step.id} command not allowed (migration/network/db): ${effective}`);
      }
    }
  }
  // ci_only inventory must not leak into any run scope.
  for (const scopeName of Object.keys(manifest.scopes || {})) {
    const runIds = new Set((manifest.scopes[scopeName].run || []).map((s) => s.id));
    for (const ci of manifest.ci_only?.[scopeName]?.steps || []) {
      if (runIds.has(ci.id)) {
        problems.push(`scope ${scopeName}: ci_only step ${ci.id} also present in run[]`);
      }
    }
  }
  return problems;
}

function runStep(step, pkgDir) {
  let cmd;
  let args;
  if (step.npm) {
    cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    args = ['run', step.npm];
  } else {
    const parts = step.command.trim().split(/\s+/);
    cmd = parts[0];
    args = parts.slice(1);
  }
  const useShell = process.platform === 'win32'; // npm.cmd requires the Windows command shim.
  return spawnSync(cmd, args, { cwd: pkgDir, stdio: 'inherit', shell: useShell });
}

function runScope(manifest, scopeName) {
  const sc = manifest.scopes[scopeName];
  const { pkgDir } = readPackageScripts(manifest, scopeName);
  const problems = validate(manifest);
  if (problems.length) {
    process.stderr.write(`Manifest integrity check failed:\n - ${problems.join('\n - ')}\n`);
    return 1;
  }
  const run = sc.run;
  for (let i = 0; i < run.length; i++) {
    const step = run[i];
    process.stdout.write(`\n[test-runner ${scopeName}] (${i + 1}/${run.length}) ${step.id} -> ${stepLabel(step)}\n`);
    const res = runStep(step, pkgDir);
    if (res.error) {
      process.stderr.write(`  spawn error for ${step.id}: ${res.error.message}\n`);
      return 1;
    }
    if (res.signal) {
      process.stderr.write(`\n[test-runner ${scopeName}] step ${step.id} terminated by signal ${res.signal}\n`);
      return 1;
    }
    if (typeof res.status === 'number' && res.status !== 0) {
      process.stderr.write(`\n[test-runner ${scopeName}] FAIL-FAST at (${i + 1}/${run.length}) ${step.id} (exit ${res.status})\n`);
      return res.status; // exact child exit propagation
    }
  }
  process.stdout.write(`\n[test-runner ${scopeName}] PASS (${run.length}/${run.length} steps)\n`);
  return 0;
}

function listScopes(manifest, scopeArg) {
  const scopes = scopeArg === 'all' ? Object.keys(manifest.scopes) : [scopeArg];
  const lines = [];
  for (const s of scopes) {
    const sc = manifest.scopes[s];
    if (!sc) {
      lines.push(`# unknown scope: ${s}`);
      continue;
    }
    lines.push(`# scope ${s}  packageDir=${sc.packageDir}  publicScript=${sc.publicScript}`);
    sc.run.forEach((step, i) => {
      lines.push(`${String(i + 1).padStart(3)}. [run]      ${step.id}  ->  ${stepLabel(step)}`);
    });
    const ciBlock = manifest.ci_only?.[s];
    const runner = ciBlock?.runner || 'sh';
    for (const ci of ciBlock?.steps || []) {
      lines.push(`      [ci_only]  ${ci.id}  ->  ${runner} ${ci.sh}  (job: ${ci.job})`);
    }
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const mode = args[0];
  let scope = 'all';
  const si = args.indexOf('--scope');
  if (si >= 0 && args[si + 1]) scope = args[si + 1];
  return { mode, scope };
}

function main() {
  const { mode, scope } = parseArgs(process.argv);
  let manifest;
  try {
    manifest = loadManifest();
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
    return;
  }
  try {
    if (mode === '--check' || mode === 'check') {
      const problems = validate(manifest);
      if (problems.length) {
        process.stderr.write(`MANIFEST CHECK: FAIL\n - ${problems.join('\n - ')}\n`);
        process.exitCode = 1;
        return;
      }
      for (const s of Object.keys(manifest.scopes)) {
        const run = manifest.scopes[s].run.length;
        const ci = (manifest.ci_only?.[s]?.steps || []).length;
        process.stdout.write(`  ${s}: run=${run} ci_only=${ci}\n`);
      }
      process.stdout.write('MANIFEST CHECK: PASS\n');
      return;
    }
    if (mode === '--list' || mode === 'list') {
      listScopes(manifest, scope);
      return;
    }
    if (mode === 'run') {
      const scopes = scope === 'all' ? Object.keys(manifest.scopes) : [scope];
      for (const s of scopes) {
        if (!manifest.scopes[s]) {
          process.stderr.write(`unknown scope: ${s}\n`);
          process.exitCode = 1;
          return;
        }
      }
      for (const s of scopes) {
        const code = runScope(manifest, s);
        if (code !== 0) {
          process.exitCode = code;
          return;
        }
      }
      process.exitCode = 0;
      return;
    }
    process.stderr.write(
      'usage: test-manifest-runner.mjs <run --scope backend|frontend|all | --list | --check>\n',
    );
    process.exitCode = 2;
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
  }
}

main();
