import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (rel) => readFile(new URL(rel, import.meta.url));
const text = async (rel) => (await read(rel)).toString('utf8');

const home = await text('../04_데일리홈.html');
const complex = await text('../05_우리단지_첫화면.html');
const my = await text('../19_내정보_메인.html');

assert.ok(
  home.includes("String(location.hostname||'').toLowerCase()!=='danjion.pages.dev'&&[\"v2\",\"v3\"].includes(sessionStorage.getItem(\"danjion:shopVariant\"))"),
  'Home must ignore persisted design shop variants on canonical production'
);
for (const [name,html] of [['complex',complex],['my',my]]) {
  assert.ok(
    html.includes("label==='이웃가게'&&String(location.hostname||'').toLowerCase()!=='danjion.pages.dev'"),
    `${name} must ignore persisted design shop variants on canonical production`
  );
}
for (const html of [home,complex,my]) {
  assert.ok(html.includes("'01_이웃가게_발견.html'") || html.includes('"01_이웃가게_발견.html"'),
    'canonical shop route must remain available');
}

const frontendV2 = await read('../01_이웃가게_발견_v2.html');
const packagedV2 = await read('../../design-gateway/versions/v3-current/01_이웃가게_발견_v2.html');
assert.ok(frontendV2.equals(packagedV2),
  'frozen shop v2 comparison source must stay byte-identical to its design-gateway package');

assert.ok(!complex.includes("querySelectorAll('.identity,.mobile-head')"),
  'Complex public-name authority must never overwrite authenticated desktop account host');
assert.ok(complex.includes("document.querySelectorAll('.mobile-head').forEach(el=>{el.textContent=name})"),
  'Complex public-name authority may update the mobile complex label only');

console.log('PASS #522 production canonical shop routing + frozen comparison parity');
