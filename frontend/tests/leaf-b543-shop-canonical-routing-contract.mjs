import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL('../'+name, import.meta.url), 'utf8');

const canonicalPages = [
  'index.html',
  '04_데일리홈.html',
  '05_우리단지_첫화면.html',
  '06_단지온공지_목록.html',
  '08_아파트소식_목록.html',
  '10_주민소식_목록.html',
  '12_이웃대화_첫화면.html',
  '19_내정보_메인.html',
  '25_1대1문의.html',
  '25A_신청제보.html'
];

for (const file of canonicalPages) {
  const html = await read(file);
  assert.equal(/01_이웃가게_발견_v[23]\.html/.test(html), false,
    `${file}: canonical navigation must not point at comparison shop files`);
}

const index = await read('index.html');
assert.equal(/setItem\([^)]*danjion:shopVariant/.test(index), false,
  'landing must not select a comparison shop variant');

const consistency = await read('assets/consistency.js');
assert.ok(consistency.includes('const isExplicitShopComparison='),
  'shared runtime must identify explicit comparison pages');
assert.ok(consistency.includes("removeItem('danjion:shopVariant')"),
  'shared runtime must clear stale comparison selection outside comparison pages');
assert.ok(consistency.includes("if(!isExplicitShopComparison)return null"),
  'shared comparison routing must stay disabled on canonical pages');

const home = await read('04_데일리홈.html');
assert.ok(home.includes("go(FILES.shops+'?shop='+encodeURIComponent(k)+'&from=home')"),
  'Home shop CTA must open the canonical popup deep link');
assert.ok(home.includes("q('#detailBtn').dataset.route='01_이웃가게_발견.html?shop='+encodeURIComponent(next)+'&from=home'"),
  'Home live business scene detail CTA must use the canonical shop popup deep link');
assert.equal(/\bisB\b/.test(home), false,
  'Home canonical runtime must not depend on the removed comparison-variant isB flag');
assert.equal(/\bshopsBFile\b/.test(home), false,
  'Home canonical runtime must not depend on the removed comparison-variant shopsBFile path');

const inquiry = await read('25_1대1문의.html');
assert.ok(inquiry.includes("location.href=FILES.shops+'?shop='+encodeURIComponent(shop)"),
  'shop inquiry return must use the canonical popup deep link');

const apply = await read('25A_신청제보.html');
assert.ok(apply.includes("location.href='index.html?intro=1'"),
  'application brand must open Intro');
assert.ok(apply.includes("location.href='01_이웃가게_발견.html'"),
  'application close control must return to canonical shops');
assert.equal(apply.includes('danjion-apply-variant-bridge-20260905'), false,
  'canonical application task must not install the old comparison bridge');

const v3 = await read('01_이웃가게_발견_v3.html');
assert.ok(v3.includes('danjion:shopVariant'),
  'explicit v3 comparison page must remain available');

console.log('PASS #543 canonical shop routing is isolated from comparison pages');
