import assert from 'node:assert/strict';
import {
  DANJION_COMPLEX_SLUG,
  NEWS_CHANNELS,
  createNewsBridge
} from '../../../frontend/assets/danjion-news-bridge.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

/* --- exports: complex slug + official channels match backend contract --- */
assert.equal(DANJION_COMPLEX_SLUG, 'banglim-myeongji-roadhill');
assert.deepEqual(NEWS_CHANNELS, ['danjion_notice', 'apartment_news', 'management_office', 'chair_greeting']);
assert.equal(typeof createNewsBridge, 'function');

/* --- createNewsBridge: requires fetchImpl, defaults from global --- */
{
  assert.throws(() => createNewsBridge({ fetchImpl: null }), TypeError);
}

/* --- listPosts: builds public GET /complexes/:slug/posts?channel&limit --- */
{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return response(200, {
      data: [
        { id: UUID_A, source_name: '단지온 관리사무소', category: 'essential', channel: 'danjion_notice', title: '엘리베이터 정기점검 안내', body: '점검 안내 본문', attachment_object_key: null, published_at: '2026-09-01T09:00:00.000Z' },
        { id: UUID_B, source_name: '단지온 관리사무소', category: null, channel: 'danjion_notice', title: '주민대표회의 결과', body: '결과 본문', attachment_object_key: 'attachments/a.pdf', published_at: '2026-09-02T10:00:00.000Z' }
      ],
      requestId: 'req-1'
    });
  };
  const bridge = createNewsBridge({ apiBase: 'https://api.example', fetchImpl });
  const result = await bridge.listPosts('danjion_notice');
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.requestId, 'req-1');
  assert.equal(result.data.length, 2);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith('https://api.example/api/v1/complexes/banglim-myeongji-roadhill/posts?'), calls[0].url);
  const params = new URL(calls[0].url).searchParams;
  assert.equal(params.get('channel'), 'danjion_notice');
  assert.equal(params.get('limit'), '50');
  /* public GET: accept json, NO credentials */
  assert.equal(calls[0].init.headers.accept, 'application/json');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.credentials, undefined);
  /* normalizePost maps snake_case -> camelCase */
  assert.equal(result.data[0].id, UUID_A);
  assert.equal(result.data[0].sourceName, '단지온 관리사무소');
  assert.equal(result.data[0].category, 'essential');
  assert.equal(result.data[0].channel, 'danjion_notice');
  assert.equal(result.data[0].title, '엘리베이터 정기점검 안내');
  assert.equal(result.data[0].body, '점검 안내 본문');
  assert.equal(result.data[0].attachmentObjectKey, null);
  assert.equal(result.data[0].publishedAt, '2026-09-01T09:00:00.000Z');
  assert.equal(result.data[1].attachmentObjectKey, 'attachments/a.pdf');
}

/* --- listPosts: limit clamped to backend range 1..50 --- */
{
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(new URL(url).searchParams.get('limit'));
    return response(200, { data: [] });
  };
  const bridge = createNewsBridge({ apiBase: 'https://api.example', fetchImpl });
  await bridge.listPosts('apartment_news', { limit: 999 });
  await bridge.listPosts('apartment_news', { limit: 0 });
  await bridge.listPosts('apartment_news', { limit: 7 });
  assert.deepEqual(seen, ['50', '1', '7']);
}

/* --- listPosts: channel 'all' or omitted drops channel param (backend default) --- */
{
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return response(200, { data: [] });
  };
  const bridge = createNewsBridge({ apiBase: 'https://api.example', fetchImpl });
  await bridge.listPosts('all');
  await bridge.listPosts();
  for (const url of seen) {
    assert.equal(new URL(url).searchParams.get('channel'), null);
  }
}

/* --- listPosts: non-array data degrades to empty list --- */
{
  const bridge = createNewsBridge({ fetchImpl: async () => response(200, { data: null }) });
  const result = await bridge.listPosts('danjion_notice');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, []);
}

/* --- getPost: builds /complexes/:slug/posts/:postId, normalizes single row --- */
{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return response(200, {
      data: { id: UUID_A, source_name: '주민대표회의', category: 'greeting', channel: 'chair_greeting', title: '2026 회장 인사말', body: '인사말 본문', attachment_object_key: null, published_at: '2026-09-03T00:00:00.000Z' },
      requestId: 'req-2'
    });
  };
  const bridge = createNewsBridge({ apiBase: 'https://api.example', fetchImpl });
  const result = await bridge.getPost(UUID_A);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example/api/v1/complexes/banglim-myeongji-roadhill/posts/' + UUID_A);
  assert.equal(calls[0].init.headers.accept, 'application/json');
  assert.equal(calls[0].init.credentials, undefined);
  assert.equal(result.data.id, UUID_A);
  assert.equal(result.data.sourceName, '주민대표회의');
  assert.equal(result.data.channel, 'chair_greeting');
  assert.equal(result.data.title, '2026 회장 인사말');
}

/* --- getPost: empty id fails before network --- */
{
  let called = 0;
  const bridge = createNewsBridge({ fetchImpl: async () => { called += 1; return response(200, { data: {} }); } });
  const empty = await bridge.getPost('');
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'validation-error');
  const missing = await bridge.getPost();
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'validation-error');
  assert.equal(called, 0, 'empty postId must fail before network');
}

/* --- error envelope: backend { error, requestId } surfaces code/status --- */
{
  const bridge = createNewsBridge({ fetchImpl: async () => response(400, { error: { code: 'INVALID_CHANNEL' }, requestId: 'req-3' }) });
  const result = await bridge.listPosts('not-a-channel');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'server-error');
  assert.equal(result.status, 400);
  assert.equal(result.error.code, 'INVALID_CHANNEL');
}

/* --- public endpoint must not treat 401/403 as session auth failures --- */
{
  const bridge = createNewsBridge({ fetchImpl: async () => response(401, { error: { code: 'UNAUTHENTICATED' } }) });
  const result = await bridge.listPosts('danjion_notice');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'auth-required');
  assert.equal(result.status, 401);
}

/* --- network failure: offline maps to network-error, status 0 --- */
{
  const bridge = createNewsBridge({ fetchImpl: async () => { throw new Error('offline'); } });
  const list = await bridge.listPosts('danjion_notice');
  assert.equal(list.ok, false);
  assert.equal(list.reason, 'network-error');
  assert.equal(list.status, 0);
  const single = await bridge.getPost(UUID_A);
  assert.equal(single.reason, 'network-error');
}

/* --- apiBase optional: relative URL works for same-origin serving --- */
{
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return response(200, { data: [] });
  };
  const bridge = createNewsBridge({ fetchImpl });
  await bridge.listPosts('management_office');
  assert.ok(calls[0].startsWith('/api/v1/complexes/banglim-myeongji-roadhill/posts?'), calls[0]);
}

/* --- custom complexSlug encoded into path --- */
{
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return response(200, { data: [] });
  };
  const bridge = createNewsBridge({ fetchImpl, complexSlug: 'complex with space' });
  await bridge.listPosts('danjion_notice');
  assert.ok(calls[0].includes('/api/v1/complexes/complex%20with%20space/posts'), calls[0]);
}

/* --- listChannels: probes public endpoint (limit=1) --- */
{
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return response(200, { data: [] });
  };
  const bridge = createNewsBridge({ apiBase: 'https://api.example', fetchImpl });
  const result = await bridge.listChannels();
  assert.equal(result.ok, true);
  assert.equal(new URL(calls[0]).searchParams.get('limit'), '1');
}

console.log('PASS #326 danjion news bridge contract');
