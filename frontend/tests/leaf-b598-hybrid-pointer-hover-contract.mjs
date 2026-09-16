import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [headerCss, interactionCss, shops] = await Promise.all([
  readFile(new URL('assets/danjion-service-header.css', root), 'utf8'),
  readFile(new URL('assets/danjion-interaction-polish.css', root), 'utf8'),
  readFile(new URL('01_이웃가게_발견.html', root), 'utf8')
]);

for (const [name, css] of [
  ['shared header', headerCss],
  ['non-header interaction', interactionCss]
]) {
  assert.match(
    css,
    /@media \(any-hover:hover\) and \(any-pointer:fine\)/,
    `#598: ${name} hover must detect any available mouse-like pointer`
  );
  assert.doesNotMatch(
    css,
    /@media \(hover:hover\) and \(pointer:fine\)/,
    `#598: ${name} must not depend on the primary pointer being fine/hover-capable`
  );
}

assert.match(
  headerCss,
  /\.desktop-nav button:hover::after,\.danjion-service-header \.desktop-nav a:hover::after/,
  '#598: shared desktop header hover underline must remain wired for buttons and anchors'
);
assert.match(
  headerCss,
  /\.desktop-nav button\.active::after,\.danjion-service-header \.desktop-nav a\.active::after/,
  '#598: persistent active underline must remain distinct from hover'
);
assert.match(
  headerCss,
  /\.desktop-nav button:focus-visible::after,\.danjion-service-header \.desktop-nav a:focus-visible::after/,
  '#598: keyboard focus feedback must remain available independent of pointer media queries'
);
assert.match(
  shops,
  /<link rel="stylesheet" href="assets\/danjion-service-header\.css">/,
  '#598: Neighbor Shops must load the canonical shared header stylesheet'
);
assert.match(
  shops,
  /<header class="site-header topbar danjion-service-header">/,
  '#598: Neighbor Shops must use the canonical shared service header'
);

console.log('PASS #598 hybrid Windows mouse hover stays available on canonical Neighbor Shops/header interactions');
