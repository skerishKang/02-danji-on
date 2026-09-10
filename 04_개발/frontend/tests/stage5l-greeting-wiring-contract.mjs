import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../../../', import.meta.url);
const sessionSource = await readFile(new URL('frontend/assets/danjion-session.js', root), 'utf8');
const bridgeSource = await readFile(new URL('frontend/assets/community-bridge.js', root), 'utf8');
const page14 = await readFile(new URL('frontend/14_가입인사_글쓰기.html', root), 'utf8');

const POST_ID = 'c0c1c4a1-3333-4333-8333-333333333333';
const API_BASE = 'https://api.example.test';
const COMMUNITY = '/api/v1/complexes/banglim-myeongji-roadhill/community';

function makeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return status >= 200 && status < 300 ? body : (body ?? { error: { code: 'HTTP_' + status } }); }
  };
}

function loadContext(search, fetchImpl) {
  const context = {
    globalThis: null,
    location: { search, origin: 'https://danjion.example' },
    URL, URLSearchParams, encodeURIComponent, Date, console,
    fetch: fetchImpl
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(sessionSource, context);
  vm.runInContext(bridgeSource, context);
  return context;
}

function loadBridge(search, fetchImpl) {
  const context = loadContext(search, fetchImpl);
  return context.DanjionCommunityBridge.createCommunityBridge({ apiBase: context.DanjionSession.danjionApiBase(), fetchImpl });
}

function serverPost(overrides = {}) {
  return {
    id: POST_ID, kind: 'greeting', title: '안녕하세요, 새로 이사 왔습니다',
    body: '502호예요. 반갑습니다.', status: 'published',
    author: { nickname: '봄이' }, reactionCount: 0, commentCount: 0, viewerLiked: false,
    publishedAt: '2026-09-10T10:00:00Z', createdAt: '2026-09-10T10:00:00Z', updatedAt: '2026-09-10T10:00:00Z',
    ...overrides
  };
}

/* ---------- 1. greeting is a canonical bridge kind, lossless and uncoerced ---------- */
{
  const bridge = loadContext('?apiBase=' + API_BASE, async () => makeResponse(200, { data: [], requestId: 'r0' })).DanjionCommunityBridge;
  assert.ok(bridge.POST_KINDS.includes('greeting'), 'greeting joins the canonical POST_KINDS (#348 C2)');
  const normalized = bridge.normalizePost(serverPost());
  assert.equal(normalized.kind, 'greeting', 'greeting round-trips without coercion into another kind');
  assert.equal(bridge.normalizePost(serverPost({ kind: 'hello' })), null, 'the legacy hello alias is still not a kind');
}

/* ---------- 2. createPost/listPosts send kind=greeting verbatim to the resident API ---------- */
{
  const calls = [];
  const bridge = loadBridge('?apiBase=' + API_BASE, async (url, init) => {
    calls.push({ url, init });
    if (init?.method === 'POST') return makeResponse(201, { data: serverPost({ status: 'pending_review', publishedAt: null }), requestId: 'r1' });
    return makeResponse(200, { data: [serverPost()], requestId: 'r2' });
  });
  const created = await bridge.createPost({ kind: 'greeting', title: '안녕하세요, 새로 이사 왔습니다', body: '502호예요. 반갑습니다.' });
  assert.equal(created.ok, true);
  assert.equal(created.mode, 'server');
  assert.equal(created.post.kind, 'greeting', 'server response kind stays greeting');
  assert.equal(created.post.status, 'pending_review', 'review mode surfaces as pending, never silently published');
  assert.equal(calls[0].url, API_BASE + COMMUNITY + '/posts');
  assert.deepEqual(JSON.parse(calls[0].init.body), { kind: 'greeting', title: '안녕하세요, 새로 이사 왔습니다', body: '502호예요. 반갑습니다.' });
  const listed = await bridge.listPosts('greeting');
  assert.equal(listed.mode, 'server');
  assert.equal(calls[1].url, API_BASE + COMMUNITY + '/posts?kind=greeting&limit=20');
}

/* ---------- 3. server-mode failure and static mode stay fail-closed for greeting ---------- */
{
  for (const [status, expected] of [[401, 'auth-required'], [403, 'auth-required'], [404, 'error'], [500, 'error']]) {
    const bridge = loadBridge('?apiBase=' + API_BASE, async () => makeResponse(status, { error: { code: 'DENIED', message: 'verified residents only' } }));
    const result = await bridge.createPost({ kind: 'greeting', title: '인사드립니다', body: '안녕하세요, 반갑습니다.' });
    assert.equal(result.ok, false);
    assert.equal(result.mode, expected, `greeting write fails closed on ${status}`);
  }
  let fetched = 0;
  const staticBridge = loadBridge('', async () => { fetched++; return makeResponse(200, { data: {} }); });
  const staticResult = await staticBridge.createPost({ kind: 'greeting', title: '인사드립니다', body: '안녕하세요, 반갑습니다.' });
  assert.equal(staticResult.error, 'SERVER_MODE_REQUIRED');
  assert.equal(fetched, 0, 'static mode never reaches the network');
}

/* ---------- 4. page 14 wiring: server mode submits greeting, demo fallback preserved ---------- */
function wiringScript(page, id) {
  const match = page.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
  assert.ok(match, `page must contain wiring script ${id}`);
  return match[1];
}
{
  assert.match(page14, /<script src="assets\/danjion-session\.js"><\/script>/, 'page 14 loads the canonical session runtime');
  assert.match(page14, /<script src="assets\/community-bridge\.js"><\/script>/, 'page 14 loads the community bridge');
  const wiring = wiringScript(page14, 'danjion-community-write-greeting-live-wiring-348');
  assert.match(wiring, /DanjionSession\.danjionApiBase\(\)/, 'page 14 reuses canonical apiBase parsing');
  assert.match(wiring, /if\(!apiBase\)return;/, 'page 14 keeps the no-apiBase demo fallback untouched');
  assert.match(wiring, /createPost\(\{kind:'greeting'/, 'page 14 submits only the canonical greeting kind');
  for (const other of ['resident_story', 'question', 'together', 'life_report', 'hello']) {
    assert.equal(new RegExp(`kind:\\s*'${other}'`).test(wiring), false, `page 14 never coerces greeting into ${other}`);
  }
  assert.match(wiring, /localStorage\.removeItem\(key\)/, 'successful server post clears the local draft');
  assert.doesNotMatch(wiring, /localStorage\.setItem|sessionStorage|indexedDB/, 'page 14 wiring never writes local persistence');
  assert.match(wiring, /auth-required/, 'page 14 surfaces expired sessions fail-closed');
  assert.match(wiring, /12_이웃대화_첫화면\.html\?type=hello&apiBase=/, 'page 14 returns to the community surface with the session base');
  new vm.Script(wiring, { filename: 'page-14-wiring' });
}

console.log('stage5l greeting wiring contract: PASS');
