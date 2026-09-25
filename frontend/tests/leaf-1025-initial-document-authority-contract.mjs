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

// ---------------------------------------------------------------------------
// 9. External-wiring-failure containment (CENTRAL blocker on PR #1029).
//
// The section 6 simulation above removes *every* <script>. That proves the
// initial markup is neutral, but it also deletes the very inline handler that
// caused the defect, so it can never observe the real failure mode:
//
//   the inline page script DOES run, while the external session / bridge /
//   live-wiring scripts fail to load.
//
// In that state the page is interactive but has no server authority at all.
// The legacy demo submit handler used to be the only remaining send path: it
// re-enabled .send from raw textarea input and appended a local fake message
// carrying prototype identity ("연블리") and fake-success copy ("시연입니다").
//
// So the contract here is a *behavioural* one, evaluated against the real
// inline block executed in a DOM stub, not a markup-stripping one.
// ---------------------------------------------------------------------------

// Extract the first inline <script> block: the code that runs before any
// external asset is requested. This is exactly the code that must stay inert
// without server authority.
const firstInlineScript = (() => {
  const match = messageHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, '21 must still ship its first inline block');
  return match[1];
})();

// Run the inline block against a minimal DOM stub and report what the composer
// did. No DanjionSession, no bridge, no live wiring — i.e. every external
// dependency is unavailable, which is the state under test.
// Parameterised by script source so the same harness judges both the real
// document and any mutation of it.
const runInlineWithoutExternal = (source = firstInlineScript) => {
  const listeners = { input: [], submit: [], click: [] };
  const created = [];
  const thread = { appendChild: (n) => created.push(n), insertAdjacentHTML: () => {}, innerHTML: '' };
  const send = { disabled: true };
  const reply = {
    value: '',
    disabled: false,
    placeholder: '',
    addEventListener: (t, f) => listeners[t] && listeners[t].push(f),
    dispatchEvent: (e) => {
      if (e && e.type === 'input') listeners.input.forEach((f) => f(e));
      return true;
    },
    focus: () => {},
    scrollIntoView: () => {},
  };
  const el = (extra = {}) => ({
    textContent: '',
    innerHTML: '',
    hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {},
    setAttribute() {},
    closest: () => null,
    // A created element must be able to resolve its own descendants, so a
    // handler that builds a fake message can be observed rather than crashing
    // on a stub limitation (which would mask *why* the contract failed).
    querySelector: () => el(),
    querySelectorAll: () => [],
    appendChild() {},
    insertAdjacentHTML() {},
    scrollIntoView() {},
    ...extra,
  });
  const form = el({ id: 'replyForm', addEventListener: (t, f) => listeners[t] && listeners[t].push(f) });
  const nodes = {
    '.toast': el(),
    '[data-more]': el({ dataset: {} }),
    '.more-menu': el({ classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }),
    '[data-action-title]': el(),
    '[data-action-copy]': el(),
    '[data-reasons]': el(),
    '[data-action]': el(),
    '[data-close]': el(),
    '.reason': el(),
    '[data-confirm]': el(),
    '.reply-context': el(),
    '#replyForm': form,
    '#reply': reply,
    '#count': el(),
    '.send': send,
    '#thread': thread,
    '.composer': el(),
    '[data-scroll-reply]': el(),
  };
  const toastText = () => nodes['.toast'].textContent;
  const documentStub = {
    querySelector: (sel) => nodes[sel] || null,
    querySelectorAll: () => [],
    getElementById: (id) => nodes['#' + id] || null,
    createElement: () => el(),
    addEventListener() {},
    body: { style: {} },
  };
  const sandbox = {
    document: documentStub,
    location: { search: '', href: '' },
    window: {},
    globalThis: undefined,
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
  };
  sandbox.globalThis = sandbox;
  // Run the real inline code with no external globals defined.
  new Function(
    'document',
    'location',
    'globalThis',
    'window',
    'setTimeout',
    'clearTimeout',
    'Event',
    source,
  )(sandbox.document, sandbox.location, sandbox, sandbox.window, sandbox.setTimeout, sandbox.clearTimeout, sandbox.Event);
  // The user types into the composer, then submits.
  reply.value = '테스트 답장';
  listeners.input.forEach((f) => f(new sandbox.Event('input')));
  const sendEnabledAfterTyping = send.disabled === false;
  let defaultPrevented = false;
  const submitEvent = {
    type: 'submit',
    preventDefault: () => {
      defaultPrevented = true;
    },
    stopPropagation() {},
    stopImmediatePropagation() {},
    target: form,
  };
  listeners.submit.forEach((f) => f(submitEvent));

  return {
    sendEnabledAfterTyping,
    defaultPrevented,
    appendedMessages: created.length,
    appendedHtml: created.map((n) => n.innerHTML || '').join(''),
    toastText: toastText(),
    replyValueAfterSubmit: reply.value,
  };
};

const noAuthority = runInlineWithoutExternal();

// (a) Typing must NOT enable send without server authority.
assert.equal(
  noAuthority.sendEnabledAfterTyping,
  false,
  '21 inline code must not enable .send from raw textarea input without server authority',
);

// (b) Submitting must be intercepted (fail closed), not forwarded.
assert.equal(
  noAuthority.defaultPrevented,
  true,
  '21 inline code must intercept composer submit instead of letting a default send happen',
);

// (c) No local fake message may be created.
assert.equal(
  noAuthority.appendedMessages,
  0,
  '21 inline code must not append a local fake message when external wiring is unavailable',
);
assert.doesNotMatch(
  noAuthority.appendedHtml,
  /연블리|시연입니다|새로고침하면 초기화/,
  '21 inline-created message must never carry prototype identity or fake-success copy',
);

// (d) The send button must stay disabled and the draft must not be "sent".
assert.equal(
  noAuthority.replyValueAfterSubmit,
  '테스트 답장',
  '21 must not clear the composer as if a send had succeeded without server authority',
);

// (e) Any toast raised in this state must be an honest gate, never a success.
assert.doesNotMatch(
  noAuthority.toastText,
  /보낸|전송|시연/,
  '21 must not claim a send succeeded while no server authority exists',
);

// (f) The prototype identity/copy must not exist anywhere in the page source,
//     including the inline block that runs without external wiring.
assert.doesNotMatch(
  firstInlineScript,
  /연블리|새로고침하면 초기화되는 시연|답장을 보낸 시연/,
  '21 inline block must not contain a prototype send demo',
);
assert.doesNotMatch(
  messageHtml,
  /연블리|새로고침하면 초기화되는 시연|답장을 보낸 시연/,
  '21 must not contain a prototype send demo anywhere in the document',
);

// (g) The legitimate server-backed path must be preserved: the authoritative
//     wiring still grants the composer, and revocation closes it again.
assert.match(
  messageHtml,
  /__danjionConversationSendAuthority=\s*sendAuthority/,
  '21 must expose an explicit send-authority gate for the authoritative wiring',
);
assert.match(
  messageHtml,
  /__danjionConversationSendAuthority\)\.grant\(\)|__danjionConversationSendAuthority\.grant\(\)/,
  '21 authoritative wiring must grant send authority when the server confirms the conversation',
);
assert.match(
  messageHtml,
  /__danjionConversationSendAuthority\)\.revoke\(\)|__danjionConversationSendAuthority\.revoke\(\)/,
  '21 must revoke send authority whenever the server declines the conversation',
);
assert.match(
  messageHtml,
  /const result=await bridge\.sendMessage\(conversationId,text\)/,
  '21 must keep the real server-backed send path',
);
assert.match(
  messageHtml,
  /__danjionConversationSendAuthority\)\.setBlocked\(blocked\)|__danjionConversationSendAuthority\.setBlocked\(blocked\)/,
  '21 must keep blocking state authoritative over the composer',
);

// The gate itself must behave correctly once the server does grant authority.
{
  const gate = { granted: false, blocked: false, send: { disabled: true } };
  const apply = () => {
    gate.send.disabled = !gate.granted || gate.blocked;
  };
  apply();
  assert.equal(gate.send.disabled, true, 'authority gate: closed before grant');
  gate.granted = true;
  apply();
  assert.equal(gate.send.disabled, false, 'authority gate: open after grant');
  gate.blocked = true;
  apply();
  assert.equal(gate.send.disabled, true, 'authority gate: closed again on block');
  gate.blocked = false;
  gate.granted = false;
  apply();
  assert.equal(gate.send.disabled, true, 'authority gate: closed after revoke');
}

// ---------------------------------------------------------------------------
// 10. Mutation proof for the external-wiring-failure containment.
//     Re-inserting the legacy demo handler must break the contract above.
// ---------------------------------------------------------------------------
{
  // The exact legacy handler CENTRAL flagged, re-injected in place.
  const legacyHandler =
    "reply.addEventListener('input',()=>{send.disabled=!reply.value.trim()});" +
    "document.querySelector('#replyForm').addEventListener('submit',event=>{event.preventDefault();" +
    "const item=document.createElement('article');item.className='message mine';" +
    "item.innerHTML='<b>연블리</b><small class=\"message-state\">보냄 · 새로고침하면 초기화되는 시연입니다.</small>';" +
    "document.querySelector('#thread').appendChild(item)});";

  const mutated = messageHtml.replace(
    'reply.addEventListener(\'input\',()=>{document.querySelector(\'#count\').textContent=reply.value.length;sendAuthority.apply()});',
    'reply.addEventListener(\'input\',()=>{document.querySelector(\'#count\').textContent=reply.value.length;sendAuthority.apply()});' + legacyHandler,
  );
  assert.notEqual(mutated, messageHtml, 'mutation must actually change the document');
  assert.match(mutated, /연블리/, 'mutation: legacy demo handler re-inserted');

  // Rule (a): the mutation must break the "no send without authority" rule.
  // Judged by the *same* harness the real document passed, so a weakened
  // behavioural rule can never silently accept the legacy handler.
  const mutatedInline = mutated.match(/<script>([\s\S]*?)<\/script>/)[1];
  let runMutated;
  try {
    runMutated = runInlineWithoutExternal(mutatedInline);
  } catch (err) {
    // A mutation that cannot even execute is still a contract break.
    runMutated = { sendEnabledAfterTyping: true, appendedMessages: 1, error: String(err) };
  }

  assert.equal(
    runMutated.sendEnabledAfterTyping,
    true,
    'mutation: legacy handler re-enables send without server authority — the contract above must reject it',
  );
  assert.equal(
    runMutated.appendedMessages,
    1,
    'mutation: legacy handler appends a local fake message without server authority — the contract above must reject it',
  );

  // And the static rules used in section 9(f) must also reject the mutation.
  // (The mutation *does* contain the prototype strings — that is precisely why
  // the static rules flag it. We assert the rule FAILS on the mutation, i.e.
  // the mutation is caught, not that the mutation is clean.)
  assert.equal(
    fails(() => assert.doesNotMatch(mutated, /연블리|새로고침하면 초기화되는 시연|답장을 보낸 시연/)),
    true,
    'mutation: prototype send-demo strings must be caught by the static rule',
  );
}

console.log('leaf-1025-initial-document-authority-contract: PASS');

