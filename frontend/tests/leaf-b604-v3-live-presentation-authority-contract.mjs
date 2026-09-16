import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL('../'+name, import.meta.url), 'utf8');
const pages = [
  ['canonical', await read('01_이웃가게_발견.html')],
  ['v3 comparison', await read('01_이웃가게_발견_v3.html')]
];

for (const [label, html] of pages) {
  assert.match(html, /image:'assets\/home-florist\.png'/,
    `${label}: adopted V3 florist presentation image must remain in source`);
  assert.match(html, /image:'assets\/scene-food\.webp'/,
    `${label}: adopted V3 food presentation image must remain in source`);
  assert.match(html, /function reconcileApiShop\(live,staticByName\)/,
    `${label}: live business data must be reconciled with V3 presentation authority`);
  assert.match(html, /presentationKey:base\.key/,
    `${label}: reconciled live rows must retain the static presentation key as a deep-link alias`);
  assert.match(html, /const reconciled=reconcileApiShops\(list\);/,
    `${label}: API success must build a reconciled list before mutating SHOP_DATA`);
  assert.match(html, /Array\.prototype\.push\.apply\(SHOP_DATA,reconciled\)/,
    `${label}: SHOP_DATA must receive reconciled rows, not raw mapped API rows`);
  assert.doesNotMatch(html, /Array\.prototype\.push\.apply\(SHOP_DATA,list\)/,
    `${label}: raw API rows must never replace the adopted V3 presentation directly`);
  assert.match(html, /reconciled\.forEach\(s=>\{byKey\[s\.key\]=s;if\(s\.presentationKey\)byKey\[s\.presentationKey\]=s\}\)/,
    `${label}: byKey must expose both server and legacy presentation keys`);
  assert.match(html, /function openShop\(key\)\{const s=byKey\[key\]\|\|byKey\['florist'\]\|\|SHOP_DATA\[0\];if\(!s\)return;active=s\.key;/,
    `${label}: popup opened through a legacy alias must promote active to the server-capable key`);
  assert.match(html, /representativeImageObjectKey:\(b\.representative_image_object_key\?\?b\.representativeImageObjectKey\)\|\|''/,
    `${label}: mapper must carry the raw representative image object key into reconciliation`);
  assert.match(html, /\/api\/v1\/storage\/public\?objectKey=/,
    `${label}: valid public business image object keys must resolve through the public storage endpoint`);
  assert.match(html, /live\.image&&live\.image!=='assets\/scene-car\.webp'\?live\.image:base\.image/,
    `${label}: missing API image must retain the distinct V3 presentation image instead of forcing car fallback`);
  assert.match(html, /reviews:Array\.isArray\(live\.reviews\)&&live\.reviews\.length\?live\.reviews:base\.reviews/,
    `${label}: empty API review projection must not erase V3 fallback review presentation`);
}

console.log('PASS #604 V3 shop presentation authority survives live API hydration');
