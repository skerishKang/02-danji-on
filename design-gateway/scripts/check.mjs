#!/usr/bin/env node
/**
 * Ordered fail-fast check runner for the design gateway (mirrors the
 * 04_개발 manifest-runner principle: deterministic order, no shell chains).
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { GATEWAY_ROOT } from './registry-lib.mjs';

const STEPS = [
  'tests/registry-contract.mjs',
  'tests/integration-contract.mjs',
  'tests/safety-contract.mjs'
];

for (const step of STEPS) {
  const result = spawnSync(process.execPath, [join(GATEWAY_ROOT, step)], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`check: FAIL at ${step}`);
    process.exit(result.status ?? 1);
  }
}
console.log(`check: PASS (${STEPS.length} contracts)`);
