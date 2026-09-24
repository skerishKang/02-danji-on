import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [sessionSource, bridgeSource, listSource, detailSource] = await Promise.all([
  read('assets/danjion-session.js'),
  read('assets/community-bridge.js'),
  read('12_이웃대화_첫화면.html'),
  read('13_이웃대화_글상세_댓글.html')
]);

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    data: body.data,
    nextCursor: body.nextCursor,
    hasMore: body.hasMore,
    json: async () => body
  };
}

function loadBridge(fetchImpl) {
  const context = {
    globalThis: null,
    location: { search: '?apiBase=https://api.example.test', origin: 'https://danjion.example' },
    URL,
    URLSearchParams,
    encodeURIComponent,
    Date,
    console,
    fetch: fetchImpl
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(sessionSource, context);
  vm.runInContext(bridgeSource, context);
  return {
    api: context.DanjionCommunityBridge,
    bridge: context.DanjionCommunityBridge.createCommunityBridge({
      apiBase: context.DanjionSession.danjionApiBase(),
      fetchImpl
    })
  };
}

const post = (id) => ({
  id,
  kind: 'greeting',
  category: null,
  title: `post-${id}`,
  body: 'body',
  status: 'published',
  author: { nickname: '작성자' },
  reactionCount: 0,
  commentCount: 0,
  viewerLiked: false,
  viewerCanEdit: false,
  viewerCanDelete: false,
  viewerCanReport: true,
  publishedAt: '2026-09-24T00:00:00.000Z',
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z'
});
const comment = (id) => ({
  id,
  postId: '00000000-0000-4000-8000-000000000001',
  body: `comment-${id}`,
  status: 'published',
  author: { nickname: '작성자' },
  viewerCanDelete: false,
  viewerCanReport: true,
  publishedAt: '2026-09-24T00:00:00.000Z',
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z'
});
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

{
  const calls = [];
  const { bridge } = loadBridge(async (url) => {
    calls.push(String(url));
    const rawUrl = String(url);
    const cursor = rawUrl.includes('cursor=feed-page-2') ? 'feed-page-2' : rawUrl.includes('cursor=feed-page-3') ? 'feed-page-3' : null;
    if (!cursor) return response(200, { data: [post(uuid(1)), post(uuid(2))], nextCursor: 'feed-page-2', hasMore: true });
    if (cursor === 'feed-page-2') return response(200, { data: [post(uuid(3)), post(uuid(4))], nextCursor: 'feed-page-3', hasMore: true });
    assert.equal(cursor, 'feed-page-3');
    return response(200, { data: [post(uuid(5))], nextCursor: null, hasMore: false });
  });
  const page1 = await bridge.listPosts('greeting', { limit: 2 });
  const page2 = await bridge.listPosts('greeting', { limit: 2, cursor: page1.nextCursor });
  const page3 = await bridge.listPosts('greeting', { limit: 2, cursor: page2.nextCursor });
  assert.deepEqual([...page1.posts, ...page2.posts, ...page3.posts].map((row) => row.id), [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)]);
  assert.equal(new Set([...page1.posts, ...page2.posts, ...page3.posts].map((row) => row.id)).size, 5);
  assert.equal(page3.hasMore, false);
  assert.equal(calls.length, 3);
  assert.ok(calls[0].includes('kind=greeting'));
  assert.ok(calls[1].includes('cursor=feed-page-2'));
  assert.ok(calls[2].includes('cursor=feed-page-3'));
  console.log('PASS FEED_PAGE1_PAGE2_PAGE3_NO_DUPLICATE');
}

{
  let commentRequests = 0;
  let replyRequests = 0;
  const { bridge } = loadBridge(async (url) => {
    if (String(url).includes('/replies')) {
      replyRequests += 1;
      return response(200, { data: [{ ...comment(uuid(21)), parentCommentId: uuid(2) }], nextCursor: null, hasMore: false });
    }
    commentRequests += 1;
    const cursor = String(url).includes('cursor=comments-page-2') ? 'comments-page-2' : null;
    if (!cursor) return response(200, { data: [comment(uuid(1)), comment(uuid(2))], nextCursor: 'comments-page-2', hasMore: true });
    assert.equal(cursor, 'comments-page-2');
    return response(200, { data: [comment(uuid(3))], nextCursor: null, hasMore: false });
  });
  const page1 = await bridge.listComments(uuid(1), { limit: 2 });
  const page2 = await bridge.listComments(uuid(1), { limit: 2, cursor: page1.nextCursor });
  assert.deepEqual([...page1.comments, ...page2.comments].map((row) => row.id), [uuid(1), uuid(2), uuid(3)]);
  assert.equal(commentRequests, 2);
  assert.equal(replyRequests, 0, 'loading first and next comment pages does not fan out reply requests');
  const replyPage = await bridge.listReplies(uuid(1), uuid(2), { limit: 20 });
  assert.equal(replyPage.replies.length, 1);
  assert.equal(replyRequests, 1, 'replies are fetched only after explicit expansion');
  console.log('PASS COMMENTS_LOAD_MORE_NO_DUPLICATE');
  console.log('PASS REPLY_LAZY_LOAD_NO_N_PLUS_ONE');
}

{
  const { api } = loadBridge(async () => response(200, { data: [] }));
  const normalizedPost = api.normalizePost(post(uuid(1)));
  const normalizedComment = api.normalizeComment(comment(uuid(2)));
  assert.equal(normalizedPost.viewerCanEdit, false);
  assert.equal(normalizedPost.viewerCanDelete, false);
  assert.equal(normalizedPost.viewerCanReport, true);
  assert.equal(normalizedComment.viewerCanDelete, false);
  assert.equal(normalizedComment.viewerCanReport, true);
  console.log('PASS OWNER_AND_REPORT_CAPABILITIES_PRESERVED');
}

assert.match(listSource, /id="postLoadMore"[^>]*type="button"/);
assert.match(listSource, /cursor:append\?feedState\.cursor:null/);
assert.match(listSource, /if\(append&&\(!feedState\.hasMore\|\|feedState\.loading\)\)return/);
assert.match(detailSource, /id="commentLoadMore"[^>]*type="button"/);
assert.match(detailSource, /data-server-reply-toggle/);
assert.match(detailSource, /data-server-replies-more/);
assert.match(detailSource, /if\(state\.loading\|\|\(append&&\(!state\.hasMore\|\|!state\.cursor\)\)\)return/);
assert.match(detailSource, /viewerCanDelete/);
assert.match(detailSource, /viewerCanReport/);
assert.doesNotMatch(detailSource, /Promise\.all\(result\.comments\.map\(c=>loadReplies/);
const loadCommentsSource = detailSource.slice(detailSource.indexOf('async function loadComments'), detailSource.indexOf("document.addEventListener('click'", detailSource.indexOf('async function loadComments')));
assert.doesNotMatch(loadCommentsSource, /loadReplies\(|listReplies\(/, 'comment first-page/load-more path must not fetch replies');
assert.match(loadCommentsSource, /if\(!append\)\{\s*gatedCommentState\(msg\);\s*flash\(msg\);\s*\}else\{\s*flash\(msg\);\s*\}/, 'append failures preserve existing comments and expose retry');
assert.match(bridgeSource, /async listComments\(postId, options = \{\}\)/);
assert.match(bridgeSource, /async listReplies\(postId, parentCommentId\)/);
assert.match(bridgeSource, /const options = arguments\[2\] \|\| \{\}/);
console.log('PASS LOAD_MORE_UI_DUPLICATE_GUARDS');
console.log('PASS REPLY_LOAD_MORE_AND_LAZY_UI_CONTRACT');
console.log('PASS FAILURE_PRESERVES_EXISTING_DATA');
