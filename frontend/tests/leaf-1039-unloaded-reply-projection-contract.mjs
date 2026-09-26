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
const runScenario = async ({
  scriptSource = firstInlineScript,
  addReplyResult,
  // ---- #1044: comment continuity scripting ----
  driveReply = true,
  driveComment = false,
  commentDraft = '새로 단 댓글',
  addCommentResult,
  postResult = { mode: 'server', post: null },
  listCommentsResults = [{ mode: 'server', comments: [], nextCursor: null, hasMore: false }],
  loadMoreBeforeComment = false,
  loadMoreAfterComment = false,
  expandThread = false,
  // When false the harness registers listeners and drives the reply-button click
  // only, leaving the submit step to the caller (Case B needs a clean timeline).
  autoSubmit = true,
  inputValue = '작성한 답글',
  // Scripted server listReplies responses, consumed in call order.
  listRepliesResults = [{ mode: 'server', replies: [], nextCursor: null, hasMore: false }],
} = {}) => {
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
    insertAdjacentHTML(_pos, html) {
      this._html += html;
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
    listReplies(postId, commentId, opts) {
      bridgeCalls.push({ op: 'listReplies', commentId, opts: opts ? { ...opts } : null });
      const next = listRepliesResults[Math.min(bridgeCalls.filter((c) => c.op === 'listReplies').length - 1, listRepliesResults.length - 1)];
      return Promise.resolve({ mode: 'server', replies: [], nextCursor: null, hasMore: false, ...next });
    },
    addComment(postId, body) {
      bridgeCalls.push({ op: 'addComment', body });
      return Promise.resolve(addCommentResult);
    },
    getPost() {
      bridgeCalls.push({ op: 'getPost' });
      const n = bridgeCalls.filter((c) => c.op === 'getPost').length;
      return Promise.resolve(typeof postResult === 'function' ? postResult(n) : postResult);
    },
    listComments(postId, opts) {
      bridgeCalls.push({ op: 'listComments', opts: opts ? { ...opts } : null });
      const n = bridgeCalls.filter((c) => c.op === 'listComments').length - 1;
      const scripted = listCommentsResults[Math.min(n, listCommentsResults.length - 1)]
        || { mode: 'server', comments: [], nextCursor: null, hasMore: false };
      return Promise.resolve(scripted);
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
  const settle = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
  const fire = (handler, target) => handler({
    type: 'click',
    target,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  });

  if (driveReply && clickHandler) {
    fire(clickHandler, replyTrigger);
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
  if (driveReply && submitHandler && autoSubmit) submitHandler(submitEvent);

  // Let the bridge promise settle.
  await settle();

  // ---- #1044: expand a reply thread, paginate comments, then submit a comment ----
  if (driveReply && expandThread && clickHandler) {
    const toggle = { dataset: { serverReplyToggle: PARENT } };
    toggle.closest = (sel) => (sel === '[data-server-reply-toggle]' ? toggle : null);
    fire(clickHandler, toggle);
    await settle();
  }
  if (loadMoreBeforeComment && clickHandler) {
    const more = { dataset: {} };
    more.closest = (sel) => (sel === '#commentLoadMore' ? more : null);
    fire(clickHandler, more);
    await settle();
  }
  if (driveComment && submitHandler) {
    byId.get('commentText').value = commentDraft;
    const commentFormEl = byId.get('commentForm');
    commentFormEl.closest = () => null;
    submitHandler({
      type: 'submit',
      target: commentFormEl,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    });
    await settle();
  }
  if (loadMoreAfterComment && clickHandler) {
    const more2 = { dataset: {} };
    more2.closest = (sel) => (sel === '#commentLoadMore' ? more2 : null);
    fire(clickHandler, more2);
    await settle();
  }

  return (
    {
          clickHandler,
          submitHandler,
          replyHost,
          replyToggle,
          replyForm,
          input,
          commentList,
          replyHostHtml: replyHost.innerHTML,
          replyToggleText: replyToggle.textContent,
          formOpen: replyForm.classList.contains('open'),
          inputValue: input.value,
          focusLog,
      bridgeCalls,
      submitHandlerFound: Boolean(submitHandler),
      commentListHtml: commentList.innerHTML,
      commentCountText: byId.get('commentCount').textContent,
      commentTitleCountText: byId.get('commentTitleCount').textContent,
      commentLoadMoreHidden: byId.get('commentLoadMore').hidden,
      commentLoadMoreText: byId.get('commentLoadMore').textContent,
      commentTextValue: byId.get('commentText').value,
      listCommentsCalls: bridgeCalls.filter((c) => c.op === 'listComments'),
      getPostCalls: bridgeCalls.filter((c) => c.op === 'getPost'),
      addCommentCalls: bridgeCalls.filter((c) => c.op === 'addComment'),
    }
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
// Case B — the thread was ALREADY LOADED before the submit.
//
// This drives the real inline state machine through the full sequence a
// resident produces, rather than asserting on source text:
//
//   1. the parent thread reaches loaded=true through a faithful listReplies read
//   2. at least one existing reply is present
//   3. cursor / hasMore are explicitly set by the server result
//   4. bridge.addReply() returns the server-created reply
//   5. the real submit -> appendReply path runs
//   6. the existing reply survives
//   7. exactly one new reply is added
//   8. a further listReplies server read now includes that same reply
//   9. projected + loaded must not produce a duplicate
//  10. cursor / hasMore stay equal to what the server returned
// ===========================================================================
{
  const EXISTING_REPLY = {
    id: 'r-existing-1',
    body: '먼저 달린 답글',
    author: { nickname: '이웃' },
    createdAt: '2026-09-25T00:00:00.000Z',
  };
  // The second server read already contains the reply the resident is about to
  // create — this is what makes step 9 (no duplicate) meaningful.
  const SECOND_READ = {
    replies: [EXISTING_REPLY, SERVER_REPLY],
    nextCursor: 'cursor-2',
    hasMore: false,
  };
  const FIRST_READ = {
    replies: [EXISTING_REPLY],
    nextCursor: 'cursor-1',
    hasMore: true,
  };

  const caseB = await runScenario({
    addReplyResult: { ok: true, mode: 'server', reply: { ...SERVER_REPLY } },
    listRepliesResults: [FIRST_READ, SECOND_READ],
    autoSubmit: false,
  });

  const fireClick = (target) =>
    caseB.clickHandler({
      type: 'click',
      target,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    });
  const settle = () => new Promise((r) => setImmediate(() => setImmediate(() => setImmediate(r))));

  // (1) Reach loaded=true through the real toggle -> loadReplies path.
  const toggleTarget = {
    dataset: { serverReplyToggle: PARENT },
    closest: (sel) => (sel === '[data-server-reply-toggle]' ? toggleTarget : null),
  };
  fireClick(toggleTarget);
  await settle();

  const readsAfterToggle = caseB.bridgeCalls.filter((c) => c.op === 'listReplies');
  assert.equal(readsAfterToggle.length, 1, 'Case B step 1: the toggle must perform exactly one listReplies read');
  assert.equal(readsAfterToggle[0].commentId, PARENT, 'Case B step 1: the read must target the parent comment');

  // (2) The existing reply is now rendered.
  assert.match(
    caseB.replyHost.innerHTML,
    /data-server-reply-id="r-existing-1"/,
    'Case B step 2: the existing reply must be rendered after the load',
  );
  assert.match(
    caseB.replyHost.innerHTML,
    /먼저 달린 답글/,
    'Case B step 2: the existing reply body must be rendered',
  );

  // (3) Pagination truth came from the server and is visible in the UI.
  assert.equal(
    caseB.replyToggle.textContent,
    '답글 더 보기',
    'Case B step 3: hasMore:true from the server must surface on the toggle',
  );
  assert.match(
    caseB.replyHost.innerHTML,
    /data-server-replies-more="c1"/,
    'Case B step 3: the server cursor must produce a real "답글 더 보기" control',
  );

  // (4-5) The real submit path runs and the server reply is projected.
  const beforeSubmit = caseB.replyHost.innerHTML;
  caseB.input.value = '추가한 답글';
  caseB.submitHandler({
    type: 'submit',
    target: caseB.replyForm,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  });
  await settle();

  assert.equal(
    caseB.bridgeCalls.filter((c) => c.op === 'addReply').length,
    1,
    'Case B step 4: the submit must reach bridge.addReply',
  );
  assert.notEqual(caseB.replyHost.innerHTML, beforeSubmit, 'Case B step 5: the submit must re-render the thread');

  // (6) The existing reply survives.
  assert.match(
    caseB.replyHost.innerHTML,
    /data-server-reply-id="r-existing-1"/,
    'Case B step 6: the pre-existing reply must still be present after the append',
  );

  // (7) Exactly one new reply, carrying the server id.
  assert.match(
    caseB.replyHost.innerHTML,
    /data-server-reply-id="r-new-1"/,
    'Case B step 7: the server-created reply must be visible',
  );
  const newIdCount = (caseB.replyHost.innerHTML.match(/data-server-reply-id="r-new-1"/g) || []).length;
  assert.equal(newIdCount, 1, 'Case B step 7: the new reply must appear exactly once, got ' + newIdCount);
  const existingIdCount = (caseB.replyHost.innerHTML.match(/data-server-reply-id="r-existing-1"/g) || []).length;
  assert.equal(existingIdCount, 1, 'Case B step 7: the existing reply must not be duplicated');

  // (8) A further real listReplies read now includes the same reply.
  const moreTarget = {
    dataset: { serverRepliesMore: PARENT },
    closest: (sel) => (sel === '[data-server-replies-more]' ? moreTarget : null),
  };
  fireClick(moreTarget);
  await settle();

  const reads = caseB.bridgeCalls.filter((c) => c.op === 'listReplies');
  assert.equal(reads.length, 2, 'Case B step 8: "답글 더 보기" must perform the append read');
  assert.equal(
    reads[1].opts?.cursor,
    'cursor-1',
    'Case B step 8: the append read must continue from the server cursor',
  );

  // (9) The projected reply was absorbed by id, so it is not rendered twice.
  assert.doesNotMatch(
    caseB.replyHost.innerHTML,
    /data-server-reply-id="r-new-1"[\s\S]*data-server-reply-id="r-new-1"/,
    'Case B step 9: projected + loaded must not duplicate the same reply',
  );
  const afterReadNew = (caseB.replyHost.innerHTML.match(/data-server-reply-id="r-new-1"/g) || []).length;
  const afterReadExisting = (caseB.replyHost.innerHTML.match(/data-server-reply-id="r-existing-1"/g) || []).length;
  assert.equal(afterReadNew, 1, 'Case B step 9: the reply must appear exactly once after the server read, got ' + afterReadNew);
  assert.equal(afterReadExisting, 1, 'Case B step 9: the existing reply must appear exactly once after the server read');

  // (10) Pagination truth matches the second server result.
  assert.equal(
    caseB.replyToggle.textContent,
    '답글 보기',
    'Case B step 10: hasMore:false from the second read must replace the toggle label',
  );
  assert.doesNotMatch(
    caseB.replyHost.innerHTML,
    /data-server-replies-more/,
    'Case B step 10: hasMore:false must remove the "답글 더 보기" control',
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

// ===========================================================================
// #1044 — comment/reply continuity across a post-submit refetch.
//
// Historical defect in `frontend/13_이웃대화_글상세_댓글.html`:
//
//   bridge.addComment(postId,v).then(async r=>{
//    if(r.ok&&r.mode==='server'){commentText.value='';await loadPost()}
//
// and `loadPost()` ends in `loadComments()`, whose full-reload branch does
// `replyStates.clear()` and replaces `commentState`. Every successful
// top-level comment therefore destroyed the loaded comment page window, the
// expanded reply threads and their cursors — and a newly-created comment could
// vanish from the UI whenever it was not inside the first refetched page.
//
// The fix must use the object the server returned, keep the existing
// pagination window, and must not fake a cursor.
//
// These cases drive the same real inline script through the same harness.
const POST_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const SERVER_POST = {
  id: POST_ID,
  kind: 'together',
  category: null,
  title: '함께하는 이웃',
  body: '오늘 저녁에 같이 산책하실래요?',
  author: { nickname: '산책메이트' },
  publishedAt: '2026-09-20T00:00:00.000Z',
  createdAt: '2026-09-20T00:00:00.000Z',
  status: 'published',
  commentCount: 25,
  reactionCount: 3,
  viewerLiked: false,
  viewerCanEdit: false,
  viewerCanReport: true,
  viewerCanDelete: false,
};

const serverComment = (n) => ({
  id: 'c-' + n,
  body: '기존 댓글 ' + n,
  author: { nickname: '이웃' + n },
  publishedAt: '2026-09-20T0' + (n % 10) + ':00:00.000Z',
  createdAt: '2026-09-20T0' + (n % 10) + ':00:00.000Z',
  status: 'published',
  viewerCanDelete: false,
  viewerCanReport: true,
});

const PAGE1 = Array.from({ length: 20 }, (_, i) => serverComment(i + 1));
const PAGE2 = Array.from({ length: 5 }, (_, i) => serverComment(i + 21));

// The server created object. Its id is deliberately NOT in any listed page —
// that is exactly the "created comment may fall outside the first refetched
// page" condition from the issue.
const CREATED_COMMENT = {
  id: 'c-created-1',
  body: '방금 남긴 댓글',
  author: { nickname: '나' },
  publishedAt: '2026-09-26T00:00:00.000Z',
  createdAt: '2026-09-26T00:00:00.000Z',
  status: 'published',
  viewerCanDelete: true,
  viewerCanReport: false,
};

const commentSuccess = { ok: true, mode: 'server', status: 201, comment: { ...CREATED_COMMENT } };

const countRows = (html, id) => (html.match(new RegExp('data-server-comment="' + id + '"', 'g')) || []).length;

// ---------------------------------------------------------------------------
// Case 1044-1 — 20+ loaded comments, a load-more, then a new top-level comment.
// ---------------------------------------------------------------------------
{
  const run = await runScenario({
    driveReply: false,
    expandThread: false,
    driveComment: true,
    loadMoreBeforeComment: true,
    postResult: (n) => (n === 1 ? { mode: 'server', post: SERVER_POST } : { mode: 'server', post: { ...SERVER_POST, commentCount: 26 } }),
    listCommentsResults: [
      { mode: 'server', comments: PAGE1, nextCursor: 'cursor-page-2', hasMore: true },
      { mode: 'server', comments: PAGE2, nextCursor: 'cursor-page-3', hasMore: true },
    ],
    addCommentResult: commentSuccess,
  });

  // 25 comments were loaded before the submit.
  for (const row of [...PAGE1, ...PAGE2]) {
    assert.equal(countRows(run.commentListHtml, row.id), 1, 'Case 1044-1: loaded comment ' + row.id + ' must survive the submit');
  }
  assert.equal(
    run.listCommentsCalls.length,
    2,
    'Case 1044-1: a successful comment must not trigger a third listComments refetch, got ' + run.listCommentsCalls.length,
  );
  assert.equal(
    run.listCommentsCalls[1].opts.cursor,
    'cursor-page-2',
    "Case 1044-1: the resident own load-more must have used the server cursor",
  );

  // The just-created server object is visible even though no listed page has it.
  assert.equal(
    countRows(run.commentListHtml, 'c-created-1'),
    1,
    'Case 1044-1: the just-created comment must be visible exactly once',
  );
  assert.match(
    run.commentListHtml,
    /방금 남긴 댓글/,
    'Case 1044-1: the rendered row must carry the server-returned body',
  );
  assert.doesNotMatch(
    run.commentListHtml,
    /data-server-comment="c-created-2"/,
    'Case 1044-1: the projection must not invent a second id',
  );
  assert.equal(run.commentTextValue, '', 'Case 1044-1: the composer must be cleared on success');
  assert.equal(String(run.commentCountText), '26', 'Case 1044-1: the summary must reconcile to the server post count');
  assert.equal(String(run.commentTitleCountText), '26', 'Case 1044-1: the title count must reconcile too');
  assert.equal(
    run.commentLoadMoreHidden,
    false,
    'Case 1044-1: the load-more control must stay available, so pagination truth survives',
  );
  assert.equal(
    run.commentLoadMoreText,
    '댓글 더 보기',
    'Case 1044-1: the load-more label must return to its resting state',
  );
  console.log('1044_CASE_PAGINATED_WINDOW=PASS');
}

// ---------------------------------------------------------------------------
// Case 1044-2 — an expanded reply thread must survive the same submit.
// ---------------------------------------------------------------------------
{
  const LOADED_REPLY = {
    id: 'r-existing-1',
    body: '펼친 스레드의 답글',
    author: { nickname: '이웃' },
    createdAt: '2026-09-21T00:00:00.000Z',
  };
  const run = await runScenario({
    driveReply: true,
    autoSubmit: false,
    expandThread: true,
    driveComment: true,
    listRepliesResults: [{ mode: 'server', replies: [LOADED_REPLY], nextCursor: 'reply-cursor-1', hasMore: true }],
    postResult: (n) => (n === 1 ? { mode: 'server', post: SERVER_POST } : { mode: 'server', post: SERVER_POST }),
    listCommentsResults: [{ mode: 'server', comments: PAGE1, nextCursor: 'cursor-page-2', hasMore: true }],
    addCommentResult: commentSuccess,
  });

  assert.equal(
    (run.replyHost.innerHTML.match(/data-server-reply-id="r-existing-1"/g) || []).length,
    1,
    'Case 1044-2: the loaded reply must remain rendered after the comment submit',
  );
  assert.match(
    run.replyHost.innerHTML,
    /data-server-replies-more/,
    'Case 1044-2: the reply pagination control must survive — cursor truth is not discarded',
  );
  assert.equal(
    run.replyToggle.textContent,
    '답글 더 보기',
    'Case 1044-2: the expanded toggle must stay expanded',
  );
  assert.equal(
    run.listCommentsCalls.length,
    1,
    'Case 1044-2: the comment submit must not refetch the comment page, got ' + run.listCommentsCalls.length,
  );
  assert.equal(
    countRows(run.commentListHtml, 'c-created-1'),
    1,
    'Case 1044-2: the just-created comment is still projected',
  );
  console.log('1044_CASE_EXPANDED_THREAD=PASS');
}

// ---------------------------------------------------------------------------
// Case 1044-3 — load-more still works, with the SAME cursor, after a submit.
// ---------------------------------------------------------------------------
{
  const run = await runScenario({
    driveReply: false,
    driveComment: true,
    loadMoreBeforeComment: true,
    loadMoreAfterComment: true,
    postResult: { mode: 'server', post: SERVER_POST },
    listCommentsResults: [
      { mode: 'server', comments: PAGE1, nextCursor: 'cursor-page-2', hasMore: true },
      { mode: 'server', comments: PAGE2, nextCursor: 'cursor-page-3', hasMore: true },
      { mode: 'server', comments: [], nextCursor: null, hasMore: false },
    ],
    addCommentResult: commentSuccess,
  });

  // initial page + resident load-more, then the submit, then another load-more
  assert.equal(
    run.listCommentsCalls.length,
    3,
    'Case 1044-3: exactly initial + pre-submit load-more + post-submit load-more, got ' + run.listCommentsCalls.length,
  );
  assert.equal(
    run.listCommentsCalls[2].opts.cursor,
    'cursor-page-3',
    'Case 1044-3: a load-more after a submit must continue from the stored server cursor, not restart at page 1',
  );
  assert.equal(
    countRows(run.commentListHtml, 'c-created-1'),
    1,
    'Case 1044-3: the projected comment must not be duplicated by a later page',
  );
  console.log('1044_CASE_LOAD_MORE_CONTINUITY=PASS');
}

// ---------------------------------------------------------------------------
// Case 1044-4 — duplicate protection: the same server id must render once.
// ---------------------------------------------------------------------------
{
  const run = await runScenario({
    driveReply: false,
    driveComment: true,
    postResult: { mode: 'server', post: SERVER_POST },
    // The very first page already contains the comment the "create" returns,
    // which is what a fast refetch or a double submit can produce.
    listCommentsResults: [{ mode: 'server', comments: [CREATED_COMMENT, ...PAGE1], nextCursor: 'cursor-page-2', hasMore: true }],
    addCommentResult: commentSuccess,
  });

  assert.equal(
    countRows(run.commentListHtml, 'c-created-1'),
    1,
    'Case 1044-4: a comment already present in the loaded window must not be projected twice',
  );
  assert.equal(
    run.listCommentsCalls.length,
    1,
    'Case 1044-4: the submit must not refetch',
  );
  console.log('1044_CASE_DUPLICATE_PROTECTION=PASS');
}

// ---------------------------------------------------------------------------
// Case 1044-5 — a failed comment submit keeps the draft and adds nothing.
// ---------------------------------------------------------------------------
{
  const run = await runScenario({
    driveReply: false,
    driveComment: true,
    commentDraft: '살아 있는 초안',
    postResult: { mode: 'server', post: SERVER_POST },
    listCommentsResults: [{ mode: 'server', comments: PAGE1, nextCursor: 'cursor-page-2', hasMore: true }],
    addCommentResult: { ok: false, mode: 'server', status: 500 },
  });

  assert.equal(run.commentTextValue, '살아 있는 초안', 'Case 1044-5: a failed submit must keep the draft');
  assert.equal(
    countRows(run.commentListHtml, 'c-created-1'),
    0,
    'Case 1044-5: a failed submit must not project anything',
  );
  assert.equal(
    run.listCommentsCalls.length,
    1,
    'Case 1044-5: a failed submit must not refetch the comment page',
  );
  console.log('1044_CASE_FAILURE_BEHAVIOR=PASS');
}

// ---------------------------------------------------------------------------
// Case 1044-6 — #981 focus lifecycle is untouched (reply success/failure).
// ---------------------------------------------------------------------------
{
  const focus = await runScenario({
    driveReply: true,
    autoSubmit: true,
    addReplyResult: { ok: true, mode: 'server', reply: { id: 'r-focus', body: '답글', author: { nickname: '나' }, createdAt: '2026-09-26T00:00:00.000Z' } },
  });
  assert.ok(focus.focusLog.includes('replyButton'), 'Case 1044-6: #981 success must return focus to the reply button');

  const failed = await runScenario({
    driveReply: true,
    autoSubmit: true,
    inputValue: '살아 있는 초안',
    addReplyResult: { ok: false, mode: 'server', status: 500 },
  });
  assert.ok(failed.focusLog.includes('input'), 'Case 1044-6: #981 failure must return focus to the input');
  assert.equal(failed.inputValue, '살아 있는 초안', 'Case 1044-6: #981 failure must retain the draft value');
  console.log('981_FOCUS_REGRESSION=PASS');
}

// ---------------------------------------------------------------------------
// Mutation proof — restoring the historical `await loadPost()` must break it.
// ---------------------------------------------------------------------------
{
  const CURRENT_SUBMIT = [
    "  bridge.addComment(postId,v).then(r=>{",
    "    if(r.ok&&r.mode==='server'){",
    "     commentText.value='';",
    "     projectCreatedComment(r.comment);",
    "     void reconcileCommentSummary();",
    "    }else flash(failMessage(r));",
    "   });",
  ].join('\n');
  const HISTORICAL_SUBMIT =
    "  bridge.addComment(postId,v).then(async r=>{\n" +
    "    if(r.ok&&r.mode==='server'){commentText.value='';await loadPost()}\n" +
    "    else flash(failMessage(r));\n" +
    "   });";

  assert.ok(detailHtml.includes(CURRENT_SUBMIT), 'the continuity submit path must exist in the page');

  const mutatedHtml = detailHtml.replace(CURRENT_SUBMIT, HISTORICAL_SUBMIT);
  assert.notEqual(mutatedHtml, detailHtml, 'mutation must actually change the document');
  assert.match(mutatedHtml, /addComment[\s\S]{0,120}await loadPost()/, 'mutation: historical refetch re-injected');

  const mutatedInline = [...mutatedHtml.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .find((b) => b.includes('function appendReply') && b.includes("addEventListener('submit'"));
  assert.ok(mutatedInline, 'mutation: the mutated inline block must be extractable');

  const run = await runScenario({
    scriptSource: mutatedInline,
    driveReply: false,
    driveComment: true,
    loadMoreBeforeComment: true,
    postResult: { mode: 'server', post: SERVER_POST },
    listCommentsResults: [
      { mode: 'server', comments: PAGE1, nextCursor: 'cursor-page-2', hasMore: true },
      { mode: 'server', comments: PAGE2, nextCursor: 'cursor-page-3', hasMore: true },
    ],
    addCommentResult: commentSuccess,
  });

  assert.ok(
    run.listCommentsCalls.length > 2,
    'mutation: the historical path must re-read the comment list, which is what the rules above forbid',
  );
  assert.equal(
    countRows(run.commentListHtml, 'c-created-1'),
    0,
    'mutation: with the historical refetch the created comment is lost from the window — the rule above must catch it',
  );
  // The historical path re-reads the FIRST page with no cursor at all — that is
  // exactly the pagination context the issue requires to survive.
  assert.equal(
    run.listCommentsCalls[2].opts,
    null,
    'mutation: the historical refetch restarts the comment window at page 1 — the rule above must catch it',
  );
  console.log('1044_MUTATION_PROOF=PASS');
}

console.log('1044_CONTINUITY_CONTRACT=PASS');

console.log('leaf-1039-unloaded-reply-projection-contract: PASS');
