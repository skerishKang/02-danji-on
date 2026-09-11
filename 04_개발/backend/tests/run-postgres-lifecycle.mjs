#!/usr/bin/env node
// #383 Windows-native portability shim.
//
// The Postgres lifecycle helpers under tests/*.sh are POSIX bash scripts.
// On Windows, a bare `bash` on PATH usually resolves to
// C:\Windows\System32\bash.exe, which is the WSL launcher, not a native
// Windows shell. Running the lifecycle suite through WSL is explicitly NOT
// an accepted portability proof.
//
// This shim resolves a real bash interpreter and executes one lifecycle
// script with it. It is a thin process-spawn portability helper, not a test
// runner: it discovers no suites, parses no manifests, and does not replace
// the POSIX `bash tests/...` invocation used by Linux CI.
//
// Usage:
//   node tests/run-postgres-lifecycle.mjs <script.sh> [args...]
//
// Resolution order on win32:
//   1. DANJION_BASH environment override (must not be the WSL launcher).
//   2. Git Bash derived from `git --exec-path` (bin/bash.exe, usr/bin/bash.exe).
//   3. Common Git for Windows install roots.
//   4. A `bash` on PATH that is NOT under C:\Windows (the WSL trap).
// On POSIX it simply uses `bash` from PATH.

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const IS_WINDOWS = process.platform === 'win32';
const WSL_BASH = /^[A-Z]:[\\/]Windows[\\/](System32|SysWOW64)[\\/]bash\.exe$/i;

function gitBashCandidates() {
  const candidates = [];
  try {
    const execPath = execFileSync('git', ['--exec-path'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    // .../Git/mingw64/libexec/git-core -> .../Git
    const marker = /[\\/]mingw64[\\/]libexec[\\/]git-core$/i;
    if (marker.test(execPath)) {
      const gitRoot = execPath.replace(marker, '');
      candidates.push(join(gitRoot, 'bin', 'bash.exe'));
      candidates.push(join(gitRoot, 'usr', 'bin', 'bash.exe'));
    }
  } catch {
    // git not on PATH; fall through to static roots.
  }
  for (const root of [
    'C:\\Program Files\\Git',
    'C:\\Program Files (x86)\\Git',
    'G:\\Program Files\\Git',
  ]) {
    candidates.push(join(root, 'bin', 'bash.exe'));
    candidates.push(join(root, 'usr', 'bin', 'bash.exe'));
  }
  return candidates;
}

function whichBash() {
  try {
    const out = execFileSync('where.exe', ['bash'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function resolveBash() {
  if (!IS_WINDOWS) {
    return { bash: 'bash', source: 'PATH (POSIX)' };
  }

  const override = process.env.DANJION_BASH;
  if (override) {
    if (WSL_BASH.test(override)) {
      return { error: `DANJION_BASH points at the WSL launcher (${override}); set it to Git Bash instead.` };
    }
    if (!existsSync(override)) {
      return { error: `DANJION_BASH is set but does not exist: ${override}` };
    }
    return { bash: override, source: 'DANJION_BASH' };
  }

  for (const candidate of gitBashCandidates()) {
    if (existsSync(candidate)) {
      return { bash: candidate, source: 'Git Bash' };
    }
  }

  for (const found of whichBash()) {
    if (WSL_BASH.test(found)) continue;
    if (existsSync(found)) {
      return { bash: found, source: 'PATH (non-WSL)' };
    }
  }

  return {
    error:
      'No Windows-native bash found. Install Git for Windows (which provides Git Bash) ' +
      'or set DANJION_BASH to your bash.exe. The WSL launcher (C:\\Windows\\System32\\bash.exe) ' +
      'is intentionally rejected.',
  };
}

function main() {
  const [scriptArg, ...rest] = process.argv.slice(2);
  if (!scriptArg) {
    console.error('usage: node tests/run-postgres-lifecycle.mjs <script.sh> [args...]');
    process.exit(2);
  }

  const resolved = resolveBash();
  if (resolved.error) {
    console.error(`BLOCKED: ${resolved.error}`);
    process.exit(20);
  }

  const scriptPath = resolve(process.cwd(), scriptArg);
  if (!existsSync(scriptPath)) {
    console.error(`BLOCKED: lifecycle script not found: ${scriptPath}`);
    process.exit(21);
  }

  // Git Bash accepts forward-slash paths; spawnSync passes argv without a
  // shell, so no manual quoting/injection surface is introduced.
  const bashScriptArg = IS_WINDOWS ? scriptPath.replace(/\\/g, '/') : scriptPath;

  console.log(`[run-postgres-lifecycle] bash: ${resolved.bash} (${resolved.source})`);
  const result = spawnSync(resolved.bash, [bashScriptArg, ...rest], {
    stdio: 'inherit',
    env: process.env,
    shell: false,
  });

  if (result.error) {
    console.error(`BLOCKED: failed to launch bash: ${result.error.message}`);
    process.exit(22);
  }
  process.exit(result.status ?? 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
