import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (rel) => readFile(new URL(rel, import.meta.url));
const text = async (rel) => (await read(rel)).toString('utf8');

const home = await text('../04_데일리홈.html');
const complex = await text('../05_우리단지_첫화면.html');
const my = await text('../19_내정보_메인.html');

for (const [name,html] of [['home',home],['complex',complex],['my',my]]) {
  assert.equal(html.includes('danjion:shopVariant'), false,
    `${name} must not depend on persisted comparison variant state`);
  assert.equal(/01_이웃가게_발견_v[23]\.html/.test(html), false,
    `${name} must not route canonical navigation into comparison files`);
  assert.ok(html.includes("'01_이웃가게_발견.html'") || html.includes('"01_이웃가게_발견.html"'),
    `${name} must retain the canonical shop route`);
}

assert.ok(home.includes("go(FILES.shops+'?shop='+encodeURIComponent(k)+'&from=home')"),
  'Home detail CTA must deep-link to the canonical popup route');

const frontendV2 = await read('../01_이웃가게_발견_v2.html');
const packagedV2 = await read('../../design-gateway/versions/v3-current/01_이웃가게_발견_v2.html');
assert.ok(frontendV2.equals(packagedV2),
  'frozen shop v2 comparison source must stay byte-identical to its design-gateway package');

assert.ok(!complex.includes("querySelectorAll('.identity,.mobile-head')"),
  'Complex public-name authority must never overwrite authenticated desktop account host');
assert.ok(complex.includes("document.querySelectorAll('.mobile-head').forEach(el=>{el.textContent=name})"),
  'Complex public-name authority may update the mobile complex label only');

console.log('PASS #522 canonical shop routing isolated from frozen comparison files');
