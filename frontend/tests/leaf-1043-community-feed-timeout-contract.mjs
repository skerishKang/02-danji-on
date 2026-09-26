import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// #1043: a community feed request that never settles must not strand the
// resident in "이웃대화를 불러오는 중입니다." forever.
//
// This contract drives the REAL production runtimes -- assets/danjion-session.js,
// assets/community-bridge.js and the live wiring block of
// 12_이웃대화_첫화면.html -- inside a vm context, against a fetch whose promises
// are settled by the test. A "hung" request is a genuinely never-settled
// promise, not a slow one, and it is the abort signal that ends it. No claim
// below is satisfied by a substring assertion: each acceptance item is an
// observed settled state.

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [sessionSource, bridgeSource, pageSource] = await Promise.all([
  read('assets/danjion-session.js'),
  read('assets/community-bridge.js'),
  read('12_이웃대화_첫화면.html')
]);

const WIRING_ID = 'danjion-community-list-live-wiring-329';
const wiring = pageSource.match(
  new RegExp(`<script id="${WIRING_ID}">([\\s\\S]*?)<\\/script>`)
)?.[1] || '';
assert.ok(wiring, `${WIRING_ID} live wiring block must exist`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate, message, budgetMs = 4000) => {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
  assert.fail(message);
};

function apiResponse(status, payload, bridgeHeader = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    headers: { get: (name) => (name === 'x-danjion-auth-bridge' ? bridgeHeader : null) }
  };
}

// Every promise is settled by the test. A real fetch rejects with AbortError
// when its signal fires, so this fake does too -- that rejection is the only
// thing that can end a hung request. `ignoreAbort` models a transport that kept
// buffering past the deadline and answers anyway.
function scriptedFetch({ ignoreAbort = false } = {}) {
  const calls = [];
  const impl = (url, init) => {
    const call = { url, init, aborted: false, settled: false };
    const promise = new Promise((resolve, reject) => {
      call.resolve = (value) => { if (call.settled) return; call.settled = true; resolve(value); };
      call.reject = (error) => { if (call.settled) return; call.settled = true; reject(error); };
    });
    const signal = init && init.signal;
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', () => {
        call.aborted = true;
        if (ignoreAbort) return;
        call.reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
      });
    }
    calls.push(call);
    return promise;
  };
  return { impl, calls };
}

function newContext(extra = {}) {
  const context = {
    console,
    URL,
    URLSearchParams,
    encodeURIComponent,
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    location: { search: '', hostname: '', origin: '' },
    ...extra
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(sessionSource, context, { filename: 'danjion-session.js' });
  vm.runInContext(bridgeSource, context, { filename: 'community-bridge.js' });
  return context;
}

const POSTS = {
  data: [{
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'greeting',
    category: null,
    title: '첫 인사',
    body: '안녕하세요',
    status: 'published',
    author: { nickname: '주민' },
    reactionCount: 0,
    commentCount: 0,
    viewerLiked: false,
    viewerCanEdit: false,
    viewerCanDelete: false,
    viewerCanReport: false,
    publishedAt: '2026-09-26T00:00:00.000Z',
    createdAt: '2026-09-26T00:00:00.000Z'
  }],
  nextCursor: null,
  hasMore: false
};

const LATE_POSTS = {
  data: [{ ...POSTS.data[0], id: '22222222-2222-4222-8222-222222222222', title: '늦은 응답' }],
  nextCursor: null,
  hasMore: false
};

// Boots the real page wiring over a minimal DOM. Only the deadline is shortened
// (via the bridge's own requestTimeoutMs option) so the contract observes the
// real bounded path without waiting out the 15s production default; every bridge
// and page function executed below is the production one.
function bootFeedPage({ ignoreAbort = false, requestTimeoutMs = 40 } = {}) {
  const fetchControl = scriptedFetch({ ignoreAbort });
  const list = { innerHTML: '' };
  const retryListeners = [];
  const loadMore = {
    disabled: false,
    hidden: true,
    textContent: '',
    addEventListener: (type, fn) => { if (type === 'click') retryListeners.push(fn); }
  };
  const topic = { dataset: { type: 'hello' }, addEventListener: () => {} };
  const noopNode = { addEventListener: () => {} };

  const context = newContext({
    fetch: fetchControl.impl,
    location: { search: '?apiBase=https://api.example.test', hostname: 'api.example.test', origin: 'https://danjion.example' },
    document: {
      getElementById: (id) => (id === 'postList' ? list : id === 'postLoadMore' ? loadMore : null),
      querySelector: (selector) => (selector === '.topic.active' ? topic : null),
      querySelectorAll: () => [noopNode],
      addEventListener: () => {}
    }
  });

  const realCreate = context.DanjionCommunityBridge.createCommunityBridge;
  context.DanjionCommunityBridge.createCommunityBridge = (options) =>
    realCreate({ ...options, requestTimeoutMs });

  vm.runInContext(wiring, context, { filename: `12_이웃대화_첫화면.html#${WIRING_ID}` });

  return {
    list,
    loadMore,
    calls: fetchControl.calls,
    clickRetry: () => Promise.all(retryListeners.map((fn) => fn()))
  };
}

/* ------------------------------------------------------------------ *
 * 1. Bounded request factory: every pre-existing outcome keeps its
 *    meaning, and a hung request gains a new truthful one.
 * ------------------------------------------------------------------ */
{
  const session = newContext().DanjionSession;
  assert.equal(session.DEFAULT_BOUNDED_REQUEST_TIMEOUT_MS, 15000,
    'the canonical bounded default must stay a finite 15s boundary');

  const { impl, calls } = scriptedFetch();
  const bounded = session.createBoundedSessionFetch('https://api.example.test', { timeoutMs: 40 });

  // A never-resolving request must still finish, bounded.
  const started = Date.now();
  const hungResult = await bounded(impl, '/hung');
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `a hung request must end quickly, took ${elapsed}ms`);
  assert.equal(hungResult.ok, false, 'a request that never settled must not report success');
  assert.equal(hungResult.reason, 'timeout', 'a bounded-out request must report the timeout reason');
  assert.equal(hungResult.status, 0, 'a timeout has no HTTP status');
  assert.equal(hungResult.authBridge, undefined, 'a timeout is never an auth-bridge disposition');
  assert.equal(calls[0].aborted, true, 'the hung request must actually be aborted');

  // Normal server response parity.
  let pending = bounded(impl, '/ok');
  calls[1].resolve(apiResponse(200, { data: { value: 7 } }));
  let result = await pending;
  assert.equal(result.ok, true, 'a normal 2xx response must still succeed');
  assert.equal(result.reason, undefined, 'a normal response must not acquire a timeout reason');
  assert.deepEqual(result.data, { value: 7 }, 'a normal response payload must be unchanged');

  // HTTP error parity.
  pending = bounded(impl, '/err');
  calls[2].resolve(apiResponse(500, { error: { code: 'BOOM' } }));
  result = await pending;
  assert.equal(result.reason, 'server-error', 'a 5xx must keep the existing server-error reason');
  assert.equal(result.status, 500, 'a 5xx must keep its status');

  // 401 auth parity, including the bounded bridge disposition.
  pending = bounded(impl, '/auth');
  calls[3].resolve(apiResponse(401, { error: { code: 'AUTH_REQUIRED' } }, 'session-invalid'));
  result = await pending;
  assert.equal(result.reason, 'auth-required', 'a 401 must keep the existing auth-required reason');
  assert.equal(result.authBridge, 'session-invalid', 'the auth-bridge disposition must survive');
  assert.equal(session.authFailureKind(result), 'signed-out', 'auth failure classification must be unchanged');

  // A genuine transport failure is still a network error, not a timeout.
  pending = bounded(impl, '/net');
  calls[4].reject(new TypeError('Failed to fetch'));
  result = await pending;
  assert.equal(result.reason, 'network-error', 'a real offline failure must stay network-error');
  assert.notEqual(result.reason, 'timeout', 'a network failure must never be reported as a timeout');

  // Single timeout owner: exactly one signal, and a finished request is not left aborted.
  pending = bounded(impl, '/signal');
  assert.ok(calls[5].init.signal, 'the bounded request must carry an abort signal');
  assert.equal(calls[5].init.signal.aborted, false, 'the signal must start un-aborted');
  calls[5].resolve(apiResponse(200, { data: null }));
  await pending;
  assert.equal(calls[5].init.signal.aborted, false, 'a completed request must not be left aborted');
}

/* ------------------------------------------------------------------ *
 * 2. The default deadline is the single owner and its timer is cleared.
 *    A real response arriving after the deadline keeps its own meaning.
 * ------------------------------------------------------------------ */
{
  const timers = [];
  const context = newContext({
    setTimeout: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length - 1; },
    clearTimeout: (handle) => { if (timers[handle]) timers[handle].cleared = true; }
  });

  const { impl, calls } = scriptedFetch();
  const bounded = context.DanjionSession.createBoundedSessionFetch('https://api.example.test');
  const pending = bounded(impl, '/default');
  assert.equal(timers.length, 1, 'the bounded request must own exactly one timer');
  assert.equal(timers[0].ms, 15000, 'the default boundary must be the canonical 15s');
  timers[0].fn();
  assert.equal(calls[0].init.signal.aborted, true, 'firing the owned timer must abort the request');
  const timedOut = await pending;
  assert.equal(timedOut.reason, 'timeout', 'the default deadline must produce a timeout outcome');

  // A settled request clears the single timer too.
  timers.length = 0;
  const okPending = bounded(impl, '/default-ok');
  assert.equal(timers.length, 1, 'each bounded request owns exactly one timer');
  calls[1].resolve(apiResponse(200, { data: null }));
  await okPending;
  assert.equal(timers[0].cleared, true, 'a settled request must clear its timer');
}
{
  // The deadline guards even a transport that ignores the abort signal: the
  // bounded request still returns by the deadline, and whatever the transport
  // produces later is discarded rather than racing the outcome.
  const { impl, calls } = scriptedFetch({ ignoreAbort: true });
  const session = newContext().DanjionSession;
  const bounded = session.createBoundedSessionFetch('https://api.example.test', { timeoutMs: 30 });
  const started = Date.now();
  const result = await bounded(impl, '/late-transport');
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `an ignore-abort transport must still be bounded, took ${elapsed}ms`);
  assert.equal(result.reason, 'timeout', 'the deadline must end a signal-ignoring transport too');
  assert.equal(result.ok, false, 'a signal-ignoring transport must not report success');
  calls[0].resolve(apiResponse(200, { data: { value: 9 } }));
  await sleep(60);
  assert.equal(result.data, undefined, 'a response past the deadline must not retroactively change the outcome');
}

/* ------------------------------------------------------------------ *
 * 3. The real page wiring: no indefinite loading, truthful copy, retry.
 * ------------------------------------------------------------------ */
{
  const page = bootFeedPage();
  assert.equal(page.calls.length, 1, 'page boot must issue exactly one feed request');
  assert.match(page.list.innerHTML, /이웃대화를 불러오는 중입니다\./,
    'the feed enters its loading notice before the request settles');
  assert.equal(page.loadMore.disabled, true, 'the retry control is disabled while loading');

  // A never-resolving request exits loading within a finite bound.
  await until(() => page.list.innerHTML.includes('응답하지 않아'),
    'a hung feed request must leave the loading state on its own');
  assert.doesNotMatch(page.list.innerHTML, /이웃대화를 불러오는 중입니다\./,
    'the loading notice must not survive a bounded-out request');

  // Truthful error copy that does not blame the session.
  assert.match(page.list.innerHTML, /이웃대화가 응답하지 않아 불러오지 못했습니다\. 잠시 후 다시 시도해 주세요\./,
    'a timeout must render the truthful network copy');
  assert.doesNotMatch(page.list.innerHTML, /로그인 후 이웃대화를 확인할 수 있습니다\./,
    'a slow feed must never be reported as an expired login');

  // The retry control is available again.
  assert.equal(page.loadMore.disabled, false, 'the retry control must be re-enabled after a timeout');
  assert.equal(page.loadMore.hidden, false, 'the retry control must be visible after a timeout');
  assert.equal(page.loadMore.textContent, '게시글 다시 시도', 'the control must offer a retry');

  // Retry after the timeout succeeds and renders the feed.
  page.clickRetry();
  assert.equal(page.calls.length, 2, 'retry must issue a fresh request');
  page.calls[1].resolve(apiResponse(200, POSTS));
  await until(() => page.list.innerHTML.includes('첫 인사'),
    'a successful retry must render the feed');
  assert.equal(page.loadMore.disabled, false, 'the control must be usable after recovery');
  assert.equal(page.loadMore.textContent, '게시글 더 보기', 'the control returns to its normal affordance');
}

/* ------------------------------------------------------------------ *
 * 4. A stale request must never overwrite a later success.
 * ------------------------------------------------------------------ */
{
  const page = bootFeedPage({ ignoreAbort: true });
  const stale = page.calls[0];
  await until(() => page.list.innerHTML.includes('응답하지 않아'), 'the first request must time out');

  page.clickRetry();
  page.calls[1].resolve(apiResponse(200, POSTS));
  await until(() => page.list.innerHTML.includes('첫 인사'), 'the retry must land first');

  // The abandoned request's transport finally answers, long after it was given up on.
  stale.resolve(apiResponse(200, LATE_POSTS));
  await sleep(150);
  assert.doesNotMatch(page.list.innerHTML, /늦은 응답/, 'a stale response must not overwrite the newer success');
  assert.match(page.list.innerHTML, /첫 인사/, 'the newer success must remain rendered');
  assert.equal(page.loadMore.disabled, false, 'a stale response must not strand the control');
}

/* ------------------------------------------------------------------ *
 * 5. Pre-existing auth and server failure behaviour is untouched.
 * ------------------------------------------------------------------ */
{
  const authPage = bootFeedPage();
  authPage.calls[0].resolve(apiResponse(401, { error: { code: 'AUTH_REQUIRED' } }, 'session-invalid'));
  await until(() => authPage.list.innerHTML.includes('로그인 후'), 'a 401 must render the existing auth copy');
  assert.match(authPage.list.innerHTML, /로그인 후 이웃대화를 확인할 수 있습니다\./,
    'AUTH_FAILURE_PARITY: the existing auth copy must be unchanged');
  assert.equal(authPage.loadMore.disabled, false, 'the auth path must still expose retry');

  const errorPage = bootFeedPage();
  errorPage.calls[0].resolve(apiResponse(500, { error: { code: 'BOOM' } }));
  await until(() => errorPage.list.innerHTML.includes('불러오지 못했습니다'), 'a 5xx must render the generic copy');
  assert.match(errorPage.list.innerHTML, /이웃대화를 불러오지 못했습니다\./,
    'a generic server failure must keep its existing copy');
  assert.doesNotMatch(errorPage.list.innerHTML, /응답하지 않아/, 'a server error is not a timeout');
  assert.equal(errorPage.loadMore.disabled, false, 'the server error path must still expose retry');
}

/* ------------------------------------------------------------------ *
 * 6. Scope guard: the unrelated unbounded lanes were not changed.
 * ------------------------------------------------------------------ */
{
  const helper = sessionSource.match(
    /function createSessionFetch\(apiBase\) \{([\s\S]*?)\n  \}\n/
  )?.[0] || '';
  assert.ok(helper, 'createSessionFetch must still exist');
  assert.doesNotMatch(helper, /AbortController|setTimeout/,
    'unrelated session lanes must keep their existing unbounded semantics');
  assert.ok(bridgeSource.includes('const sessionFetch = session.createSessionFetch(apiBase)'),
    'the bridge must retain the canonical unbounded request for non-feed lanes');
  assert.ok(bridgeSource.includes('const boundedRequest ='),
    'the bridge must expose a separate bounded request only for the feed lane');

  // Behavioural scope proof: a non-feed mutation must NOT acquire the #1043
  // deadline/signal. It keeps the pre-existing unbounded transport semantics.
  const fetchControl = scriptedFetch({ ignoreAbort: true });
  const context = newContext({ fetch: fetchControl.impl });
  const bridge = context.DanjionCommunityBridge.createCommunityBridge({
    apiBase: 'https://api.example.test',
    fetchImpl: fetchControl.impl,
    requestTimeoutMs: 20,
    location: { hostname: 'api.example.test', search: '?apiBase=https://api.example.test' }
  });
  const mutation = bridge.addComment(POSTS.data[0].id, '범위 보존 댓글');
  assert.equal(fetchControl.calls.length, 1, 'the mutation must issue one request');
  assert.equal(fetchControl.calls[0].init.signal, undefined,
    'a non-feed mutation must not inherit the feed AbortController/deadline');
  fetchControl.calls[0].resolve(apiResponse(201, {
    data: {
      id: '33333333-3333-4333-8333-333333333333',
      postId: POSTS.data[0].id,
      body: '범위 보존 댓글',
      status: 'published',
      author: { nickname: '주민' },
      viewerCanDelete: true,
      viewerCanReport: false,
      publishedAt: '2026-09-26T00:00:00.000Z',
      createdAt: '2026-09-26T00:00:00.000Z',
      updatedAt: null
    }
  }));
  const mutationResult = await mutation;
  assert.equal(mutationResult.ok, true, 'the unbounded mutation result must keep its existing success semantics');
}

console.log('PASS #1043 community feed bounded request contract');
console.log('COMMUNITY_FEED_INDEFINITE_LOADING=NO');
console.log('COMMUNITY_FEED_REQUEST_BOUNDED=YES');
console.log('COMMUNITY_FEED_TIMEOUT_TRUTHFUL_ERROR=YES');
console.log('COMMUNITY_FEED_TIMEOUT_RETRY_AVAILABLE=YES');
console.log('COMMUNITY_FEED_TIMEOUT_AS_AUTH_FAILURE=NO');
console.log('NORMAL_SERVER_RESPONSE_PARITY=PASS');
console.log('HTTP_ERROR_PARITY=PASS');
console.log('AUTH_FAILURE_PARITY=PASS');
console.log('STALE_RESPONSE_GUARD=PASS');
console.log('SINGLE_TIMEOUT_OWNER=YES');
console.log('TIMER_CLEANUP=YES');
console.log('UNRELATED_REQUEST_TIMEOUTS_CHANGED=NO');
console.log('PRODUCT_API_SEMANTICS_CHANGED=NO');
console.log('PRODUCTION_MUTATION=0');
console.log('PRODUCTION_DEPLOY=0');
