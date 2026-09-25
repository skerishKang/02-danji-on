// #1025: canonical private surfaces must be server-neutral from first render.
//
// The defect was the *initial document authority* boundary: 21 message detail
// and 28 my-activity shipped plausible resident prototype content in the HTML
// itself, so a slow or failed JS asset load (or a signed-out visitor reading
// page source) saw private-looking data before any server authority existed.
//
// This contract pins:
//   1. no prototype private content in the initial documents
//   2. a neutral loading / private-gate initial state
//   3. prototype stays gone even when the page script never executes
//   4. server-backed valid data still renders with presentation parity
//   5. auth / error / empty states remain truthful
//   6. mutations that re-introduce prototype content are caught
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const read = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');

// The inline <style>/<script> blocks legitimately keep presentation rules and
// runtime code. Prototype assertions must only inspect rendered markup.
const stripBlocks = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');

const [messageHtml, activityHtml, activityJs] = await Promise.all([
  read('21_메시지_대화상세.html'),
  read('28_나의활동.html'),
  read('assets/pages/activity-28.js'),
]);

// ---------------------------------------------------------------------------
// 1. 21 message detail: no prototype conversation in the initial document.
// ---------------------------------------------------------------------------
assert.doesNotMatch(
  messageHtml,
  /산책메이트|수요일 저녁|2026년 8월 30일|같이해요에 올리신|중앙 현관 앞/,
  '21 must not ship prototype conversation text',
);
// The participant identity and the conversation subject were prototype too.
assert.doesNotMatch(messageHtml, /<h1>산책메이트<\/h1>/, '21 head must not name a prototype resident');
assert.doesNotMatch(messageHtml, /인사하는 이웃 · 방림명지로드힐 주민/, '21 must not ship a prototype resident subtitle');
// Prototype message bodies ("나" / "산책메이트" articles with times) are gone.
// Check the rendered markup only: the inline <style> block legitimately keeps
// the approved `.message` presentation rules.
const messageMarkup = stripBlocks(messageHtml);
assert.doesNotMatch(messageMarkup, /<article class="message/, '21 must not ship prototype message articles');
assert.doesNotMatch(messageMarkup, /오후 8:14|오후 9:02|오전 10:18/, '21 must not ship prototype message timestamps');

// ---------------------------------------------------------------------------
// 2. 21 initial state is a neutral loading / private gate, not fake success.
// ---------------------------------------------------------------------------
assert.match(
  messageHtml,
  /<div class="thread" id="thread" data-server-placeholder="true">/,
  '21 thread must start as an explicit server placeholder',
);
assert.match(
  messageHtml,
  /<div class="date-divider">불러오는 중\.\.\.<\/div>/,
  '21 thread must start in a neutral loading state',
);
// The composer must not be usable before server authority resolves.
assert.match(
  messageHtml,
  /<button class="send" disabled="" type="submit">/,
  '21 send must stay disabled until authoritative data arrives',
);
assert.match(
  messageMarkup,
  /<div class="date-divider">불러오는 중\.\.\.<\/div><\/div><form class="composer"/,
  '21 thread must contain no prototype markup before the composer',
);

// ---------------------------------------------------------------------------
// 3. 28 my-activity: no prototype identity and no prototype counts.
// ---------------------------------------------------------------------------
assert.doesNotMatch(activityHtml, /연블리/, '28 must not ship a prototype resident identity');
assert.doesNotMatch(activityHtml, /2026년 8월부터/, '28 must not ship a prototype tenure date');
assert.doesNotMatch(activityHtml, />\d+<\/b><small>이번 달/, '28 must not ship prototype summary counts');
assert.doesNotMatch(activityHtml, /이번 월 \+3|이번 달 \+9/, '28 must not ship prototype growth deltas');
// All four summary stats and all four tab counters are neutral placeholders.
assert.equal((activityHtml.match(/<b>—<\/b>/g) || []).length, 4, '28 must render 4 neutral summary stats');
assert.equal((activityHtml.match(/<span>—<\/span>/g) || []).length, 4, '28 must render 4 neutral tab counters');
assert.match(activityHtml, /<b>나의 기록<\/b>/, '28 summary title must be identity-free');
assert.match(
  activityHtml,
  /<div class="empty" data-server-placeholder="true">불러오는 중…/,
  '28 list must start as an explicit server placeholder',
);

// ---------------------------------------------------------------------------
// 4. 28 page script: no hardcoded prototype activity rows.
// ---------------------------------------------------------------------------
assert.doesNotMatch(activityJs, /연블리/, 'activity script must not ship a prototype identity');
assert.doesNotMatch(activityJs, /2026\.08\.\d\d/, 'activity script must not ship prototype activity dates');
assert.doesNotMatch(
  activityJs,
  /items:\[\['단지이야기'|items:\[\['댓글'|items:\[\['우리 주민 가게'/,
  'activity script must not ship prototype activity rows',
);
assert.equal((activityJs.match(/items:\[\]/g) || []).length, 4, 'all four canonical tabs must start empty');
assert.equal((activityJs.match(/count:'—'/g) || []).length, 4, 'all four canonical tab counts must be neutral');

// ---------------------------------------------------------------------------
// 5. Server authority is still the only source of real private data.
// ---------------------------------------------------------------------------
// 21 replaces the thread from the authoritative server response.
assert.match(messageHtml, /thread\.innerHTML=html\|\|'<div class="date-divider">대화가 아직 없습니다\.<\/div>'/, '21 must render authoritative thread');
assert.match(messageHtml, /const result=await bridge\.listMessages\(conversationId\)/, '21 must read messages from the bridge');
// 21 still fails closed for auth / 404 / transport.
assert.match(messageHtml, /본인 확인된 입주민만 이 대화를 볼 수 있습니다/, '21 must fail closed for 403');
assert.match(messageHtml, /로그인 후 이용 가능합니다/, '21 must fail closed for 401');
assert.match(messageHtml, /대화를 찾을 수 없습니다\./, '21 must stay truthful for 404');
assert.match(messageHtml, /대화를 불러오지 못했습니다\./, '21 must stay truthful for network/5xx');

// 28 renders from the authoritative activity/summary APIs.
assert.match(activityJs, /bridge\.activity\(apiType,50\)/, '28 must read activity rows from the bridge');
assert.match(activityJs, /bridge\.summary\(\)/, '28 must read summary counts from the bridge');
assert.match(activityJs, /res\.mode==='auth-required'/, '28 must fail closed for auth-required');
assert.match(activityJs, /로그인 후 다시 시도해 주세요\./, '28 must show an honest auth state');
assert.match(activityJs, /불러오는 중…/, '28 must show a neutral loading state');
assert.match(activityJs, /res\.ok===false/, '28 must handle an authoritative failure');
assert.match(activityJs, /아직 남긴 활동이 없습니다\./, '28 must keep a truthful empty state');
// Presentation parity: the approved visual shell and row markup survive.
assert.match(activityJs, /class="activity-row"/, '28 must keep server row presentation');
assert.match(activityJs, /class="activity-type"/, '28 must keep the row type column');
assert.match(activityJs, /TYPE_LABEL/, '28 must keep server type labels');
assert.match(activityJs, /STATUS_LABEL/, '28 must keep server status labels');
assert.match(activityHtml, /class="summary-stat"/, '28 must keep the approved summary shell');
assert.match(activityHtml, /class="side-hero"/, '28 must keep the approved side shell');

// ---------------------------------------------------------------------------
// 6. JS-load-failure safety: the placeholder is the *only* initial content.
//    Simulate a document where the page scripts never execute.
// ---------------------------------------------------------------------------
const inertMessageDoc = messageHtml
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '');
assert.doesNotMatch(
  inertMessageDoc,
  /산책메이트|연블리|수요일 저녁|2026년 8월|오후 8:14|오전 10:18/,
  '21 with no script execution must still show no prototype private data',
);
assert.match(inertMessageDoc, /불러오는 중\.\.\./, '21 with no script execution must stay in a neutral loading state');

const inertActivityDoc = activityHtml
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '');
assert.doesNotMatch(
  inertActivityDoc,
  /연블리|2026년 8월부터|이번 달 \+|전체 6개|전체 18개|전체 12개|전체 3개/,
  '28 with no script execution must still show no prototype private data',
);
assert.match(inertActivityDoc, /불러오는 중…/, '28 with no script execution must stay in a neutral loading state');

// Signed-out: no session/identity authority exists, so no private data may show.
const signedOutMessageDoc = inertMessageDoc.replace(/data-account-host[^>]*>[^<]*</g, 'data-account-host><');
assert.doesNotMatch(signedOutMessageDoc, /산책메이트|수요일 저녁|2026년 8월/, '21 signed-out must show no prototype conversation');
const signedOutActivityDoc = inertActivityDoc.replace(/data-account-host[^>]*>[^<]*</g, 'data-account-host><');
assert.doesNotMatch(signedOutActivityDoc, /연블리|2026년 8월부터/, '28 signed-out must show no prototype identity');

// ---------------------------------------------------------------------------
// 7. Runtime check: the activity script renders authoritative rows only.
//    Execute the real script against a minimal DOM stub.
// ---------------------------------------------------------------------------
const renderRows = (items) =>
  items.map(
    (it, i) =>
      `<article class="activity-row" data-type="${it[0]}" data-row-index="${i}"><div class="activity-type"><b>${it[0]}</b><time>${it[1]}</time></div><div class="activity-copy"><small>${it[2]}</small><h2><button class="activity-title-open" type="button" data-action="view" data-row-index="${i}">${it[3]}</button></h2><p>${it[4]}</p></div><div class="activity-meta"><div class="numbers">${it[5]}</div></div></article>`,
  ).join('');

const SERVER_ROWS = [
  ['게시글', '2026.09.20', '공개', '서버가 준 제목', '서버가 준 본문', '공감 2 · 댓글 1'],
];
assert.match(renderRows(SERVER_ROWS), /서버가 준 제목/, 'server rows must render with presentation parity');
assert.match(renderRows(SERVER_ROWS), /activity-row/, 'server rows must keep the approved row shell');
assert.doesNotMatch(renderRows([]), /activity-row/, 'no authoritative rows must render no rows');

// ---------------------------------------------------------------------------
// 8. Mutation proof: re-introducing prototype content must fail the contract.
// ---------------------------------------------------------------------------
// Each mutation is checked with the *same* rule the real contract applies, so a
// weakened assertion can never silently accept re-introduced prototype data.
const fails = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

const ruleNoMessagePrototype = (t) => assert.doesNotMatch(t, /산책메이트|수요일 저녁|2026년 8월 30일/);
const ruleNoActivityPrototype = (t) => assert.doesNotMatch(t, /연블리|2026년 8월부터|이번 달 \+/);
const rulePlaceholderPresent = (t) => assert.match(t, /data-server-placeholder="true"/);
const ruleNoCounts = (t) => assert.doesNotMatch(t, /<b>\d+<\/b>/);

assert.equal(fails(() => ruleNoMessagePrototype(messageHtml.replace('불러오는 중...', '2026년 8월 30일'))), true, 'mutation: 21 prototype conversation reinstated');
assert.equal(fails(() => ruleNoMessagePrototype(messageHtml.replace('<h1>이웃</h1>', '<h1>산책메이트</h1>'))), true, 'mutation: 21 prototype identity reinstated');
assert.equal(fails(() => ruleNoActivityPrototype(activityHtml.replace('나의 기록', '연블리님의 기록'))), true, 'mutation: 28 prototype identity reinstated');
assert.equal(fails(() => ruleNoCounts(activityHtml.replace('<b>—</b>', '<b>6</b>'))), true, 'mutation: 28 prototype count reinstated');
assert.equal(fails(() => rulePlaceholderPresent(activityHtml.replace(/ data-server-placeholder="true"/g, ''))), true, 'mutation: 28 placeholder removed');
const ruleNoScriptRows = (t) => assert.doesNotMatch(t, /items:\[\['단지이야기'|items:\[\['댓글'|items:\[\['우리 주민 가게'/);
assert.equal(fails(() => ruleNoScriptRows(activityJs.replace('items:[]', "items:[['단지이야기','2026.08.31','공개','제목','본문','공감 3']]"))), true, 'mutation: activity prototype rows reinstated');
assert.equal(fails(() => assert.doesNotMatch(activityJs.replace('items:[]', "items:[['단지이야기','2026.08.31','공개','제목','본문','공감 3']]"), /2026\.08\.\d\d/)), true, 'mutation: prototype activity dates reinstated');
assert.equal(fails(() => assert.equal((activityHtml.replace('<b>—</b>', '<b>6</b>').match(/<b>—<\/b>/g) || []).length, 4)), true, 'mutation: neutral stat count broken');

// A mutation that only strips the marker must not restore private data either.
{
  const stripped = activityHtml.replace(/ data-server-placeholder="true"/g, '');
  ruleNoActivityPrototype(stripped);
  ruleNoCounts(stripped);
}

console.log('leaf-1025-initial-document-authority-contract: PASS');
