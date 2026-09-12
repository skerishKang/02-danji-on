import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Assignment #346 [Leaf B10]: static wiring contract + bridge HTTP runtime contract
// for the canonical resident-news list/detail surfaces (10/11) and the bounded
// resident-news-v1 bridge. Run: node frontend/tests/leaf-b10-resident-news-wiring-contract.mjs
//
// A. authority is resident-news-v1: exact feed + detail routes, read-only (GET only)
// B. transport reuses the shared #324 DanjionSession runtime (credentials, envelope,
//    401/403 -> auth-required, fail-closed on 4xx/5xx/network)
// C. server mode only when an explicit apiBase exists; static/demo fallback otherwise
// D. no fabricated rows, no browser persistence, no mutation verbs
// E. list carries the post id into the detail surface; detail fails closed truthfully

const root = new URL('../', import.meta.url);
const bridge = await import(new URL('assets/resident-news-bridge.js', root).href);
const bridgeSource = await readFile(new URL('assets/resident-news-bridge.js', root), 'utf8');
const sessionSource = await readFile(new URL('assets/danjion-session.js', root), 'utf8');
const page10 = await readFile(new URL('10_주민소식_목록.html', root), 'utf8');
const page11 = await readFile(new URL('11_주민소식_상세.html', root), 'utf8');

const CANON = 'banglim-myeongji-roadhill';
const WRONG = 'bangnim-myeongji-roadhill';
const BASE = 'https://api.example.test';
const FEED_PATH = `/api/v1/complexes/${CANON}/resident-news`;
const POST_ID = '3f0c1a2b-4d5e-4f60-8a9b-0c1d2e3f4a5b';
const OTHER_ID = '9a8b7c6d-5e4f-4a3b-8c1d-2e3f4a5b6c7d';
const BANNED_STORAGE = ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie'];

/* ============ shared runtime + bridge runtime contract (no DOM) ============ */

function loadSession() {
  const context = {
    globalThis: null,
    location: { search: '', origin: 'https://demo.example' },
    URLSearchParams
  };
  context.globalThis = context;
  vm.runInNewContext(sessionSource, context, { filename: 'danjion-session.js' });
  return context.DanjionSession;
}

const Session = loadSession();

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, async json() { return body; } };
}

function makeBridge(responder) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return responder(calls.length - 1);
  };
  const b = bridge.createResidentNewsBridge({ apiBase: BASE, fetchImpl, Session });
  return { b, calls };
}

/* --- A. canonical slug + runtime requirement --- */
assert.equal(bridge.DANJION_RESIDENT_NEWS_COMPLEX_SLUG, CANON, 'bridge owns the canonical complex slug');
assert.throws(
  () => bridge.createResidentNewsBridge({ apiBase: BASE, fetchImpl: async () => response(200, { data: null }), Session: undefined }),
  TypeError,
  'bridge must refuse to run without the shared session runtime'
);
assert.throws(
  () => bridge.createResidentNewsBridge({ apiBase: BASE, fetchImpl: null, Session }),
  TypeError,
  'bridge must refuse to run without a fetch implementation'
);

/* --- A2. feed: exact route, GET only, envelope extraction --- */
{
  const { b, calls } = makeBridge(() => response(200, {
    data: {
      posts: [
        { id: POST_ID, title: '재능나눔 모임', body: '본문', publishedAt: '2026-08-28T00:00:00.000Z', createdAt: '2026-08-27T00:00:00.000Z' },
        { id: OTHER_ID, title: '화단 가꾸기', body: '본문2', publishedAt: '2026-08-24T00:00:00.000Z', createdAt: '2026-08-23T00:00:00.000Z' }
      ]
    },
    requestId: 'r1'
  }));
  const result = await b.listPosts();
  assert.equal(result.ok, true, 'feed success is ok');
  assert.equal(calls.length, 1, 'feed is a single request');
  assert.equal(calls[0].url, `${BASE}${FEED_PATH}`, 'feed must target the resident-news-v1 collection route');
  assert.equal(calls[0].init.method, 'GET', 'feed must be a GET');
  assert.equal(calls[0].init.credentials, 'include', 'bridge requests must send cookies');
  assert.equal(result.posts.length, 2, 'feed returns normalized rows');
  assert.equal(result.posts[0].id, POST_ID);
  assert.equal(result.posts[0].title, '재능나눔 모임');
  assert.equal(result.posts[0].publishedAt, '2026-08-28T00:00:00.000Z');
  assert.ok(!/\/resident-news\//.test(calls[0].url), 'feed must not append a post id');
}

/* --- D2. feed drops rows the server did not identify (no fabricated identity) --- */
{
  const { b } = makeBridge(() => response(200, {
    data: { posts: [{ id: POST_ID, title: 'ok', body: 'b' }, { id: 'garbage', title: 'nope', body: 'b' }, null, { title: 'no id' }] },
    requestId: 'r2'
  }));
  const result = await b.listPosts();
  assert.equal(result.ok, true);
  assert.equal(result.posts.length, 1, 'rows without a server UUID must be dropped, not rendered');
  assert.equal(result.posts[0].id, POST_ID);
}

/* --- A3. feed with no posts stays an empty list, never invented content --- */
{
  const { b } = makeBridge(() => response(200, { data: { posts: [] }, requestId: 'r3' }));
  const result = await b.listPosts();
  assert.equal(result.ok, true);
  assert.deepEqual(result.posts, [], 'an empty feed must stay empty');
}
{
  const { b } = makeBridge(() => response(200, { data: null, requestId: 'r4' }));
  const result = await b.listPosts();
  assert.equal(result.ok, true);
  assert.deepEqual(result.posts, [], 'a null envelope must not fabricate rows');
}

/* --- B2. feed failure stays fail-closed and empty --- */
{
  const { b } = makeBridge(() => response(403, { error: { code: 'RESIDENT_VERIFICATION_REQUIRED', message: 'no' } }));
  const result = await b.listPosts();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'auth-required', '403 maps to auth-required');
  assert.equal(result.error.code, 'RESIDENT_VERIFICATION_REQUIRED', 'backend code is preserved');
  assert.deepEqual(result.posts, [], 'a failed feed must not render rows');
}
{
  const { b } = makeBridge(() => response(500, { error: { code: 'INTERNAL' } }));
  const result = await b.listPosts();
  assert.equal(result.reason, 'server-error', '5xx maps to server-error');
  assert.deepEqual(result.posts, []);
}
{
  const { b } = makeBridge(() => { throw new Error('offline'); });
  const result = await b.listPosts();
  assert.equal(result.reason, 'network-error', 'network failure maps to network-error');
  assert.equal(result.status, 0);
  assert.deepEqual(result.posts, []);
}

/* --- A4. detail: exact route with the id, GET only --- */
{
  const { b, calls } = makeBridge(() => response(200, {
    data: { id: POST_ID, title: '재능나눔 모임', body: '첫 문단\n\n둘째 문단', publishedAt: '2026-08-28T00:00:00.000Z', createdAt: '2026-08-27T00:00:00.000Z' },
    requestId: 'r5'
  }));
  const result = await b.getPost(POST_ID);
  assert.equal(result.ok, true, 'detail success is ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BASE}${FEED_PATH}/${POST_ID}`, 'detail must target the resident-news-v1 item route');
  assert.equal(calls[0].init.method, 'GET', 'detail must be a GET');
  assert.equal(result.post.id, POST_ID);
  assert.equal(result.post.body, '첫 문단\n\n둘째 문단');
}

/* --- A5. detail rejects a malformed id client-side, before the network --- */
{
  const { b, calls } = makeBridge(() => response(200, { data: {} }));
  for (const bad of ['', '   ', 'not-a-uuid', '../escape', `${POST_ID}x`, null, undefined]) {
    const result = await b.getPost(bad);
    assert.equal(result.ok, false, `detail must reject ${JSON.stringify(bad)}`);
    assert.equal(result.reason, 'validation-error', `detail must reject ${JSON.stringify(bad)} as validation-error`);
    assert.equal(result.status, 0);
  }
  assert.equal(calls.length, 0, 'malformed ids must never reach the network');
}

/* --- B3. detail failure modes stay truthful --- */
{
  const { b } = makeBridge(() => response(404, { error: { code: 'NOT_FOUND', message: 'Resident news not found' } }));
  const result = await b.getPost(POST_ID);
  assert.equal(result.ok, false);
  assert.equal(result.status, 404, 'a 404 must stay a 404');
  assert.equal(result.error.code, 'NOT_FOUND');
}
{
  const { b } = makeBridge(() => response(401, { error: { code: 'UNAUTHENTICATED' } }));
  const result = await b.getPost(POST_ID);
  assert.equal(result.reason, 'auth-required', '401 maps to auth-required');
}
{
  const { b } = makeBridge(() => response(403, { error: { code: 'RESIDENT_VERIFICATION_REQUIRED' } }));
  const result = await b.getPost(POST_ID);
  assert.equal(result.reason, 'auth-required', '403 maps to auth-required');
}
{
  const { b } = makeBridge(() => { throw new Error('offline'); });
  const result = await b.getPost(POST_ID);
  assert.equal(result.reason, 'network-error');
  assert.equal(result.status, 0);
}
{
  const { b } = makeBridge(() => response(200, { data: { id: 'garbage', title: 'x', body: 'y' }, requestId: 'r6' }));
  const result = await b.getPost(POST_ID);
  assert.equal(result.ok, true);
  assert.equal(result.post, null, 'a detail payload without a server id must not be presented as a post');
}

/* --- D3. normalization never invents fields --- */
{
  const normalized = bridge.normalizeResidentNewsPost({ id: POST_ID, title: 't', body: 'b' });
  assert.equal(normalized.publishedAt, null, 'absent publishedAt stays null');
  assert.equal(normalized.createdAt, null, 'absent createdAt stays null');
  const snake = bridge.normalizeResidentNewsPost({ id: POST_ID, title: 't', body: 'b', published_at: '2026-01-01T00:00:00.000Z', created_at: '2026-01-02T00:00:00.000Z' });
  assert.equal(snake.publishedAt, '2026-01-01T00:00:00.000Z', 'snake_case published_at is accepted');
  assert.equal(snake.createdAt, '2026-01-02T00:00:00.000Z', 'snake_case created_at is accepted');
  const empty = bridge.normalizeResidentNewsPost(null);
  assert.deepEqual(empty, { id: '', title: '', body: '', publishedAt: null, createdAt: null }, 'a missing row normalizes to empty strings, not fabricated copy');
}

/* --- D4. the lane is read-only and never persists --- */
{
  const { b, calls } = makeBridge(() => response(200, { data: { posts: [] }, requestId: 'r7' }));
  await b.listPosts();
  await b.getPost(POST_ID);
  assert.ok(calls.every((c) => c.init.method === 'GET'), 'the resident-news lane must issue GET requests only');
  assert.ok(!/method:\s*'(POST|PATCH|PUT|DELETE)'/.test(bridgeSource), 'bridge must not declare any mutation verb');
}
for (const banned of BANNED_STORAGE) {
  assert.ok(!bridgeSource.includes(banned), `bridge must never touch ${banned}`);
}

/* ============ static page contract: 10_주민소식_목록.html ============ */

function wiringBlock(source, id) {
  const start = source.indexOf(`<script id="${id}">`);
  assert.ok(start > -1, `wiring script id ${id} must exist`);
  const end = source.indexOf('</script>', start);
  assert.ok(end > start, `wiring script ${id} must be terminated`);
  return { start, block: source.slice(start, end) };
}

const list = wiringBlock(page10, 'resident-news-list-server-wiring-20260911');
{
  const runtimeTag = page10.indexOf('<script src="assets/danjion-session.js"></script>');
  assert.ok(runtimeTag > -1 && runtimeTag < list.start, 'the shared session runtime must load before the list wiring');
  assert.ok(list.block.includes("import('./assets/resident-news-bridge.js')"), 'list wiring must load the bounded bridge module');
  assert.ok(list.block.includes('DANJION_RESIDENT_NEWS_COMPLEX_SLUG'), 'list wiring must pin the canonical complex slug');
  assert.ok(list.block.includes('DanjionSession.danjionApiBase()') && /if\s*\(!apiBase\)\s*return;/.test(list.block),
    'list wiring must derive apiBase from the canonical #419 resolver and early-return without it (demo/static fallback preserved)');
  assert.ok(list.block.includes('createResidentNewsBridge('), 'list wiring must build the bridge');
  assert.ok(list.block.includes('listPosts('), 'list wiring must read the resident-news-v1 feed');
  assert.ok(list.block.includes('DETAIL') && list.block.includes('?postId='), 'list wiring must carry the post id into the detail surface');
  assert.ok(list.block.includes("result.reason==='auth-required'"), 'list wiring must branch on auth-required');
  assert.ok(list.block.includes('불러오는 중'), 'list wiring must show a loading state');
  assert.ok(!list.block.includes('innerHTML'), 'list wiring must render via textContent only');
  for (const banned of BANNED_STORAGE) {
    assert.ok(!list.block.includes(banned), `list wiring must never persist via ${banned}`);
  }
  assert.ok(page10.includes('id="danjion-direct-router-v5"'), 'the shared router must remain in place');
}

/* ============ static page contract: 11_주민소식_상세.html ============ */

const detail = wiringBlock(page11, 'resident-news-detail-server-wiring-20260911');
{
  const runtimeTag = page11.indexOf('<script src="assets/danjion-session.js"></script>');
  assert.ok(runtimeTag > -1 && runtimeTag < detail.start, 'the shared session runtime must load before the detail wiring');
  assert.ok(detail.block.includes("import('./assets/resident-news-bridge.js')"), 'detail wiring must load the bounded bridge module');
  assert.ok(detail.block.includes('DANJION_RESIDENT_NEWS_COMPLEX_SLUG'), 'detail wiring must pin the canonical complex slug');
  assert.ok(detail.block.includes('DanjionSession.danjionApiBase()') && /if\s*\(!apiBase\)\s*return;/.test(detail.block),
    'detail wiring must derive apiBase from the canonical #419 resolver and early-return without it (demo/static fallback preserved)');
  assert.ok(detail.block.includes("get('postId')"), 'detail wiring must read the post id from the query');
  assert.ok(detail.block.includes('getPost('), 'detail wiring must read the resident-news-v1 item route');
  assert.ok(detail.block.includes('소식을 찾을 수 없습니다.'), 'detail wiring must fail closed with the canonical not-found copy');
  assert.ok(detail.block.includes('로그인이 필요합니다.'), 'detail wiring must surface the auth-required copy');
  assert.ok(detail.block.includes('불러오지 못했습니다'), 'detail wiring must surface a truthful failure copy');
  assert.ok(detail.block.includes('불러오는 중'), 'detail wiring must show a loading state');
  assert.ok(detail.block.includes('textContent'), 'detail wiring must render via textContent');
  assert.ok(!detail.block.includes('innerHTML'), 'detail wiring must not inject markup from server data');
  for (const banned of BANNED_STORAGE) {
    assert.ok(!detail.block.includes(banned), `detail wiring must never persist via ${banned}`);
  }
  // demo-only authored blocks must stand down in server mode
  for (const selector of ["'.hero'", "'.summary'", "'.dek'", "'.article-nav button'"]) {
    assert.ok(detail.block.includes(selector), `detail wiring must stand down the demo-only block ${selector}`);
  }
}

/* ============ governance: canonical slug, no typo slug, no backend scope ============ */

for (const [name, src] of [['page10', page10], ['page11', page11], ['bridge', bridgeSource]]) {
  assert.ok(!src.includes(WRONG), `${name} must not contain the typo slug "${WRONG}"`);
}
for (const [name, src] of [['page10', page10], ['page11', page11], ['bridge', bridgeSource]]) {
  assert.ok(!/04_개발\/backend|migrations\/|\.sql\b|DATABASE_URL/.test(src), `${name} must not reach into backend/schema/migration scope`);
}

console.log('PASS #346 leaf-b10 resident-news 10/11 wiring contract');
