// Issue #817: 아파트소식 must split its two server-authoritative presentation
// modes into two real surfaces:
//   * display_mode 'highlight' keeps the lightweight native-dialog popup on 08
//     (reader semantics, Escape/back, shareable ?post=).
//   * display_mode 'article' no longer widens that dialog; it navigates to the
//     dedicated detail page 08A_아파트소식_상세.html?post=<uuid>, which renders
//     getPost server data with the reused official-news 공감 contract.
// The list also reads apartment_news and management_office side by side through
// the existing single-channel server contract. Static, deterministic, offline.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [list, detail] = await Promise.all([
  readFile(new URL('08_아파트소식_목록.html', root), 'utf8'),
  readFile(new URL('08A_아파트소식_상세.html', root), 'utf8')
]);

/* ---------------- 08 list: routing split ---------------- */

assert.ok(detail.includes('<title>단지온 · 아파트소식 상세</title>'),
  'the canonical article detail surface must exist as its own page');

assert.ok(list.includes("const ARTICLE_DETAIL_PAGE = '08A_아파트소식_상세.html';"),
  '08 names the dedicated detail page as the article target');
assert.ok(list.includes('post.displayMode === \'article\'') &&
          list.includes('location.href = articleDetailHref(post.id)'),
  'HIGHLIGHT_OPENS_POPUP/ARTICLE_OPENS_DETAIL_PAGE: a server article must navigate to the detail page, never open the popup');
assert.ok(list.includes("row.dataset.displayMode === 'article'") &&
          list.includes('location.href = articleDetailHref(pid)'),
  'article rows carry the server-authored mode and navigate without a popup round-trip');
assert.ok(list.includes("if (pushUrl) pushPostUrl(pid);"),
  'only confirmed highlight popups claim the shareable ?post= URL');
assert.ok(list.includes('dialog.classList.toggle(\'reader\', article)') &&
          list.includes("<dialog id=\"storyDialog\">"),
  'the lightweight popup lane keeps the native dialog and its Escape/back semantics');

/* ---------------- 08 list: two official channels ---------------- */

assert.ok(list.includes("bridge.listPosts('apartment_news')") &&
          list.includes("bridge.listPosts('management_office')") &&
          list.includes('Promise.all'),
  'APARTMENT_NEWS_CHANNEL_VISIBLE/MANAGEMENT_OFFICE_CHANNEL_VISIBLE: both official channels are read in parallel through the existing channel contract');
assert.ok(list.includes('mergeNewsResults'),
  'the merged feed must have one named merge owner');
assert.ok(list.includes("(Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0)"),
  'the merged feed is ordered by server publishedAt, newest first');
assert.ok(list.includes('seen.has(row.id)'),
  'a duplicated id across channel reads must collapse to one row (one post, one channel)');
assert.ok(list.includes("posts.find(p => p.channel === 'chair_greeting')") &&
          list.includes("posts.filter(p => p.channel !== 'chair_greeting')"),
  'CHAIR_GREETING_PRESERVED: the chair feature lane keeps its server-channel contract');
assert.ok(list.includes('<i class="mode-badge">장문</i>'),
  'article rows stay visually distinguishable in the list via the existing mode badge');
assert.ok(list.includes("p.authorityLabel ? p.authorityLabel + ' · ' + categoryLabel(p.category) : categoryLabel(p.category)"),
  'list rows label their server authority so 입주자대표회의 and 관리사무소 are tellable in one feed');
assert.ok(!list.includes("bridge.listPosts('all')"),
  'the list must not dump every channel (danjion_notice stays out of 아파트소식)');

/* ---------------- 08A detail: server-authoritative rendering ---------------- */

assert.ok(detail.includes('DanjionSession.danjionApiBase()') &&
          detail.indexOf('assets/danjion-session.js') < detail.indexOf('DanjionSession.danjionApiBase()'),
  'the detail page resolves apiBase through the canonical session runtime before first use');
assert.ok(!detail.includes("get('apiBase')"),
  'the detail page must not read ?apiBase= outside the canonical resolver');
assert.ok(detail.includes("new URLSearchParams(location.search).get('post')"),
  'ARTICLE_DEEP_LINK/ARTICLE_REFRESH: the detail page hydrates from the stable ?post= uuid on every load');
assert.ok(detail.includes('bridge.getPost(postId)') && detail.includes('if (!POST_UUID.test'),
  'the body renders from server getPost data and malformed ids fail closed');
assert.ok(detail.includes('function notFound()') &&
          detail.includes('이 소식을 찾을 수 없거나 공개되지 않았습니다') &&
          detail.includes('아파트소식 목록으로 돌아가기'),
  'a missing post must never strand the reader on a broken blank screen');
assert.ok(detail.includes('href="08_아파트소식_목록.html"') &&
          detail.includes('apartmentDetail:FILES.apartment'),
  'ARTICLE_BACK: the detail page returns to the 아파트소식 list (link + router parent)');

assert.ok(detail.includes('post.authorityLabel ? `${post.authorityLabel} · ${kindLabel}` : kindLabel'),
  'ARTICLE_AUTHORITY_LABEL: 입주자대표회의 · 회의결과 / 관리사무소 · 생활안내 come from the server authority key mirror');
assert.ok(detail.includes('categoryLabel(post.category)') &&
          detail.includes('INTERNAL_CATEGORY'),
  'ARTICLE_CATEGORY: human labels render, internal slugs fall back to 아파트소식 (RAW_CATEGORY_SLUG_HIDDEN)');
assert.ok(detail.includes('formatDate(post.publishedAt)') &&
          detail.includes('renderParagraphs(post.body'),
  'ARTICLE_BODY: 게시일 and the long-form body render from server data');
assert.ok(detail.includes('node.textContent = paragraph'),
  'article paragraphs are text nodes, never re-injected HTML');
assert.ok(detail.includes('replace(/\\\\r\\\\n|\\\\n|\\\\r/g'),
  'literal and real newline forms are both honoured as paragraph boundaries');
assert.equal(detail.includes('.innerHTML ='), false,
  'the detail page must not use an innerHTML write path');

/* ---------------- 08A detail: reused 공감 contract ---------------- */

assert.ok(detail.includes('bridge.getReaction(postId)') &&
          detail.includes('bridge.setReaction(activePost.id, !activePost.active)'),
  'REACTION_VISIBLE/REACTION_TOGGLE_CONTRACT: 공감 reuses the official-news bridge endpoints, no new reaction system');
assert.ok(detail.includes("result.data?.reactionCount") &&
          detail.includes('paintReaction'),
  'REACTION_COUNT: only the server-read reactionCount is painted');
for (const key of ['login-required', 'resident-verification-required', 'forbidden', 'not-found', 'server-mode-required']) {
  assert.ok(detail.includes(key), `the ${key} boundary must stay distinguishable (#765)`);
}
assert.ok(detail.includes('session.fetchSession(fetch)') &&
          detail.includes('nativeSessionReady'),
  'a signed-out visitor sees the login boundary, never a verification prompt');
assert.equal(detail.includes("method: 'POST'"), false,
  'reactions must flow through the bridge only; the page keeps no direct write call');

/* ---------------- attachment scope discipline ---------------- */

assert.equal(detail.includes('attachment_object_key') || detail.includes('attachmentObjectKey') || detail.includes('<img'), false,
  'MULTI_IMAGE_NOT_ADDED: no public-URL contract exists yet, so the detail page renders no invented attachment surface');

/* ---------------- runtime syntax stays valid ---------------- */

const listModule = list.match(/<script type="module">([\s\S]*?)<\/script>/);
assert.ok(listModule, '08 keeps its module wiring');
const detailModule = detail.match(/<script type="module">([\s\S]*?)<\/script>/);
assert.ok(detailModule, '08A exposes its module wiring');
const detailRouter = detail.match(/<script id="danjion-direct-router-v5">([\s\S]*?)<\/script>/);
assert.ok(detailRouter && detailRouter[1].includes('"08A_아파트소식_상세.html"'),
  'the shared router registers the new detail file');

console.log('news-apartment-article-detail-08a-contract: PASS #817 highlight popup vs article detail + dual channels + reused reaction contract');
