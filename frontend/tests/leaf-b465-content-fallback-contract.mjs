import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #465: server-empty / server-error states must never erase built-in
// community content that is already present in the static V3 pages.

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const notice = await read('../06_단지온공지_목록.html');
const apartment = await read('../08_아파트소식_목록.html');
const resident = await read('../10_주민소식_목록.html');
const community = await read('../12_이웃대화_첫화면.html');

// 1) DanjiOn notices: only non-empty arrays may take over the static list.
assert.ok(
  notice.includes("result.ok && Array.isArray(result.data) && result.data.length > 0"),
  'notice list must preserve built-in notices when server collection is empty'
);
assert.ok(
  notice.includes('단지온 홈과 네 가지 메뉴 이용 안내'),
  'notice built-in onboarding content must remain in the page'
);

// 2) Apartment news: empty collection keeps the built-in feature and rows;
// partial server data must not blank the recent-news slot.
assert.ok(
  apartment.includes("result.ok && Array.isArray(result.data) && result.data.length > 0"),
  'apartment news must not render an empty server collection'
);
assert.ok(
  apartment.includes('if (newsList && news.length > 0)'),
  'apartment recent-news slot must not be blanked by a server response with no news rows'
);
assert.ok(
  apartment.includes('주민 안내문자·방송·게시판 홍보 협조 논의'),
  'apartment built-in recent-news content must remain in the page'
);

// 3) Resident news: loading/empty/error states keep static cards and filters.
assert.ok(
  resident.includes('if(!posts.length)return;'),
  'resident news must not replace built-in cards with an empty server state'
);
assert.ok(
  !resident.includes("notice('주민소식을 불러오는 중입니다.');"),
  'resident news must not erase built-in cards with a loading placeholder'
);
assert.ok(
  resident.includes("resident-news fallback preserved"),
  'resident news failures must explicitly preserve the fallback content'
);

// 4) Community: unsupported kind, auth/network failure and empty server result
// all keep the static board rendered by the earlier page script.
assert.ok(
  community.includes("if(!posts.length)return;"),
  'community empty server collection must preserve built-in posts'
);
assert.ok(
  community.includes("community fallback preserved"),
  'community non-server outcomes must preserve built-in posts'
);
assert.ok(
  !community.includes("list.innerHTML=notice('가입인사 카테고리는 아직 서버 연동이 준비되지 않았습니다."),
  'community unsupported signup-intro category must not replace built-in posts'
);

console.log('leaf-b465-content-fallback-contract: PASS');
