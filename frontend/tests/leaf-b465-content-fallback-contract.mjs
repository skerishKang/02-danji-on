import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #740 reconciles the old #465 fallback rule for canonical Production.
// Official/editorial launch content may remain static where explicitly intended,
// but resident-authored lanes must never promote prototype residents/posts when
// the server is empty, unavailable, or denies access.

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const notice = await read('../06_단지온공지_목록.html');
const apartment = await read('../08_아파트소식_목록.html');
const resident = await read('../10_주민소식_목록.html');
const community = await read('../12_이웃대화_첫화면.html');

// 1) DanjiOn notices: current onboarding notices are approved static editorial
// until a non-empty server collection takes ownership.
assert.ok(
  notice.includes("if (result.ok) {") &&
  notice.includes("Array.isArray(result.data) && result.data.length > 0") &&
  notice.includes("renderPosts(result.data)"),
  'notice list must render server rows only for a non-empty successful collection'
);
assert.ok(
  notice.includes('단지온 홈과 네 가지 메뉴 이용 안내'),
  'notice onboarding editorial must remain available'
);

// 2) Apartment news: current chair/apartment launch copy remains editorial
// until a non-empty server collection replaces the corresponding slots.
assert.ok(
  apartment.includes("if (result.ok) {") &&
  apartment.includes("Array.isArray(result.data) && result.data.length > 0") &&
  apartment.includes("renderStories(result.data)"),
  'apartment news must render server rows only for a non-empty successful collection'
);
assert.ok(
  apartment.includes('if (newsList && news.length > 0)'),
  'apartment recent-news slot must not be blanked by a partial server response'
);
assert.ok(
  apartment.includes('주민 안내문자·방송·게시판 홍보 협조 논의'),
  'approved apartment launch editorial must remain in the page'
);

// 3) Resident news: canonical server mode owns the lane and must replace
// prototype resident cards with loading/empty/error truth.
assert.ok(
  resident.includes("if(result.ok){if(result.posts.length)render(result.posts);else notice('현재 공개된 주민소식이 없습니다.');return}"),
  'resident news empty server collection must render an honest empty state'
);
assert.ok(
  resident.includes("notice('주민소식을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');"),
  'resident news server failure must fail closed instead of showing built-in resident stories'
);
assert.ok(
  !resident.includes("console.info('[danjion] 주민소식을 불러오는 중입니다. 기존 콘텐츠를 유지합니다.')"),
  'resident news production wiring must not advertise preservation of prototype resident content'
);

// 4) Community: canonical server mode clears prototype residents immediately,
// then renders only server rows or truthful loading/empty/error states.
assert.ok(
  community.includes("list.innerHTML=notice('이웃대화를 불러오는 중입니다.');"),
  'community must clear prototype resident posts before awaiting server authority'
);
assert.ok(
  community.includes("아직 등록된 이웃대화가 없습니다."),
  'community empty server collection must render an honest empty state'
);
assert.ok(
  !community.includes("community fallback preserved"),
  'community server errors must not preserve prototype resident posts'
);

console.log('leaf-b465-content-fallback-contract: PASS');
