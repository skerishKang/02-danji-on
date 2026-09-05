import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [integration, client, main] = await Promise.all([
  readFile(new URL('src/v2/integration/V2MessagesIntegration.tsx', root), 'utf8'),
  readFile(new URL('src/resident-messages-client.ts', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

const CURRENT_008_MESSAGES_AUTHORITY = {
  title: '20_메시지함_목록.html',
  screen: '20 메시지함 목록',
  anchors: ['메시지함', '안 읽음', '안 읽은 메시지', '새 메시지'],
  // 2026-09-05 TRACK K: interaction labels are shared with the conversation view.
  relocated: [
    { anchor: '프로필 보기', authority: '21_메시지_대화상세.html', impl: 'V2MessagesIntegration.tsx' },
    { anchor: '새로고침', authority: '21_메시지_대화상세.html', impl: 'V2MessagesIntegration.tsx' }
  ]
};

for (const anchor of CURRENT_008_MESSAGES_AUTHORITY.anchors) {
  assert.ok(anchor.length > 0, `20 design requirement anchor must be named: ${anchor}`);
}

for (const reloc of CURRENT_008_MESSAGES_AUTHORITY.relocated) {
  assert.ok(reloc.anchor.length > 0 && reloc.authority.length > 0 && reloc.impl.length > 0,
    `20 relocated anchor must name its new authority/impl: ${reloc.anchor}`);
}

assert.match(integration, /data-v2-messages-panel/,
  '20 inbox surface must keep its stable hook');
assert.match(integration, /data-v2-message-unread/,
  '20 unread total must keep its stable hook');
assert.match(integration, /\{unreadTotal\}개 안 읽음/,
  '20 unread-message authority must remain visible');
assert.match(integration, /data-v2-conversation-item/,
  '20 conversation rows must keep their stable hook');
assert.match(integration, /data-unread=\{conversation\.unreadCount\}/,
  '20 per-row unread state must stay server-derived');
assert.match(integration, /아직 대화가 없습니다\./,
  '20 empty inbox parity must remain');
assert.match(integration, /residentMessagesClient\.listConversations\(\)/,
  '20 inbox must use canonical resident-messages authority');

for (const hook of ['프로필 보기', '대화 열기', '새로고침']) {
  assert.ok(integration.includes(hook), `20 inbox interaction must remain: ${hook}`);
}

assert.match(client, /\/api\/v1\/me\/conversations/,
  '20 inbox must use canonical resident conversation list');
assert.match(client, /authenticatedFetch/,
  '20 messages must stay on authenticated authority');

assert.match(integration, /document\.querySelector<HTMLElement>\('\.v2-profile-dialog'\)/,
  '20 inbox must mount into the canonical profile dialog');
assert.match(integration, /new MutationObserver\(sync\)/,
  '20 inbox must stay reactive to dialog presence');

assert.doesNotMatch(integration + client, /localStorage|sessionStorage|indexedDB/i,
  '20 parity must not create browser persistence authority');
assert.doesNotMatch(integration, /이웃온기|주민혜택 쿠폰/,
  '20 parity surface must not add excluded 23/03 screens');

assert.match(main, /import V2MessagesIntegration from '\.\/v2\/integration\/V2MessagesIntegration';/,
  'main must mount the messages integration on the v2 root');
assert.match(main, /<V2MessagesIntegration \/>/,
  'main must render the messages integration on the v2 root');

console.log('PASS V2 20260904 current 20 메시지함 목록 parity contract');
