import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [hub, topbar, complexNews, residentNews, css] = await Promise.all([
  readFile(new URL('src/v2/visual/V2ComplexHub.tsx', root), 'utf8'),
  readFile(new URL('src/v2/visual/V2Topbar.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2ComplexNewsPortal.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2ResidentNewsPortal.tsx', root), 'utf8'),
  readFile(new URL('src/v2/visual/v2-008-complex-hub.css', root), 'utf8')
]);

const CURRENT_008_COMPLEX_HUB_AUTHORITY = {
  title: '05_우리단지_첫화면.html',
  driveFileId: '1bBUnFJxOJdEKKZpXLBhv-g9reP_IOxt7'
};

assert.equal(CURRENT_008_COMPLEX_HUB_AUTHORITY.driveFileId, '1bBUnFJxOJdEKKZpXLBhv-g9reP_IOxt7');
assert.match(hub, /driveFileId: '1bBUnFJxOJdEKKZpXLBhv-g9reP_IOxt7'/,
  '05 parity surface must pin the current Drive authority');
assert.match(hub, /title: '05_우리단지_첫화면\.html'/,
  '05 parity surface must name the current source file');
assert.match(hub, /방림명지로드힐의 네 가지 소식 공간/,
  '05 current eyebrow copy must remain visible');
assert.match(hub, /단지온 공지는 가장 먼저, 주민의 이야기는 가깝게\./,
  '05 current intro copy must remain visible');

for (const [channel, title, action] of [
  ['official', '단지온공지', '단지온공지 보기'],
  ['apartment', '아파트소식', '아파트소식 보기'],
  ['resident', '주민소식', '소식 보기 · 제보하기'],
  ['dialogue', '이웃대화', '이웃대화 들어가기']
]) {
  assert.match(hub, new RegExp(`key: '${channel}'`), `05 hub must retain ${channel} channel`);
  assert.ok(hub.includes(`title: '${title}'`), `05 hub must retain ${title}`);
  assert.ok(hub.includes(`action: '${action}'`), `05 hub must retain ${action}`);
}

assert.match(hub, /data-v2-complex-hub/,
  '05 hub must expose a stable browser-test selector');
assert.match(hub, /data-v2-complex-channel=\{channel\.key\}/,
  '05 hub must expose stable channel selectors');
assert.match(hub, /<V2CommunityView/,
  '이웃대화 must reuse the canonical Community view');
assert.doesNotMatch(hub, /dataAdapter|communityApi|localStorage|sessionStorage|indexedDB/,
  '05 hub must remain presentation/routing only and must not create data authority');

assert.match(topbar, /import \{ V2ComplexHub \} from '\.\/V2ComplexHub';/,
  '우리단지 primary navigation must enter the current 05 hub');
assert.match(topbar, /<V2ComplexHub/,
  'Topbar must render the 05 hub instead of skipping directly to Community');
assert.doesNotMatch(topbar, /import \{ V2CommunityView \}/,
  'Topbar must not bypass the 05 hub with a direct Community import');

assert.match(hub, /danjion:v2-open-complex-news/,
  '05 public-news channels must delegate to the existing complex-news portal');
assert.match(complexNews, /addEventListener\('danjion:v2-open-complex-news'/,
  'complex-news portal must accept the 05 hub event');
assert.match(complexNews, /channel !== 'official' && channel !== 'apartment'/,
  'complex-news hub event must stay restricted to approved public channel keys');

assert.match(hub, /danjion:v2-open-resident-news/,
  '05 resident-news channel must delegate to the existing resident-news portal');
assert.match(residentNews, /detail\?\.view === 'feed'/,
  'resident-news portal must accept the 05 feed entry');
assert.match(residentNews, /UUID_RE\.test\(postId\)/,
  'existing notification deep-link UUID validation must remain intact');

assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
  '05 desktop authority must remain a two-column channel grid');
assert.match(css, /@media\(max-width:900px\)[\s\S]*grid-template-columns:1fr/,
  '05 responsive authority must collapse the hub to one column');
assert.match(css, /@media\(prefers-reduced-motion:reduce\)/,
  '05 parity must preserve reduced-motion handling');

console.log('PASS V2 20260904 current 05 complex hub parity contract');
