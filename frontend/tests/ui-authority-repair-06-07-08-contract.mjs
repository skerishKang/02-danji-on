import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Issue #354 [UI Authority Repair]: restore the sibling-final-v3 (authority
// a2e856de522f77793ced0718cf58ab4b2d210732) demo behavior for the 06/07/08 news
// surfaces that commit 6a1c0e0 (#326/#335) unintentionally replaced, while keeping
// the danjion-news-bridge server wiring and apiBase behavior intact.
//
// Bounded, offline, deterministic: static source assertions only.

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(here, '..');
const read = (name) => readFile(path.join(FRONTEND, name), 'utf8');

const LIST = '06_단지온공지_목록.html';
const DETAIL = '07_단지온공지_상세.html';
const APARTMENT = '08_아파트소식_목록.html';

const [list, detail, apartment] = await Promise.all([read(LIST), read(DETAIL), read(APARTMENT)]);

// ---------------------------------------------------------------------------
// 1. 06 — demo filter compatibility + ?notice= fallback restored
// ---------------------------------------------------------------------------
assert.ok(
  list.includes("document.querySelectorAll('.notice-row, .pinned')"),
  '06 filter must consider both sibling rows and the pinned card'
);
assert.ok(
  list.includes('el.dataset.category || el.dataset.kind'),
  '06 filter set must accept data-category (server) or data-kind (sibling demo)'
);
assert.ok(
  list.includes('const kind = row.dataset.category || row.dataset.kind') ||
    list.includes("row.dataset.category || row.dataset.kind || ''"),
  '06 filter predicate must fall back from data-category to data-kind'
);
assert.ok(
  list.includes("head.textContent = rawQuery ? `“${rawQuery}” 검색 결과` : '전체 공지'"),
  '06 search result list-head copy from sibling-final-v3 must be restored'
);

// server postId path preserved
assert.ok(
  list.includes("go(FILES.noticeDetail+'?postId='+encodeURIComponent(postId)"),
  '06 must keep the #335 server postId detail route'
);
// sibling ?notice= fallback restored, and only after the server postId branch
const postIdIdx = list.indexOf("go(FILES.noticeDetail+'?postId='+encodeURIComponent(postId)");
const noticeFallbackIdx = list.indexOf("if(el.dataset.notice==='biz'){go(FILES.noticeDetail+'?notice=biz');return;}");
assert.ok(noticeFallbackIdx > -1, '06 must restore the sibling ?notice= fallback chain');
assert.ok(postIdIdx > -1 && postIdIdx < noticeFallbackIdx, '06 server postId branch must precede the demo fallback');
for (const key of ['biz', 'writing', 'message', 'level', 'first']) {
  assert.ok(
    list.includes(`notice=${key}`),
    `06 demo fallback must cover ?notice=${key}`
  );
}
assert.ok(
  list.includes("if(el.dataset.kind==='guide'||el.dataset.notice==='first')"),
  '06 guide/first demo fallback from sibling-final-v3 must be preserved verbatim'
);
// sibling static markup untouched
assert.ok(list.includes('<article class="pinned" data-kind="essential">'), '06 pinned sibling markup must be unchanged');
assert.ok(list.includes('data-notice="biz"'), '06 sibling data-notice rows must remain in static markup');
assert.ok(list.includes('data-notice="level"'), '06 sibling level row must remain in static markup');
// server bridge preserved
assert.ok(list.includes("bridge.listPosts('danjion_notice')"), '06 must keep the server list route');

// ---------------------------------------------------------------------------
// 2. 07 — sibling NOTICES renderer restored behind an apiBase/server-postId gate
// ---------------------------------------------------------------------------
assert.ok(
  detail.includes('<script id="notice-renderer-20260906">'),
  '07 must restore the sibling-final-v3 notice renderer'
);
assert.ok(
  detail.includes('if(__noticeApiBase&&__noticeServerPostId)return;'),
  '07 sibling renderer must yield when a server-authoritative postId is selected'
);
assert.ok(
  detail.includes("__noticeParams.get('postId')") && detail.includes('__noticeServerPostId'),
  '07 sibling gate must only yield for a UUID server postId'
);
for (const key of ['first:', 'biz:', 'message:', 'level:']) {
  assert.ok(detail.includes(key), `07 sibling renderer must still define NOTICES.${key.slice(0, -1)}`);
}
for (const anchor of ['menus', 'privacy', 'privacyList', 'apply', 'check', 'info', 'benefit', 'review', 'start', 'shop', 'safe', 'manner', 'type', 'how', 'rule', 'ai', 'lvLevels', 'lvScore', 'lvNote']) {
  assert.ok(detail.includes(`'${anchor}'`), `07 sibling renderer index entry ${anchor} must be restored`);
}
assert.ok(
  detail.includes('document.getElementById("noticeContent").innerHTML=data.html'),
  '07 sibling renderer must repopulate #noticeContent'
);
// server path preserved and still UUID-gated
assert.ok(detail.includes("import { createNewsBridge, DANJION_COMPLEX_SLUG } from './assets/danjion-news-bridge.js';"), '07 must keep the server bridge import');
assert.ok(detail.includes('await bridge.getPost(postId)'), '07 must keep the server detail route');
assert.ok(detail.includes('const SERVER_POST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;'), '07 server postId must be UUID-validated');
assert.ok(
  !detail.includes("params.get('postId') || params.get('notice')"),
  '07 must no longer feed the demo ?notice= key into the server bridge'
);
// renderer must be a classic inline script placed before the deferred module
assert.ok(
  detail.indexOf('<script id="notice-renderer-20260906">') < detail.indexOf('<script type="module">'),
  '07 sibling renderer must be declared before the server module script'
);

// ---------------------------------------------------------------------------
// 3. 08 — sibling [data-story] dialog + demo filter semantics restored
// ---------------------------------------------------------------------------
for (const key of ['meeting:', 'business:', 'record:']) {
  assert.ok(apartment.includes(key), `08 sibling stories.${key.slice(0, -1)} must be restored`);
}
assert.ok(
  apartment.includes("title: '주민 안내문자·방송·게시판 홍보 협조 논의'"),
  '08 sibling story copy must be restored verbatim'
);
assert.ok(
  apartment.includes("event.target.closest('[data-story], [data-post-id]')"),
  '08 must handle sibling [data-story] rows and server [data-post-id] rows'
);
assert.ok(
  apartment.includes("const story = stories[row.dataset.story];"),
  '08 sibling story lookup must be restored'
);
assert.ok(
  apartment.includes("document.addEventListener('click', event => {"),
  '08 row binding must be delegated so server-rendered rows are clickable'
);
assert.ok(
  !apartment.includes("document.querySelectorAll('[data-post-id]').forEach(button => button.addEventListener"),
  '08 must not keep the one-shot server-only binding that left sibling rows inert'
);
assert.ok(
  apartment.includes("document.querySelectorAll('[data-kind], [data-post-id]')"),
  '08 filter set must include sibling [data-kind] items and server rows'
);
assert.ok(
  apartment.includes('const kind = item.dataset.kind || \'\';'),
  '08 filter predicate must consult sibling data-kind first'
);
assert.ok(
  apartment.includes("if (kind) return kind === button.dataset.filter;"),
  '08 sibling data-kind comparison must be restored'
);
assert.ok(
  apartment.includes("(item.querySelector('.type')?.textContent || '').includes(button.textContent.trim())"),
  '08 server-row filter behavior from #335 must be preserved'
);
// sibling static markup untouched
assert.ok(apartment.includes('data-story="meeting"'), '08 sibling data-story rows must remain in static markup');
assert.ok(apartment.includes('data-kind="chair"'), '08 sibling feature data-kind must remain');
assert.ok(apartment.includes('<dialog id="storyDialog">'), '08 dialog shell must be unchanged');
assert.ok(apartment.includes('data-close-story'), '08 dialog close controls must be unchanged');
// server bridge preserved
assert.ok(apartment.includes("bridge.listPosts('apartment_news')"), '08 must keep the server list route');
assert.ok(apartment.includes('bridge.getPost(pid)'), '08 must keep the server detail route');
assert.ok(apartment.includes("import { createNewsBridge, DANJION_COMPLEX_SLUG } from './assets/danjion-news-bridge.js';"), '08 must keep the server bridge import');

// ---------------------------------------------------------------------------
// 4. scope guards — no backend/schema/migration/redesign surface in this repair
// ---------------------------------------------------------------------------
for (const [name, src] of [[LIST, list], [DETAIL, detail], [APARTMENT, apartment]]) {
  assert.ok(!/\bmigration\b/i.test(src), `${name} must not touch migrations`);
  assert.ok(!/CREATE TABLE|ALTER TABLE/i.test(src), `${name} must not contain schema DDL`);
  assert.ok(!/indexedDB/.test(src), `${name} must never touch client-side databases`);
}

console.log('UI_AUTHORITY_REPAIR_06_07_08_CONTRACT_PASS');
