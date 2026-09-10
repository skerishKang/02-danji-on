import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../../../', import.meta.url);
const sessionSource = await readFile(new URL('frontend/assets/danjion-session.js', root), 'utf8');
const bridgeSource = await readFile(new URL('frontend/assets/messages-notifications-bridge.js', root), 'utf8');
const page20 = await readFile(new URL('frontend/20_메시지함_목록.html', root), 'utf8');
const page21 = await readFile(new URL('frontend/21_메시지_대화상세.html', root), 'utf8');
const page27 = await readFile(new URL('frontend/27_알림함.html', root), 'utf8');

const CONVERSATION_ID = 'a0a1c4a1-1111-4111-8111-111111111111';
const MESSAGE_ID = 'b0a1c4a1-2222-4222-8222-222222222222';
const NOTIFICATION_ID = 'c0a1c4a1-3333-4333-8333-333333333333';
const API_BASE = 'https://api.example.test';

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
    URL, URLSearchParams, encodeURIComponent, console,
    fetch: fetchImpl
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(sessionSource, context);
  vm.runInContext(bridgeSource, context);
  return context.DanjionMessagesNotificationsBridge.createMessagesNotificationsBridge({ apiBase: context.DanjionSession.danjionApiBase(), fetchImpl });
}

/* ---------- 1. 20 message list reads resident-messages-v1 authority ---------- */
{
  const calls = [];
  const bridge = loadBridge('?apiBase=' + API_BASE + '/', async (url, init) => {
    calls.push({ url, init });
    return makeResponse(200, { data: { conversations: [
      { id: CONVERSATION_ID, complexSlug: 'banglim-myeongji-roadhill', participant: { userId: 'u2', nickname: '산책메이트' }, latestMessage: { body: '수요일 저녁 같이 걸어요.', createdAt: '2026-09-09T10:00:00Z' }, unreadCount: 2, createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-09T10:00:00Z' }
    ] }, requestId: 'r1' });
  });
  const r = await bridge.listConversations();
  assert.equal(r.mode, 'server');
  assert.equal(r.conversations.length, 1);
  assert.equal(r.conversations[0].participant.nickname, '산책메이트');
  assert.equal(r.conversations[0].unreadCount, 2);
  assert.equal(calls[0].url, API_BASE + '/api/v1/me/conversations');
  assert.equal(calls[0].init.credentials, 'include');
}

/* ---------- 2. 21 conversation detail reads + sends through v1 routes ---------- */
{
  const calls = [];
  const bridge = loadBridge('?apiBase=' + API_BASE, async (url, init) => {
    calls.push({ url, init });
    if (init?.method === 'POST') return makeResponse(201, { data: { id: MESSAGE_ID, conversationId: CONVERSATION_ID, senderUserId: 'u1', body: '네, 중앙 현관 앞에서 만나요.', createdAt: '2026-09-09T11:00:00Z' }, requestId: 'r2' });
    return makeResponse(200, { data: { conversationId: CONVERSATION_ID, messages: [
      { id: MESSAGE_ID, senderUserId: 'u2', body: '출발 장소는 중앙 현관 앞이 편할 것 같아요.', createdAt: '2026-09-09T10:00:00Z', deletedAt: null }
    ] }, requestId: 'r1' });
  });
  const list = await bridge.listMessages(CONVERSATION_ID);
  assert.equal(list.mode, 'server');
  assert.equal(list.messages[0].body, '출발 장소는 중앙 현관 앞이 편할 것 같아요.');
  assert.match(calls[0].url, new RegExp(`/api/v1/conversations/${CONVERSATION_ID}/messages$`));

  const sent = await bridge.sendMessage(CONVERSATION_ID, '네, 중앙 현관 앞에서 만나요.');
  assert.equal(sent.ok, true);
  assert.equal(sent.mode, 'server');
  assert.equal(sent.message.id, MESSAGE_ID);
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(JSON.parse(calls[1].init.body).body, '네, 중앙 현관 앞에서 만나요.');

  const read = await bridge.markConversationRead(CONVERSATION_ID);
  assert.equal(read.ok, true);
}

/* ---------- 3. 27 notifications read/update only via resident-notifications-v1 ---------- */
{
  const calls = [];
  const bridge = loadBridge('?apiBase=' + API_BASE, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/read-all')) return makeResponse(200, { data: { updatedCount: 3 }, requestId: 'r3' });
    if (url.endsWith('/read')) return makeResponse(200, { data: { id: NOTIFICATION_ID, readAt: '2026-09-09T12:00:00Z' }, requestId: 'r2' });
    return makeResponse(200, { data: { unreadCount: 1, notifications: [
      { id: NOTIFICATION_ID, type: 'inquiry_answer', title: '문의 답변이 등록되었습니다', actor: null, resource: { type: 'inquiry', id: 'd0a1c4a1-4444-4444-8444-444444444444' }, readAt: null, createdAt: '2026-09-09T12:00:00Z' }
    ] }, requestId: 'r1' });
  });
  const feed = await bridge.listNotifications();
  assert.equal(feed.mode, 'server');
  assert.equal(feed.unreadCount, 1);
  assert.equal(feed.notifications[0].category, 'account');
  assert.equal(calls[0].url, API_BASE + '/api/v1/me/notifications');

  const one = await bridge.markNotificationRead(NOTIFICATION_ID);
  assert.equal(one.ok, true);
  assert.match(calls[1].url, new RegExp(`/api/v1/me/notifications/${NOTIFICATION_ID}/read$`));
  assert.equal(calls[1].init.method, 'POST');

  const all = await bridge.markAllNotificationsRead();
  assert.equal(all.ok, true);
  assert.equal(all.updatedCount, 3);
  assert.match(calls[2].url, /\/api\/v1\/me\/notifications\/read-all$/);
}

/* ---------- 4. category mapping is display-only, server type preserved ---------- */
{
  const context = { globalThis: null, location: { search: '', origin: 'https://danjion.example' }, URL, URLSearchParams, console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(sessionSource, context);
  vm.runInContext(bridgeSource, context);
  const map = context.DanjionMessagesNotificationsBridge.notificationCategory;
  assert.equal(map('message'), 'message');
  assert.equal(map('comment'), 'reaction');
  assert.equal(map('reaction'), 'reaction');
  assert.equal(map('inquiry_answer'), 'account');
  assert.equal(map('household_link'), 'account');
  assert.equal(map('anything-unknown'), 'official');
}

/* ---------- 5. fail-closed: 401/403 -> auth-required, 404/5xx/network -> error ---------- */
{
  for (const [status, expected] of [[401, 'auth-required'], [403, 'auth-required'], [404, 'error'], [500, 'error']]) {
    const bridge = loadBridge('?apiBase=' + API_BASE, async () => makeResponse(status, { error: { code: 'DENIED' } }));
    const list = await bridge.listConversations();
    assert.equal(list.mode, expected, `list ${status}`);
    assert.equal(list.conversations.length, 0);
    const feed = await bridge.listNotifications();
    assert.equal(feed.mode, expected, `feed ${status}`);
    const send = await bridge.sendMessage(CONVERSATION_ID, '테스트');
    assert.equal(send.ok, false);
    assert.equal(send.mode, expected, `send ${status}`);
    const mark = await bridge.markAllNotificationsRead();
    assert.equal(mark.ok, false);
    assert.equal(mark.mode, expected, `mark ${status}`);
  }
  const dead = loadBridge('?apiBase=' + API_BASE, async () => { throw new Error('offline'); });
  const offline = await dead.listConversations();
  assert.equal(offline.mode, 'error');
  assert.equal(offline.status, 0);
}

/* ---------- 6. no fake persistence: static mode never fetches or claims server success ---------- */
{
  let fetched = 0;
  const bridge = loadBridge('', async () => { fetched++; return makeResponse(200, { data: {} }); });
  const list = await bridge.listConversations();
  assert.equal(list.mode, 'static');
  const feed = await bridge.listNotifications();
  assert.equal(feed.mode, 'static');
  const send = await bridge.sendMessage(CONVERSATION_ID, '시연 전송');
  assert.equal(send.ok, false);
  assert.equal(send.error, 'SERVER_MODE_REQUIRED');
  const mark = await bridge.markNotificationRead(NOTIFICATION_ID);
  assert.equal(mark.ok, false);
  assert.equal(fetched, 0, 'no apiBase must never touch the network');
}

/* ---------- 7. invalid ids never reach the network ---------- */
{
  let fetched = 0;
  const bridge = loadBridge('?apiBase=' + API_BASE, async () => { fetched++; return makeResponse(200, { data: {} }); });
  const bad = await bridge.sendMessage('demo-conversation-1', 'hello');
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'CONVERSATION_ID_INVALID');
  const badMark = await bridge.markNotificationRead('not-a-uuid');
  assert.equal(badMark.ok, false);
  const long = await bridge.sendMessage(CONVERSATION_ID, 'a'.repeat(2001));
  assert.equal(long.ok, false);
  assert.equal(long.error, 'MESSAGE_BODY_INVALID');
  assert.equal(fetched, 0, 'invalid input must not reach the network');
}

/* ---------- 8. pages reuse the canonical session runtime + wiring ---------- */
function wiringScript(page, id) {
  const match = page.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
  assert.ok(match, `page must contain wiring script ${id}`);
  return match[1];
}
{
  for (const [name, page, id] of [['20', page20, 'danjion-messages-list-live-wiring-330'], ['21', page21, 'danjion-conversation-detail-live-wiring-330'], ['27', page27, 'danjion-notifications-live-wiring-330']]) {
    assert.match(page, /<script src="assets\/danjion-session\.js"><\/script>/, `${name} loads canonical session runtime`);
    assert.match(page, /<script src="assets\/messages-notifications-bridge\.js"><\/script>/, `${name} loads the bridge`);
    const wiring = wiringScript(page, id);
    assert.doesNotMatch(wiring, /localStorage|sessionStorage|indexedDB/, `${name} wiring never persists locally`);
    assert.doesNotMatch(wiring, /new URLSearchParams\(location\.search\)\.get\('apiBase'\)/, `${name} reuses canonical apiBase parsing`);
  }
  const w20 = wiringScript(page20, 'danjion-messages-list-live-wiring-330');
  assert.match(w20, /DanjionSession\.danjionApiBase\(\)/);
  assert.match(w20, /bridge\.listConversations\(\)/);
  assert.match(w20, /21_메시지_대화상세\.html\?apiBase='/, '21 navigation carries apiBase + conversation');
  assert.match(w20, /&conversation='/);
  assert.match(w20, /본인 확인된 입주민만 메시지함을 볼 수 있습니다/, '403 is denied truthfully');
  const w21 = wiringScript(page21, 'danjion-conversation-detail-live-wiring-330');
  assert.match(w21, /bridge\.listMessages\(conversationId\)/);
  assert.match(w21, /bridge\.sendMessage\(conversationId,text\)/);
  assert.match(w21, /bridge\.markConversationRead\(conversationId\)/);
  assert.match(w21, /id!=='replyForm'\)return;[\s\S]*?stopImmediatePropagation/, 'demo fake-send is intercepted in server mode');
  const w27 = wiringScript(page27, 'danjion-notifications-live-wiring-330');
  assert.match(w27, /bridge\.listNotifications\(\)/);
  assert.match(w27, /bridge\.markAllNotificationsRead\(\)/);
  assert.match(w27, /bridge\.markNotificationRead\(item\.dataset\.notification\)/);
  assert.match(w27, /본인 확인된 입주민만 알림함을 볼 수 있습니다/);
}

/* ---------- 9. no-apiBase demo behavior is preserved ---------- */
{
  assert.match(wiringScript(page20, 'danjion-messages-list-live-wiring-330'), /if\(!apiBase\)return;/, '20 keeps static demo when no apiBase');
  assert.match(wiringScript(page21, 'danjion-conversation-detail-live-wiring-330'), /if\(!apiBase\)return;/, '21 keeps static demo when no apiBase');
  assert.match(wiringScript(page27, 'danjion-notifications-live-wiring-330'), /if\(!apiBase\)return;/, '27 keeps static demo when no apiBase');
}

console.log('stage5j messages/notifications wiring contract: PASS');
