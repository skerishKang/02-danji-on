import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL('../'+name, import.meta.url), 'utf8');
const expected = new Map([
  ['02_이웃가게_상세.html','이웃가게'],
  ['03_주민혜택_쿠폰.html','이웃가게'],
  ['06_단지온공지_목록.html','우리단지'],
  ['07_단지온공지_상세.html','우리단지'],
  ['08_아파트소식_목록.html','우리단지'],
  ['09_회장인사_상세.html','우리단지'],
  ['10_주민소식_목록.html','우리단지'],
  ['11_주민소식_상세.html','우리단지'],
  ['12_이웃대화_첫화면.html','우리단지'],
  ['13_이웃대화_글상세_댓글.html','우리단지'],
  ['20_메시지함_목록.html','내정보'],
  ['21_메시지_대화상세.html','내정보'],
  ['22_주민_공개프로필.html','내정보'],
  ['23_이웃온기.html','내정보'],
  ['24_설정.html','내정보'],
  ['25_1대1문의.html','내정보'],
  ['26_우리집연결.html','내정보'],
  ['27_알림함.html','내정보'],
  ['28_나의활동.html','내정보']
]);
const labels=['홈','인트로','이웃가게','우리단지','내정보'];

for (const [file,active] of expected) {
  const html=await read(file);
  const header=(html.match(/<header[\s\S]*?<\/header>/)||[])[0]||'';
  assert.ok(header.includes('danjion-service-header'), `${file}: canonical header class required`);
  assert.ok(header.includes('data-account-host'), `${file}: shared account host required`);
  assert.ok(html.includes('assets/danjion-service-header.css'), `${file}: shared header CSS required`);
  assert.ok(html.includes('assets/danjion-session.js'), `${file}: shared session/account runtime required`);
  let last=-1;
  for(const label of labels){
    const i=header.indexOf('>'+label+'</a>');
    assert.ok(i>=0, `${file}: missing ${label} nav item`);
    assert.ok(i>last, `${file}: canonical nav order must be stable`);
    last=i;
  }
  const activeMatch=header.match(/aria-current="page" class="active"[^>]*>([^<]+)<\/a>/);
  assert.equal(activeMatch?.[1],active, `${file}: active primary section mismatch`);
  assert.ok(header.includes('href="./index.html?intro=1">인트로</a>'),
    `${file}: Intro must remain a native link that bypasses legacy direct-router query stripping`);
}

const notification=await read('27_알림함.html');
assert.ok(notification.includes('class="header-actions"') && notification.includes('class="bell"'),
  'notification page must preserve its bell beside the shared account host');

const css=await read('assets/danjion-service-header.css');
assert.ok(css.includes('.desktop-nav button,.danjion-service-header .desktop-nav a'),
  'shared CSS must style both button and anchor variants');
assert.ok(css.includes('.mobile-head,.danjion-service-header .mobile-title'),
  'shared CSS must preserve page-owned mobile title variants');
assert.ok(css.includes('.danjion-service-header .header-actions'),
  'shared CSS must support notification header actions');
assert.ok(css.includes('body .danjion-service-header .identity.danjion-account-host{display:none!important}'),
  'mobile service headers must not leak the desktop account strip');
assert.equal(css.includes('\\n'),false,'shared CSS must not contain escaped newline artifacts');

for (const file of ['14_가입인사_글쓰기.html','15_단지이야기_글쓰기.html','16_궁금해요_글쓰기.html','17_같이해요_글쓰기.html']) {
  const html=await read(file);
  const header=(html.match(/<header[\s\S]*?<\/header>/)||[])[0]||'';
  assert.ok(header.includes('writebar'), `${file}: dedicated composer header must remain intact`);
  assert.equal(header.includes('danjion-service-header'),false, `${file}: composer must not be converted to service nav`);
}
const apply=await read('25A_신청제보.html');
const applyHeader=(apply.match(/<header[\s\S]*?<\/header>/)||[])[0]||'';
assert.ok(applyHeader.includes('class="head"') && !applyHeader.includes('danjion-service-header'),
  'apply/report task sheet must keep its dedicated close-task header');

console.log('PASS #532 canonical service header phase 2 across 19 production screens');
