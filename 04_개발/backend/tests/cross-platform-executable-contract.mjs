/**
 * Executable contract for the supported local runner surface.
 *
 * This intentionally does not require every shell helper to become JavaScript.
 * It enforces the partition between the four supported local lifecycle entry
 * points and the bash-only CI inventory, then checks the process-launching
 * invariants that make the local surface portable on Windows.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(here, '..');
const areaDir = resolve(backendDir, '..');
const repoRoot = resolve(areaDir, '..');
const manifestPath = join(areaDir, 'test-runner.manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const backendPackage = JSON.parse(readFileSync(join(backendDir, 'package.json'), 'utf8'));
const runnerSource = readFileSync(join(areaDir, 'scripts', 'test-manifest-runner.mjs'), 'utf8');
const lifecycleLauncherSource = readFileSync(join(backendDir, 'tests', 'run-postgres-lifecycle.mjs'), 'utf8');

const portableLocal = manifest.portable_local?.backend;
const ciOnly = manifest.ci_only?.backend;
assert.ok(portableLocal, 'portable_local.backend classification is required');
assert.ok(ciOnly, 'ci_only.backend classification is required');
assert.equal(portableLocal.launcher, 'tests/run-postgres-lifecycle.mjs');
assert.match(portableLocal.launcher, /^tests\/[A-Za-z0-9._-]+\.mjs$/);
assert.ok(!portableLocal.launcher.includes('\\'), 'portable launcher must use forward-slash paths');
assert.ok(!portableLocal.launcher.startsWith('/'), 'portable launcher must be repository-relative');

const shellFiles = readdirSync(join(backendDir, 'tests'))
  .filter((name) => name.endsWith('.sh'))
  .sort()
  .map((name) => `tests/${name}`);
const portableShells = [...portableLocal.shell_scripts].sort();
const ciShells = ciOnly.steps.map((step) => step.sh).sort();

assert.deepEqual(
  portableShells.concat(ciShells).sort(),
  shellFiles,
  'every backend shell helper must be classified exactly once',
);
assert.equal(new Set(portableShells).size, portableShells.length, 'duplicate portable shell classification');
assert.equal(new Set(ciShells).size, ciShells.length, 'duplicate ci_only shell classification');
assert.ok(portableShells.length > 0, 'portable local shell classification is empty');
assert.ok(ciShells.length > 0, 'ci_only shell classification is empty');

for (const shellPath of portableShells.concat(ciShells)) {
  assert.match(shellPath, /^tests\/[A-Za-z0-9._-]+\.sh$/);
  assert.ok(!shellPath.includes('\\'), `shell path must use forward slashes: ${shellPath}`);
  assert.ok(readFileSync(join(backendDir, shellPath)), `missing shell helper: ${shellPath}`);
}

const localScriptNames = portableLocal.npm_scripts;
assert.deepEqual(
  localScriptNames.slice().sort(),
  [
    'test:application-documents-owner-list-postgres-lifecycle',
    'test:business-application-photos-044-lifecycle',
    'test:complex-news-channel-040-lifecycle',
    'test:report-rb-postgres-lifecycle',
  ].sort(),
  'supported local npm entrypoint inventory changed',
);

for (const scriptName of localScriptNames) {
  const command = backendPackage.scripts?.[scriptName];
  assert.match(
    command,
    /^node tests\/run-postgres-lifecycle\.mjs tests\/[A-Za-z0-9._-]+\.sh$/,
    `${scriptName} must use the portable lifecycle launcher without a shell chain`,
  );
  const shellPath = command.match(/(tests\/[^ ]+\.sh)$/)?.[1];
  assert.ok(portableShells.includes(shellPath), `${scriptName} must target portable_local shell ${shellPath}`);
}

const runIds = new Set(manifest.scopes.backend.run.map((step) => step.id));
for (const step of ciOnly.steps) {
  assert.ok(!runIds.has(step.id), `ci_only step leaked into backend manifest run: ${step.id}`);
  assert.ok(!localScriptNames.includes(step.id), `ci_only step exposed as a supported local npm entrypoint: ${step.id}`);
}

// F8 runner contract: npm is launched with argv, not a shell command string.
// Windows uses npm.cmd; Node requires the Windows command shim to use the
// platform shell, but manifest steps still cannot contain shell operators.
assert.match(runnerSource, /process\.platform === ['"]win32['"] \? ['"]npm\.cmd['"] : ['"]npm['"]/);
assert.match(runnerSource, /spawnSync\(cmd, args, \{ cwd: pkgDir, stdio: 'inherit', shell: useShell \}\)/);
assert.match(runnerSource, /const useShell = process\.platform === 'win32'/);
for (const scope of Object.values(manifest.scopes)) {
  assert.match(scope.packageDir, /^04_개발\/[A-Za-z0-9._-]+$/);
  assert.ok(!scope.packageDir.includes('\\'), 'manifest packageDir must use forward slashes');
  for (const step of scope.run) {
    const effective = step.command || `npm run ${step.npm}`;
    assert.doesNotMatch(effective, /&&|\|\||;/, `raw shell chaining in ${step.id}`);
  }
}

// #383 launcher contract: native Git Bash only, no WSL fallback, argv-safe
// path passing, and an explicit no-shell child process.
assert.match(lifecycleLauncherSource, /process\.platform === ['"]win32['"]/);
assert.match(lifecycleLauncherSource, /System32\|SysWOW64/);
assert.match(lifecycleLauncherSource, /spawnSync\(resolved\.bash, \[bashScriptArg, \.\.\.rest\]/);
assert.match(lifecycleLauncherSource, /shell: false/);
assert.match(lifecycleLauncherSource, /scriptPath\.replace\(\/\\\\\/g, '\/'\)/);
assert.match(lifecycleLauncherSource, /pathToFileURL/);

// Workflow bash invocations may remain CI-only, but every referenced backend
// shell helper must be in the explicit CI inventory or local inventory.
const workflowDir = join(repoRoot, '.github', 'workflows');
const workflowFiles = readdirSync(workflowDir).filter(
  (name) => name.endsWith('.yml') || name.endsWith('.yaml'),
);
const workflowShellRefs = new Set();
for (const workflowFile of workflowFiles) {
  const source = readFileSync(join(workflowDir, workflowFile), 'utf8');
  for (const match of source.matchAll(/\bbash(?:\s+-n)?\s+([^\s'"`]+\.sh)/g)) {
    const raw = match[1].replaceAll('\\', '/');
    const marker = '04_개발/backend/';
    const normalized = raw.includes(marker) ? raw.slice(raw.indexOf(marker) + marker.length) : raw;
    if (normalized.startsWith('tests/')) workflowShellRefs.add(normalized);
  }
}
for (const shellPath of workflowShellRefs) {
  assert.ok(
    portableShells.includes(shellPath) || ciShells.includes(shellPath),
    `workflow shell invocation is unclassified: ${shellPath}`,
  );
}

process.stdout.write(
  `cross-platform-executable-contract: PASS local_shells=${portableShells.length} ci_only_shells=${ciShells.length} workflow_shells=${workflowShellRefs.size}\n`,
);
