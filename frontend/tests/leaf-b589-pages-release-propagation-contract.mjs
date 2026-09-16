import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(
  new URL('../../.github/workflows/pages-production-release.yml', import.meta.url),
  'utf8'
);

const delayMatch = workflow.match(/retry_delays=\(([^)]+)\)/);
assert.ok(delayMatch, '#589: production release must declare a bounded leaf propagation retry schedule');

const retryDelays = delayMatch[1]
  .trim()
  .split(/\s+/)
  .map(Number);

assert.deepEqual(
  retryDelays,
  [8, 3, 5, 8, 13, 21, 30, 45],
  '#589: retry schedule must preserve the reviewed settle window and bounded backoff'
);
assert.equal(retryDelays.length, 8, '#589: leaf verification must have eight bounded convergence rounds');
assert.ok(
  retryDelays.reduce((sum, seconds) => sum + seconds, 0) >= 120,
  '#589: leaf propagation budget must exceed the former ~18-second per-leaf window'
);

assert.match(
  workflow,
  /for delay in "\$\{retry_delays\[@\]\}"; do[\s\S]*for i in "\$\{!parity_paths\[@\]\}"; do/,
  '#589: pending leaves must be retried in global convergence rounds'
);
assert.match(
  workflow,
  /if \[ "\$\{leaf_matched\[\$i\]\}" = "1" \]; then[\s\S]*continue/,
  '#589: already converged leaves must not be fetched again'
);
assert.match(
  workflow,
  /release=\$\{GITHUB_SHA\}-leaf-\$\{leaf_round\}-\$\{leaf_tokens\[\$i\]\}/,
  '#589: every target/round fetch must carry a distinct cache-buster'
);
assert.match(
  workflow,
  /--header 'Pragma: no-cache'/,
  '#589: leaf convergence fetches must explicitly discourage stale intermediary cache reuse'
);
assert.match(
  workflow,
  /actual_leaf_sha="HTTP_ERROR"/,
  '#589: transient HTTP failures must stay inside the bounded retry loop instead of aborting immediately'
);
assert.match(
  workflow,
  /Canonical Pages leaf content mismatch after \$\{leaf_round\} attempts:[\s\S]*expected_sha=\$\{expected_leaf_shas\[\$i\]\}; actual_sha=\$\{last_leaf_shas\[\$i\]\}/,
  '#589: permanent mismatches must fail closed with attempt count and both hashes'
);

// Synthetic policy check: a stale edge for two rounds followed by exact bytes
// must converge without requiring a second deployment.
const simulateConvergence = (samples, maxRounds) => {
  let attempts = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    attempts += 1;
    if (samples[round] === 'MATCH') return { matched: true, attempts };
  }
  return { matched: false, attempts };
};

assert.deepEqual(
  simulateConvergence(['STALE', 'STALE', 'MATCH'], retryDelays.length),
  { matched: true, attempts: 3 },
  '#589: synthetic stale-then-converged edge sequence must pass within the retry budget'
);
assert.deepEqual(
  simulateConvergence(Array(retryDelays.length).fill('STALE'), retryDelays.length),
  { matched: false, attempts: retryDelays.length },
  '#589: a permanent stale/mismatched edge must still exhaust the budget and fail closed'
);

console.log('PASS #589 Pages leaf propagation verification is bounded, cache-busted, and fail-closed');
