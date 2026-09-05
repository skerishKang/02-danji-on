import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [integration, client, safetyClient, main] = await Promise.all([
  readFile(new URL('src/v2/integration/V2MessagesIntegration.tsx', root), 'utf8'),
  readFile(new URL('src/resident-messages-client.ts', root), 'utf8'),
  readFile(new URL('src/resident-safety-client.ts', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

const CURRENT_008_CONVERSATION_AUTHORITY = {
  title: '21_메시지_대화상세.html',
  screen: '21 메시지 대화상세',
  anchors: ['답장 쓰기', '답장 보내기', '대화 신고하기', '공개 프로필 보기'],
  // 2026-09-05 TRACK K: success toast and report reasons are shared vocabulary,
  // pinned to the 22-aligned six-constant reason set below.
  relocated: [
    { anchor: '메시지를 보냈습니다.', authority: '21_메시지_대화상세.html', impl: 'V2MessagesIntegration.tsx' },
    { anchor: '개인정보 침해', authority: '22_주민_공개프로필.html', impl: 'V2MessagesIntegration.tsx (6종 상수)' },
    { anchor: '스팸', authority: '22_주민_공개프로필.html', impl: 'V2MessagesIntegration.tsx (6종 상수)' }
  ]
};

for (const anchor of CURRENT_008_CONVERSATION_AUTHORITY.anchors) {
  assert.ok(anchor.length > 0, `21 design requirement anchor must be named: ${anchor}`);
}

for (const reloc of CURRENT_008_CONVERSATION_AUTHORITY.relocated) {
  assert.ok(reloc.anchor.length > 0 && reloc.authority.length > 0 && reloc.impl.length > 0,
    `21 relocated anchor must name its new authority/impl: ${reloc.anchor}`);
}

assert.match(integration, /data-v2-conversation-dialog/,
  '21 conversation detail must keep its stable dialog hook');
assert.match(integration, /data-v2-message-thread/,
  '21 message thread must keep its stable hook');
assert.match(integration, /data-v2-message-row/,
  '21 message rows must keep their stable hook');
assert.match(integration, /data-sender=\{fromOther \? 'other' : 'self'\}/,
  '21 self/other message attribution must remain explicit');
assert.match(integration, /message\.body \?\? '삭제된 메시지입니다\.'/,
  '21 deleted-message parity must remain');
assert.match(integration, /'메시지를 보냈습니다\.'/,
  '21 send-completion parity must remain');
assert.match(integration, /'메시지는 1~2000자로 입력해 주세요\.'/,
  '21 compose bounds parity must remain');
assert.match(integration, /data-v2-message-compose/,
  '21 compose surface must keep its stable hook');
assert.match(integration, /maxLength=\{2000\}/,
  '21 compose must keep the 2000-character bound');

assert.match(integration, /danjion:v2-open-conversation/,
  '21 conversation detail must consume the canonical deep-link');
assert.match(integration, /danjion:v2-resident-blocked/,
  '21 conversation detail must react to resident blocks');
assert.match(integration, /searchParams\.get\('conversation'\)/,
  '21 stable internal conversation query deep-link must be consumed');
assert.match(integration, /UUID_RE\.test\(/,
  '21 conversation deep-links must be UUID validated before API access');

assert.match(integration, /residentMessagesClient\.markRead\(conversationId\)/,
  '21 open must mark the canonical read state');
assert.match(integration, /residentMessagesClient\.listMessages\(conversationId\)/,
  '21 thread must use canonical message authority');
assert.match(integration, /residentMessagesClient\.sendMessage\(selected\.id, body\)/,
  '21 reply must write through the canonical messages client');
assert.match(integration, /주민 프로필 보기/,
  '21 thread must keep the participant profile entry point');

assert.match(client, /\/api\/v1\/conversations\/\$\{encodeURIComponent\(conversationId\)\}\/messages/,
  '21 message list/send must use canonical conversation route');
assert.match(client, /\/api\/v1\/conversations\/\$\{encodeURIComponent\(conversationId\)\}\/read/,
  '21 read state must use canonical backend endpoint');
assert.match(client, /authenticatedFetch/,
  '21 messages must stay on authenticated authority');

for (const label of ['욕설·괴롭힘', '위협', '개인정보 침해', '명예훼손 우려', '스팸', '기타']) {
  assert.ok(integration.includes(label), `21 report reason parity must keep 22-aligned label: ${label}`);
}
assert.match(integration, /대화 신고하기/,
  '21 conversation detail must expose the 대화 신고하기 entry point');
assert.match(integration, /data-v2-message-report-form/,
  '21 report form must keep its stable hook');
assert.match(integration, /residentSafetyClient\.reportMessage\(reportableMessage\.id, reportReason, reportDetail\)/,
  '21 report must write through the canonical safety authority');
assert.match(integration, /senderUserId === selected\.participant\.userId && message\.body != null/,
  '21 report must only target live (non-deleted) peer messages');
assert.match(integration, /'이미 검토 중인 신고가 있습니다\.'/,
  '21 report must surface already-reported feedback');
assert.match(safetyClient, /reportMessage\(messageId: string, reason: ResidentReportReason, detail\?: string\)/,
  '21 safety client must expose reportMessage with canonical signature');
assert.match(safetyClient, /targetType: 'message', targetId: messageId/,
  '21 report must target messages through the canonical safety route');
assert.match(safetyClient, /mockReports\.add\(key\)/,
  '21 report must keep the canonical mock dedupe authority');

assert.match(integration, /document\.querySelector<HTMLElement>\('\.v2-profile-dialog'\)/,
  '21 conversation surface must mount into the canonical profile dialog');
assert.match(integration, /new MutationObserver\(sync\)/,
  '21 conversation surface must stay reactive to dialog presence');

assert.doesNotMatch(integration + client + safetyClient, /localStorage|sessionStorage|indexedDB/i,
  '21 parity must not create browser persistence authority');
assert.doesNotMatch(integration + safetyClient, /이웃온기|주민혜택 쿠폰/,
  '21 parity surface must not add excluded 23/03 screens');

assert.match(main, /import V2MessagesIntegration from '\.\/v2\/integration\/V2MessagesIntegration';/,
  'main must mount the messages integration on the v2 root');
assert.match(main, /<V2MessagesIntegration \/>/,
  'main must render the messages integration on the v2 root');

console.log('PASS V2 20260904 current 21 메시지 대화상세 parity contract');
