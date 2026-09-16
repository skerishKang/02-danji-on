import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../.github/workflows/pages-production-release.yml', import.meta.url), 'utf8');

for (const path of [
  '01_이웃가게_발견.html',
  '04_데일리홈.html',
  '05_우리단지_첫화면.html',
  '19_내정보_메인.html',
  'assets/danjion-session.js',
  'assets/danjion-service-header.css',
  'assets/consistency.js'
]) {
  assert.ok(workflow.includes(`'${path}'`), `production release parity must include ${path}`);
}

assert.match(
  workflow,
  /urllib\.parse\.quote\(sys\.argv\[1\], safe="\/"\)/,
  'leaf parity must URL-encode non-ASCII paths instead of hard-coding escapes'
);
assert.match(
  workflow,
  /expected_leaf_sha=.*sha256sum "dist\/\$\{path\}"/,
  'leaf parity must hash the release artifact source'
);
assert.match(
  workflow,
  /actual_leaf_sha=.*sha256sum "\$leaf_file"/,
  'leaf parity must hash the canonical downloaded leaf'
);
assert.match(
  workflow,
  /Canonical Pages leaf content mismatch/,
  'leaf mismatch must fail closed'
);

console.log('PASS Pages production release verifies critical V3 leaf byte parity');
