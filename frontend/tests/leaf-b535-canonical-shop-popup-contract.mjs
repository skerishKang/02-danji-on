import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const canonical = await readFile(new URL('../01_이웃가게_발견.html', import.meta.url), 'utf8');
const legacyDetail = await readFile(new URL('../02_이웃가게_상세.html', import.meta.url), 'utf8');
const comparison = await readFile(new URL('../01_이웃가게_발견_v3.html', import.meta.url), 'utf8');

assert.ok(canonical.includes('data-shop-experience="popup-v3"'),
  'canonical shop page must identify the adopted popup experience');
assert.ok(canonical.includes('id="shopCompareModal"') &&
          canonical.includes('function openShop(key)') &&
          canonical.includes('window.openShopCompareV2=openShop'),
  'canonical shop page must contain the adopted v3 in-page popup runtime');
assert.ok(canonical.includes("if(shop){e.preventDefault();e.stopPropagation();openShop(shop.dataset.shopKey);}"),
  'canonical shop cards must open the in-page popup');
assert.ok(canonical.includes("if(SCREEN==='shops' && cls.contains('shop-link'))") &&
          canonical.includes("if(window.openShopCompareV2)window.openShopCompareV2(el.dataset.shopKey||'florist')"),
  'canonical direct router must preserve popup behavior for shop-link controls');

assert.ok(canonical.includes("const key=initial.get('shop');"),
  'canonical ?shop= deep-link key must be captured before authority resolution');
assert.ok(canonical.includes("if(key&&byKey[key])setTimeout(()=>openShop(key),0);"),
  'API SUCCESS must resolve the requested ?shop= key after live authority replacement');
assert.ok(canonical.includes("if(key&&byKey[key])setTimeout(()=>openShop(key),60);"),
  'API fallback must resolve the requested ?shop= key only after fallback authority is known');
assert.ok(canonical.indexOf("if(key&&byKey[key])setTimeout(()=>openShop(key),0);") > canonical.indexOf("Array.prototype.push.apply(SHOP_DATA,list);"),
  'API deep-link auto-open must occur after API SHOP_DATA replacement');
assert.equal(canonical.includes('01_이웃가게_발견_v3.html'), false,
  'public canonical page must never self-route to the comparison filename');
assert.equal(/setItem\(["']danjion:shopVariant["'],["']v3["']\)/.test(canonical), false,
  'canonical production page must not write comparison-variant state');

assert.ok(canonical.includes('danjion-service-header') &&
          canonical.includes('data-account-host') &&
          canonical.includes('assets/danjion-service-header.css'),
  'promoted popup experience must retain the shared authenticated header contract');
assert.ok(canonical.includes("if(inMain && text==='인트로')") &&
          canonical.includes("go('index.html?intro=1')"),
  'canonical shop header must preserve the explicit Intro query');

assert.ok(legacyDetail.includes("String(location.hostname||'').toLowerCase()!=='danjion.pages.dev'"),
  'legacy detail redirect must be production-host scoped');
assert.ok(legacyDetail.includes("location.replace('01_이웃가게_발견.html'+(query?'?'+query:''))"),
  'legacy production detail links must return to the canonical popup page');
assert.ok(legacyDetail.includes("if(shop)target.set('shop',shop)"),
  'legacy detail redirect must preserve the requested shop key');

assert.ok(comparison.includes('비교안 B 팝업형') &&
          /setItem\(["']danjion:shopVariant["'],["']v3["']\)/.test(comparison),
  'the separate v3 comparison file must remain available for design-review provenance');

console.log('PASS #535 canonical production shops use adopted v3 popup experience');
