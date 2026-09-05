import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [panel, portal, client, main] = await Promise.all([
  readFile(new URL('src/v2/integration/V2NotificationsPanel.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2NotificationsPortal.tsx', root), 'utf8'),
  readFile(new URL('src/resident-notifications-client.ts', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

const CURRENT_008_NOTIFICATIONS_AUTHORITY = {
  title: '27_알림함.html',
  screen: '27 알림함',
  anchors: ['새알림']
};

for (const anchor of CURRENT_008_NOTIFICATIONS_AUTHORITY.anchors) {
  assert.ok(anchor.length > 0, `27 design requirement anchor must be named: ${anchor}`);
}

assert.match(panel, /\{feed\.unreadCount\}개 안 읽음/,
  '27 unread-count authority must remain visible');
for (const text of ['모두 읽음', '읽음', '메시지함 열기', '주민소식 열기', '새 알림이 없습니다.']) {
  assert.ok(panel.includes(text), `27 notification interactions must remain: ${text}`);
}
assert.match(panel, /residentNotificationsClient\.list\(\)/,
  '27 feed must use canonical notification authority');
assert.match(panel, /residentNotificationsClient\.markRead\(/,
  '27 single mark-read must write through canonical client');
assert.match(panel, /residentNotificationsClient\.markAllRead\(\)/,
  '27 mark-all-read must write through canonical client');
assert.match(panel, /danjion:v2-open-conversation/,
  '27 message notifications must deep-link to the existing message surface');
assert.match(panel, /danjion:v2-open-resident-news/,
  '27 resident-news notifications must deep-link to the existing resident-news surface');
assert.match(panel, /UUID_RE\.test\(/,
  '27 deep-link targets must remain UUID validated');
assert.match(client, /authenticatedFetch/,
  '27 must stay on authenticated authority');

for (const hook of [
  'data-v2-notifications-panel',
  'data-v2-notification-unread',
  'data-v2-notification-item',
  'data-v2-notifications-status'
]) {
  assert.ok(panel.includes(hook), `stable notifications hook must remain: ${hook}`);
}

assert.doesNotMatch(panel, /localStorage|sessionStorage|indexedDB/i,
  '27 parity must not create browser persistence authority');
assert.doesNotMatch(panel, /이웃온기|주민혜택 쿠폰/,
  '27 parity surface must not add excluded 23/03 screens');

assert.match(portal, /<V2NotificationsPanel \/>/,
  '27 portal must reuse the canonical notifications panel');
assert.match(portal, /'\.v2-profile-dialog'/,
  '27 panel must mount into the canonical profile dialog');

assert.match(main, /import V2NotificationsPortal from '\.\/v2\/integration\/V2NotificationsPortal';/,
  'main must mount the notifications portal on the v2 root');

console.log('PASS V2 20260904 current 27 알림함 parity contract');
