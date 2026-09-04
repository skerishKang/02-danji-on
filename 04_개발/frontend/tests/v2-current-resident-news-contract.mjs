import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [portal, client, css] = await Promise.all([
  readFile(new URL('src/v2/integration/V2ResidentNewsPortal.tsx', root), 'utf8'),
  readFile(new URL('src/resident-news-client.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/v2-resident-news.css', root), 'utf8')
]);

const CURRENT_008_RESIDENT_NEWS_AUTHORITY = {
  list: {
    title: '10_주민소식_목록.html',
    driveFileId: '1v2YF-r9iV8EQyWvKqDevtIxxNDolv9ra'
  },
  detail: {
    title: '11_주민소식_상세.html',
    driveFileId: '1CcN0qYY22Cbar7G5ErxGYwqc8XRElMtI'
  }
};

assert.equal(CURRENT_008_RESIDENT_NEWS_AUTHORITY.list.driveFileId, '1v2YF-r9iV8EQyWvKqDevtIxxNDolv9ra');
assert.equal(CURRENT_008_RESIDENT_NEWS_AUTHORITY.detail.driveFileId, '1CcN0qYY22Cbar7G5ErxGYwqc8XRElMtI');

for (const text of [
  '주민이 전하는 우리 단지 이야기',
  '주민이 직접 전한 소식입니다.',
  'RESIDENT STORY',
  '좋은 소식을',
  '보내주세요.',
  '제보부터 게시까지',
  '최근 주민소식',
  '소식 읽기',
  '운영진 확인 후 게시',
  '주민소식 전체 보기'
]) {
  assert.ok(portal.includes(text), `current 10/11 authority text must remain: ${text}`);
}

assert.match(portal, /residentNewsClient\.listPosts\(\)/,
  '10 list must use canonical resident-news feed authority');
assert.match(portal, /residentNewsClient\.getPost\(postId\)/,
  '11 detail must use canonical resident-news detail authority');
assert.match(portal, /residentNewsClient\.submit\(\{ title, body \}\)/,
  'resident submission must preserve title/body server contract');
assert.match(portal, /residentNewsClient\.listOwnSubmissions\(\)/,
  '내 제보 must preserve canonical signed-in resident status authority');
assert.match(portal, /danjion:v2-open-resident-news/,
  'notification and 05 hub resident-news entry event must remain supported');
assert.match(portal, /UUID_RE\.test\(postId\)/,
  'notification deep-link IDs must remain validated before detail loading');
for (const hook of [
  'data-v2-resident-news-list',
  'data-v2-resident-news-item',
  'data-v2-resident-news-detail',
  'data-v2-resident-news-form',
  'data-v2-resident-news-submissions'
]) {
  assert.ok(portal.includes(hook), `stable resident-news integration hook must remain: ${hook}`);
}

assert.match(portal, /분류값은 현재 API에 없으므로 임의로 추정하지 않습니다\./,
  '10 category filters must not invent a category contract absent from the API');
assert.doesNotMatch(portal, /<select|type=["']file["']|type=["']email["']|name=["']email["']|<img\b|objectKey|attachment/i,
  '10/11 live parity must not synthesize unsupported categories, files, email, images, or attachment authority');
assert.doesNotMatch(portal, /localStorage|sessionStorage|indexedDB/i,
  'resident-news parity must not create browser persistence authority');

assert.match(client, /export type ResidentNewsPost = \{[\s\S]*?id: string;[\s\S]*?title: string;[\s\S]*?body: string;[\s\S]*?publishedAt: string \| null;[\s\S]*?createdAt: string \| null;/,
  'current resident-news post contract must remain limited to server fields actually available');
assert.doesNotMatch(client, /ResidentNewsPost = \{[\s\S]*?(category|image|author|location):/,
  'frontend must not silently extend resident-news post authority with design-only fields');
assert.match(client, /authenticatedFetch\([\s\S]*'resident'\)/,
  'resident-news reads and writes must stay on resident-authenticated authority');

assert.match(css, /\.v2-resident-news-stories\{display:grid;grid-template-columns:1\.1fr \.9fr/,
  '10 desktop story composition must keep current featured/list geometry');
assert.match(css, /\.v2-resident-news-article-grid\{display:grid;grid-template-columns:300px minmax\(0,1fr\)/,
  '11 desktop detail must keep current summary/body composition');
assert.match(css, /@media\(max-width:760px\)[\s\S]*\.v2-resident-news-layer\{bottom:68px\}/,
  'resident-news mobile surface must preserve the current four-item bottom navigation area');

console.log('PASS V2 20260904 current 10/11 resident-news parity contract');
