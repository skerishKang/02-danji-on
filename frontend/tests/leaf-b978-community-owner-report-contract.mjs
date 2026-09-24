import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [sessionSource, bridgeSource, detailSource, backendSource] = await Promise.all([
  read('assets/danjion-session.js'),
  read('assets/community-bridge.js'),
  read('13_이웃대화_글상세_댓글.html'),
  read('../04_개발/backend/src/community-resident-v1.ts')
]);

const POST_ID = 'a0a1c4a1-1111-4111-8111-111111111111';
const OTHER_POST_ID = 'c0c1c4a1-3333-4333-8333-333333333333';
const COMMENT_ID = 'b0b1c4a1-2222-4222-8222-222222222222';

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => body
  };
}

function loadBridge(fetchImpl, complexSlug = 'banglim-myeongji-roadhill') {
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
      fetchImpl,
      complexSlug
    })
  };
}

function post(overrides = {}) {
  return {
    id: POST_ID,
    kind: 'question',
    title: '기존 제목',
    body: '기존 내용',
    status: 'published',
    author: { nickname: '작성자' },
    reactionCount: 1,
    commentCount: 1,
    viewerLiked: false,
    viewerCanEdit: false,
    viewerCanDelete: false,
    viewerCanReport: true,
    publishedAt: '2026-09-20T00:00:00.000Z',
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    ...overrides
  };
}

function comment(overrides = {}) {
  return {
    id: COMMENT_ID,
    postId: POST_ID,
    body: '댓글',
    status: 'published',
    author: { nickname: '작성자' },
    viewerCanDelete: false,
    viewerCanReport: true,
    publishedAt: '2026-09-20T00:00:00.000Z',
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    ...overrides
  };
}

assert.match(backendSource, /request\.method === 'PATCH'/, 'backend post PATCH must remain supported');
assert.match(backendSource, /request\.method === 'DELETE'/, 'backend delete contract must remain supported');
assert.match(backendSource, /reportsMatch/, 'backend report contract must remain supported');
assert.doesNotMatch(backendSource, /commentMatch\s*&&\s*request\.method\s*===\s*'PATCH'/, 'comment PATCH is not in #978 scope');
assert.doesNotMatch(backendSource, /replyMatch/, 'reply PATCH/DELETE is not in #978 scope');
assert.doesNotMatch(bridgeSource, /deleteReply|updateComment|blockUser|unblockUser/, 'unsupported Community mutations stay out of the bridge');

{
  const { api } = loadBridge(async () => response(200, { data: [] }));
  const owned = api.normalizePost(post({ viewerCanEdit: true, viewerCanDelete: true, viewerCanReport: false }));
  assert.equal(owned.viewerCanEdit, true);
  assert.equal(owned.viewerCanDelete, true);
  assert.equal(owned.viewerCanReport, false);
  const nicknameOnly = api.normalizePost(post({ author: { nickname: '작성자' }, viewerCanEdit: undefined, viewerCanDelete: undefined, viewerCanReport: undefined }));
  assert.equal(nicknameOnly.viewerCanEdit, false);
  assert.equal(nicknameOnly.viewerCanDelete, false);
  assert.equal(nicknameOnly.viewerCanReport, false);
  const normalizedComment = api.normalizeComment(comment({ viewerCanDelete: true, viewerCanReport: false }));
  assert.equal(normalizedComment.viewerCanDelete, true);
  assert.equal(normalizedComment.viewerCanReport, false);
}

{
  const calls = [];
  const { bridge } = loadBridge(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (init.method === 'PATCH') return response(200, { data: post({ viewerCanEdit: true, viewerCanDelete: true, viewerCanReport: false, title: '새 제목', body: '새 내용' }) });
    if (init.method === 'DELETE' && String(url).includes(`/posts/${POST_ID}`)) return response(200, { data: { id: POST_ID, status: 'deleted' } });
    if (init.method === 'DELETE' && String(url).includes(`/comments/${COMMENT_ID}`)) return response(200, { data: { id: COMMENT_ID, status: 'deleted' } });
    if (String(url).endsWith('/reports')) return response(201, { data: { id: 'd0d1c4a1-4444-4444-8444-444444444444', status: 'submitted', createdAt: '2026-09-20T00:00:00.000Z' } });
    throw new Error(`unexpected route ${init.method || 'GET'} ${url}`);
  });

  const updated = await bridge.updatePost(POST_ID, { title: '  새 제목  ', body: '  새 내용  ' });
  assert.equal(updated.ok, true);
  assert.equal(updated.post.title, '새 제목');
  const patch = calls.find((call) => call.init.method === 'PATCH');
  assert.equal(patch.url, `https://api.example.test/api/v1/complexes/banglim-myeongji-roadhill/community/posts/${POST_ID}`);
  assert.deepEqual(JSON.parse(patch.init.body), { title: '새 제목', body: '새 내용' });

  const deletedPost = await bridge.deletePost(POST_ID);
  assert.equal(deletedPost.ok, true);
  assert.equal(deletedPost.deleted, true);
  assert.equal(deletedPost.post.status, 'deleted');

  const deletedComment = await bridge.deleteComment(COMMENT_ID);
  assert.equal(deletedComment.ok, true);
  assert.equal(deletedComment.deleted, true);
  assert.equal(deletedComment.comment.status, 'deleted');

  const reportedPost = await bridge.reportTarget({ targetType: 'post', targetId: POST_ID, reason: 'spam', detail: '  불필요한 홍보  ' });
  assert.equal(reportedPost.ok, true);
  assert.equal(reportedPost.report.status, 'submitted');
  const reportCall = calls.find((call) => String(call.url).endsWith('/reports'));
  assert.deepEqual(JSON.parse(reportCall.init.body), { targetType: 'post', targetId: POST_ID, reason: 'spam', detail: '불필요한 홍보' });
  console.log('PASS OWNER_POST_UPDATE');
  console.log('PASS OWNER_POST_DELETE');
  console.log('PASS OWNER_COMMENT_DELETE');
  console.log('PASS POST_REPORT');
}

{
  const { bridge } = loadBridge(async (url, init = {}) => {
    if (init.method === 'DELETE' || init.method === 'PATCH') return response(404, { error: { code: 'NOT_FOUND', message: 'not owner' } });
    if (String(url).endsWith('/reports')) return response(404, { error: { code: 'NOT_FOUND', message: 'cross-complex target' } });
    throw new Error('unexpected route');
  });
  assert.equal((await bridge.updatePost(OTHER_POST_ID, { title: '변경', body: '내용' })).mode, 'error');
  assert.equal((await bridge.deletePost(OTHER_POST_ID)).mode, 'error');
  assert.equal((await bridge.deleteComment(COMMENT_ID)).mode, 'error');
  assert.equal((await bridge.reportTarget({ targetType: 'comment', targetId: COMMENT_ID, reason: 'other' })).mode, 'error');
  console.log('PASS NON_OWNER_POST_MUTATION_DENIED');
  console.log('PASS NON_OWNER_COMMENT_DELETE_DENIED');
  console.log('PASS CROSS_COMPLEX_DENIED');
}

{
  const calls = [];
  const { bridge } = loadBridge(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return response(201, { data: { id: 'd0d1c4a1-4444-4444-8444-444444444444', status: 'submitted', createdAt: null } });
  });
  const reportedComment = await bridge.reportTarget({ targetType: 'comment', targetId: COMMENT_ID, reason: 'privacy', detail: '' });
  assert.equal(reportedComment.ok, true);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(JSON.parse(calls[0].init.body).targetType, 'comment');
  console.log('PASS COMMENT_REPORT');
}

{
  let fetched = 0;
  const { bridge, api } = loadBridge(async () => { fetched++; return response(200, { data: {} }); });
  assert.equal((await bridge.updatePost('not-a-uuid', { title: '제목', body: '내용' })).error, 'POST_ID_INVALID');
  assert.equal((await bridge.updatePost(POST_ID, { title: '', body: '내용' })).error, 'POST_TITLE_INVALID');
  assert.equal((await bridge.updatePost(POST_ID, { title: '제목', body: '가'.repeat(10001) })).error, 'POST_BODY_INVALID');
  assert.equal((await bridge.deletePost('not-a-uuid')).error, 'POST_ID_INVALID');
  assert.equal((await bridge.deleteComment('not-a-uuid')).error, 'COMMENT_ID_INVALID');
  assert.equal((await bridge.reportTarget({ targetType: 'user', targetId: POST_ID, reason: 'other' })).error, 'REPORT_TARGET_TYPE_INVALID');
  assert.equal((await bridge.reportTarget({ targetType: 'post', targetId: 'not-a-uuid', reason: 'other' })).error, 'REPORT_TARGET_ID_INVALID');
  assert.equal((await bridge.reportTarget({ targetType: 'post', targetId: POST_ID, reason: 'not-allowed' })).error, 'REPORT_REASON_INVALID');
  assert.equal((await bridge.reportTarget({ targetType: 'post', targetId: POST_ID, reason: 'other', detail: '가'.repeat(1001) })).error, 'REPORT_DETAIL_INVALID');
  assert.equal(fetched, 0);
  assert.deepEqual([...api.REPORT_REASONS], ['abuse', 'threat', 'privacy', 'defamation_risk', 'spam', 'other']);
  assert.equal(api.MAX_REPORT_DETAIL_CHARS, 1000);
  console.log('PASS INVALID_REPORT_REASON_REJECTED');
}

{
  const signedOut = loadBridge(async () => response(401, { error: { code: 'AUTH_REQUIRED', message: 'required' } }, { 'x-danjion-auth-bridge': 'no-cookie' })).bridge;
  const unverified = loadBridge(async () => response(403, { error: { code: 'RESIDENT_VERIFICATION_REQUIRED', message: 'verified only' } })).bridge;
  const signedOutResult = await signedOut.deletePost(POST_ID);
  const unverifiedResult = await unverified.reportTarget({ targetType: 'post', targetId: POST_ID, reason: 'other' });
  assert.equal(signedOutResult.mode, 'auth-required');
  assert.equal(signedOutResult.status, 401);
  assert.equal(signedOutResult.authBridge, 'no-cookie');
  assert.equal(unverifiedResult.mode, 'auth-required');
  assert.equal(unverifiedResult.status, 403);
  console.log('PASS SIGNED_OUT_DENIED');
  console.log('PASS UNVERIFIED_DENIED');
}

{
  const duplicate = loadBridge(async () => response(200, { data: { status: 'already_reported' } })).bridge;
  const result = await duplicate.reportTarget({ targetType: 'post', targetId: POST_ID, reason: 'other' });
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.report.status, 'already_reported');
}

{
  assert.match(bridgeSource, /async updatePost\(postId, input = \{\}\)/);
  assert.match(bridgeSource, /async deletePost\(postId\)/);
  assert.match(bridgeSource, /async deleteComment\(commentId\)/);
  assert.match(bridgeSource, /async reportTarget\(input = \{\}\)/);
  assert.match(detailSource, /id="postEditBtn"/);
  assert.match(detailSource, /id="postDeleteBtn"/);
  assert.match(detailSource, /id="postReportBtn"/);
  assert.match(detailSource, /data-server-comment-delete/);
  assert.match(detailSource, /data-server-comment-report/);
  assert.match(detailSource, /viewerCanEdit/);
  assert.match(detailSource, /viewerCanDelete/);
  assert.match(detailSource, /viewerCanReport/);
  assert.match(detailSource, /bridge\.updatePost\(/);
  assert.match(detailSource, /bridge\.deletePost\(/);
  assert.match(detailSource, /bridge\.deleteComment\(/);
  assert.match(detailSource, /bridge\.reportTarget\(/);
  assert.match(detailSource, /showPostRecovery\('deleted'\)/);
  assert.match(detailSource, /await loadComments\(\)/);
  assert.match(detailSource, /esc\(c\.body\)/);
  assert.doesNotMatch(detailSource, /author\.nickname\s*(?:===|==|!==|!=)/);
  assert.doesNotMatch(bridgeSource, /author\.nickname\s*(?:===|==|!==|!=)/);
  const live = detailSource.match(/<script id="danjion-community-detail-live-wiring-329">([\s\S]*?)<\/script>/);
  assert.ok(live);
  assert.doesNotThrow(() => new vm.Script(live[1], { filename: 'community-detail-live-wiring' }));
  assert.doesNotMatch(detailSource, /deleteReply|updateComment|blockUser|unblockUser/);
  console.log('PASS CANONICAL_BRIDGE_METHODS');
  console.log('PASS CANONICAL_UI_WIRING');
  console.log('PASS PAGEERROR=0');
}

console.log('leaf-b978-community-owner-report-contract: PASS');
