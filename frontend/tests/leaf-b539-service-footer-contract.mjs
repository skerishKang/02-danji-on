import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL('../'+name, import.meta.url), 'utf8');
const footer = await read('assets/danjion-service-footer.js');
const session = await read('assets/danjion-session.js');

assert.ok(footer.includes("copy.textContent='단지온은 우리 단지의 소식, 이웃가게, 주민 활동과 생활 정보를 한곳에서 연결하는 아파트 생활 서비스입니다.'"),
  'shared footer must explain the DanjiOn service');
assert.ok(footer.includes("by.textContent='DANJION by PADIEM'"),
  'shared footer must preserve factual PADIEM attribution');
assert.ok(footer.includes("intro.href='index.html?intro=1'") &&
          footer.includes("inquiry.href='25_1대1문의.html'"),
  'shared footer must provide service-intro and inquiry routes');
assert.ok(footer.includes("if(!document.querySelector('.danjion-service-header'))return false"),
  'footer runtime must fail closed outside canonical service screens');
assert.ok(footer.includes("document.body.insertBefore(footer,mobileNav)"),
  'footer must preserve the mobile bottom navigation as the final navigation surface');
assert.equal(/사업자등록|대표자|회사 주소|전화번호/.test(footer), false,
  'footer must not invent legal/company registration or contact details');

assert.ok(session.includes("script.src = 'assets/danjion-service-footer.js'"),
  'shared session runtime must load the common footer asset');
assert.ok(session.includes("data-danjion-service-footer-runtime"),
  'footer runtime loader must be de-duplicated');
assert.ok(session.includes("loadServiceFooterRuntime,"),
  'footer loader must remain observable through the shared runtime');

const servicePages=[
  '01_이웃가게_발견.html','02_이웃가게_상세.html','03_주민혜택_쿠폰.html','04_데일리홈.html',
  '05_우리단지_첫화면.html','06_단지온공지_목록.html','07_단지온공지_상세.html','08_아파트소식_목록.html',
  '09_회장인사_상세.html','10_주민소식_목록.html','11_주민소식_상세.html','12_이웃대화_첫화면.html',
  '13_이웃대화_글상세_댓글.html','19_내정보_메인.html','20_메시지함_목록.html','21_메시지_대화상세.html',
  '22_주민_공개프로필.html','23_이웃온기.html','24_설정.html','25_1대1문의.html','26_우리집연결.html',
  '27_알림함.html','28_나의활동.html'
];
for(const file of servicePages){
  const html=await read(file);
  assert.ok(html.includes('danjion-service-header'), `${file}: canonical service header required for footer eligibility`);
  assert.ok(html.includes('assets/danjion-session.js'), `${file}: shared session runtime required to load footer`);
}

for(const file of ['14_가입인사_글쓰기.html','15_단지이야기_글쓰기.html','16_궁금해요_글쓰기.html','17_같이해요_글쓰기.html','25A_신청제보.html','index.html']){
  const html=await read(file);
  const header=(html.match(/<header[\s\S]*?<\/header>/)||[])[0]||'';
  assert.equal(header.includes('danjion-service-header'),false,
    `${file}: task/Intro screen must remain outside common service-footer eligibility`);
}

console.log('PASS #539 common DanjiOn / PADIEM service footer contract');
