import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (name) => readFile(new URL('../'+name, import.meta.url), 'utf8');
const prodGuard = "String(location.hostname||'').toLowerCase()!=='danjion.pages.dev'";
const canonicalHost = "String(location.hostname||'').toLowerCase()==='danjion.pages.dev'";

for (const name of [
  '06_단지온공지_목록.html',
  '08_아파트소식_목록.html',
  '10_주민소식_목록.html',
  '12_이웃대화_첫화면.html'
]) {
  const html = await read(name);
  assert.ok(
    html.includes("label==='이웃가게'&&"+prodGuard+"&&"),
    `${name}: comparison shop variant must be disabled on canonical production`
  );
  assert.ok(
    html.includes("sessionStorage.getItem('danjion:shopVariant')"),
    `${name}: preview/local comparison routing must remain available`
  );
}

const inquiry = await read('25_1대1문의.html');
assert.ok(
  inquiry.includes("const v2="+prodGuard+"&&new URLSearchParams(location.search).get('from')==='v2-shop'"),
  'inquiry main-nav v2 return must be disabled on canonical production'
);
assert.ok(
  inquiry.includes("if("+canonicalHost+"){\n      location.href=FILES.shops+'?shop='"),
  'inquiry back route must canonicalize a v2/shop return to the production shop page'
);
assert.ok(
  inquiry.includes("location.href='01_이웃가게_발견_v2.html?shop='"),
  'inquiry preview/local comparison return must remain available'
);

const apply = await read('25A_신청제보.html');
assert.ok(
  apply.includes("const allowVariant="+prodGuard),
  'apply variant bridge must be explicitly disabled on canonical production'
);
assert.ok(
  apply.includes("B="+prodGuard+"&&['v2','v3'].includes"),
  'apply direct router must not promote stored comparison variants on canonical production'
);
assert.ok(
  apply.includes(canonicalHost+"?'01_이웃가게_발견.html'"),
  'apply close fallback must always return to the canonical shop page on production'
);
assert.ok(
  apply.includes("allowVariant&&params.get('return')==='v2'") &&
  apply.includes("allowVariant&&params.get('return')==='v3'"),
  'apply query-driven comparison variants must remain preview/local-only'
);

console.log('PASS #529 canonical production cannot re-enter frozen shop comparison variants');
