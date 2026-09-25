import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const backendRoot = new URL('../', import.meta.url);
const workflowsRoot = new URL('../../.github/workflows/', backendRoot);
const inputExpression = '${{ inputs.expected_main }}';
const environmentExpression = 'EXPECTED_MAIN: ${{ inputs.expected_main }}';
const shaPattern = /^[0-9a-fA-F]{40}$/;

function assertExpectedMain(value) {
  if (!shaPattern.test(value)) {
    throw new Error(`expected_main must be a 40-character hexadecimal SHA: ${String(value)}`);
  }
}

function assertProductionBootstrapAuthority(source) {
  assert.match(source, /workflow_dispatch:/, 'Production Worker bootstrap must remain manually dispatchable');
  assert.match(
    source,
    /if: github\.event_name == 'workflow_dispatch' && inputs\.confirm_production/,
    'Production mutation must require workflow_dispatch and confirm_production'
  );
  assert.doesNotMatch(source, /^  push:/m, 'Production Worker bootstrap must not have a push trigger');
  assert.doesNotMatch(source, /\[production-bootstrap\]/, 'commit markers must never authorize Production deployment');
  assert.doesNotMatch(source, /github\.event_name == 'push'/, 'push events must never authorize Production deployment');
  assert.match(source, /npm ci --ignore-scripts/, 'Production backend install must use the committed lockfile');
  assert.doesNotMatch(source, /npm install --ignore-scripts/, 'Production backend install must not be mutable');
}

function assertExpectedMainWorkflowBoundary(file, source) {
  if (!source.includes('expected_main:') && !source.includes(inputExpression)) return;

  assert.ok(
    source.includes(environmentExpression),
    `${file}: expected_main must be assigned to EXPECTED_MAIN at a YAML environment boundary`
  );

  const withoutBoundary = source.replace(
    /^\s*EXPECTED_MAIN: \$\{\{\s*inputs\.expected_main\s*\}\}\s*$/gm,
    ''
  );
  assert.doesNotMatch(
    withoutBoundary,
    /\$\{\{\s*inputs\.expected_main\s*\}\}/,
    `${file}: expected_main must not be interpolated directly into workflow source`
  );
  assert.match(
    source,
    /\^\[0-9a-fA-F\]\{40\}\$/,
    `${file}: expected_main must be validated as exactly 40 hexadecimal characters`
  );
  assert.match(
    source,
    /\$\{EXPECTED_MAIN\}/,
    `${file}: shell logic must consume the environment-bound expected_main value`
  );
}

const workflowFiles = (await readdir(workflowsRoot)).filter((file) => file.endsWith('.yml')).sort();
let expectedMainWorkflowCount = 0;
for (const file of workflowFiles) {
  const source = await readFile(new URL(file, workflowsRoot), 'utf8');
  if (source.includes('expected_main:') || source.includes(inputExpression)) expectedMainWorkflowCount += 1;
  assertExpectedMainWorkflowBoundary(file, source);
  assert.doesNotMatch(source, /npm install --ignore-scripts/, `${file}: checked-in-lockfile lanes must not use mutable npm install`);
}
assert.equal(expectedMainWorkflowCount, 33, '#1007: the audited expected_main workflow set must not silently shrink');

for (const file of ['backend-ci.yml', 'verification-ci.yml']) {
  const source = await readFile(new URL(file, workflowsRoot), 'utf8');
  assert.match(source, /npm ci --ignore-scripts/, `${file}: backend dependency installation must be deterministic`);
}

const productionBootstrap = await readFile(new URL('production-worker-bootstrap.yml', workflowsRoot), 'utf8');
assertProductionBootstrapAuthority(productionBootstrap);

// Runtime validator: malformed, short, non-hex, and suffixed values must fail closed.
assert.doesNotThrow(() => assertExpectedMain('a'.repeat(40)));
assert.doesNotThrow(() => assertExpectedMain('ABCDEF0123456789abcdef0123456789ABCDEF01'));
for (const malformed of ['', 'main', 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), `${'a'.repeat(40)}; echo unsafe`]) {
  assert.throws(() => assertExpectedMain(malformed), /expected_main must be a 40-character hexadecimal SHA/);
}

// Mutation battery: every prohibited regression must make the source contract fail.
const pushMutation = productionBootstrap.replace(
  'workflow_dispatch:',
  "push:\n    branches: [main]\n\n  workflow_dispatch:"
);
assert.notEqual(pushMutation, productionBootstrap, 'push-trigger mutation must modify the fixture');
assert.throws(() => assertProductionBootstrapAuthority(pushMutation), /must not have a push trigger/);

const markerMutation = productionBootstrap.replace(
  'if: github.event_name == \'workflow_dispatch\' && inputs.confirm_production',
  "if: contains(github.event.head_commit.message, '[production-bootstrap]')"
);
assert.notEqual(markerMutation, productionBootstrap, 'marker-authority mutation must modify the fixture');
assert.throws(() => assertProductionBootstrapAuthority(markerMutation), /workflow_dispatch and confirm_production/);

const directSpliceMutation = productionBootstrap.replace(
  'authorized_main="${EXPECTED_MAIN}"',
  "authorized_main=\"${{ inputs.expected_main }}\""
);
assert.notEqual(directSpliceMutation, productionBootstrap, 'direct-splice mutation must modify the fixture');
assert.throws(() => assertExpectedMainWorkflowBoundary('production-worker-bootstrap.yml', directSpliceMutation), /must not be interpolated directly/);

const malformedValidationMutation = productionBootstrap.replaceAll(
  '^[0-9a-fA-F]{40}$',
  '^[0-9a-fA-F]*$'
);
assert.notEqual(malformedValidationMutation, productionBootstrap, 'malformed-SHA mutation must modify the fixture');
assert.throws(
  () => assertExpectedMainWorkflowBoundary('production-worker-bootstrap.yml', malformedValidationMutation),
  /exactly 40 hexadecimal characters/
);

console.log('Production workflow security contract: PASS');
