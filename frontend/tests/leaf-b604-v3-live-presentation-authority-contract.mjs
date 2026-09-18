import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL('../'+name, import.meta.url), 'utf8');
const canonical = await read('01_이웃가게_발견.html');
const comparison = await read('01_이웃가게_발견_v3.html');

// #604 still owns the adopted V3 presentation layer, but #738 narrows what
// presentation fallback may mean in canonical Production: visual assets/aliases
// may be reused, while business copy, reviews, benefits and mutations are
// server-authoritative.
for (const [label, html] of [['canonical', canonical], ['v3 comparison', comparison]]) {
  assert.match(html, /image:'assets\/home-florist\.png'/,
    `${label}: adopted V3 florist presentation image must remain in source`);
  assert.match(html, /image:'assets\/scene-food\.webp'/,
    `${label}: adopted V3 food presentation image must remain in source`);
  assert.match(html, /\/api\/v1\/storage\/public\?objectKey=/,
    `${label}: public business image object keys must resolve through the public storage endpoint`);
}

assert.match(canonical, /const PRODUCTION_SERVER_MODE=Boolean\(CANONICAL_API_BASE\)/,
  'canonical shop page must explicitly distinguish Production server authority');
assert.match(canonical, /const __V3_PRESENTATION=SHOP_DATA\.map\(s=>\(\{key:s\.key,name:s\.name,image:s\.image\}\)\)/,
  'canonical page may retain only visual presentation aliases from the V3 fixture');
assert.match(canonical, /if\(PRODUCTION_SERVER_MODE\)SHOP_DATA=\[\]/,
  'canonical Production must clear prototype shop rows before rendering');
assert.match(canonical, /function reconcileApiShop\(live,staticByName\)/,
  'canonical live rows still reconcile with the visual presentation lookup');
assert.match(canonical, /image:resolvedImage\|\|\(base\?base\.image:live\.image\)/,
  'canonical reconciliation may reuse only the V3 image when the live row lacks one');
assert.match(canonical, /presentationKey:base\?base\.key:undefined/,
  'canonical reconciliation may retain the presentation deep-link alias');
assert.doesNotMatch(canonical, /reviews:Array\.isArray\(live\.reviews\).*base\.reviews/,
  'canonical Production must never restore prototype reviews from presentation fixtures');
assert.doesNotMatch(canonical, /benefit:live\.benefit.*base\.benefit/,
  'canonical Production must never restore prototype benefit copy from presentation fixtures');
assert.doesNotMatch(canonical, /way:base\.way|contact:base\.contact/,
  'canonical Production must not substitute prototype business facts for missing server fields');
assert.match(canonical, /reviews:\[\]/,
  'API business mapping must not synthesize a fake review from benefit data');
assert.doesNotMatch(canonical, /DANJION · API/,
  'canonical Production must not invent a benefit code');
assert.match(canonical, /businessAuthorityState='error';draw\(\)/,
  'canonical API failure must render an error state instead of demo SHOP_DATA');
assert.doesNotMatch(canonical, /using demo SHOP_DATA fallback/,
  'canonical source must not preserve the old Production demo fallback');

assert.match(comparison, /function reconcileApiShop\(live,staticByName\)/,
  'comparison page preserves the original adopted V3 demo presentation behavior');
assert.match(comparison, /presentationKey:base\.key/,
  'comparison page retains its legacy presentation alias');
assert.match(comparison, /reviews:Array\.isArray\(live\.reviews\)&&live\.reviews\.length\?live\.reviews:base\.reviews/,
  'comparison-only page may preserve the historical demo review presentation');

console.log('PASS #604/#738 V3 presentation survives without becoming Production data authority');
