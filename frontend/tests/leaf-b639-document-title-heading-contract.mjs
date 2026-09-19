import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const frontend=join(here,'..');

const canonicalPages=[
  'index.html',
  '01_이웃가게_발견.html',
  '02_이웃가게_상세.html',
  '03_주민혜택_쿠폰.html',
  '04_데일리홈.html',
  '05_우리단지_첫화면.html',
  '06_단지온공지_목록.html',
  '07_단지온공지_상세.html',
  '08_아파트소식_목록.html',
  '08A_아파트소식_상세.html',
  '09_회장인사_상세.html',
  '10_주민소식_목록.html',
  '11_주민소식_상세.html',
  '12_이웃대화_첫화면.html',
  '13_이웃대화_글상세_댓글.html',
  '14_가입인사_글쓰기.html',
  '15_단지이야기_글쓰기.html',
  '16_궁금해요_글쓰기.html',
  '17_같이해요_글쓰기.html',
  '19_내정보_메인.html',
  '20_메시지함_목록.html',
  '21_메시지_대화상세.html',
  '22_주민_공개프로필.html',
  '23_이웃온기.html',
  '24_설정.html',
  '25A_신청제보.html',
  '25_1대1문의.html',
  '26_우리집연결.html',
  '27_알림함.html',
  '28_나의활동.html'
];

const titles=[];
const forbiddenTitle=/STEP\s*\d+|WEB\s+CINEMATIC|웹\s*통합검토|프론트엔드\s*점검/i;

for(const page of canonicalPages){
  const html=readFileSync(join(frontend,page),'utf8');
  const titleMatches=[...html.matchAll(/<title>([\s\S]*?)<\/title>/gi)];
  assert.equal(titleMatches.length,1,`${page}: exactly one document title is required`);
  const title=titleMatches[0][1].replace(/\s+/g,' ').trim();
  assert.ok(title,`${page}: document title must be non-empty`);
  assert.ok(title.includes('단지온'),`${page}: title must preserve DanjiOn product naming`);
  assert.doesNotMatch(title,forbiddenTitle,`${page}: internal prototype/review metadata must not ship in title`);
  titles.push(title);

  const h1=[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  assert.equal(h1.length,1,`${page}: canonical source must expose exactly one literal page-level H1`);
  const text=h1[0][1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  assert.ok(text,`${page}: page-level H1 needs a meaningful source fallback`);
}

assert.equal(
  new Set(titles).size,
  titles.length,
  'canonical document titles must be unique across Production screens'
);

const detail=readFileSync(join(frontend,'13_이웃대화_글상세_댓글.html'),'utf8');
assert.match(
  detail,
  /<h1 id="title">이웃대화 글<\/h1>/,
  'dynamic conversation detail must retain a meaningful H1 before runtime hydration'
);
assert.match(
  detail,
  /title\.textContent=d\.title/,
  'conversation detail may replace the fallback H1 with hydrated content'
);

const myInfo=readFileSync(join(frontend,'19_내정보_메인.html'),'utf8');
assert.match(
  myInfo,
  /id="myinfoAccessTitle" role="heading" aria-level="1"/,
  'signed-out My Info gate must retain an accessible level-one heading without creating a second literal H1'
);
assert.equal(
  (myInfo.match(/<h1\b/gi)||[]).length,
  1,
  'My Info must retain exactly one literal H1 for the private member dashboard'
);
assert.match(
  myInfo,
  /myinfoAccessGate[\s\S]*myinfoPrivateContent" hidden/,
  'guest heading and private H1 must remain in mutually gated surfaces'
);

const admin=readFileSync(join(frontend,'admin','index.html'),'utf8');
assert.match(admin,/<title>단지온 관리자 콘솔<\/title>/,'admin console title must remain meaningful');
assert.match(
  admin,
  /lead\.append\(el\('h1','단지온 운영관리'\)/,
  'admin runtime must render its page-level H1'
);

console.log(`leaf-b639-document-title-heading-contract: PASS pages=${canonicalPages.length}`);
