import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [client, integration, main] = await Promise.all([
  readFile(new URL('src/resident-messages-client.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2MessagesIntegration.tsx', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

assert.match(client, /\/api\/v1\/me\/conversations/,
  'inbox must use canonical resident conversation list');
assert.match(client, /\/api\/v1\/conversations\/\$\{encodeURIComponent\(conversationId\)\}\/messages/,
  'message list/send must use canonical conversation route');
assert.match(client, /\/api\/v1\/conversations\/\$\{encodeURIComponent\(conversationId\)\}\/read/,
  'read state must use canonical backend endpoint');
assert.match(client, /\/api\/v1\/conversations'/,
  'client must preserve a typed start-conversation entry point for verified profile flows');
assert.match(client, /authenticatedFetch\(/,
  'API conversations/messages must use resident authenticated session');
assert.doesNotMatch(client, /localStorage|sessionStorage|indexedDB/i,
  'conversation/message authority must not be browser persistence');

assert.match(integration, /data-v2-messages-panel/);
assert.match(integration, /data-v2-conversation-dialog/);
assert.match(integration, /residentMessagesClient\.listConversations\(\)/);
assert.match(integration, /residentMessagesClient\.markRead\(conversationId\)/);
assert.match(integration, /residentMessagesClient\.listMessages\(conversationId\)/);
assert.match(integration, /residentMessagesClient\.sendMessage\(selected\.id, body\)/);
assert.match(integration, /window\.addEventListener\('danjion:v2-open-conversation'/,
  'notification conversation event must open the canonical message integration');
assert.match(integration, /searchParams\.get\('conversation'\)/,
  'stable internal conversation query deep-link must be consumed');
assert.match(integration, /UUID_RE\.test\(text\)/,
  'conversation deep-links must be UUID shaped before API access');
assert.match(integration, /body\.length > 2000/);
assert.doesNotMatch(integration, /participantUserId.*<input|placeholder=.*UUID|name=.*participantUserId/is,
  'V2 production UI must not expose raw recipient UUID entry');
assert.doesNotMatch(integration, /building|unitCode|buildingCode|auth_user|provider/i,
  'V2 message presentation must not expose exact residence/provider identity');

assert.match(main, /V2MessagesIntegration/);
assert.match(main, /v2=\{<>[\s\S]*<V2NotificationsPortal \/>[\s\S]*<V2MessagesIntegration \/>[\s\S]*<\/\>\}/,
  'messages must mount in V2 after the notification producer/deep-link surface');

console.log('PASS V2 resident message inbox/detail backend-authority/deep-link contract');
