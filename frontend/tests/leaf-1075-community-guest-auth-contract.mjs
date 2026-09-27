import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// #1075: signed-out community auth UX. Pages 12/13 must classify auth
// failures through the authoritative DanjionSession.authFailureKind:
//   no-cookie → truthful fresh-guest login-required copy
//   session-invalid → stale/expired-session copy
//   session-failed / no-session-token / token-failed / token-invalid →
//     truthful transient bridge-fault copy (NEVER "login expired")
//   403 → resident-verification boundary; timeout/network stay non-auth.
// Page 12 additionally reroutes guest write affordances to the canonical
// login boundary only for the guest/stale kinds. Every claim below executes
// the real production wiring/scripts inside a vm.

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

const LOGIN_COPY = '로그인 후 이웃대화를 이용할 수 있습니다.';
const STALE_COPY = '세션이 만료되었습니다. 다시 로그인해 주세요.';
const EXPIRED13 = '로그인이 만료되었습니다. 다시 로그인한 뒤 이용해 주세요.';
const RESIDENT_COPY = '본인 확인된 입주민만 이용할 수 있습니다.';
const BRIDGE_FAULT_COPY = '일시적으로 로그인 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
const LOGIN_HREF = 'index.html?auth=login';
const DISPOSITIONS = ['no-cookie', 'session-invalid', 'session-failed', 'no-session-token', 'token-failed', 'token-invalid'];

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

/* 1. Page 12 across every auth-bridge disposition. */
for (const disposition of DISPOSITIONS) {
  const page = bootPage12(function () {
    return apiResponse(401, { error: { code: 'AUTH_REQUIRED' } }, disposition);
  });
  if (disposition === 'no-cookie') {
    await until(() => page.list.innerHTML.indexOf(LOGIN_COPY) !== -1, 'no-cookie: fresh-guest copy must render');
    assert.equal(page.list.innerHTML.indexOf('게시글 다시 시도'), -1, 'no-cookie: retry must not be offered');
    assert.equal(page.loadMore.hidden, true, 'no-cookie: retry control hidden');
    assert.ok(page.list.innerHTML.indexOf(LOGIN_HREF) !== -1, 'no-cookie: canonical login CTA present');
    const writeHref = page.fireWriteClick();
    assert.equal(writeHref, LOGIN_HREF, 'no-cookie: write affordance routes to the login boundary');
  } else if (disposition === 'session-invalid') {
    await until(() => page.list.innerHTML.indexOf(STALE_COPY) !== -1, 'session-invalid: stale copy must render');
    assert.equal(page.list.innerHTML.indexOf(LOGIN_COPY), -1, 'session-invalid must not use the fresh-guest copy');
    assert.equal(page.loadMore.hidden, true, 'session-invalid: retry control hidden');
    assert.ok(page.list.innerHTML.indexOf(LOGIN_HREF) !== -1, 'session-invalid: login CTA present');
    const writeHref = page.fireWriteClick();
    assert.equal(writeHref, LOGIN_HREF, 'session-invalid: write affordance routes to re-login');
  } else {
    // bridge-fault family: session-failed / no-session-token / token-failed / token-invalid
    await until(() => page.list.innerHTML.indexOf(BRIDGE_FAULT_COPY) !== -1,
      disposition + ' must render the truthful bridge-fault copy');
    assert.equal(page.list.innerHTML.indexOf(EXPIRED13), -1, disposition + ' must never say the login expired');
    assert.equal(page.list.innerHTML.indexOf(STALE_COPY), -1, disposition + ' must never use the stale-session copy');
    assert.equal(page.loadMore.hidden, false, disposition + ' is transient: retry stays available');
    assert.equal(page.loadMore.textContent, '게시글 다시 시도', disposition + ' keeps the retry affordance');
    const writeHref = page.fireWriteClick();
    assert.ok(writeHref.indexOf('가입인사') !== -1, disposition + ' keeps the existing write navigation');
  }
}

/* 2. Page 12: 403 resident-verification boundary. */
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

/* 3. Page 12: timeout — #1043 retry behavior preserved, no auth copy. */
{
  const page = bootPage12(function () {
    return new Promise(function () {});
  }, { fastForwardTimers: true });
  await until(() => page.list.innerHTML.indexOf('응답하지 않아') !== -1, 'timeout copy must render');
  assert.equal(page.loadMore.hidden, false, 'timeout keeps the retry control visible');
  assert.equal(page.loadMore.textContent, '게시글 다시 시도', 'timeout retry affordance preserved');
  assert.equal(page.list.innerHTML.indexOf(BRIDGE_FAULT_COPY), -1, 'timeout must not use the bridge-fault copy');
  assert.equal(page.list.innerHTML.indexOf('auth=login'), -1, 'timeout must not render the login CTA');
  const writeHref = page.fireWriteClick();
  assert.ok(writeHref.indexOf('가입인사') !== -1, 'timeout keeps the existing write navigation');
}

/* 4. Page 12: authenticated success — resident flow unchanged. */
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

/* 5. Page 13 failMessage: real function over the real authFailureKind. */
{
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(sessionSource, context, { filename: 'danjion-session.js' });
  assert.equal(typeof context.DanjionSession.authFailureKind, 'function', 'the runtime classifier must be available');
  const src = page13Source.match(/function failMessage\(result\)\{[\s\S]*?\n \}/)?.[0] || '';
  assert.ok(src, '13 failMessage must exist');
  const fm = vm.runInContext('(' + src + ')', context, { filename: '13 failMessage' });

  assert.equal(fm({ mode: 'auth-required', status: 401, authBridge: 'no-cookie' }), LOGIN_COPY,
    'no-cookie → truthful fresh-guest login-required copy');
  assert.equal(fm({ mode: 'auth-required', status: 401, authBridge: 'session-invalid' }), EXPIRED13,
    'session-invalid → expired-session copy (allowed)');
  for (const d of ['session-failed', 'no-session-token', 'token-failed', 'token-invalid']) {
    const msg = fm({ mode: 'auth-required', status: 401, authBridge: d });
    assert.equal(msg, BRIDGE_FAULT_COPY, d + ' → truthful transient bridge-fault copy');
    assert.notEqual(msg, EXPIRED13, d + ' must never say the login expired');
  }
  assert.equal(fm({ mode: 'auth-required', status: 403 }), RESIDENT_COPY, '403 stays the resident boundary');
  assert.equal(fm({ mode: 'auth-required', status: 401 }), EXPIRED13,
    'auth-required without a disposition keeps the existing expired copy');
  assert.equal(fm({ mode: 'error', status: 404 }), '게시물을 찾을 수 없습니다.', '404 stays not-found');
  assert.equal(fm({ mode: 'timeout' }), '서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.',
    'timeout stays a non-auth failure');
  assert.equal(fm({ mode: 'error', status: 500 }), '서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.',
    'server errors stay non-auth failures');
}

/* 6. Source guards: authoritative classifier reused, facade untouched. */
{
  assert.ok(page12Source.indexOf('DanjionSession.authFailureKind') !== -1, 'page 12 must reuse authFailureKind');
  assert.ok(page13Source.indexOf('DanjionSession.authFailureKind') !== -1, 'page 13 must reuse authFailureKind');
  assert.ok(page12Source.indexOf("loadMore.textContent='게시글 다시 시도'") !== -1, 'timeout retry affordance remains in source');
  assert.ok(page12Source.indexOf('index.html?auth=login') !== -1, 'guest CTA uses the canonical entry');
  assert.ok(page12Source.indexOf("setAttribute('aria-pressed'") !== -1, '#1041 aria-pressed wiring remains');
  assert.equal(page13Source.indexOf('x-danjion-auth-bridge'), -1, '13 must not duplicate facade header logic');
  assert.ok(sessionSource.indexOf('AUTH_BRIDGE_FAILURE_SET') !== -1, 'the runtime classifier enum remains unchanged');
  assert.equal(sessionSource.indexOf('authFailureKind({reason'), -1, 'the runtime itself must not be adapted per-page');
}

console.log('PASS #1075 community guest auth contract (authFailureKind authoritative)');
console.log('AUTH_FAILURE_KIND_REUSED=YES');
console.log('PAGE12_NO_COOKIE=TRUTHFUL_LOGIN_REQUIRED_CTA');
console.log('PAGE12_SESSION_INVALID=STALE_SESSION_COPY_CTA');
console.log('PAGE12_SESSION_FAILED=BRIDGE_FAULT_TRANSIENT_RETRY');
console.log('PAGE12_NO_SESSION_TOKEN=BRIDGE_FAULT_TRANSIENT_RETRY');
console.log('PAGE12_TOKEN_FAILED=BRIDGE_FAULT_TRANSIENT_RETRY');
console.log('PAGE12_TOKEN_INVALID=BRIDGE_FAULT_TRANSIENT_RETRY');
console.log('PAGE12_403=RESIDENT_BOUNDARY');
console.log('PAGE12_TIMEOUT=RETRY_PRESERVED');
console.log('PAGE12_AUTHENTICATED=UNCHANGED');
console.log('PAGE13_NO_COOKIE=TRUTHFUL_LOGIN_REQUIRED');
console.log('PAGE13_SESSION_INVALID=EXPIRED_COPY_ALLOWED');
console.log('PAGE13_SESSION_FAILED=BRIDGE_FAULT_NOT_EXPIRED');
console.log('PAGE13_NO_SESSION_TOKEN=BRIDGE_FAULT_NOT_EXPIRED');
console.log('PAGE13_TOKEN_FAILED=BRIDGE_FAULT_NOT_EXPIRED');
console.log('PAGE13_TOKEN_INVALID=BRIDGE_FAULT_NOT_EXPIRED');
console.log('PAGE13_403=RESIDENT_BOUNDARY');
console.log('PAGE13_TIMEOUT_NON_AUTH=DISTINCT');
console.log('BACKEND_AUTH_CHANGE=NO');
console.log('PRODUCTION_MUTATION=0');
console.log('DB_MUTATION=0');
console.log('PRODUCTION_DEPLOY=0');
