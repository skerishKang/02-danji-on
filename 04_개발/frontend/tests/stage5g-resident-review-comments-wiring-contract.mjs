import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../../../', import.meta.url);
const html = await readFile(new URL('frontend/01_이웃가게_발견_v3.html', root), 'utf8');
const bridgeSource = await readFile(new URL('frontend/assets/reviews-bridge.js', root), 'utf8');

const BUSINESS_ID = 'd0a1c4a1-1111-4111-8111-111111111111';
const REVIEW_ID = 'e0a1c4a1-2222-4222-8222-222222222222';
const COMMENT_ID = 'f0a1c4a1-4444-4444-8444-444444444444';
const key = `api-${BUSINESS_ID}`;
let sandboxBridge;

const makeResponse = (status, data) => ({
  ok: status >= 200 && status < 300,
  status,
  async json(){ return status >= 200 && status < 300 ? { data } : { error: { code: data } }; }
});

/* ---------- 1/7. listComments: GET hydrate endpoint + normalization ---------- */
{
  const calls = [];
  const sandbox = {
    globalThis: {},
    location: { origin: 'https://danjion.pages.dev' },
    URL, encodeURIComponent, console,
    fetch: async (url, init) => { calls.push({ url, init }); return makeResponse(200, { reviewId: REVIEW_ID, comments: [{ id: COMMENT_ID, body: '함께 갔어요.', isMine: true, author: { userId: 'u1', nickname: '연블리', avatarUrl: null }, createdAt: '2026.09.01', updatedAt: null }] }); }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(bridgeSource, sandbox);
  sandboxBridge = sandbox.DanjionReviewsBridge;
  const bridge = sandboxBridge.createReviewsBridge({ apiBase: 'https://api.example.test/', fetchImpl: sandbox.fetch });
  const r = await bridge.listComments(key, REVIEW_ID);
  assert.equal(r.mode, 'server');
  assert.equal(r.comments.length, 1);
  assert.equal(r.comments[0].author.nickname, '연블리');
  assert.equal(r.comments[0].body, '함께 갔어요.');
  assert.equal(r.comments[0].id, COMMENT_ID);
  assert.equal(r.comments[0].isMine, true);
  assert.equal(calls[0].init.credentials, 'include');
  assert.match(calls[0].url, new RegExp(`/businesses/${BUSINESS_ID}/reviews/${REVIEW_ID}/comments$`));

  // static keys never fetch comments
  const silent = sandboxBridge.createReviewsBridge({ fetchImpl: async () => { throw new Error('no fetch'); } });
  const s1 = await silent.listComments('florist', REVIEW_ID);
  assert.equal(s1.mode, 'static');
  // non-UUID review id never fetches
  const s2 = await silent.listComments(key, 'review-9');
  assert.equal(s2.mode, 'static');
}

/* ---------- 2/3/4/5/6. createComment semantics on the bridge ---------- */
{
  const calls = [];
  const bridge = sandboxBridge.createReviewsBridge({
    apiBase: 'https://api.example.test/',
    fetchImpl: async (url, init) => { calls.push({ url, init }); return makeResponse(201, { id: COMMENT_ID, reviewId: REVIEW_ID, body: '좋은 가게네요.', isMine: true, author: { userId: 'me', nickname: '연블리', avatarUrl: null }, createdAt: '방금', updatedAt: null }); }
  });
  const ok = await bridge.createComment(key, REVIEW_ID, '좋은 가게네요.');
  assert.equal(ok.ok, true);
  assert.equal(ok.comment.id, COMMENT_ID);
  assert.equal(ok.comment.author.nickname, '연블리');
  const post = calls[0];
  assert.equal(post.init.method, 'POST');
  assert.match(post.url, new RegExp(`/businesses/${BUSINESS_ID}/reviews/${REVIEW_ID}/comments$`));
  const payload = JSON.parse(post.init.body);
  assert.equal(payload.body, '좋은 가게네요.');
  // create must target /comments, NOT the owner reply endpoint
  assert.doesNotMatch(post.url, /\/reply$/);

  // 4. 500-char bound preserved client-side
  const tooLong = await bridge.createComment(key, REVIEW_ID, 'a'.repeat(501));
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.error, 'COMMENT_BODY_TOO_LONG');
  assert.equal(calls.length, 1, 'over-bound body must not reach the network');

  // 5. auth-required mode on 401/403
  const authBridge = sandboxBridge.createReviewsBridge({
    apiBase: 'https://api.example.test/',
    fetchImpl: async () => makeResponse(401, 'AUTH_REQUIRED')
  });
  const denied = await authBridge.createComment(key, REVIEW_ID, 'hello');
  assert.equal(denied.mode, 'auth-required');
  assert.equal(denied.ok, false);

  // 6. error mode on 500/network
  const errBridge = sandboxBridge.createReviewsBridge({
    apiBase: 'https://api.example.test/',
    fetchImpl: async () => makeResponse(500, 'INTERNAL')
  });
  const failed = await errBridge.createComment(key, REVIEW_ID, 'hello');
  assert.equal(failed.mode, 'error');
  const netBridge = sandboxBridge.createReviewsBridge({
    apiBase: 'https://api.example.test/',
    fetchImpl: async () => { throw new Error('down'); }
  });
  const net = await netBridge.createComment(key, REVIEW_ID, 'hello');
  assert.equal(net.ok, false);
  assert.equal(net.error, 'NETWORK_ERROR');
}

/* ---------- page-level wiring contracts ---------- */

// A. server review load hydrates r[5] through listComments before render
assert.match(html, /async function hydrateServerComments\(key,s\)\{/,
  'A: hydrate helper must exist for server review comments');
assert.match(html, /hydrateServerComments\(key,s\);renderReviewPreview\(s\)/,
  'A: loadServerReviews must hydrate comments before rendering');
assert.match(html, /await __reviewsBridge\.listComments\(key,x\[0\]\[6\]\)/,
  'A: hydrate must fetch per-review comments with the review UUID from tuple index 6');
assert.match(html, /Promise\.allSettled\(/,
  'A: per-review comment fetches must be bounded parallel (allSettled: one failure must not kill rendering)');
assert.match(html, /if\(c\.mode!=='server'\)return;x\[0\]\[5\]=\(c\.comments\|\|\[\]\)\.map/,
  'A: failed comment fetch must leave the review as-is (degraded, not faked)');
assert.match(html, /const REVIEW_ID_UUID=\/\^\[0-9a-f\]\{8\}/,
  'A: review UUID validation gate must exist in the page runtime');
assert.match(html, /REVIEW_ID_UUID\.test\(x\[0\]\[6\]\|\|''\)/,
  'A: only UUID-bearing (server) reviews are hydrated; demo reviews untouched');

// B. comment submit goes through bridge createComment with server response update
assert.match(html, /__reviewsBridge\.createComment\(active,rid,v\)/,
  'B: resident comment submit must call bridge createComment with the review UUID');
assert.match(html, /rrow\[5\]\.push\(\[c\.comment\.author\.nickname,c\.comment\.createdAt\|\|'',c\.comment\.body,c\.comment\.id,c\.comment\.isMine\]\)/,
  'B: server comment must be appended from the server response (5-tuple with commentId + isMine)');

// C. reload/reopen: openReview re-fetches server reviews (and comments) when not keepLoaded
assert.match(html, /async function openReview\(keepLoaded\)\{const s=byKey\[active\];if\(!s\)return;if\(!keepLoaded\)\{try\{await loadServerReviews\(active\)\}catch\(_\)\{void 0\}\}/,
  'C: reopening the review sheet reloads server reviews + hydrated comments');

// 5. auth-required on comment create: no fake local comment
assert.match(html, /if\(c\.mode==='auth-required'\)\{flash\('로그인 후 이용 가능합니다\.'\);return\}/,
  '5: 401/403 comment create must surface login notice and never push a local comment');

// 6. network/5xx fail closed
assert.match(html, /flash\('댓글 등록에 실패했습니다\.'\);return\}/,
  '6: server failure must fail closed with an honest failure notice');

// 8. static/demo review keeps the pre-existing local behavior byte-for-byte
assert.match(html, /s\.reviews\[ri\]\[5\]=s\.reviews\[ri\]\[5\]\|\|\[\];s\.reviews\[ri\]\[5\]\.push\(\['연블리','방금',v\]\);openReview\(true\);/,
  '8: demo comment path must keep the exact original local push (no server call)');

// 10. resident comment lane never touches the owner reply API
assert.doesNotMatch(html, /__reviewsBridge\.reply\(/,
  '10: resident comment must NOT reuse the owner-only reply() method');
assert.doesNotMatch(html, /\/reply`/,
  '10: comment wiring must not construct the owner reply endpoint');

// 11. bridgeReviewToArray still preserves reviewId at index 6 and empty comments at index 5
assert.match(html, /function bridgeReviewToArray\(r\)\{return\[r\.author\?\.nickname\|\|'',r\.createdAt\|\|'',r\.body\|\|'',r\.reply\?\.body\|\|'',r\.reply\?\.createdAt\|\|'',\[\],r\.id\|\|''\]\}/,
  '11: bridgeReviewToArray must keep the canonical tuple shape (comments empty, reviewId preserved)');

// 12. commentId travels through the tuple (index 3 of the comment tuple)
assert.match(html, /c\.comment\.id,c\.comment\.isMine\]/,
  '12: comment tuples must carry commentId and isMine beyond the first 3 renderer fields');

// 13. canonical copy unchanged (renderer strings must be intact)
assert.match(html, /<span class="resident-badge-r">주민<\/span>/,
  '13: resident comment badge markup must be preserved');
assert.match(html, /maxlength="500" placeholder="따뜻한 댓글을 남겨주세요\."/,
  '13: canonical comment form copy and 500 bound must be preserved');
assert.match(html, /댓글 달기/,
  '13: canonical comment toggle copy must be preserved');

// 14. no new edit/delete UI invented (UPDATE_DELETE_UI_EXISTS = NO)
assert.doesNotMatch(html, /data-comment-edit|data-comment-delete|댓글 수정|댓글 삭제/,
  '14: no edit/delete comment UI may be invented without product authority');

console.log('PASS stage5g resident review comments wiring contract (GAP-1)');
