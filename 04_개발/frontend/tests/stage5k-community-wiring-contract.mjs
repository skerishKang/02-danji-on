import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../../../', import.meta.url);
const sessionSource = await readFile(new URL('frontend/assets/danjion-session.js', root), 'utf8');
const bridgeSource = await readFile(new URL('frontend/assets/community-bridge.js', root), 'utf8');
const page12 = await readFile(new URL('frontend/12_이웃대화_첫화면.html', root), 'utf8');
const page13 = await readFile(new URL('frontend/13_이웃대화_글상세_댓글.html', root), 'utf8');
const page15 = await readFile(new URL('frontend/15_단지이야기_글쓰기.html', root), 'utf8');
const page16 = await readFile(new URL('frontend/16_궁금해요_글쓰기.html', root), 'utf8');
const page17 = await readFile(new URL('frontend/17_같이해요_글쓰기.html', root), 'utf8');

const POST_ID = 'a0a1c4a1-1111-4111-8111-111111111111';
const COMMENT_ID = 'b0b1c4a1-2222-4222-8222-222222222222';
const API_BASE = 'https://api.example.test';
const COMMUNITY = '/api/v1/complexes/banglim-myeongji-roadhill/community';

function makeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return status >= 200 && status < 300 ? body : (body ?? { error: { code: 'HTTP_' + status } }); }
  };
}

function loadBridge(search, fetchImpl) {
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
  return context.DanjionCommunityBridge.createCommunityBridge({ apiBase: context.DanjionSession.danjionApiBase(), fetchImpl });
}

function serverPost(overrides = {}) {
  return {
    id: POST_ID, kind: 'question', title: '세탁기 청소 맡겨보신 분 계실까요?',
    body: '오래 사용해서 한 번 제대로 분해 청소를 하려고 해요.', status: 'published',
    author: { nickname: '연블리' }, reactionCount: 4, commentCount: 1, viewerLiked: false,
    publishedAt: '2026-09-09T10:00:00Z', createdAt: '2026-09-09T10:00:00Z', updatedAt: '2026-09-09T10:00:00Z',
    ...overrides
  };
}

/* ---------- 1. route matrix matches community-resident-v1 exactly ---------- */
{
  const calls = [];
  const bridge = loadBridge('?apiBase=' + API_BASE + '/', async (url, init) => {
    calls.push({ url, init });
    if (url === API_BASE + COMMUNITY + '/posts?kind=question&limit=20') {
      return makeResponse(200, { data: [serverPost()], requestId: 'r1' });
    }
    if (url === API_BASE + COMMUNITY + '/posts?limit=50') {
      return makeResponse(200, { data: [serverPost()], requestId: 'r2' });
    }
    if (url === API_BASE + COMMUNITY + '/posts/' + POST_ID && !init?.method) {
      return makeResponse(200, { data: serverPost({ viewerLiked: true }), requestId: 'r3' });
    }
    if (url === API_BASE + COMMUNITY + '/posts' && init?.method === 'POST') {
      return makeResponse(201, { data: serverPost({ status: 'pending_review', publishedAt: null }), requestId: 'r4' });
    }
    if (url === API_BASE + COMMUNITY + '/posts/' + POST_ID + '/comments' && !init?.method) {
      return makeResponse(200, { data: [{ id: COMMENT_ID, postId: POST_ID, body: '지난달에 이용한 곳이 전후 사진을 보내줘서 좋았어요.', status: 'published', author: { nickname: '살림손' }, publishedAt: '2026-09-09T11:00:00Z', createdAt: '2026-09-09T11:00:00Z', updatedAt: '2026-09-09T11:00:00Z' }], requestId: 'r5' });
    }
    if (url === API_BASE + COMMUNITY + '/posts/' + POST_ID + '/comments' && init?.method === 'POST') {
      return makeResponse(201, { data: { id: COMMENT_ID, postId: POST_ID, body: '저도 이용했어요.', status: 'pending_review', author: { nickname: '나' }, publishedAt: null, createdAt: '2026-09-09T12:00:00Z', updatedAt: '2026-09-09T12:00:00Z' }, requestId: 'r6' });
    }
    if (url === API_BASE + COMMUNITY + '/posts/' + POST_ID + '/reactions') {
      return makeResponse(200, { data: { postId: POST_ID, reactionType: 'like', active: init.method === 'POST' }, requestId: 'r7' });
    }
    throw new Error('unexpected route ' + (init?.method || 'GET') + ' ' + url);
  });

  const feed = await bridge.listPosts('question');
  assert.equal(feed.mode, 'server');
  assert.equal(feed.posts[0].kind, 'question');
  assert.equal(feed.posts[0].author.nickname, '연블리');

  const all = await bridge.listPosts(null, { limit: 50 });
  assert.equal(all.mode, 'server');
  assert.equal(all.posts.length, 1);

  const one = await bridge.getPost(POST_ID.toUpperCase());
  assert.equal(one.mode, 'server');
  assert.equal(one.post.viewerLiked, true);

  const created = await bridge.createPost({ kind: 'question', title: '세탁기 청소 맡겨보신 분 계실까요?', body: '오래 사용해서 한 번 제대로 분해 청소를 하려고 해요.' });
  assert.equal(created.ok, true);
  assert.equal(created.status, 201);
  assert.equal(created.post.status, 'pending_review');
  assert.equal(JSON.parse(calls.find(c => c.init?.method === 'POST' && c.url.endsWith('/posts')).init.body).kind, 'question');

  const comments = await bridge.listComments(POST_ID);
  assert.equal(comments.mode, 'server');
  assert.equal(comments.comments[0].id, COMMENT_ID);

  const added = await bridge.addComment(POST_ID, '  저도 이용했어요.  ');
  assert.equal(added.ok, true);
  assert.equal(added.comment.status, 'pending_review');
  assert.equal(JSON.parse(calls.find(c => c.init?.method === 'POST' && c.url.endsWith('/comments')).init.body).body, '저도 이용했어요.');

  const liked = await bridge.setReaction(POST_ID, true);
  assert.equal(liked.ok, true);
  assert.equal(liked.active, true);
  const unliked = await bridge.setReaction(POST_ID, false);
  assert.equal(unliked.active, false);
  const likeCall = calls.find(c => c.url.endsWith('/reactions') && c.init?.method === 'POST');
  const unlikeCall = calls.find(c => c.url.endsWith('/reactions') && c.init?.method === 'DELETE');
  assert.ok(likeCall && unlikeCall, 'reaction POST and DELETE both use the v1 route');
  for (const call of calls) assert.equal(call.init.credentials, 'include', 'every request rides the canonical session fetch');
}

/* ---------- 2. normalization keeps the v1 authority shapes ---------- */
{
  const context = { globalThis: null, location: { search: '', origin: 'https://danjion.example' }, URL, URLSearchParams, encodeURIComponent, Date, console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(sessionSource, context);
  vm.runInContext(bridgeSource, context);
  const bridge = context.DanjionCommunityBridge;
  assert.deepEqual([...bridge.POST_KINDS].sort(), ['greeting', 'life_report', 'question', 'resident_story', 'together'].sort());
  assert.equal(bridge.DEFAULT_COMPLEX_SLUG, 'banglim-myeongji-roadhill');
  const post = bridge.normalizePost(serverPost({ reactionCount: 'x', commentCount: -3 }));
  assert.equal(post.reactionCount, 0);
  assert.equal(post.commentCount, 0);
  assert.equal(bridge.normalizePost({ ...serverPost(), kind: 'hello' }), null, 'kinds outside canonical POST_KINDS never normalize (greeting canonical since #348)');
  const comment = bridge.normalizeComment({ id: COMMENT_ID, postId: POST_ID, body: '안녕', status: 'published', author: { nickname: '봄날' } });
  assert.equal(comment.author.nickname, '봄날');
}

/* ---------- 3. fail-closed: 401/403 -> auth-required, 404/5xx/network -> error ---------- */
{
  for (const [status, expected] of [[401, 'auth-required'], [403, 'auth-required'], [404, 'error'], [500, 'error']]) {
    const bridge = loadBridge('?apiBase=' + API_BASE, async () => makeResponse(status, { error: { code: 'DENIED', message: 'verified residents only' } }));
    const feed = await bridge.listPosts('question');
    assert.equal(feed.mode, expected, `list ${status}`);
    assert.equal(feed.posts.length, 0);
    const one = await bridge.getPost(POST_ID);
    assert.equal(one.mode, expected, `get ${status}`);
    assert.equal(one.post, null);
    const created = await bridge.createPost({ kind: 'question', title: '질문', body: '내용입니다' });
    assert.equal(created.ok, false);
    assert.equal(created.mode, expected, `create ${status}`);
    const comments = await bridge.listComments(POST_ID);
    assert.equal(comments.mode, expected, `comments ${status}`);
    const added = await bridge.addComment(POST_ID, '댓글');
    assert.equal(added.mode, expected, `add ${status}`);
    const liked = await bridge.setReaction(POST_ID, true);
    assert.equal(liked.mode, expected, `react ${status}`);
  }
  const dead = loadBridge('?apiBase=' + API_BASE, async () => { throw new Error('offline'); });
  const offline = await dead.listPosts(null);
  assert.equal(offline.mode, 'error');
  assert.equal(offline.status, 0);
}

/* ---------- 4. no fake persistence: static mode never fetches or claims server success ---------- */
{
  let fetched = 0;
  const bridge = loadBridge('', async () => { fetched++; return makeResponse(200, { data: [] }); });
  const feed = await bridge.listPosts('question');
  assert.equal(feed.mode, 'static');
  const one = await bridge.getPost(POST_ID);
  assert.equal(one.mode, 'static');
  assert.equal(one.error, 'SERVER_MODE_REQUIRED');
  const created = await bridge.createPost({ kind: 'question', title: '질문', body: '내용입니다' });
  assert.equal(created.ok, false);
  assert.equal(created.error, 'SERVER_MODE_REQUIRED');
  const liked = await bridge.setReaction(POST_ID, true);
  assert.equal(liked.ok, false);
  assert.equal(fetched, 0, 'no apiBase must never touch the network');
}

/* ---------- 5. client validation mirrors the v1 limits without touching the network ---------- */
{
  let fetched = 0;
  const bridge = loadBridge('?apiBase=' + API_BASE, async () => { fetched++; return makeResponse(200, { data: [] }); });
  const hello = await bridge.createPost({ kind: 'hello', title: '인사', body: '안녕하세요' });
  assert.equal(hello.error, 'POST_KIND_INVALID', 'hello stays out of the write surface; only canonical greeting (#348) is accepted');
  const badKind = await bridge.listPosts('hello');
  assert.equal(badKind.error, 'POST_KIND_INVALID');
  const badId = await bridge.getPost('story1');
  assert.equal(badId.error, 'POST_ID_INVALID');
  const longTitle = await bridge.createPost({ kind: 'question', title: '가'.repeat(161), body: '내용입니다' });
  assert.equal(longTitle.error, 'POST_TITLE_INVALID');
  const longBody = await bridge.createPost({ kind: 'question', title: '질문', body: '가'.repeat(10001) });
  assert.equal(longBody.error, 'POST_BODY_INVALID');
  const longComment = await bridge.addComment(POST_ID, '가'.repeat(301));
  assert.equal(longComment.error, 'COMMENT_BODY_INVALID');
  assert.equal(fetched, 0, 'invalid input must not reach the network');
  assert.match(bridgeSource, /'greeting'/, 'greeting is a canonical kind since #348 C2 (never coerced into another kind)');
}

/* ---------- 6. pages reuse the canonical session runtime + wiring ---------- */
function wiringScript(page, id) {
  const match = page.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
  assert.ok(match, `page must contain wiring script ${id}`);
  return match[1];
}
const WIRING = [
  ['12', page12, 'danjion-community-list-live-wiring-329'],
  ['13', page13, 'danjion-community-detail-live-wiring-329'],
  ['15', page15, 'danjion-community-write-story-live-wiring-329'],
  ['16', page16, 'danjion-community-write-question-live-wiring-329'],
  ['17', page17, 'danjion-community-write-together-live-wiring-329']
];
for (const [name, page, id] of WIRING) {
  assert.match(page, /<script src="assets\/danjion-session\.js"><\/script>/, `${name} loads canonical session runtime`);
  assert.match(page, /<script src="assets\/community-bridge\.js"><\/script>/, `${name} loads the community bridge`);
  const wiring = wiringScript(page, id);
  assert.match(wiring, /DanjionSession\.danjionApiBase\(\)/, `${name} reuses canonical apiBase parsing`);
  assert.match(wiring, /if\(!apiBase\)return;/, `${name} keeps static demo when no apiBase`);
  assert.doesNotMatch(wiring, /localStorage\.setItem|sessionStorage|indexedDB/, `${name} wiring never writes local persistence`);
  new vm.Script(wiring, { filename: `page-${name}-wiring` });
}
{
  const w12 = wiringScript(page12, 'danjion-community-list-live-wiring-329');
  assert.match(w12, /story:'resident_story',question:'question',together:'together'/, '12 maps chips onto the v1 kinds only');
  assert.match(w12, /bridge\.listPosts\(null,\{limit:50\}\)/, '12 전체보기 reads the v1 feed');
  assert.match(w12, /result\.posts\.filter\(p=>LABEL\[p\.kind\]\)/, '12 hides kinds outside the shared UI mapping');
  assert.match(w12, /가입인사 카테고리는 아직 서버 연동이 준비되지 않았습니다/, '12 keeps 가입인사 fail-closed (page 14 HOLD)');
  assert.match(w12, /13_이웃대화_글상세_댓글\.html\?apiBase=\$\{encodeURIComponent\(apiBase\)\}&post=\$\{encodeURIComponent\(p\.id\)\}/, '12 links details with apiBase + server post id');
  assert.match(w12, /WRITE\[selected\]\+'\?apiBase='/, '12 hands apiBase to the write pages');
  assert.ok(page12.indexOf('danjion-community-list-live-wiring-329') < page12.indexOf('danjion-direct-router-v5'), '12 wiring stays ahead of the router');
}
{
  const w13 = wiringScript(page13, 'danjion-community-detail-live-wiring-329');
  assert.match(w13, /if\(!UUID\.test\(postId\)\)return;/, '13 keeps demo ids static');
  assert.match(w13, /bridge\.getPost\(postId\)/);
  assert.match(w13, /bridge\.listComments\(postId\)/);
  assert.match(w13, /bridge\.addComment\(postId,v\)/);
  assert.match(w13, /bridge\.setReaction\(postId,!liked\)/);
  assert.match(w13, /closest\('#likeBtn'\)[\s\S]*?stopImmediatePropagation/, '13 demo like is intercepted in server mode');
  assert.match(w13, /ev\.target!==commentForm\)return;[\s\S]*?stopImmediatePropagation/, '13 demo fake comment is intercepted in server mode');
  assert.match(w13, /게시 대기 중/, '13 shows pending_review comments truthfully');
  assert.match(w13, /12_이웃대화_첫화면\.html\?type=/, '13 back link carries apiBase');
}
for (const [name, page, id, kind, chip] of [['15', page15, 'danjion-community-write-story-live-wiring-329', 'resident_story', 'story'], ['16', page16, 'danjion-community-write-question-live-wiring-329', 'question', 'question'], ['17', page17, 'danjion-community-write-together-live-wiring-329', 'together', 'together']]) {
  const wiring = wiringScript(page, id);
  assert.match(wiring, new RegExp(`kind:'${kind}'`), `${name} publishes only its v1 kind`);
  assert.match(wiring, /bridge\.createPost\(/);
  assert.match(wiring, new RegExp(`type=${chip}&apiBase=`), `${name} returns to its board with apiBase`);
  assert.match(wiring, /심사 후 공개됩니다/, `${name} reports review mode truthfully`);
  assert.match(wiring, /localStorage\.removeItem\(/, `${name} clears the demo draft after real submit`);
}
{
  const w17 = wiringScript(page17, 'danjion-community-write-together-live-wiring-329');
  assert.match(w17, /input\[required\]/, '17 keeps the required dynamic-field gate');
  assert.match(w17, /fieldLabel\(i\)\+': '\+v/, '17 preserves dynamic form answers in the post body');
}

/* ---------- 7. demo behavior stays intact for no-apiBase visitors ---------- */
{
  assert.match(page12, /const POSTS=\[/, '12 demo board data preserved');
  assert.match(page12, /id="danjion-direct-router-v5"/, '12 router preserved');
  assert.match(page13, /const DATA=\{/, '13 demo detail data preserved');
  assert.match(page13, /commentForm\.addEventListener\('submit'/, '13 demo comment handler preserved');
  assert.match(page15, /const key='danjionDraft:15'/, '15 demo draft flow preserved');
  assert.match(page16, /궁금한 내용을 10자 이상 적어주세요\./, '16 demo validation preserved');
  assert.match(page17, /const data=\{/, '17 demo dynamic templates preserved');
}

console.log('stage5k community wiring contract: PASS');
