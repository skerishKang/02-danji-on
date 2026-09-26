// #1034: the message list must never present prototype counters, and its
// local receive toggle must never claim an unsaved local success, when there is
// no authoritative conversation data.
//
// Defects on current main (frontend/20_메시지함_목록.html):
//
//   1. INITIAL document ships prototype counters —
//        전체 6 / 안 읽음 2 / 안 읽은 메시지 2개 / 안 읽음 2 / 답장 대기 1
//   2. non-success paths (AUTH_REQUIRED / 401 / 403 / ERROR / NETWORK_FAILURE)
//      called showState() without neutralizing the summary, and auth-required
//      only patched the rail heading — so prototype private-activity counts could
//      survive with no server truth behind them.
//   3. the first inline block installed a *local* receive toggle that flipped
//      `.on` / aria-checked and toasted '새 메시지를 받습니다.' — fake success
//      that only stays hidden while the external live wiring loads.
//
// This contract executes the real shipped code, not a markup strip:
//   * INITIAL counters are parsed out of the served HTML
//   * the authoritative live wiring is executed against a scripted bridge for
//     AUTH_REQUIRED(401) / 403 / ERROR(500) / NETWORK_FAILURE / VALID_DATA
//   * the first inline block is executed with NO external dependency at all and
//     the receive toggle is clicked
//   * both legacy defects are re-injected to prove the harness detects them
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGE = new URL('../20_메시지함_목록.html', import.meta.url);
const html = readFileSync(PAGE, 'utf8');

const TRUTHFUL_ROUTE = '수신 여부는 서버에 저장되지 않습니다. 알림 설정은 24 설정 화면에서 관리됩니다.';
const FAKE_SUCCESS = /새 메시지를 받습니다|새 메시지를 받지 않습니다/;
const NEUTRAL = '—';

const firstInlineOf = (source) => {
  const match = source.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'message list must still ship its first inline block');
  return match[1];
};

const liveWiringOf = (source) => {
  const start = source.indexOf('<script id="danjion-messages-list-live-wiring-330">');
  assert.notEqual(start, -1, 'authoritative live wiring script must exist');
  const end = source.indexOf('</script>', start);
  return source.slice(source.indexOf('>', start) + 1, end);
};

// Reads every counter the summary owns, straight out of the served markup.
const initialCountersOf = (source) => {
  const filters = [...source.matchAll(/class="filter[^"]*" data-filter="(all|unread)"[^>]*>[^<]*<span>([^<]*)<\/span>/g)];
  const rail = source.match(/<h2>안 읽은 메시지<br\/>([^<]*)<\/h2>/);
  const summary = [...source.matchAll(/<div><span>(안 읽음|답장 대기)<\/span><b>([^<]*)<\/b><\/div>/g)];
  return {
    all: (filters.find((m) => m[1] === 'all') || [])[2],
    unread: (filters.find((m) => m[1] === 'unread') || [])[2],
    rail: rail ? rail[1] : null,
    summaryUnread: (summary.find((m) => m[1] === '안 읽음') || [])[2],
    summaryReplyWait: (summary.find((m) => m[1] === '답장 대기') || [])[2],
  };
};

const PROTOTYPE_COUNTS = { all: '6', unread: '2', rail: '2개', summaryUnread: '2', summaryReplyWait: '1' };

const assertNeutral = (counters, label) => {
  for (const [key, value] of Object.entries(counters)) {
    assert.notEqual(
      value,
      PROTOTYPE_COUNTS[key],
      `${label}: prototype ${key} count must not be visible, got ${JSON.stringify(value)}`,
    );
    assert.notEqual(
      value,
      undefined,
      `${label}: ${key} counter slot must exist so it can be neutralized`,
    );
    assert.doesNotMatch(
      String(value),
      /^\d+$/,
      `${label}: ${key} must be neutral (no authoritative count) without server truth, got ${JSON.stringify(value)}`,
    );
  }
};

// ---------------------------------------------------------------------------
// 1. INITIAL — the served document must ship neutral counters.
// ---------------------------------------------------------------------------
assertNeutral(initialCountersOf(html), 'INITIAL');
assert.ok(
  !/안 읽은 메시지<br\/>\d/.test(html),
  'INITIAL: rail must not ship a numeric unread headline',
);
assert.ok(
  !/답장 대기<\/span><b>\d/.test(html),
  'INITIAL: reply-wait summary must not ship a numeric prototype value',
);

// The prototype conversation rows themselves are counters too: each shipped
// row carried an unread badge and a reply-wait marker, so a prototype unread
// value survived INITIAL even when the rail/summary had been neutralized.
// The initial list must be a server placeholder, never prototype rows.
// Assertions run against the *served markup* only: the authoritative row
// template inside the live-wiring script legitimately builds these classes at
// runtime and must not be mistaken for shipped prototype content.
const initialMarkup = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
assert.doesNotMatch(
  initialMarkup,
  /<button[^>]*class="mail-row[^"]*unread/,
  'INITIAL: no prototype unread conversation row may be served',
);
assert.doesNotMatch(
  initialMarkup,
  /class="unread-count"/,
  'INITIAL: no prototype unread-count badge may be served',
);
assert.doesNotMatch(
  initialMarkup,
  /class="reply-wait"/,
  'INITIAL: no prototype reply-wait marker may be served',
);
assert.doesNotMatch(
  initialMarkup,
  /산책메이트|살림손|초록문|한울타리|로드힐 꽃작업실|바른 자동차정비/,
  'INITIAL: no prototype conversation identity may be served',
);
assert.ok(
  /<div class="mail-list"[^>]*data-server-placeholder="true"/.test(initialMarkup),
  'INITIAL: the message list must ship a server placeholder',
);
assert.ok(
  /data-server-placeholder="true"[^>]*>[\s\S]{0,120}불러오는 중/.test(initialMarkup),
  'INITIAL: the placeholder must show a neutral loading state',
);

// ---------------------------------------------------------------------------
// 2. Shared DOM stub for executing the real page code.
// ---------------------------------------------------------------------------
const makeHarness = () => {
  const listeners = { input: [], submit: [], click: [] };

  const makeNode = (classes = '') => {
    const classSet = new Set(classes.split(/\s+/).filter(Boolean));
    const attrs = {};
    // Per-node listener registry: a real click only reaches handlers bound to
    // the clicked element (and document), so a switch click must not also fire
    // the rail-link shortcut handler.
    const own = {};
    return {
      classes,
      classSet,
      attrs,
      textContent: '',
      innerHTML: '',
      hidden: false,
      value: '',
      style: {},
      dataset: {},
      classList: {
        add: (...c) => c.forEach((x) => classSet.add(x)),
        remove: (...c) => c.forEach((x) => classSet.delete(x)),
        toggle: (c, force) => {
          const on = force === undefined ? !classSet.has(c) : Boolean(force);
          if (on) classSet.add(c);
          else classSet.delete(c);
          return on;
        },
        contains: (c) => classSet.has(c),
      },
      setAttribute: (k, v) => {
        attrs[k] = String(v);
      },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      addEventListener: (t, f) => {
        if (!own[t]) own[t] = [];
        own[t].push(f);
        if (listeners[t]) listeners[t].push(f);
      },
      removeEventListener() {},
      fireClick: (event) => (own.click || []).slice().forEach((f) => f(event)),
      click() {},
      querySelector: () => makeNode(),
      querySelectorAll: () => [],
      appendChild() {},
      insertAdjacentHTML() {},
      scrollIntoView() {},
      focus() {},
    };
  };

  const el = (extra = {}) => Object.assign(makeNode(), extra);

  // Canonical markup ships the receive switch in the "on" state, so "on" alone
  // is not a change — exactly as in the #1030 page-21 harness.
  const receiveToggle = makeNode('toggle on');
  receiveToggle.setAttribute('aria-checked', 'true');

  const railTitle = el();
  railTitle.innerHTML = `안 읽은 메시지<br/>${PROTOTYPE_COUNTS.rail}`;

  const allCount = el();
  allCount.textContent = PROTOTYPE_COUNTS.all;
  const unreadCount = el();
  unreadCount.textContent = PROTOTYPE_COUNTS.unread;

  const summaryUnread = el();
  summaryUnread.textContent = PROTOTYPE_COUNTS.summaryUnread;
  const summaryReplyWrap = el();
  const summaryReplyWait = el({ parentElement: summaryReplyWrap });
  summaryReplyWait.textContent = PROTOTYPE_COUNTS.summaryReplyWait;

  const strong = el();
  const note = el();
  const emptyResult = el({
    style: {},
    querySelector: (sel) => (sel === 'strong' ? strong : sel === 'span' ? note : null),
  });
  const mailList = el();
  const toast = el();
  const searchInput = el();
  const searchForm = el();
  const filterShortcut = el();
  const filterAll = el();
  const filterUnread = el();
  const mailRow = el();
  mailRow.dataset.kind = 'unread received';
  mailRow.dataset.search = '산책메이트';
  const inbox = el();

  const nodes = {
    '.toast': toast,
    '.mail-list': mailList,
    '.empty-result': emptyResult,
    '.rail-card h2': railTitle,
    '.filter[data-filter="all"] span': allCount,
    '.filter[data-filter="unread"] span': unreadCount,
    '.receive .toggle': receiveToggle,
    // The legacy local handler resolved the switch as bare `.toggle`; the stub
    // must answer that selector too, otherwise the mutation would be invisible.
    '.toggle': receiveToggle,
    '.search input': searchInput,
    '#searchForm': searchForm,
    '[data-filter-shortcut]': filterShortcut,
    '.filter[data-filter="unread"]': filterUnread,
    '.inbox': inbox,
  };

  const documentStub = {
    querySelector: (sel) => nodes[sel] || null,
    querySelectorAll: (sel) => {
      if (sel === '.summary div b') return [summaryUnread, summaryReplyWait];
      if (sel === '.toggle') return [receiveToggle];
      if (sel === '.mail-list .mail-row' || sel === '.mail-row') return [mailRow];
      if (sel === '[data-filter]' || sel === '[data-demo]') return [];
      return [];
    },
    getElementById: (id) => nodes['#' + id] || null,
    createElement: () => makeNode(),
    addEventListener: (t, f) => listeners[t] && listeners[t].push(t === 'click' ? f : f),
    body: { style: {} },
  };

  const readCounters = () => ({
    all: allCount.textContent,
    unread: unreadCount.textContent,
    rail: railTitle.innerHTML.replace('안 읽은 메시지<br/>', ''),
    summaryUnread: summaryUnread.textContent,
    summaryReplyWait: summaryReplyWait.textContent,
  });

  return {
    listeners,
    documentStub,
    receiveToggle,
    toast,
    strong,
    note,
    emptyResult,
    summaryReplyWrap,
    readCounters,
  };
};

// ---------------------------------------------------------------------------
// 3. Authoritative live wiring, executed for every non-success + success state.
// ---------------------------------------------------------------------------
const runLiveWiring = async (result, pageHtml = html) => {
  const harness = makeHarness();
  const source = liveWiringOf(pageHtml);
  const bridge = { listConversations: async () => result };
  const session = {
    danjionApiBase: () => 'https://api.example.test',
    isCanonicalProduction: () => true,
  };
  const windowStub = { DanjionSession: session };

  new Function(
    'window',
    'document',
    'location',
    'DanjionSession',
    'DanjionMessagesNotificationsBridge',
    'setTimeout',
    'clearTimeout',
    'Intl',
    source,
  )(
    windowStub,
    harness.documentStub,
    { search: '', href: '' },
    session,
    { createMessagesNotificationsBridge: () => bridge },
    () => 0,
    () => {},
    Intl,
  );

  // let the async load() settle
  for (let i = 0; i < 8; i += 1) await Promise.resolve();

  return {
    counters: harness.readCounters(),
    railHtml: null,
    strong: harness.strong.textContent,
    note: harness.note.textContent,
    emptyVisible: harness.emptyResult.style.display,
    replyWrapHidden: harness.summaryReplyWrap.style.display,
  };
};

const NON_SUCCESS_STATES = [
  ['AUTH_REQUIRED(401)', { mode: 'auth-required', status: 401 }],
  ['AUTH_REQUIRED(403)', { mode: 'auth-required', status: 403 }],
  ['ERROR(5xx)', { mode: 'error', status: 500 }],
  ['NETWORK_FAILURE', { mode: 'error', status: 0 }],
];

for (const [label, result] of NON_SUCCESS_STATES) {
  // eslint-disable-next-line no-await-in-loop
  const run = await runLiveWiring(result);
  assertNeutral(run.counters, label);
  assert.equal(
    run.counters.rail,
    NEUTRAL,
    `${label}: rail headline must be neutral, got ${JSON.stringify(run.counters.rail)}`,
  );
  assert.equal(
    run.counters.summaryUnread,
    NEUTRAL,
    `${label}: 안 읽음 must be neutral without server truth`,
  );
  assert.equal(
    run.counters.summaryReplyWait,
    NEUTRAL,
    `${label}: 답장 대기 must be neutral without server truth`,
  );
  console.log(`${label}_COUNTS_NEUTRAL=YES`);
}

// auth-required / 403 copy must survive the neutralization refactor
{
  const r401 = await runLiveWiring({ mode: 'auth-required', status: 401 });
  assert.equal(r401.strong, '로그인이 필요합니다.', '401 copy must be preserved');
  assert.equal(r401.note, '로그인 후 다시 시도해 주세요.', '401 detail copy must be preserved');
  const r403 = await runLiveWiring({ mode: 'auth-required', status: 403 });
  assert.equal(r403.strong, '본인 확인된 입주민만 메시지함을 볼 수 있습니다.', '403 copy must be preserved');
  assert.equal(
    r403.note,
    '우리집 연결(26)에서 입주민 확인을 마쳐 주세요.',
    '403 resident-verification copy must be preserved',
  );
  const rErr = await runLiveWiring({ mode: 'error', status: 500 });
  assert.equal(rErr.strong, '메시지함을 불러오지 못했습니다.', 'API error copy must be preserved');
  assert.equal(
    rErr.note,
    '네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
    'API error detail copy must be preserved',
  );
  console.log('NON_SUCCESS_COPY_PRESERVED=PASS');
}

// ---------------------------------------------------------------------------
// 4. VALID SERVER DATA — counters must equal the server truth exactly.
// ---------------------------------------------------------------------------
{
  const rows = [
    { id: 'c1', unreadCount: 2, updatedAt: '2026-09-20T10:00:00Z', latestMessage: { body: '안녕하세요', createdAt: '2026-09-20T10:00:00Z' }, participant: { nickname: '산책메이트' } },
    { id: 'c2', unreadCount: 1, updatedAt: '2026-09-19T10:00:00Z', latestMessage: { body: '세탁기 업체 정보', createdAt: '2026-09-19T10:00:00Z' }, participant: { nickname: '살림손' } },
    { id: 'c3', unreadCount: 1, updatedAt: '2026-09-18T10:00:00Z', latestMessage: null, participant: { nickname: '꽃' } },
  ];
  const run = await runLiveWiring({ mode: 'ok', conversations: rows });
  assert.equal(run.counters.all, '3', 'valid server data: total count must be the row count');
  assert.equal(run.counters.unread, '4', 'valid server data: unread filter must be the server unread sum');
  assert.equal(run.counters.rail, '4개', 'valid server data: rail headline must be the server unread sum');
  assert.equal(run.counters.summaryUnread, '4', 'valid server data: 안 읽음 must be the server unread sum');
  assert.equal(
    run.replyWrapHidden,
    'none',
    'valid server data: the prototype reply-wait row must be hidden once the server answered',
  );
  console.log('VALID_SERVER_COUNT_PARITY=PASS');
}

// ---------------------------------------------------------------------------
// 5. EXTERNAL WIRING FAILURE — first inline block only, receive toggle clicked.
// ---------------------------------------------------------------------------
const runInlineWithoutExternal = (source) => {
  const harness = makeHarness();
  harness.receiveToggle.setAttribute('aria-checked', 'true');

  new Function('document', 'location', 'setTimeout', 'clearTimeout', source)(
    harness.documentStub,
    { search: '', href: '' },
    () => 0,
    () => {},
  );

  harness.receiveToggle.fireClick({
    type: 'click',
    target: harness.receiveToggle,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  });

  return {
    ariaChecked: harness.receiveToggle.getAttribute('aria-checked'),
    stillOn: harness.receiveToggle.classList.contains('on'),
    toastText: harness.toast.textContent,
  };
};

const firstInline = firstInlineOf(html);

assert.doesNotMatch(
  html,
  FAKE_SUCCESS,
  'message list must not contain local receive fake-success copy anywhere',
);
assert.doesNotMatch(
  firstInline,
  /classList\.toggle\('on'\)/,
  'first inline block must not flip the receive toggle locally without server authority',
);
assert.doesNotMatch(
  firstInline,
  /setAttribute\('aria-checked'/,
  'first inline block must not rewrite aria-checked locally without server authority',
);
assert.ok(
  firstInline.includes(TRUTHFUL_ROUTE),
  'first inline block must keep the truthful fail-closed receive message',
);
assert.ok(
  (html.match(new RegExp(TRUTHFUL_ROUTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length >= 2,
  'the truthful receive message must exist on both the inline fallback and the authoritative wiring',
);

{
  const noWiring = runInlineWithoutExternal(firstInline);
  assert.equal(
    noWiring.ariaChecked,
    'true',
    'external wiring failure: aria-checked must not be rewritten by a local handler',
  );
  assert.equal(
    noWiring.stillOn,
    true,
    'external wiring failure: the .on class must not be flipped locally',
  );
  assert.doesNotMatch(
    noWiring.toastText,
    FAKE_SUCCESS,
    'external wiring failure: no copy that implies a saved server preference',
  );
  if (noWiring.toastText) {
    assert.ok(
      noWiring.toastText.includes(TRUTHFUL_ROUTE),
      'external wiring failure: any message must route truthfully to Settings, got: ' + noWiring.toastText,
    );
  }
  console.log('EXTERNAL_WIRING_FAILURE_RECEIVE_MUTATION=NO');
  console.log('LOCAL_NOTIFICATION_FAKE_SUCCESS=NO');
}

// ---------------------------------------------------------------------------
// 6. Mutation proof — both legacy defects must be caught by the same harness.
//    Removing a whole <script> block must NOT be the only way to fail here.
// ---------------------------------------------------------------------------
{
  const LEGACY_HANDLER =
    "const receive=document.querySelector('.toggle');receive.addEventListener('click',()=>{" +
    "const on=receive.classList.toggle('on');receive.setAttribute('aria-checked',String(on));" +
    "showToast(on?'새 메시지를 받습니다.':'새 메시지를 받지 않습니다.')});";
  const FAIL_CLOSED_HANDLER =
    "document.querySelectorAll('.toggle').forEach(button=>button.addEventListener('click',()=>{" +
    `showToast('${TRUTHFUL_ROUTE}')}))` + ';';

  const mutatedInline = firstInline.replace(FAIL_CLOSED_HANDLER, LEGACY_HANDLER);
  assert.notEqual(
    mutatedInline,
    firstInline,
    'mutation guard: the legacy receive handler must actually be re-injected',
  );
  assert.ok(mutatedInline.includes(LEGACY_HANDLER), 'mutation must be present in the mutated inline block');

  const mutated = runInlineWithoutExternal(mutatedInline);
  assert.equal(
    mutated.ariaChecked,
    'false',
    'MUTATION_PROOF: the legacy handler must be caught by this harness (aria-checked flipped)',
  );
  assert.equal(
    mutated.stillOn,
    false,
    'MUTATION_PROOF: the legacy handler must be caught by this harness (.on removed)',
  );
  assert.match(
    mutated.toastText,
    FAKE_SUCCESS,
    'MUTATION_PROOF: the legacy handler must be caught by this harness (fake-success copy)',
  );
  console.log('MUTATION_PROOF_RECEIVE_HANDLER=PASS');
}

{
  // Re-introduce the prototype summary into the served document only.
  const mutatedHtml = html
    .replace('<h2>안 읽은 메시지<br/>—</h2>', `<h2>안 읽은 메시지<br/>${PROTOTYPE_COUNTS.rail}</h2>`)
    .replace('<div><span>안 읽음</span><b>—</b></div>', `<div><span>안 읽음</span><b>${PROTOTYPE_COUNTS.summaryUnread}</b></div>`)
    .replace('<div><span>답장 대기</span><b>—</b></div>', `<div><span>답장 대기</span><b>${PROTOTYPE_COUNTS.summaryReplyWait}</b></div>`);
  assert.notEqual(mutatedHtml, html, 'mutation guard: the prototype summary must actually be re-injected');

  let caught = null;
  try {
    assertNeutral(initialCountersOf(mutatedHtml), 'MUTATION_PROOF');
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'MUTATION_PROOF: the prototype summary must be caught by this harness');

  // And the non-success state must not rescue it either: authoritative wiring
  // is still present in the mutated document, so only the INITIAL parse catches
  // the surviving prototype value.
  const mutatedNonSuccess = await runLiveWiring({ mode: 'error', status: 500 }, mutatedHtml);
  assertNeutral(mutatedNonSuccess.counters, 'MUTATION_PROOF/non-success');
  console.log('MUTATION_PROOF_PROTOTYPE_SUMMARY=PASS');
}

console.log('PASS #1034 message list initial authority contract');
console.log('MESSAGE_LIST_INITIAL_PROTOTYPE_COUNTS=NO');
console.log('MESSAGE_LIST_AUTH_REQUIRED_COUNTS_NEUTRAL=YES');
console.log('MESSAGE_LIST_401_COUNTS_NEUTRAL=YES');
console.log('MESSAGE_LIST_403_COUNTS_NEUTRAL=YES');
console.log('MESSAGE_LIST_ERROR_COUNTS_NEUTRAL=YES');
console.log('MESSAGE_LIST_NETWORK_FAILURE_COUNTS_NEUTRAL=YES');
console.log('MESSAGE_LIST_VALID_SERVER_COUNT_PARITY=PASS');
console.log('UI_REDESIGN=NO');
