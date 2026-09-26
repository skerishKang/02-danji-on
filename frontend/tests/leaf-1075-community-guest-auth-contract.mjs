import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// #1075: signed-out community auth UX. Page 12 must present the canonical
// login boundary (not a retry) for auth-required feed results and must route
// guest write affordances to that boundary; page 13 must not tell a fresh
// no-cookie guest that their login expired. Every claim below executes the
// real production wiring/scripts inside a vm against scripted responses.

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [sessionSource, bridgeSource, page12Source, page13Source] = await Promise.all([
  read('assets/danjion-session.js'),
  read('assets/community-bridge.js'),
  read('12_이웃대화_첫화면.html'),
  read('13_이웃대화_글상세_댓글.html')
]);

const WIRING_ID = 'danjion-community-list-live-wiring-329';
const wiring = page12Source.match(new RegExp(`<script id="${WIRING_ID}">([\\s\\S]*?)<\\/script>`))?.[1] || '';
assert.ok(wiring, '12 live wiring block must exist');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate, message, budgetMs = 6000) => {
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

const POSTS = {
  data: [{
    id: 'a1c0e66d-0000-4000-8000-000000000001',
    kind: 'greeting',
    category: null,
    title: '게시물',
    body: '본문',
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

// Boots the REAL page-12 wiring over a minimal DOM. `respond` decides every
// fetch outcome; document click listeners are captured so the write-boundary
// capture handler can be driven directly.
function bootPage12(respond, opts = {}) {
  const calls = [];
  const impl = function (url, init) {
    calls.push({ url: String(url), init: init || {} });
    return respond(String(url), init || {}, calls.length);
  };
  const list = { innerHTML: '' };
  const loadMoreClicks = [];
  const loadMore = {
    disabled: false, hidden: true, textContent: '',
    addEventListener: function (type, fn) { if (type === 'click') loadMoreClicks.push(fn); }
  };
  const topic = { dataset: { type: 'hello' }, addEventListener: function () {} };
  const docClickListeners = [];
  const context = {
    console,
    URL,
    URLSearchParams,
    encodeURIComponent,
    AbortController,
    Date,
    fetch: impl,
    location: {
      search: '?apiBase=https://api.example.test',
      hostname: 'api.example.test',
      href: 'https://api.example.test/12_%EC%9D%B4%EC%9B%83%EB%8C%80%ED%99%94_%EC%B2%AB%ED%99%94%EB%A9%B4.html'
    },
    document: {
      getElementById: (id) => (id === 'postList' ? list : id === 'postLoadMore' ? loadMore : null),
      querySelector: (selector) => (selector === '.topic.active' ? topic : null),
      querySelectorAll: () => [{ addEventListener: function () {} }],
      addEventListener: function (type, fn) { if (type === 'click') docClickListeners.push(fn); }
    }
  };
  if (opts.fastForwardTimers) {
    const realSetTimeout = setTimeout;
    context.setTimeout = function (fn, ms) {
      if (typeof ms === 'number' && ms >= 10000) return realSetTimeout(fn, 120);
      return realSetTimeout(fn, ms);
    };
    context.clearTimeout = clearTimeout;
  }
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(sessionSource, context, { filename: 'danjion-session.js' });
  vm.runInContext(bridgeSource, context, { filename: 'community-bridge.js' });
  vm.runInContext(wiring, context, { filename: '12_이웃대화_첫화면.html#' + WIRING_ID });
  return {
    list,
    loadMore,
    loadMoreClicks,
    calls,
    docClickListeners,
    fireWriteClick: function () {
      const ev = {
        target: { closest: function (sel) { return sel.indexOf('#writeMain') !== -1 || sel.indexOf('#mobileWrite') !== -1 ? { id: 'writeMain' } : null; } },
        preventDefault: function () {},
        stopImmediatePropagation: function () {}
      };
      docClickListeners.forEach(function (fn) { fn(ev); });
      return context.location.href;
    }
  };
}

const LOGIN_COPY = '로그인 후 이웃대화를 이용할 수 있습니다.';
const EXPIRED_COPY = '세션이 만료되었습니다. 다시 로그인해 주세요.';
const RESIDENT_COPY = '본인 확인된 입주민만 이용할 수 있습니다.';
const LOGIN_HREF = 'index.html?auth=login';

/* 1. Guest no-cookie: login CTA, no retry affordance, guest write boundary. */
{
  const page = bootPage12(function () {
    return apiResponse(401, { error: { code: 'AUTH_REQUIRED' } }, 'no-cookie');
  });
  await until(() => page.list.innerHTML.indexOf(LOGIN_COPY) !== -1, 'guest CTA copy must render');
  assert.ok(page.list.innerHTML.indexOf(LOGIN_HREF) !== -1, 'the CTA must link the canonical login boundary');
  assert.equal(page.list.innerHTML.indexOf('게시글 다시 시도'), -1, '게시글 다시 시도 must not be offered to a no-cookie guest');
  assert.equal(page.loadMore.hidden, true, 'the retry control must be hidden for auth-required');
  assert.equal(page.loadMore.disabled, true, 'the hidden retry control must be inert');
  const writeHref = page.fireWriteClick();
  assert.equal(writeHref, LOGIN_HREF, 'guest write affordance must route to the login boundary');
  assert.equal(writeHref.indexOf('apiBase'), -1, 'the login boundary must be the canonical plain entry');
}

/* 2. Expired/invalid session: distinct truthful copy, CTA still the boundary. */
{
  const page = bootPage12(function () {
    return apiResponse(401, { error: { code: 'AUTH_REQUIRED' } }, 'session-invalid');
  });
  await until(() => page.list.innerHTML.indexOf(EXPIRED_COPY) !== -1, 'expired copy must render for session-invalid');
  assert.equal(page.list.innerHTML.indexOf(LOGIN_COPY), -1, 'expired state must not use the fresh-guest copy');
  assert.ok(page.list.innerHTML.indexOf(LOGIN_HREF) !== -1, 'expired state still links the login boundary');
  const writeHref = page.fireWriteClick();
  assert.equal(writeHref, LOGIN_HREF, 'expired-session write affordance routes to login too');
}

/* 3. 403 resident-verification: distinct copy, no login CTA, no retry. */
{
  const page = bootPage12(function () {
    return apiResponse(403, { error: { code: 'RESIDENT_VERIFICATION_REQUIRED' } });
  });
  await until(() => page.list.innerHTML.indexOf(RESIDENT_COPY) !== -1, '403 must render the resident-verification copy');
  assert.equal(page.list.innerHTML.indexOf('auth=login'), -1, '403 must not offer the login CTA');
  assert.equal(page.loadMore.hidden, true, '403 must not offer retry');
  const writeHref = page.fireWriteClick();
  assert.ok(writeHref.indexOf('가입인사') !== -1, '403 member keeps the authenticated write flow (own gates apply)');
}

/* 4. Timeout: #1043 retry behavior preserved, auth copy must not appear. */
{
  const page = bootPage12(function () {
    return new Promise(function () {}); // hung feed request
  }, { fastForwardTimers: true });
  await until(() => page.list.innerHTML.indexOf('응답하지 않아') !== -1, 'timeout copy must render');
  assert.equal(page.loadMore.hidden, false, 'timeout keeps the retry control visible');
  assert.equal(page.loadMore.textContent, '게시글 다시 시도', 'timeout retry affordance preserved');
  assert.equal(page.loadMore.disabled, false, 'timeout retry control must be enabled');
  assert.equal(page.list.innerHTML.indexOf('auth=login'), -1, 'timeout must not render the login CTA');
  const writeHref = page.fireWriteClick();
  assert.ok(writeHref.indexOf('가입인사') !== -1, 'timeout keeps the existing write navigation (auth state unknown)');
}

/* 5. Authenticated success: unchanged resident flow. */
{
  const page = bootPage12(function () {
    return apiResponse(200, POSTS);
  });
  await until(() => page.list.innerHTML.indexOf('게시물') !== -1, 'authenticated feed must render rows');
  assert.equal(page.loadMore.hidden, true, 'single page hides the more button as before');
  const writeHref = page.fireWriteClick();
  assert.ok(writeHref.indexOf('가입인사') !== -1, 'authenticated write affordance keeps the direct writer navigation');
  assert.ok(writeHref.indexOf('apiBase=') !== -1, 'authenticated navigation keeps the apiBase carry');
}

/* 6. Page 13 failMessage: real function, truthful per-disposition copy. */
{
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  const src = page13Source.match(/function failMessage\(result\)\{[\s\S]*?\n \}/)?.[0] || '';
  assert.ok(src, '13 failMessage must exist');
  const fm = vm.runInContext('(' + src + ')', context, { filename: '13 failMessage' });
  const EXPIRED13 = '로그인이 만료되었습니다. 다시 로그인한 뒤 이용해 주세요.';
  assert.equal(fm({ mode: 'auth-required', status: 401, authBridge: 'no-cookie' }), LOGIN_COPY,
    'no-cookie guest must get truthful login-required copy');
  assert.equal(fm({ mode: 'auth-required', status: 401, authBridge: 'session-invalid' }), EXPIRED13,
    'resolved-then-invalid session keeps the existing expired copy');
  assert.equal(fm({ mode: 'auth-required', status: 401 }), EXPIRED13,
    'auth-required without a disposition keeps the existing expired copy');
  assert.notEqual(fm({ mode: 'auth-required', status: 401, authBridge: 'no-cookie' }), EXPIRED13,
    'the no-cookie copy must be distinct from the expired copy');
  assert.equal(fm({ mode: 'auth-required', status: 403 }), RESIDENT_COPY,
    '403 resident-verification boundary stays distinct');
  assert.equal(fm({ mode: 'error', status: 404 }), '게시물을 찾을 수 없습니다.', '404 stays not-found');
  assert.equal(fm({ mode: 'timeout' }), '서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.',
    'timeout stays a non-auth failure');
  assert.equal(fm({ mode: 'error', status: 500 }), '서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.',
    'server errors stay non-auth failures');
}

/* 7. Source guards: shared runtime/auth facade untouched, both affordances coexist. */
{
  assert.ok(page12Source.indexOf("loadMore.textContent='게시글 다시 시도'") !== -1,
    'the timeout retry affordance must remain in source');
  assert.ok(page12Source.indexOf('index.html?auth=login') !== -1, 'guest CTA must use the canonical entry');
  assert.ok((page12Source.match(/guestFeed/g) || []).length >= 3, 'guest boundary must be wired');
  assert.ok(page13Source.indexOf("authBridge==='no-cookie'") !== -1, '13 must branch on the no-cookie disposition');
  assert.equal(page13Source.indexOf('x-danjion-auth-bridge'), -1, '13 must not duplicate facade header logic');
  assert.ok(page12Source.indexOf('aria-pressed') !== -1 || page12Source.indexOf("setAttribute('aria-pressed'") !== -1,
    '#1041 aria-pressed wiring must remain in page 12');
}

console.log('PASS #1075 community guest auth contract');
console.log('PAGE12_NO_COOKIE_COPY=TRUTHFUL_LOGIN_REQUIRED');
console.log('PAGE12_NO_COOKIE_CTA=AUTH_ENTRY_NOT_RETRY');
console.log('PAGE12_TIMEOUT_RETRY=PRESERVED');
console.log('PAGE12_GUEST_WRITE_CTA=AUTH_BOUNDARY');
console.log('PAGE12_RESIDENT_403=DISTINCT_NO_LOGIN_CTA');
console.log('PAGE13_NO_COOKIE_COPY=TRUTHFUL_LOGIN_REQUIRED');
console.log('PAGE13_EXPIRED_SESSION_COPY=DISTINCT');
console.log('PAGE13_RESIDENT_VERIFICATION_403=DISTINCT');
console.log('PAGE13_TIMEOUT_NON_AUTH=DISTINCT');
console.log('AUTHENTICATED_WRITE_FLOW=PRESERVED');
console.log('BACKEND_AUTH_CHANGE=NO');
console.log('PRODUCTION_MUTATION=0');
console.log('DB_MUTATION=0');
console.log('PRODUCTION_DEPLOY=0');
