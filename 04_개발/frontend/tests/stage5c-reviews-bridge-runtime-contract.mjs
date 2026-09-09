import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../../../', import.meta.url);
const source = await readFile(new URL('frontend/assets/reviews-bridge.js', root), 'utf8');

const sandbox = {
  globalThis: {},
  location: { origin: 'https://danjion.pages.dev' },
  fetch: async () => { throw new Error('unexpected fetch'); },
  URL,
  encodeURIComponent,
  console
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const { createReviewsBridge, businessIdFromKey, normalizeReview } = sandbox.DanjionReviewsBridge;
assert.ok(createReviewsBridge);

const BUSINESS_ID = 'd0a1c4a1-1111-4111-8111-111111111111';
const REVIEW_ID = 'e0a1c4a1-2222-4222-8222-222222222222';
const key = `api-${BUSINESS_ID}`;

assert.equal(businessIdFromKey(key), BUSINESS_ID);
assert.equal(businessIdFromKey('florist'), null);
assert.equal(businessIdFromKey('api-not-a-uuid'), null);

{
  const r = normalizeReview({
    id: REVIEW_ID,
    body: '좋았습니다.',
    isMine: true,
    author: { userId: 'u1', nickname: '이웃', avatarUrl: null },
    reply: { body: '감사합니다.', createdAt: 'c', updatedAt: 'u' },
    createdAt: 'c1', updatedAt: 'u1'
  });
  assert.equal(r.body, '좋았습니다.');
  assert.equal(r.isMine, true);
  assert.equal(r.author.nickname, '이웃');
  assert.equal(r.reply.body, '감사합니다.');
}

const makeResponse = (status, data) => ({
  ok: status >= 200 && status < 300,
  status,
  async json(){ return status >= 200 && status < 300 ? { data } : { error: { code: data } }; }
});

// list: verified resident server response is normalized and credentials are included.
{
  const calls = [];
  const bridge = createReviewsBridge({
    apiBase: 'https://api.example.test/',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return makeResponse(200, { businessId: BUSINESS_ID, reviews: [{
        id: REVIEW_ID, body: '편안했어요.', isMine: false,
        author: { userId: 'u2', nickname: '산책메이트', avatarUrl: null }, reply: null,
        createdAt: 'now', updatedAt: 'now'
      }] });
    }
  });
  const result = await bridge.list(key);
  assert.equal(result.mode, 'server');
  assert.equal(result.reviews.length, 1);
  assert.equal(result.reviews[0].author.nickname, '산책메이트');
  assert.equal(calls[0].init.credentials, 'include');
  assert.match(calls[0].url, new RegExp(`/businesses/${BUSINESS_ID}/reviews$`));
}

// static fallback rows never call the authenticated review API.
{
  let called = false;
  const bridge = createReviewsBridge({ fetchImpl: async () => { called = true; } });
  const result = await bridge.list('florist');
  assert.equal(result.mode, 'static');
  assert.equal(called, false);
}

// unauthenticated/unverified boundaries remain explicit; bridge does not fake success.
for (const status of [401, 403]) {
  const bridge = createReviewsBridge({ fetchImpl: async () => makeResponse(status, 'AUTH_REQUIRED') });
  const result = await bridge.list(key);
  assert.equal(result.mode, 'auth-required');
  assert.equal(result.status, status);
}

// create uses canonical POST payload and returns immediately renderable isMine review.
{
  let captured;
  const bridge = createReviewsBridge({ fetchImpl: async (url, init) => {
    captured = { url, init };
    return makeResponse(201, { id: REVIEW_ID, businessId: BUSINESS_ID, body: '새 후기', isMine: true, createdAt: 'c', updatedAt: 'u' });
  }});
  const result = await bridge.create(key, ' 새 후기 ');
  assert.equal(result.ok, true);
  assert.equal(result.review.body, '새 후기');
  assert.equal(result.review.isMine, true);
  assert.equal(captured.init.method, 'POST');
  assert.equal(JSON.parse(captured.init.body).body, '새 후기');
}

// own-review update/delete use review UUID under the same canonical business path.
{
  const calls = [];
  const bridge = createReviewsBridge({ fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'PATCH') return makeResponse(200, { id: REVIEW_ID, businessId: BUSINESS_ID, body: '수정', isMine: true });
    return makeResponse(200, { id: REVIEW_ID, businessId: BUSINESS_ID, deleted: true });
  }});
  const updated = await bridge.update(key, REVIEW_ID, '수정');
  const removed = await bridge.remove(key, REVIEW_ID);
  assert.equal(updated.review.body, '수정');
  assert.equal(removed.deleted, true);
  assert.match(calls[0].url, new RegExp(`/reviews/${REVIEW_ID}$`));
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(calls[1].init.method, 'DELETE');
}

// owner reply keeps a distinct endpoint and does not mutate resident review semantics.
{
  let captured;
  const bridge = createReviewsBridge({ fetchImpl: async (url, init) => {
    captured = { url, init };
    return makeResponse(200, { reviewId: REVIEW_ID, businessId: BUSINESS_ID, body: '감사합니다.', createdAt: 'c', updatedAt: 'u' });
  }});
  const result = await bridge.reply(key, REVIEW_ID, '감사합니다.');
  assert.equal(result.ok, true);
  assert.equal(result.reply.body, '감사합니다.');
  assert.match(captured.url, new RegExp(`/reviews/${REVIEW_ID}/reply$`));
  assert.equal(captured.init.method, 'POST');
}

// network failures and invalid bodies/ids fail closed.
{
  const bridge = createReviewsBridge({ fetchImpl: async () => { throw new Error('offline'); } });
  const list = await bridge.list(key);
  assert.equal(list.mode, 'error');
  assert.equal(list.status, 0);
  assert.equal((await bridge.create(key, '   ')).error, 'REVIEW_BODY_REQUIRED');
  assert.equal((await bridge.update(key, 'bad', 'x')).error, 'VALID_IDS_REQUIRED');
}

console.log('PASS #278 reviews/replies frontend bridge runtime');
