// #1076: a signed-out direct deep link to 21 message detail must settle into
// one coherent guest state instead of leaving an authenticated conversation
// shell behind.
//
// Historical defect: the API auth boundary already failed closed (no message
// data leak, no send authority), but `showState()` only replaced the thread
// body and disabled the reply controls. After "로그인 후 이용 가능합니다." was
// confirmed the page still showed:
//
//   대화 상대를 불러오는 중입니다.   <- stale participant loading copy
//   이웃
//   대화 주제 / 불러오는 중…        <- stale topic loading placeholder
//   답장 쓰기 [textarea] [답장 보내기] <- composer shell that looks actionable
//
// The fix extends the single state-settling helper with a `settled` flag: once
// a terminal non-conversation state is confirmed (guest login gate / 403
// resident verification / 404 / network error / invalid UUID) the participant
// loading copy, the topic placeholder, the composer shell and the mobile
// floating reply button are all cleared, while send authority stays revoked.
// Loading (`불러오는 중...`) intentionally keeps its shell — it is transient.
//
// This contract is behavioural: it executes the real live-wiring inline block
// and drives the page's actual load() path against a scripted bridge.
//
//   Case A  signed-out + valid-shaped UUID -> coherent login gate
//   Case B  invalid UUID                   -> graceful state, no shell
//   Case C  authenticated valid conversation -> full render, composer open
//   Case D  403 resident verification      -> own copy, no login-expired copy
//   Case E  404                            -> not-found copy, no stale shell
//   Case F  network/server error           -> error copy, no stale shell
//   Case G  mobile 390 structural pins     -> hidden shell leaves no box
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');
const page = await read('21_메시지_대화상세.html');

// The behaviour lives in the live-wiring inline block.
const scriptSource = (() => {
  const blocks = [...page.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const script = blocks.find((b) => b.includes('function showState') && b.includes('listMessages'));
  assert.ok(script, '21 must still ship the inline block that owns showState and the conversation load');
  return script;
})();

const UUID_OK = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

// ---------------------------------------------------------------------------
// Harness: a DOM stub faithful to the initial guest document (stale loading
// shell present), plus the real send-authority flag contract.
// ---------------------------------------------------------------------------
const settle = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

const runScenario = async ({
  conversationId = UUID_OK,
  selfResult,
  conversationsResult = { mode: 'server', conversations: [] },
  messagesResult = { mode: 'server', messages: [] },
} = {}) => {
  const bridgeCalls = [];
  const docListeners = [];

  const els = {
    thread: { innerHTML: '<div class="date-divider">불러오는 중...</div>' },
    reply: {
      value: '',
      disabled: false,
      placeholder: '답장 내용을 입력하세요.',
      addEventListener() {},
      dispatchEvent() {},
      focus() {},
    },
    send: { disabled: true },
    personSmall: { textContent: '대화 상대를 불러오는 중입니다.' },
    personH1: { textContent: '이웃' },
    routeSpan: { textContent: '/ 대화' },
    railName: { textContent: '이웃' },
    mobileHead: { textContent: '대화' },
    subjectNote: {
      textContent: '불러오는 중…',
      removedAttributes: [],
      removeAttribute(name) {
        this.removedAttributes.push(name);
      },
    },
    replyForm: { hidden: false },
    mobileReply: { hidden: false, textContent: '답장하기', addEventListener() {} },
  };

  const documentStub = {
    getElementById: (id) => (id === 'thread' ? els.thread : id === 'reply' ? els.reply : id === 'replyForm' ? els.replyForm : null),
    querySelector: (sel) => {
      if (sel === '.send') return els.send;
      if (sel === '.conversation-head .person small') return els.personSmall;
      if (sel === '.conversation-head .person h1') return els.personH1;
      if (sel === '.route-left span') return els.routeSpan;
      if (sel === '.profile-line b') return els.railName;
      if (sel === '.mobile-head') return els.mobileHead;
      if (sel === '.subject [data-server-placeholder="true"]') return els.subjectNote;
      if (sel === '[data-scroll-reply]') return els.mobileReply;
      return null;
    },
    querySelectorAll: () => [],
    addEventListener: (type, fn) => docListeners.push({ type, fn }),
  };

  const authority = {
    granted: false,
    blocked: false,
    grant() {
      this.granted = true;
    },
    revoke() {
      this.granted = false;
      this.blocked = false;
    },
    setBlocked(value) {
      this.blocked = Boolean(value);
    },
  };

  const bridge = {
    getSelfId() {
      bridgeCalls.push({ op: 'getSelfId' });
      return Promise.resolve(selfResult);
    },
    listConversations() {
      bridgeCalls.push({ op: 'listConversations' });
      return Promise.resolve(conversationsResult);
    },
    listMessages(id) {
      bridgeCalls.push({ op: 'listMessages', id });
      return Promise.resolve(messagesResult);
    },
    sendMessage(id, body) {
      bridgeCalls.push({ op: 'sendMessage', id, body });
      return Promise.resolve({ ok: false, mode: 'static', error: 'SERVER_MODE_REQUIRED' });
    },
    markConversationRead(id) {
      bridgeCalls.push({ op: 'markConversationRead', id });
      return Promise.resolve({ ok: true, mode: 'server' });
    },
  };

  const DanjionSession = {
    danjionApiBase: () => '/api',
    isCanonicalProduction: () => true,
  };

  const sandbox = {
    document: documentStub,
    location: { search: '?conversation=' + encodeURIComponent(conversationId), href: '' },
    window: { DanjionSession },
    DanjionSession,
    DanjionMessagesNotificationsBridge: {
      createMessagesNotificationsBridge: () => bridge,
    },
    DanjionResidentBridge: {
      createResidentBridge: () => ({
        blockedUsers: () => Promise.resolve({ ok: true, blocks: [] }),
      }),
    },
    console,
    __danjionConversationSendAuthority: authority,
  };
  sandbox.globalThis = sandbox;

  new Function(
    'document',
    'location',
    'window',
    'globalThis',
    'DanjionSession',
    'DanjionMessagesNotificationsBridge',
    'DanjionResidentBridge',
    scriptSource,
  )(
    documentStub,
    sandbox.location,
    sandbox.window,
    sandbox,
    DanjionSession,
    sandbox.DanjionMessagesNotificationsBridge,
    sandbox.DanjionResidentBridge,
  );

  await settle();

  return {
    authority,
    bridgeCalls,
    threadHtml: els.thread.innerHTML,
    replyDisabled: els.reply.disabled,
    sendDisabled: els.send.disabled,
    personSmallText: els.personSmall.textContent,
    personH1Text: els.personH1.textContent,
    subjectText: els.subjectNote.textContent,
    subjectPlaceholderRemoved: els.subjectNote.removedAttributes.includes('data-server-placeholder'),
    composerHidden: els.replyForm.hidden,
    mobileReplyHidden: els.mobileReply.hidden,
    listConversationsCalls: bridgeCalls.filter((c) => c.op === 'listConversations'),
    listMessagesCalls: bridgeCalls.filter((c) => c.op === 'listMessages'),
    markReadCalls: bridgeCalls.filter((c) => c.op === 'markConversationRead'),
  };
};

// ===========================================================================
// Case A — SIGNED-OUT + valid-shaped UUID. The auth-required answer is the
// first server word, so no conversation data may even be attempted, and the
// page must settle into one coherent login gate.
// ===========================================================================
const caseA = await runScenario({ selfResult: { mode: 'auth-required', status: 401 } });

assert.match(caseA.threadHtml, /로그인 후 이용 가능합니다\./, 'Case A: the login-required copy must be visible in the thread');
assert.equal(
  caseA.personSmallText,
  '',
  'Case A: the stale participant loading copy (대화 상대를 불러오는 중입니다.) must be gone',
);
assert.doesNotMatch(caseA.threadHtml, /대화 상대를 불러오는 중/, 'Case A: no participant loading copy anywhere in the settled state');
assert.equal(caseA.subjectPlaceholderRemoved, true, 'Case A: the topic loading placeholder attribute must be dropped');
assert.notEqual(caseA.subjectText, '불러오는 중…', 'Case A: the stale topic loading copy (불러오는 중…) must be gone');
assert.equal(caseA.composerHidden, true, 'Case A: the reply composer shell must be hidden for the guest');
assert.equal(caseA.mobileReplyHidden, true, 'Case A: the mobile floating reply button must be hidden for the guest');
assert.equal(caseA.replyDisabled, true, 'Case A: the reply field must stay disabled');
assert.equal(caseA.sendDisabled, true, 'Case A: the send button must stay disabled');
assert.equal(caseA.authority.granted, false, 'Case A: send authority must stay revoked for the guest');
assert.equal(caseA.listConversationsCalls.length, 0, 'Case A: a signed-out guest must not read any conversation list');
assert.equal(caseA.listMessagesCalls.length, 0, 'Case A: a signed-out guest must not read any messages');
assert.equal(caseA.markReadCalls.length, 0, 'Case A: a guest must not trigger mark-as-read');
assert.doesNotMatch(caseA.threadHtml, /본인 확인된 입주민/, 'Case A: the 403 resident copy must not bleed into the guest gate');

// ===========================================================================
// Case B — invalid UUID keeps its existing graceful state, now fully settled.
// ===========================================================================
const caseB = await runScenario({ conversationId: 'not-a-uuid' });

assert.match(caseB.threadHtml, /열 수 있는 대화가 없습니다\. 메시지함에서 다시 선택해 주세요\./, 'Case B: the graceful invalid-conversation copy must stay');
assert.equal(caseB.composerHidden, true, 'Case B: the composer shell must be hidden in the invalid state too');
assert.equal(caseB.personSmallText, '', 'Case B: no participant loading copy may survive');
assert.notEqual(caseB.subjectText, '불러오는 중…', 'Case B: no topic loading copy may survive');
assert.equal(caseB.authority.granted, false, 'Case B: send authority must stay revoked');
assert.equal(caseB.listConversationsCalls.length, 0, 'Case B: an invalid UUID must not read any server data');

// ===========================================================================
// Case C — AUTHENTICATED + valid conversation: the authenticated rendering
// contract is untouched; the settle path must never run here.
// ===========================================================================
const caseC = await runScenario({
  selfResult: { mode: 'server', status: 200, userId: '11111111-1111-4111-8111-111111111111' },
  conversationsResult: {
    mode: 'server',
    conversations: [
      {
        id: UUID_OK,
        participant: { nickname: '산책메이트', userId: '22222222-2222-4222-8222-222222222222' },
        complexSlug: 'mokdong-01',
      },
    ],
  },
  messagesResult: {
    mode: 'server',
    messages: [
      {
        id: 'm-1',
        senderUserId: '22222222-2222-4222-8222-222222222222',
        body: '안녕하세요! 내일 산책 가실래요?',
        createdAt: '2026-09-26T09:00:00.000Z',
        deletedAt: null,
      },
    ],
  },
});

assert.equal(caseC.personH1Text, '산책메이트', 'Case C: the participant nickname must render normally');
assert.match(caseC.threadHtml, /안녕하세요! 내일 산책 가실래요\?/, 'Case C: the message list must render');
assert.equal(caseC.composerHidden, false, 'Case C: the composer must stay available for an authenticated resident');
assert.equal(caseC.replyDisabled, false, 'Case C: the reply field must be enabled after server access succeeds');
assert.equal(caseC.authority.granted, true, 'Case C: send authority must be granted only after server access success');
assert.equal(caseC.listMessagesCalls.length, 1, 'Case C: the messages must be read exactly once');
assert.equal(caseC.markReadCalls.length, 1, 'Case C: mark-as-read must still run for the authenticated resident');

// ===========================================================================
// Case D — 403 resident verification: its own copy, composer inaccessible.
// ===========================================================================
const caseD = await runScenario({ selfResult: { mode: 'auth-required', status: 403 } });

assert.match(caseD.threadHtml, /본인 확인된 입주민만 메시지를 이용할 수 있습니다\./, 'Case D: the resident verification copy must be shown');
assert.doesNotMatch(caseD.threadHtml, /로그인 후 이용 가능합니다/, 'Case D: the 403 state must not show a fake login-expired copy');
assert.equal(caseD.composerHidden, true, 'Case D: the composer must be inaccessible');
assert.equal(caseD.authority.granted, false, 'Case D: send authority must stay revoked');

// ===========================================================================
// Case E — 404: graceful not-found state with no stale loading shell.
// ===========================================================================
const caseE = await runScenario({
  selfResult: { mode: 'server', status: 200, userId: '11111111-1111-4111-8111-111111111111' },
  messagesResult: { mode: 'error', status: 404 },
});

assert.match(caseE.threadHtml, /대화를 찾을 수 없습니다\. 메시지함에서 다시 선택해 주세요\./, 'Case E: the not-found copy must be shown');
assert.equal(caseE.composerHidden, true, 'Case E: the composer shell must be hidden');
assert.equal(caseE.personSmallText, '', 'Case E: no participant loading copy may survive');
assert.notEqual(caseE.subjectText, '불러오는 중…', 'Case E: no topic loading copy may survive');
assert.equal(caseE.authority.granted, false, 'Case E: send authority must stay revoked');

// ===========================================================================
// Case F — network/server error: error copy with no stale loading shell.
// ===========================================================================
const caseF = await runScenario({
  selfResult: { mode: 'server', status: 200, userId: '11111111-1111-4111-8111-111111111111' },
  messagesResult: { mode: 'error', status: 500 },
});

assert.match(caseF.threadHtml, /대화를 불러오지 못했습니다\. 네트워크 상태를 확인해 주세요\./, 'Case F: the network/server copy must be shown');
assert.equal(caseF.composerHidden, true, 'Case F: the composer shell must be hidden');
assert.equal(caseF.personSmallText, '', 'Case F: no participant loading copy may survive');
assert.equal(caseF.authority.granted, false, 'Case F: send authority must stay revoked');

// ===========================================================================
// Case G — mobile 390 structural pins. A node contract cannot measure pixels;
// it can pin that a hidden composer leaves no box and the bottom nav is safe.
// ===========================================================================
assert.match(
  page,
  /\[hidden\]\{display:none!important\}/,
  'Case G: [hidden] must be display:none!important so the hidden composer leaves no empty box',
);
assert.match(page, /class="mobile-bottom"/, 'Case G: the mobile bottom navigation must remain in place');
assert.doesNotMatch(
  caseA.threadHtml,
  /<form/,
  'Case G: the settled guest thread must contain no composer markup at all',
);

// Loading must keep its transient shell: the loading call stays unsettled.
assert.match(
  scriptSource,
  /showState\('불러오는 중\.\.\.'\);/,
  'the loading state must call showState without settling (transient shell is truthful)',
);

// ===========================================================================
// Mutation proof — restoring the historical thread-only showState must break
// the guest coherence: the stale shell survives.
// ===========================================================================
{
  const HISTORICAL_SHOWSTATE =
    "function showState(text){\n" +
    "    thread.innerHTML='<div class=\"date-divider\">'+esc(text)+'</div>';\n" +
    "    replyField.disabled=true;\n" +
    "    sendButton.disabled=true;\n" +
    "    /* 서버 권위가 없는 상태에서는 composer 가 닫혀 있는 상태를 유지한다. */\n" +
    "    if(globalThis.__danjionConversationSendAuthority)globalThis.__danjionConversationSendAuthority.revoke();\n" +
    "  }";
  assert.ok(scriptSource.includes('function showState(text,settled)'), 'the settled showState signature must exist in the page');
  const start = scriptSource.indexOf('function showState(text,settled){');
  const end = scriptSource.indexOf('async function load()', start);
  assert.ok(start > -1 && end > start, 'showState must precede load() in the live-wiring block');
  const mutatedScript = scriptSource.slice(0, start) + HISTORICAL_SHOWSTATE + '\n  ' + scriptSource.slice(end);
  assert.notEqual(mutatedScript, scriptSource, 'mutation must actually change the script');

  // Re-execute the exact same sandbox construction with the mutated source.
  const runMutated = async () => {
    const bridgeCalls = [];
    const els = {
      thread: { innerHTML: '' },
      reply: { value: '', disabled: false, addEventListener() {}, dispatchEvent() {}, focus() {}, placeholder: '' },
      send: { disabled: true },
      personSmall: { textContent: '대화 상대를 불러오는 중입니다.' },
      personH1: { textContent: '이웃' },
      routeSpan: { textContent: '/ 대화' },
      railName: { textContent: '이웃' },
      mobileHead: { textContent: '대화' },
      subjectNote: {
        textContent: '불러오는 중…',
        removedAttributes: [],
        removeAttribute(name) {
          this.removedAttributes.push(name);
        },
      },
      replyForm: { hidden: false },
      mobileReply: { hidden: false, textContent: '답장하기', addEventListener() {} },
    };
    const documentStub = {
      getElementById: (id) => (id === 'thread' ? els.thread : id === 'reply' ? els.reply : id === 'replyForm' ? els.replyForm : null),
      querySelector: (sel) => {
        if (sel === '.send') return els.send;
        if (sel === '.conversation-head .person small') return els.personSmall;
        if (sel === '.conversation-head .person h1') return els.personH1;
        if (sel === '.route-left span') return els.routeSpan;
        if (sel === '.profile-line b') return els.railName;
        if (sel === '.mobile-head') return els.mobileHead;
        if (sel === '.subject [data-server-placeholder="true"]') return els.subjectNote;
        if (sel === '[data-scroll-reply]') return els.mobileReply;
        return null;
      },
      querySelectorAll: () => [],
      addEventListener: () => {},
    };
    const authority = {
      granted: false,
      blocked: false,
      grant() {
        this.granted = true;
      },
      revoke() {
        this.granted = false;
        this.blocked = false;
      },
      setBlocked() {},
    };
    const bridge = {
      getSelfId: () => Promise.resolve({ mode: 'auth-required', status: 401 }),
      listConversations: () => {
        bridgeCalls.push('listConversations');
        return Promise.resolve({ mode: 'server', conversations: [] });
      },
      listMessages: () => Promise.resolve({ mode: 'server', messages: [] }),
      sendMessage: () => Promise.resolve({ ok: false }),
      markConversationRead: () => Promise.resolve({ ok: true, mode: 'server' }),
    };
    const DanjionSession = { danjionApiBase: () => '/api', isCanonicalProduction: () => true };
    const sandbox = {
      document: documentStub,
      location: { search: '?conversation=' + UUID_OK, href: '' },
      window: { DanjionSession },
      DanjionSession,
      DanjionMessagesNotificationsBridge: { createMessagesNotificationsBridge: () => bridge },
      DanjionResidentBridge: { createResidentBridge: () => ({ blockedUsers: () => Promise.resolve({ ok: true, blocks: [] }) }) },
      console,
      __danjionConversationSendAuthority: authority,
    };
    sandbox.globalThis = sandbox;
    new Function(
      'document',
      'location',
      'window',
      'globalThis',
      'DanjionSession',
      'DanjionMessagesNotificationsBridge',
      'DanjionResidentBridge',
      mutatedScript,
    )(
      documentStub,
      sandbox.location,
      sandbox.window,
      sandbox,
      DanjionSession,
      sandbox.DanjionMessagesNotificationsBridge,
      sandbox.DanjionResidentBridge,
    );
    await settle();
    return { els, authority };
  };

  const mutatedRun = await runMutated();
  assert.match(mutatedRun.els.thread.innerHTML, /로그인 후 이용 가능합니다\./, 'mutation: the thread copy alone still works');
  assert.equal(mutatedRun.els.replyForm.hidden, false, 'mutation: the historical helper must leave the composer shell visible');
  assert.equal(
    mutatedRun.els.personSmall.textContent,
    '대화 상대를 불러오는 중입니다.',
    'mutation: the historical helper must leave the stale participant loading copy',
  );
  assert.equal(mutatedRun.els.subjectNote.textContent, '불러오는 중…', 'mutation: the historical helper must leave the stale topic copy');
  assert.equal(mutatedRun.authority.granted, false, 'mutation: send authority stays revoked — the defect is presentation only');
}

console.log('1076_CASE_SIGNED_OUT_LOGIN_GATE=PASS');
console.log('1076_CASE_INVALID_UUID=PASS');
console.log('1076_CASE_AUTHENTICATED_REGRESSION=PASS');
console.log('1076_CASE_RESIDENT_403=PASS');
console.log('1076_CASE_NOT_FOUND_404=PASS');
console.log('1076_CASE_NETWORK_ERROR=PASS');
console.log('1076_CASE_MOBILE_STRUCTURE=PASS');
console.log('1076_MUTATION_PROOF=PASS');

console.log('leaf-1076-guest-message-detail-gate-contract: PASS');
