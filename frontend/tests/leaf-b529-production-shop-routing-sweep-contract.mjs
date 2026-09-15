import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (name) => readFile(new URL('../'+name, import.meta.url), 'utf8');

for (const name of [
  '06_단지온공지_목록.html',
  '08_아파트소식_목록.html',
  '10_주민소식_목록.html',
  '12_이웃대화_첫화면.html'
]) {
  const html = await read(name);
  assert.equal(html.includes('danjion:shopVariant'), false,
    `${name}: canonical navigation must not read comparison state`);
  assert.equal(/01_이웃가게_발견_v[23]\.html/.test(html), false,
    `${name}: canonical navigation must not re-enter comparison shop files`);
  assert.ok(html.includes("'01_이웃가게_발견.html'") || html.includes('"01_이웃가게_발견.html"'),
    `${name}: canonical shop route must remain available`);
}

const inquiry = await read('25_1대1문의.html');
assert.equal(inquiry.includes('danjion:shopVariant'), false,
  'inquiry must not restore comparison state');
assert.equal(/01_이웃가게_발견_v[23]\.html/.test(inquiry), false,
  'inquiry must not return to comparison shop files');
assert.ok(inquiry.includes("location.href=FILES.shops+'?shop='+encodeURIComponent(shop)"),
  'inquiry shop return must preserve shop key on canonical popup route');

const apply = await read('25A_신청제보.html');
assert.equal(apply.includes('danjion:shopVariant'), false,
  'application/report task must not depend on comparison state');
assert.equal(/01_이웃가게_발견_v[23]\.html/.test(apply), false,
  'application/report task must not route into comparison shop files');
assert.equal(apply.includes('danjion-apply-variant-bridge-20260905'), false,
  'old application comparison bridge must be removed');
assert.ok(apply.includes("location.href='01_이웃가게_발견.html'"),
  'application close control must return to canonical shops');
assert.ok(apply.includes("location.href='index.html?intro=1'"),
  'application brand must return to explicit Intro');

console.log('PASS #529 canonical routes cannot re-enter frozen shop comparison variants');
