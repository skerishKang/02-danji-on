// Issue #768 [Owner Product][Apartment News V3]: the browser side of the
// long-form article + 공감 contract. This freezes the bridge surface the 08
// apartment-news page builds on:
//   * display_mode is read back verbatim; an unknown mode fails closed to the
//     'highlight' popup, never to the reader, and is never inferred from length
//   * authority labels are a pure presentation map of the server key — an
//     unknown key renders NO label instead of fabricating 입주자대표회의
//   * 공감 runs only through the canonical DanjionSession lane and keeps the
//     401 / verification-403 / other-403 / 404 boundaries distinguishable
// Bounded, offline, deterministic: fetch is stubbed, no server, no DOM.
import assert from 'node:assert/strict';
import {
  DANJION_COMPLEX_SLUG,
  NEWS_CHANNELS,
  NEWS_DISPLAY_MODES,
  NEWS_AUTHORITY_LABELS,
  newsAuthorityLabel,
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

// A minimal canonical session lane: createSessionFetch(base) must return the
// (fetchImpl, path, init) caller the bridge expects, forwarding to our stub.
function installSessionLane() {
  globalThis.DanjionSession = {
    createSessionFetch(base) {
      const root = String(base || '').replace(/\/+$/, '');
      return (fetchImpl, path, init) => fetchImpl(`${root}${path}`, init || {});
    }
  };
}
function removeSessionLane() {
  delete globalThis.DanjionSession;
}

/* --- #768 display modes mirror the server contract exactly --- */
assert.deepEqual(NEWS_DISPLAY_MODES, ['highlight', 'article']);
assert.deepEqual(NEWS_CHANNELS, ['danjion_notice', 'apartment_news', 'management_office', 'chair_greeting']);

/* --- authority labels mirror CHANNEL_AUTHORITY keys, presentation-only --- */
{
  assert.deepEqual(Object.keys(NEWS_AUTHORITY_LABELS).sort(), [
    'danjion_operator',
    'management_office',
    'resident_council',
    'resident_council_representative'
  ].sort());
  assert.equal(newsAuthorityLabel('resident_council'), '입주자대표회의');
  assert.equal(newsAuthorityLabel('resident_council_representative'), '입주자대표회장');
  assert.equal(newsAuthorityLabel('management_office'), '관리사무소');
  assert.equal(newsAuthorityLabel('danjion_operator'), '단지온 운영자');
  // The safe fallback: an unknown or absent key yields NO label. The list page
  // then renders the type alone and never attributes the post to a body that
  // did not author it.
  assert.equal(newsAuthorityLabel('some_future_authority'), '');
  assert.equal(newsAuthorityLabel(''), '');
  assert.equal(newsAuthorityLabel(null), '');
  assert.equal(newsAuthorityLabel(undefined), '');
}

/* --- normalizePost via listPosts: display_mode readback + fail-closed --- */
{
  const rows = [
    { id: UUID_A, source_name: null, category: 'progress', channel: 'apartment_news', display_mode: 'article', authority: 'resident_council', title: '장문 소식', body: '본문', reaction_count: 3, published_at: '2026-09-10T00:00:00.000Z' },
    { id: UUID_B, source_name: null, category: null, channel: 'apartment_news', display_mode: 'mystery-mode', authority: 'not-a-real-authority', title: '알 수 없는 모드', body: '본문', published_at: '2026-09-11T00:00:00.000Z' }
  ];
  const bridge = createNewsBridge({ apiBase: 'https://api.example', fetchImpl: async () => response(200, { data: rows }) });
  const result = await bridge.listPosts('apartment_news');
  assert.equal(result.ok, true);
  assert.equal(result.data[0].displayMode, 'article', 'a server article mode stays article');
  assert.equal(result.data[0].authority, 'resident_council', 'the authority key is the readback contract');
  assert.equal(result.data[0].authorityLabel, '입주자대표회의');
  assert.equal(result.data[0].reactionCount, 3, 'the server reaction count is rendered as-is');
  assert.equal(result.data[1].displayMode, 'highlight', 'an unknown display mode fails closed to the popup');
  assert.equal(result.data[1].authorityLabel, '', 'an unknown authority never gets a fabricated label');
}

/* --- normalizePost: absent mode and missing count degrade safely --- */
{
  const bridge = createNewsBridge({
    apiBase: 'https://api.example',
    fetchImpl: async () => response(200, {
      data: [{ id: UUID_A, channel: 'apartment_news', title: 't', body: 'b', reaction_count: '-4' }]
    })
  });
  const result = await bridge.listPosts('apartment_news');
  assert.equal(result.data[0].displayMode, 'highlight', 'a legacy row without display_mode stays a popup');
  assert.equal(result.data[0].reactionCount, 0, 'a non-positive count normalizes to 0');
  assert.equal(result.data[0].authorityLabel, '', 'a missing authority key never fabricates a label');

  const detail = await (createNewsBridge({
    apiBase: 'https://api.example',
    fetchImpl: async () => response(200, { data: { id: UUID_A, channel: 'chair_greeting', display_mode: 'article', authority: 'resident_council_representative', title: '인사', body: '본문' } })
  })).getPost(UUID_A);
  assert.equal(detail.data.displayMode, 'article');
  assert.equal(detail.data.authorityLabel, '입주자대표회장');
}

/* --- getReaction/setReaction: canonical session lane + resident path --- */
{
  installSessionLane();
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return response(200, { data: { postId: UUID_A, reactionType: 'like', active: true, reactionCount: 5 }, requestId: 'req-r1' });
  };
  const bridge = createNewsBridge({ apiBase: 'https://api.example', fetchImpl });

  const read = await bridge.getReaction(UUID_A);
  assert.equal(read.ok, true);
  assert.equal(read.requestId, 'req-r1');
  assert.deepEqual(read.data, { postId: UUID_A, reactionType: 'like', active: true, reactionCount: 5 });
  assert.equal(calls[0].url, `https://api.example/api/v1/complexes/${DANJION_COMPLEX_SLUG}/news/posts/${UUID_A}/reaction`);
  assert.equal(calls[0].init.method, 'GET');

  const on = await bridge.setReaction(UUID_A, true);
  assert.equal(on.ok, true);
  assert.equal(calls[1].init.method, 'POST');

  const off = await bridge.setReaction(UUID_A, false);
  assert.equal(off.ok, true);
  assert.equal(calls[2].init.method, 'DELETE');
  removeSessionLane();
}

/* --- reaction count is never taken from the client; only the DB readback --- */
{
  installSessionLane();
  const bridge = createNewsBridge({
    apiBase: 'https://api.example',
    fetchImpl: async () => response(200, { data: { postId: UUID_A, active: false } })
  });
  const result = await bridge.getReaction(UUID_A);
  assert.equal(result.ok, true);
  assert.equal(result.data.reactionCount, 0, 'a missing server count renders 0, never a fabricated number');
  assert.equal(result.data.reactionType, 'like', 'reaction type defaults to like');
  removeSessionLane();
}

/* --- boundary states stay distinguishable (#765 is never re-introduced) --- */
{
  installSessionLane();
  const run = (status, payload) =>
    createNewsBridge({ apiBase: 'https://api.example', fetchImpl: async () => response(status, payload) }).getReaction(UUID_A);

  const loggedOut = await run(401, { error: { code: 'UNAUTHENTICATED' } });
  assert.equal(loggedOut.ok, false);
  assert.equal(loggedOut.reason, 'login-required', 'a signed-out viewer is asked to log in');

  const unverified = await run(403, { error: { code: 'RESIDENT_VERIFICATION_REQUIRED' } });
  assert.equal(unverified.ok, false);
  assert.equal(unverified.reason, 'resident-verification-required', 'a verification boundary is never shown as log-in');

  const forbidden = await run(403, { error: { code: 'FORBIDDEN' } });
  assert.equal(forbidden.reason, 'forbidden');

  const missing = await run(404, { error: { code: 'NOT_FOUND' } });
  assert.equal(missing.reason, 'not-found');

  const broken = await run(500, { error: { code: 'INTERNAL' } });
  assert.equal(broken.reason, 'server-error');

  const offline = await createNewsBridge({ apiBase: 'https://api.example', fetchImpl: async () => { throw new Error('offline'); } }).getReaction(UUID_A);
  assert.equal(offline.reason, 'network-error');
  assert.equal(offline.status, 0);
  removeSessionLane();
}

/* --- without the canonical session runtime the mutation fails closed --- */
{
  removeSessionLane();
  let called = 0;
  const bridge = createNewsBridge({ apiBase: 'https://api.example', fetchImpl: async () => { called += 1; return response(200, {}); } });
  const result = await bridge.setReaction(UUID_A, true);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'server-mode-required', 'no unauthenticated request is ever fired');
  assert.equal(called, 0, 'no request left the bridge without the session lane');
}

/* --- empty postId fails before any network or session lookup --- */
{
  installSessionLane();
  let called = 0;
  const bridge = createNewsBridge({ apiBase: 'https://api.example', fetchImpl: async () => { called += 1; return response(200, {}); } });
  for (const attempt of [bridge.getReaction(''), bridge.setReaction('', true), bridge.setReaction(null, true)]) {
    const result = await attempt;
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'validation-error');
  }
  assert.equal(called, 0, 'an empty postId must fail before the network');
  removeSessionLane();
}

console.log('PASS #768 complex news article + reaction bridge contract');
