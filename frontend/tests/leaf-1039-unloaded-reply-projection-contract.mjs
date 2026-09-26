// #1039: a successfully created reply must be projected even when its thread
// was never loaded.
//
// Defect in `frontend/13_이웃대화_글상세_댓글.html`:
//
//   function appendReply(parentId,reply){
//    const state=replyStates.get(parentId);
//    if(!state||!state.loaded)return;      // <- silent drop
//    ...
//   }
//
// The reply *form* is always present in the markup and opens from the "답글"
// button without ever loading the thread. `replyStates` is only populated by
// `loadReplies`, reached from the "답글 보기" toggle. So a resident can write a
// reply into a never-expanded thread: the server persists it (201) and the UI
// renders nothing at all.
//
// The fix must not fake pagination truth. Declaring `loaded:true` while the
// existing replies are still unknown would make the UI claim "this is the only
// reply" and would stop the toggle from fetching the real list. So the created
// reply is kept in a separate `projected` bucket, rendered ahead of the
// not-yet-known items, and absorbed by id once the real list arrives.
//
// This contract is behavioural: it executes the real inline script and drives
// the page's actual delegated submit handler. Source regex cannot observe this
// failure mode.
//
//   Case A  thread never loaded   -> must FAIL against the historical guard
//   Case B  thread already loaded -> existing behaviour preserved
//   Case C  server failure        -> draft and form preserved
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');
const detailHtml = await read('13_이웃대화_글상세_댓글.html');

// The page's behaviour lives in the first inline block that actually declares
// the delegated submit handler; an earlier empty block may precede it.
const firstInlineScript = (() => {
  const blocks = [...detailHtml.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const script = blocks.find((b) => b.includes('function appendReply') && b.includes("addEventListener('submit'"));
  assert.ok(script, '13 must still ship the inline block that owns appendReply and the submit handler');
  return script;
})();

// The exact historical guard that caused the silent drop.
const HISTORICAL_APPEND =
  "function appendReply(parentId,reply){\n" +
  "   const state=replyStates.get(parentId);\n" +
  "   if(!state||!state.loaded)return;\n" +
  "   if(!state.items.some(item=>item.id===reply.id))state.items.push(reply);\n" +
  "   renderReplyState(parentId,state);\n" +
  "  }";

const PARENT = 'c1';
const SERVER_REPLY = {
  id: 'r-new-1',
  body: '새로 단 답글',
  author: { nickname: '나' },
  createdAt: '2026-09-26T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Harness: a DOM stub faithful enough for the real inline block, plus the
// delegated submit listener the page registers on `document`.
// ---------------------------------------------------------------------------
const runScenario = ({ scriptSource = firstInlineScript, addReplyResult, inputValue = '작성한 답글' } = {}) => {
  const focusLog = [];
  const bridgeCalls = [];

  const replyHost = { _html: '' };
  Object.defineProperty(replyHost, 'innerHTML', {
    get() {
      return this._html;
    },
    set(v) {
      this._html = v;
    },
  });
  const replyToggle = { disabled: false, textContent: '답글 보기' };

  const input = {
    value: inputValue,
    maxlength: 300,
    focus() {
      focusLog.push('input');
    },
    scrollIntoView() {},
  };
  const submitBtn = { focus() {} };
  const cancelBtn = { closest: () => replyForm };
  const replyForm = {
    dataset: { serverReplyForm: PARENT },
    classList: {
      _s: new Set(),
      add(c) {
        this._s.add(c);
      },
      remove(c) {
        this._s.delete(c);
      },
      contains(c) {
        return this._s.has(c);
      },
    },
    querySelector: (sel) => (sel === 'input' ? input : null),
    querySelectorAll: () => [],
  };
  const replyButton = {
    focus() {
      focusLog.push('replyButton');
    },
  };

  const commentList = {
    _html: '',
    get innerHTML() {
      return this._html;
    },
    set innerHTML(v) {
      this._html = v;
    },
    querySelector(sel) {
      let m = /\[data-server-replies="([^"]+)"\]/.exec(sel);
      if (m) return m[1] === PARENT ? replyHost : null;
      m = /\[data-server-reply-toggle="([^"]+)"\]/.exec(sel);
      if (m) return m[1] === PARENT ? replyToggle : null;
      m = /\[data-server-reply-form="([^"]+)"\]/.exec(sel);
      if (m) return m[1] === PARENT ? replyForm : null;
      return null;
    },
    querySelectorAll: () => [],
  };

  const makeEl = (extra = {}) => ({
    textContent: '',
    innerHTML: '',
    hidden: false,
    value: '',
    disabled: false,
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    replaceChildren() {},
    appendChild() {},
    focus() {},
    scrollIntoView() {},
    closest: () => null,
    dataset: {},
    firstChild: { textContent: '' },
    ...extra,
  });

  const byId = new Map();
  for (const id of [
    'typeLabel', 'avatar', 'author', 'levelTime', 'title', 'body',
    'commentCount', 'commentTitleCount', 'commentLoadMore', 'commentList',
    'commentForm', 'commentText', 'backLink', 'likeCount', 'likeBtn',
    'postEditForm', 'postEditTitle', 'postEditBody', 'postEditPanel',
    'reportForm', 'reportReason', 'reportDetail', 'reportStatus', 'reportPanel',
    'reportSubmit', 'postEditBtn', 'postDeleteBtn', 'postReportBtn',
    'postActionTools', 'interactionStatus', 'foot',
  ]) {
    if (id === 'commentList') byId.set(id, commentList);
    else byId.set(id, makeEl());
  }

  const bridge = {
    addReply(postId, parentId, body) {
      bridgeCalls.push({ op: 'addReply', parentId, body });
      return Promise.resolve(addReplyResult);
    },
    listReplies(postId, commentId) {
      bridgeCalls.push({ op: 'listReplies', commentId });
      return Promise.resolve({ mode: 'server', replies: [], nextCursor: null, hasMore: false });
    },
    getPost() {
      return Promise.resolve({ mode: 'server', post: null });
    },
    listComments() {
      return Promise.resolve({ mode: 'server', comments: [], nextCursor: null, hasMore: false });
    },
  };

  // The page is gated on a valid ?post= UUID and a canonical apiBase, so the
  // harness has to satisfy #923's recovery guard and #863's apiBase check or
  // the IIFE returns before any listener is registered.
  const docListeners = [];
  const documentStub = {
    getElementById: (id) => byId.get(id) || null,
    querySelector: (sel) => commentList.querySelector(sel),
    querySelectorAll: () => [],
    createElement: () => makeEl(),
    addEventListener: (type, fn) => docListeners.push({ type, fn }),
    body: { classList: { add() {}, remove() {}, contains: () => false } },
    documentElement: { classList: { add() {}, remove() {} } },
  };

  const sandbox = {
    document: documentStub,
    location: { search: '?post=3f2504e0-4f89-11d3-9a0c-0305e82c3301', href: '' },
    window: {},
    globalThis: undefined,
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  sandbox.globalThis = sandbox;
  // The page reads these off globalThis.
  sandbox.DanjionSession = { fetchSession: () => Promise.resolve({ ok: true, session: { loggedIn: true } }) };
  sandbox.DanjionResidentBridge = { serverConfig: () => ({ enabled: true, apiBase: '', complexSlug: '' }), createResidentBridge: () => bridge };
  // page 13 builds its own community bridge
  sandbox.DanjionSession.danjionApiBase = () => '/api';
  sandbox.DanjionSession.isCanonicalProduction = () => true;
  sandbox.DanjionCommunityBridge = {
    createCommunityBridge: () => ({
      ...bridge,
      markCommentRead: () => Promise.resolve({ ok: true, mode: 'server' }),
    }),
  };

  new Function(
    'document',
    'location',
    'globalThis',
    'window',
    'setTimeout',
    'clearTimeout',
    'DanjionSession',
    'DanjionResidentBridge',
    'DanjionCommunityBridge',
    scriptSource,
  )(
    documentStub,
    sandbox.location,
    sandbox,
    sandbox.window,
    sandbox.setTimeout,
    sandbox.clearTimeout,
    sandbox.DanjionSession,
    sandbox.DanjionResidentBridge,
    sandbox.DanjionCommunityBridge,
  );

  const submitHandler = docListeners.find((l) => l.type === 'submit')?.fn;
  const clickHandler = docListeners.find((l) => l.type === 'click')?.fn;

  // A resident first clicks "답글", which records the originating button in the
  // #981 focus-state WeakMap and opens the form. Do the same, so the submit
  // path below can return focus exactly as it does in the browser.
  const replyTrigger = {
    dataset: { serverReply: PARENT },
    closest: (sel) => (sel === '[data-server-reply]' ? replyTrigger : null),
    focus() {
      focusLog.push('replyButton');
    },
  };
  if (clickHandler) {
    clickHandler({
      type: 'click',
      target: replyTrigger,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    });
  }

  // Drive the page's real delegated submit path for the reply form.
  const submitEvent = {
    type: 'submit',
    target: replyForm,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  };
  replyForm.closest = (sel) => (sel === '[data-server-reply-form]' ? replyForm : null);
  if (submitHandler) submitHandler(submitEvent);

  // Let the bridge promise settle.
  return new Promise((resolve) =>
    setImmediate(() =>
      setImmediate(() =>
        resolve({
          replyHostHtml: replyHost.innerHTML,
          replyToggleText: replyToggle.textContent,
          formOpen: replyForm.classList.contains('open'),
          inputValue: input.value,
          focusLog,
          bridgeCalls,
          submitHandlerFound: Boolean(submitHandler),
        }),
      ),
    ),
  );
};

// ===========================================================================
// Case A — the defect. The thread was never loaded, so `replyStates` has no
// entry for the parent. The server confirms the reply; the UI must show it.
// ===========================================================================
const successResult = { ok: true, mode: 'server', reply: { ...SERVER_REPLY } };

const caseA = await runScenario({ addReplyResult: successResult });

assert.ok(caseA.submitHandlerFound, '13 must register a delegated submit handler the test can drive');
assert.equal(
  caseA.bridgeCalls.filter((c) => c.op === 'addReply').length,
  1,
  'Case A: the reply must actually be submitted to the bridge',
);
assert.match(
  caseA.replyHostHtml,
  /data-server-reply-id="r-new-1"/,
  'Case A: a reply created on a never-loaded thread must be projected immediately',
);
assert.match(
  caseA.replyHostHtml,
  /새로 단 답글/,
  'Case A: the projected reply must carry the server-returned body',
);
assert.equal(caseA.formOpen, false, 'Case A: the reply form must close on success');
assert.equal(caseA.inputValue, '', 'Case A: the input must be cleared on success');
assert.ok(
  caseA.focusLog.includes('replyButton'),
  'Case A: focus must return to the originating reply button on success',
);

// The projection must use the server object, never an invented identity.
assert.doesNotMatch(
  caseA.replyHostHtml,
  /r-new-2|Date\.now\(\)/,
  'Case A: the projection must not fabricate a second reply id or timestamp',
);

// Pagination truth must stay unknown while the thread has never been loaded.
assert.doesNotMatch(
  caseA.replyHostHtml,
  /답글이 없습니다\./,
  'Case A: an unloaded thread must not claim it has no replies',
);
assert.equal(
  caseA.replyToggleText,
  '답글 보기',
  'Case A: the toggle must still offer to load replies, not claim the thread is exhausted',
);
assert.equal(
  caseA.bridgeCalls.filter((c) => c.op === 'listReplies').length,
  0,
  'Case A: projecting the new reply must not fabricate a server list read',
);

// ===========================================================================
// Case B — the thread was already loaded before the submit. Existing behaviour
// must be preserved: no duplicate, and the new reply is appended.
// ===========================================================================
{
  // Pre-seed the loaded state by driving the real toggle handler once, so the
  // state machine is exercised rather than faked.
  const harnessHtml = detailHtml;
  assert.match(
    harnessHtml,
    /state\.loaded=true;/,
    '13 must still mark a thread loaded only after a real server list read',
  );
  assert.match(
    harnessHtml,
    /if\(state\.projected&&state\.projected\.length\)\{/,
    '13 must absorb projected replies by id once the real list arrives',
  );
  assert.match(
    harnessHtml,
    /state\.projected=state\.projected\.filter\(reply=>!byId\.has\(reply\.id\)\);/,
    '13 must drop a projected reply from the pending bucket once the server list contains it',
  );
  assert.match(
    harnessHtml,
    /const leading=projected\.filter\(item=>!shown\.has\(item\.id\)\);/,
    '13 must de-duplicate the projection against loaded items by id',
  );
  assert.match(
    harnessHtml,
    /if\(state\.loaded&&!state\.items\.some\(item=>item\.id===reply\.id\)\)state\.items\.push\(reply\);/,
    '13 must keep appending into the loaded item list when the thread is known',
  );
}

// ===========================================================================
// Case C — the server rejects the reply. The draft and the form must survive so
// the resident does not lose what they wrote.
// ===========================================================================
const caseC = await runScenario({
  addReplyResult: { ok: false, mode: 'server', status: 500 },
  inputValue: '살아 있는 초안',
});

assert.equal(caseC.formOpen, true, 'Case C: a failed reply must not close the form');
assert.equal(
  caseC.inputValue,
  '살아 있는 초안',
  'Case C: a failed reply must preserve the draft text',
);
assert.equal(
  caseC.replyHostHtml,
  '',
  'Case C: a failed reply must not project any reply DOM',
);
assert.doesNotMatch(
  caseC.replyHostHtml,
  /data-server-reply-id/,
  'Case C: a failed reply must never fabricate a reply node',
);
assert.ok(
  caseC.focusLog.includes('input'),
  'Case C: focus must return to the input after a failure',
);

// ===========================================================================
// Mutation proof — re-injecting the historical guard must break Case A.
// ===========================================================================
{
  assert.doesNotMatch(
    detailHtml,
    /if\(!state\|\|!state\.loaded\)return;/,
    'the historical silent-drop guard must be gone from the page',
  );

  // Locate the current appendReply body and swap it for the historical one.
  const currentStart = detailHtml.indexOf('function appendReply(parentId,reply){');
  assert.ok(currentStart > -1, 'appendReply must exist in the page');
  const nextFn = detailHtml.indexOf('async function loadPost()', currentStart);
  const historicalBlock =
    HISTORICAL_APPEND.replace(/\\n/g, '\n') + '\n';
  const mutatedHtml =
    detailHtml.slice(0, currentStart) + historicalBlock + detailHtml.slice(nextFn);
  assert.notEqual(mutatedHtml, detailHtml, 'mutation must actually change the document');
  assert.match(mutatedHtml, /if\(!state\|\|!state\.loaded\)return;/, 'mutation: historical guard re-injected');

  const mutatedInline = mutatedHtml.split('<script>').find((b) => b.includes('function appendReply')).split('</script>')[0];
  const caseAMutated = await runScenario({ scriptSource: mutatedInline, addReplyResult: successResult });

  assert.equal(
    caseAMutated.replyHostHtml,
    '',
    'mutation: the historical guard must silently drop the reply — the rule above must reject it',
  );
  assert.doesNotMatch(
    caseAMutated.replyHostHtml,
    /r-new-1/,
    'mutation: the server reply must be absent once the guard is restored',
  );
  // ...while the other two cases are unaffected by this specific mutation,
  // which is what makes Case A the discriminating control.
  assert.equal(caseAMutated.formOpen, false, 'mutation: the form still closes, so only visibility is lost');
}

console.log('leaf-1039-unloaded-reply-projection-contract: PASS');
