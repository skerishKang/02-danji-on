#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  LEGACY_GRANDFATHERED_MOUNTED_BUNDLES,
  absoluteRootViolations,
  isLegacyGrandfatheredBundle
} from '../scripts/absolute-root-scanner.mjs';

const jsMutations = [
  'const route = { href:`/auth-recovery.html` };',
  'const route = { href:"/auth-recovery.html" };',
  'const asset = { src:\'/assets/app.js\' };'
];

for (const source of jsMutations) {
  const strict = absoluteRootViolations(source);
  assert.ok(strict.some((violation) => violation.includes('JavaScript')), `strict scanner missed mutation: ${source}`);
  const mutated = source.replace('/auth-recovery.html', './auth-recovery.html').replace('/assets/app.js', './assets/app.js');
  assert.deepEqual(absoluteRootViolations(mutated), [], `safe relative mutation still failed: ${mutated}`);
}

assert.deepEqual(
  absoluteRootViolations('<a href="/legacy.html">legacy</a>', { legacy: true }),
  ['absolute-root HTML src/href'],
  'legacy mode must not weaken the existing HTML rule'
);
assert.deepEqual(
  absoluteRootViolations('body{background:url("/legacy.png")}', { legacy: true }),
  ['absolute-root CSS url()'],
  'legacy mode must not weaken the existing CSS rule'
);

assert.deepEqual(LEGACY_GRANDFATHERED_MOUNTED_BUNDLES, ['v2-runtime', 'v2-runtime-post984']);
assert.equal(isLegacyGrandfatheredBundle('v2-runtime'), true);
assert.equal(isLegacyGrandfatheredBundle('v2-runtime-post984'), true);
assert.equal(isLegacyGrandfatheredBundle('future-runtime'), false);

console.log('absolute-root-scanner-1009-contract: PASS');
console.log(`mutations=${jsMutations.length}; grandfathered=${LEGACY_GRANDFATHERED_MOUNTED_BUNDLES.join(',')}; future=strict`);
