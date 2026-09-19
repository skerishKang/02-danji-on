// Issue #767 (from #762 owner live QA round 2): the canonical V3 community write
// screens must carry the selected 말머리 into the server write and read it back.
// This leaf proves: the frontend allowlist mirrors the server list exactly, the
// bridge fails closed on an unsupported category, and the write/detail pages use
// the server-shaped `category` field instead of a local-only promise.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const load = (path, base) => readFile(new URL(path, base), 'utf8');
const [sessionSource, bridgeSource, page13, page16, page17, backendApi] = await Promise.all([
  load('assets/danjion-session.js', root),
  load('assets/community-bridge.js', root),
  load('13_이웃대화_글상세_댓글.html', root),
  load('16_궁금해요_글쓰기.html', root),
  load('17_같이해요_글쓰기.html', root),
  load('../04_개발/backend/src/community-resident-v1.ts', root)
]);

/* 1. one canonical allowlist: the frontend mirrors the server strings exactly. */
const backendBlock = backendApi.match(/const POST_CATEGORIES[^=]*= \{([\s\S]*?)\n\};/);
assert.ok(backendBlock, 'backend keeps a canonical POST_CATEGORIES allowlist');
const bridgeBlock = bridgeSource.match(/const POST_CATEGORIES = Object\.freeze\(\{([\s\S]*?)\n  \}\);/);
assert.ok(bridgeBlock, 'bridge keeps a canonical POST_CATEGORIES allowlist');
const quoted = s => [...s.matchAll(/'([^']+)'/g)].map(m => m[1]);
assert.deepEqual(quoted(bridgeBlock[1]), quoted(backendBlock[1]),
  'the frontend category strings must mirror the server-authoritative list, in order');
assert.deepEqual(quoted(bridgeBlock[1]), ['생활·살림', '단지시설', '이웃추천', '기타', '산책·운동', '취미활동', '육아 같이해요', '공동구매', '강아지 산책 같이해요']);
assert.equal(/최대 3장/.test(bridgeSource), false, 'no arbitrary frontend attachment promise enters the bridge');

/* 2. bridge behaviour: category is optional for compatibility but never invented. */
const POST_ID = 'a0a1c4a1-1111-4111-8111-111111111111';
function makeResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}
function loadBridge(fetchImpl) {
  const context = {
    globalThis: null,
    location: { search: '?apiBase=https://api.example.test', origin: 'https://danjion.example' },
    URL, URLSearchParams, encodeURIComponent, Date, console, fetch: fetchImpl
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(sessionSource, context);
  vm.runInContext(bridgeSource, context);
  return { api: context.DanjionCommunityBridge, bridge: context.DanjionCommunityBridge.createCommunityBridge({ apiBase: context.DanjionSession.danjionApiBase(), fetchImpl }) };
}
{
  const { api } = loadBridge(async () => makeResponse(200, { data: [] }));
  assert.deepEqual(Object.keys(api.POST_CATEGORIES).sort(), ['question', 'together']);
  assert.ok(Object.isFrozen(api.POST_CATEGORIES.question), 'the mirrored allowlist is not mutable at runtime');
  assert.equal(api.MAX_CATEGORY_CHARS, 40);
  assert.equal(api.normalizePost({ id: POST_ID, kind: 'question', title: 't', body: 'b', category: '단지시설', status: 'published' }).category, '단지시설');
  assert.equal(api.normalizePost({ id: POST_ID, kind: 'question', title: 't', body: 'b', status: 'published' }).category, null);
}
{
  const calls = [];
  const { bridge } = loadBridge(async (url, init) => {
    calls.push({ url, init });
    return makeResponse(201, { data: { id: POST_ID, kind: 'question', category: '단지시설', title: '제목', body: '내용입니다', status: 'pending_review', author: { nickname: '나' }, publishedAt: null, createdAt: null, updatedAt: null } });
  });
  const invalid = await bridge.createPost({ kind: 'question', category: '없는유형', title: '제목', body: '내용입니다' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, 'POST_CATEGORY_INVALID', 'a category outside the allowlist must fail closed');
  const wrongKind = await bridge.createPost({ kind: 'greeting', category: '기타', title: '인사', body: '반갑습니다' });
  assert.equal(wrongKind.error, 'POST_CATEGORY_INVALID', 'a kind without an allowlist can never send one');
  const tooLong = await bridge.createPost({ kind: 'together', category: '가'.repeat(41), title: '제목', body: '내용입니다' });
  assert.equal(tooLong.error, 'POST_CATEGORY_INVALID', 'the bridge mirrors the 40-character server bound');
  assert.equal(calls.length, 0, 'invalid input must never reach the network');

  const created = await bridge.createPost({ kind: 'question', category: '단지시설', title: '제목', body: '내용입니다' });
  assert.equal(created.ok, true);
  assert.equal(created.post.category, '단지시설');
  const sent = JSON.parse(calls.at(-1).init.body);
  assert.equal(sent.kind, 'question');
  assert.equal(sent.category, '단지시설', 'the selected 말머리 rides the canonical server write');

  const withoutCategory = await bridge.createPost({ kind: 'question', title: '제목', body: '내용입니다' });
  assert.equal(withoutCategory.ok, true, 'an older client without a category must keep its write lane');
  assert.equal('category' in JSON.parse(calls.at(-1).init.body), false, 'no empty category key is fabricated');
}

/* 3. write pages keep the 말머리 selectable and send it; the detail page renders it. */
function wiring(page, id) {
  const match = page.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
  assert.ok(match, `page must contain wiring script ${id}`);
  return match[1];
}
{
  assert.match(page16, /id="categoryChip"/, '16 exposes the selected 말머리');
  assert.match(page16, /'궁금해요 · '\+type/, '16 mirrors the selection into the 말머리 chip');
  const w16 = wiring(page16, 'danjion-community-write-question-live-wiring-329');
  assert.equal(w16.includes("querySelectorAll('.type-tab').forEach(b=>{b.disabled=true"), false,
    '16 must not disable the now-persisted 말머리');
  assert.match(w16, /kind:'question',category,/, '16 sends the selected 말머리');
  assert.match(w16, /POST_CATEGORY_INVALID/, '16 surfaces an invalid 말머리 instead of dropping it silently');
  assert.doesNotMatch(w16, /별도 저장되지 않습니다\. 제목과 내용은 정상 게시됩니다/);
  new vm.Script(w16, { filename: 'page-16-wiring' });
}
{
  assert.match(page17, /id="categoryChip"/);
  assert.match(page17, /'같이해요 · '\+item\.title/, '17 mirrors the selected 유형 into the 말머리 chip');
  const w17 = wiring(page17, 'danjion-community-write-together-live-wiring-329');
  assert.match(w17, /TOGETHER_CATEGORY=\{walk:'산책·운동',hobby:'취미활동',parent:'육아 같이해요',group:'공동구매',dog:'강아지 산책 같이해요'\}/,
    '17 maps each canonical activity type onto its server category');
  assert.match(page17, /data-kind="dog" type="button">강아지 산책 같이해요</,
    '17 exposes the additive 강아지 산책 같이해요 option the owner requested (#767)');
  assert.match(page17, /repeat\(5,1fr\)/,
    '17 keeps one tab row for all five 유형 instead of wrapping into an accidental empty column');
  assert.match(page17, /dog:\{title:'강아지 산책 같이해요'/,
    '17 mirrors the selected 유형 into the 말머리 chip from the same canonical list');
  assert.equal(w17.includes("querySelectorAll('.type-tab').forEach(b=>{b.disabled=true"), false,
    '17 must not disable the now-persisted 유형');
  assert.match(w17, /kind:'together',category,/, '17 sends the selected 유형');
  assert.match(w17, /dynamic\.hidden=true/, '17 still hides the structured recruit fields the server does not store');
  new vm.Script(w17, { filename: 'page-17-wiring' });
}
{
  const w13 = wiring(page13, 'danjion-community-detail-live-wiring-329');
  assert.match(w13, /post\.category\?kindLabel\+' · '\+post\.category:kindLabel/,
    '13 renders the server category as the 말머리 and stays truthful when it is absent');
  new vm.Script(w13, { filename: 'page-13-wiring' });
}

console.log('leaf-b767-community-category-contract: PASS');
