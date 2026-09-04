import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const devDir = path.resolve(scriptDir, '..');
const frontendDir = path.resolve(devDir, 'frontend');
const args = new Set(process.argv.slice(2));
const releaseMode = args.has('--release') || process.env.DANJION_V2_GATE_MODE === 'release';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// CURRENT VISUAL AUTHORITY — 008 integrated frontend / 04 daily home, 2026-09-04.
const fixedSource = {
  fileId: '1j0f5-UyK012HKuny4xsbZchbYXJ3oVsX',
  sha256: '267F6BAC8EF83A4AAC85D7D3C69A68A3901F652F2B59003C735575245C487110'
};

const requirements = {
  A: [
    'frontend/src/v2/visual',
    'frontend/src/v2/v2-visual.css'
  ],
  B: [
    'frontend/src/v2/V2App.tsx',
    'frontend/src/v2/flows',
    'frontend/src/v2/v2-flow.css'
  ],
  C: [
    'frontend/src/ui-variant.tsx',
    'frontend/src/gateway/GatewayApp.tsx',
    'frontend/src/main.tsx'
  ],
  D: [
    'frontend/tests/v2-fidelity.spec.ts',
    'frontend/tests/v2-product-flow.spec.ts',
    'frontend/tests/v2-responsive-accessibility.spec.ts',
    'frontend/tests/v2-visual-contrast.spec.ts',
    'frontend/tests/v2-gateway-safety.spec.ts',
    'frontend/tests/v2-v1-safety.spec.ts',
    'frontend/tests/v2/reference-contract.ts',
    'frontend/tests/v2/playwright.v2.config.ts',
    'docs/v2/V2_PARITY_MATRIX.md',
    'docs/v2/V2_QA_GATE.md'
  ]
};

const blockers = [];
for (const [track, relativePaths] of Object.entries(requirements)) {
  const missing = relativePaths.filter((relative) => !existsSync(path.resolve(devDir, relative)));
  if (missing.length) blockers.push({ track, missing });
}

const mainPath = path.resolve(frontendDir, 'src/main.tsx');
if (existsSync(mainPath)) {
  const main = readFileSync(mainPath, 'utf8');
  if (/v2\s*=\s*\{?\s*<V2IntegrationPending\b/.test(main)) {
    blockers.push({ track: 'C+B', missing: ['main.tsx still mounts V2IntegrationPending instead of integrated V2App'] });
  }
}

console.log(`[V2 QA] current visual source id=${fixedSource.fileId}`);
console.log(`[V2 QA] current visual source sha256=${fixedSource.sha256}`);
if (blockers.length) {
  for (const blocker of blockers) {
    console.log(`BLOCKED_V2_${blocker.track}: ${blocker.missing.join('; ')}`);
  }
  console.log('V2_D_QA_CONTRACT_READY: QA contract exists, but fidelity PASS is forbidden until A/B/C are integrated.');
  process.exit(releaseMode ? 3 : 0);
}

const run = (command, commandArgs, env = {}) => {
  console.log(`\n[V2 QA] ${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, {
    cwd: frontendDir,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (!existsSync(path.resolve(frontendDir, 'node_modules/@playwright/test'))) {
  run(npm, ['install', '--ignore-scripts']);
}

run(npm, ['run', 'typecheck']);

// Existing V1 suite is intentionally run unchanged with the variant unset.
const v1Env = { ...process.env };
delete v1Env.VITE_UI_VARIANT;
console.log('\n[V2 QA] existing V1 Playwright suite with VITE_UI_VARIANT unset');
const v1 = spawnSync(npx, ['playwright', 'test', '--config=playwright.config.ts'], {
  cwd: frontendDir,
  env: v1Env,
  stdio: 'inherit'
});
if (v1.status !== 0) process.exit(v1.status ?? 1);

const config = 'tests/v2/playwright.v2.config.ts';
run(npx, ['playwright', 'test', `--config=${config}`], { DANJION_V2_TARGET_VARIANT: 'v1' });
run(npx, ['playwright', 'test', `--config=${config}`], { DANJION_V2_TARGET_VARIANT: 'invalid' });
run(npx, ['playwright', 'test', `--config=${config}`], {
  DANJION_V2_TARGET_VARIANT: 'gateway',
  DANJION_EXPECTED_V1_URL: 'http://127.0.0.1:4181/',
  DANJION_EXPECTED_V2_URL: 'http://127.0.0.1:4182/'
});
run(npx, ['playwright', 'test', `--config=${config}`], { DANJION_V2_TARGET_VARIANT: 'v2' });

console.log('\nV2_FIDELITY_GATE_PASS');
console.log('This PASS is valid only for the integrated A/B/C/D commit that executed this script; it does not imply production readiness.');