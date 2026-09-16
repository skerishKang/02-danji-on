import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [promotion, legacy, consistency, home] = await Promise.all([
  readFile(new URL('README_V3_PROMOTION_20260906.md', root), 'utf8'),
  readFile(new URL('01_이웃가게_발견.html', root), 'utf8'),
  readFile(new URL('assets/consistency.js', root), 'utf8'),
  readFile(new URL('04_데일리홈.html', root), 'utf8')
]);

assert.match(
  promotion,
  /이웃가게 본체:\s*`frontend\/01_이웃가게_발견_v3\.html`/,
  '#604: adopted Neighbor Shops source of truth must remain the V3 file'
);
assert.match(
  legacy,
  /location\.replace\(['"]?target['"]?\)/,
  '#604: legacy Neighbor Shops entry must forward instead of rendering an independent product'
);
assert.ok(
  legacy.includes("01_이웃가게_발견_v3.html'+location.search+location.hash"),
  '#604: compatibility forward must preserve query/hash into V3'
);
assert.match(
  consistency,
  /const FILES=\{1:'01_이웃가게_발견_v3\.html'/,
  '#604: common route authority must default Neighbor Shops to V3'
);
assert.ok(
  !home.includes('01_이웃가게_발견.html'),
  '#604: Home must not generate the legacy Neighbor Shops route'
);
assert.ok(
  home.includes('01_이웃가게_발견_v3.html'),
  '#604: Home CTA/nav must generate the adopted V3 Neighbor Shops route'
);

console.log('PASS #604 Neighbor Shops product authority is restored to 01_이웃가게_발견_v3.html');
