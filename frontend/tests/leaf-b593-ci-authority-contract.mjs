import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(
  new URL('../../.github/workflows/v2-integration-gate.yml', import.meta.url),
  'utf8'
);

assert.match(workflow, /^name: Legacy V2 Regression Gate$/m,
  '#593: workflow display name must explicitly say legacy regression');
assert.doesNotMatch(workflow, /^name: V2 Integration Gate$/m,
  '#593: ambiguous V2 Integration Gate name must not return');

assert.doesNotMatch(workflow, /- '04_개발\/frontend\/\*\*'/,
  '#593: broad 04_개발/frontend/** trigger would make V3-only edits launch the legacy V2 gate');

for (const required of [
  "04_개발/frontend/src/v2/**",
  "04_개발/frontend/src/gateway/**",
  "04_개발/frontend/src/ui-variant.tsx",
  "04_개발/frontend/src/main.tsx",
  "04_개발/frontend/tests/v2/**",
  "04_개발/frontend/tests/v2-*.spec.ts",
  "04_개발/frontend/tests/v2-*-contract.mjs",
  "04_개발/scripts/v2-*",
  "04_개발/docs/v2/**"
]) {
  assert.ok(workflow.includes(`- '${required}'`), `#593: missing actual legacy V2 trigger: ${required}`);
}

for (const forbidden of [
  "04_개발/frontend/e2e-top-level-v3/**",
  "04_개발/frontend/playwright-top-level-v3.config.ts",
  "frontend/**"
]) {
  assert.ok(!workflow.includes(`- '${forbidden}'`),
    `#593: current canonical V3 authority must not be owned by legacy V2 gate: ${forbidden}`);
}

assert.match(workflow, /Role: legacy compatibility\/regression safety only; NOT current design authority/,
  '#593: summary must state the gate is not design authority');
assert.match(workflow, /Canonical design authority: sibling latest V3 \(`frontend\/\*\*`\) — NOT this workflow/,
  '#593: summary must point to current canonical V3 authority');
assert.match(workflow, /Production readiness: NOT CLAIMED/,
  '#593: legacy regression pass must not imply production readiness');

const v3Gate = await readFile(
  new URL('../../.github/workflows/toplevel-v3-browser-gate.yml', import.meta.url),
  'utf8'
);
assert.match(v3Gate, /^name: Canonical V3 Browser Runtime Gate$/m,
  '#593: canonical V3 browser gate must remain the primary runtime gate');
assert.match(v3Gate, /- 'frontend\/\*\*'/,
  '#593: canonical V3 browser gate must continue to own frontend/** changes');
assert.match(v3Gate, /04_개발\/frontend\/e2e-top-level-v3\/\*\*/,
  '#593: V3 browser test edits must stay under the V3 gate');

console.log('PASS #593 CI naming/path authority: sibling latest V3 is canonical; V2 is legacy regression only');
