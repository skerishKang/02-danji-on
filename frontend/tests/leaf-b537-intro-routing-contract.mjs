import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL('../'+name, import.meta.url), 'utf8');
const index = await read('index.html');
const consistency = await read('assets/consistency.js');

assert.equal(index.includes("const explicitIntro=new URLSearchParams(location.search).get('intro')==='1'"), false,
  'Intro must not depend on a query flag to avoid an authenticated auto-redirect');
assert.equal(index.includes("if(real&&!explicitIntro){location.replace('04_데일리홈.html');return}"), false,
  'authenticated users opening the root/Intro must not be bounced to Home');
assert.ok(index.includes("location.replace('04_데일리홈.html')"),
  'successful authentication must still continue into the service Home');

const servicePages = [
  '01_이웃가게_발견.html','02_이웃가게_상세.html','03_주민혜택_쿠폰.html','04_데일리홈.html',
  '05_우리단지_첫화면.html','06_단지온공지_목록.html','07_단지온공지_상세.html','08_아파트소식_목록.html',
  '09_회장인사_상세.html','10_주민소식_목록.html','11_주민소식_상세.html','12_이웃대화_첫화면.html',
  '13_이웃대화_글상세_댓글.html','19_내정보_메인.html','20_메시지함_목록.html','21_메시지_대화상세.html',
  '22_주민_공개프로필.html','23_이웃온기.html','24_설정.html','25_1대1문의.html','26_우리집연결.html',
  '27_알림함.html','28_나의활동.html'
];

for (const file of servicePages) {
  const html = await read(file);
  const header = (html.match(/<header[\s\S]*?<\/header>/)||[])[0]||'';
  assert.ok(header.includes('danjion-service-header'), `${file}: canonical service header required`);
  assert.ok(header.includes('인트로'), `${file}: Intro entry required`);
  assert.ok(
    header.includes('index.html?intro=1') || header.includes('./index.html?intro=1'),
    `${file}: Intro entry must target the explicit Intro route`
  );

  const router = (html.match(/<script id="danjion-direct-router-v5">[\s\S]*?<\/script>/)||[])[0]||'';
  const nativeBrandIntro =
    /class="brand"[^>]+href="(?:\.\/)?index\.html(?:\?intro=1)?"/.test(header) ||
    /class="brand"[^>]+data-route="(?:\.\/)?index\.html(?:\?intro=1)?"/.test(header);
  const routedBrandIntro = router.includes("if(cls.contains('brand'))") &&
    (router.includes("go('index.html?intro=1')") || router.includes("go('index.html')"));
  assert.ok(nativeBrandIntro || routedBrandIntro,
    `${file}: logo must resolve to Intro rather than the service Home`);
}

const sharedBrandBlock = (consistency.match(/if\(number!==29 && \(el\.classList\.contains\('brand'\)[\s\S]*?\n    \}/)||[])[0]||'';
assert.ok(sharedBrandBlock.includes("location.href='index.html?intro=1'"),
  'shared consistency runtime must route service logos to explicit Intro');
assert.equal(sharedBrandBlock.includes("04_데일리홈.html"), false,
  'shared consistency runtime must not override service logos back to Home');

console.log('PASS #537 stable Intro / logo / Home routing contract');
