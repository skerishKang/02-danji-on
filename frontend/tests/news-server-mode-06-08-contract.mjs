import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Issue #358 [News Server Mode]: repair the three server-mode defects that #354 deliberately
// left out of scope, without disturbing any of the #354 sibling-final-v3 authority
// restorations (authority a2e856de522f77793ced0718cf58ab4b2d210732).
//
//   1. 06 — the static .pinned sibling and a server-injected .pinned produced two pinned cards
//   2. 06 — renderPosts() replaced .notice-list innerHTML and destroyed #noticeEmpty
//   3. 08 — the server feature link carried ?postId= in href but the router read dataset.postId
//
// Bounded, offline, deterministic: static source assertions only.

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(here, '..');
const read = (name) => readFile(path.join(FRONTEND, name), 'utf8');

const LIST = '06_단지온공지_목록.html';
const DETAIL = '07_단지온공지_상세.html';
const APARTMENT = '08_아파트소식_목록.html';

const [list, detail, apartment] = await Promise.all([read(LIST), read(DETAIL), read(APARTMENT)]);

const countOf = (haystack, needle) => haystack.split(needle).length - 1;
const idx = (haystack, needle, label) => {
  const at = haystack.indexOf(needle);
  assert.ok(at > -1, `${label}: expected to find ${JSON.stringify(needle)}`);
  return at;
};

// ---------------------------------------------------------------------------
// 1. 06 defect 1 — one pinned card in server mode
// ---------------------------------------------------------------------------
// The sibling-final-v3 pinned card is the single pinned slot and stays the only pinned
// element in the document source; the server render no longer fabricates a second one.
assert.equal(
  countOf(list, '<article class="pinned"'),
  1,
  '06 must declare exactly one pinned card element (the sibling-final-v3 slot)'
);
assert.ok(
  list.includes('<article class="pinned" data-kind="essential">'),
  '06 sibling pinned markup from #354 must remain unchanged'
);
assert.ok(
  list.includes("let pinnedSlot = document.querySelector('.notice-layout > .pinned');"),
  '06 must resolve the existing sibling .pinned slot as the server render target'
);
assert.ok(
  list.includes('function renderPinned(pinned) {'),
  '06 must render the pinned card through the existing slot'
);
assert.ok(
  list.includes('renderPinned(pinned);'),
  '06 renderPosts must delegate the pinned card to the slot renderer'
);
assert.ok(
  list.includes('pinnedSlot.dataset.postId = pinned.id;'),
  '06 must expose the server post id on the pinned slot so detail routing works'
);
assert.ok(
  list.includes('pinnedSlot.remove();'),
  '06 must drop the sibling demo card when the server has no pinned post'
);
// The duplicate-producing path is gone: renderPosts must not build a pinned article and must
// not concatenate one into the .notice-list innerHTML.
assert.ok(
  !list.includes('const pinnedHtml = pinned ?'),
  '06 must not build a standalone pinnedHtml block any more'
);
assert.ok(
  !list.includes('${pinnedHtml}'),
  '06 must not inject a second pinned card into .notice-list'
);
assert.ok(
  list.includes('<div class="list-head"><h2>전체 공지</h2></div>${noticeHtml}'),
  '06 server render must keep the sibling list head structure'
);

// ---------------------------------------------------------------------------
// 2. 06 defect 2 — server empty state stays truthful
// ---------------------------------------------------------------------------
assert.ok(
  list.includes('const emptyState = () => document.getElementById(\'noticeEmpty\');'),
  '06 must resolve the empty state node on demand instead of capturing a stale reference'
);
assert.ok(
  !list.includes('emptyMsg'),
  '06 must not keep the stale captured empty-state reference'
);
assert.ok(
  list.includes('<p class="notice-empty" id="noticeEmpty" hidden>검색 결과가 없습니다.</p>'),
  '06 server render must re-emit the sibling-final-v3 empty state node'
);
assert.equal(
  countOf(list, 'id="noticeEmpty"'),
  2,
  '06 must keep the static empty state and re-emit one for the server render'
);
assert.ok(
  list.includes('const empty = emptyState();') && list.includes('if (empty) empty.hidden = shown !== 0;'),
  '06 empty state visibility must be driven by the shared filter'
);
// One filtering authority: renderPosts must hand off to the sibling filter rather than keep
// its own visibleCount path.
assert.ok(
  !list.includes('visibleCount'),
  '06 must not keep the ad-hoc visibleCount empty-state path'
);
assert.ok(
  list.includes('  applyNoticeFilter();\n}\n\nasync function loadPosts() {'),
  '06 renderPosts must run the sibling filter as its final step after the server render'
);
// Server rows must always be filter members, otherwise the empty state could show while rows
// are visible. data-category must never be rendered empty.
assert.ok(
  !list.includes('data-category="${p.category || \'\'}"'),
  '06 server rows must not render an empty data-category that escapes the filter set'
);
assert.ok(
  list.includes('data-category="${p.category || p.channel || \'danjion_notice\'}"'),
  '06 server rows must fall back to the channel so they stay filter members'
);
// The #354 demo filter semantics are untouched.
assert.ok(
  list.includes("document.querySelectorAll('.notice-row, .pinned')"),
  '06 sibling filter set from #354 must remain unchanged'
);
assert.ok(
  list.includes('el.dataset.category || el.dataset.kind'),
  '06 sibling filter predicate from #354 must remain unchanged'
);

// ---------------------------------------------------------------------------
// 3. 08 defect 3 — server feature navigation preserves postId
// ---------------------------------------------------------------------------
assert.ok(
  apartment.includes('const href=el.getAttribute(\'href\')||\'\';'),
  '08 feature-link branch must read the anchor href'
);
assert.ok(
  apartment.includes("try{hrefPostId=new URLSearchParams(href.split('?').slice(1).join('?')).get('postId')||'';}catch(e){hrefPostId='';}"),
  '08 must extract postId from the href query string'
);
assert.ok(
  apartment.includes("const pid = el.dataset.postId || (el.closest('[data-post-id]')?.dataset.postId) || hrefPostId || '';"),
  '08 must fall back to the href postId when no data attribute carries it'
);
assert.ok(
  apartment.includes("go(FILES.chair + (pid ? '?postId=' + encodeURIComponent(pid) : ''));"),
  '08 must route to the chair detail with the preserved postId'
);
assert.ok(
  apartment.includes('href="09_회장인사_상세.html?postId=${chair.id}"'),
  '08 server render must keep emitting the postId on the feature link'
);
assert.ok(
  apartment.includes('<a class="feature-link" href="09_회장인사_상세.html">'),
  '08 sibling demo feature link must stay query-free'
);
assert.ok(
  apartment.includes('if(SCREEN===\'apartment\' && cls.contains(\'feature-link\'))'),
  '08 must keep the explicit apartment feature-link route'
);
// #354 restorations on 08 must be untouched.
assert.ok(
  apartment.includes("event.target.closest('[data-story], [data-post-id]')"),
  '08 delegated dialog binding from #354 must remain unchanged'
);
assert.ok(
  apartment.includes("document.querySelectorAll('[data-kind], [data-post-id]')"),
  '08 sibling filter set from #354 must remain unchanged'
);
assert.ok(
  apartment.includes('data-story="meeting"') && apartment.includes('data-kind="chair"'),
  '08 sibling static markup must remain unchanged'
);

// ---------------------------------------------------------------------------
// 4. #354 authority restorations elsewhere stay untouched
// ---------------------------------------------------------------------------
assert.ok(
  detail.includes('<script id="notice-renderer-20260906">'),
  '07 sibling-final-v3 renderer from #354 must remain in place'
);
assert.ok(
  detail.includes('if(__noticeApiBase&&__noticeServerPostId)return;'),
  '07 sibling renderer gate from #354 must remain in place'
);
assert.ok(
  list.includes("go(FILES.noticeDetail+'?postId='+encodeURIComponent(postId)"),
  '06 server postId detail route from #354 must remain in place'
);
assert.ok(
  list.includes("if(el.dataset.notice==='biz'){go(FILES.noticeDetail+'?notice=biz');return;}"),
  '06 sibling ?notice= fallback from #354 must remain in place'
);
assert.ok(
  list.includes('<article class="pinned" data-kind="essential">') &&
    list.includes('data-notice="level"'),
  '06 sibling demo markup must remain unchanged'
);
// The repair must stay on the client: no persistence, no schema, no server mutation.
assert.ok(
  !list.includes("method: 'POST'") && !apartment.includes("method: 'POST'"),
  '06/08 must not gain a persistence write path'
);
for (const [name, src] of [[LIST, list], [DETAIL, detail], [APARTMENT, apartment]]) {
  assert.ok(!/\bmigration\b/i.test(src), `${name} must not touch migrations`);
  assert.ok(!/CREATE TABLE|ALTER TABLE/i.test(src), `${name} must not contain schema DDL`);
  assert.ok(!/indexedDB/.test(src), `${name} must never touch client-side databases`);
}

// ---------------------------------------------------------------------------
// 5. demo path is untouched — the slot is only rendered after a successful server read
// ---------------------------------------------------------------------------
assert.ok(
  idx(list, 'if (result.ok) {', '06 server-success gate') <
    idx(list, 'renderPosts(result.data);', '06 renderPosts call'),
  '06 renderPosts must only run on a successful server response, so demo mode never touches the slot'
);
assert.ok(
  idx(list, 'function renderPosts(posts) {', '06 renderPosts definition') <
    idx(list, 'loadPosts();', '06 loadPosts invocation'),
  '06 renderPosts must be defined before loadPosts() runs'
);
assert.ok(
  idx(list, "const searchInput = document.querySelector('#searchForm input');", '06 searchInput init') <
    idx(list, 'loadPosts();', '06 loadPosts invocation'),
  '06 searchInput must be initialised before loadPosts() can reach applyNoticeFilter()'
);

console.log('NEWS_SERVER_MODE_06_08_CONTRACT_PASS');
