import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, api, app, messages] = await Promise.all([
  readFile(new URL('migrations/025_resident_notifications.sql', root), 'utf8'),
  readFile(new URL('src/resident-notifications-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('src/resident-messages-v1.ts', root), 'utf8')
]);

assert.match(migration, /create table if not exists notifications\b/i, 'missing notifications table');
assert.match(migration, /user_id uuid not null references app_users\(id\)/i, 'notification recipient must be an app user');
assert.match(migration, /unique index[^;]*uq_notifications_source_event/is, 'notification source events must be deduplicated');
assert.match(migration, /where read_at is null/i, 'unread notifications need an index');
assert.match(migration, /create or replace function notify_resident_message_insert\(\)/i,
  'message notification producer must be database-owned');
assert.match(migration, /after insert on messages/i, 'message notification must be created after the message insert');
assert.match(migration, /'message:' \|\| new\.id::text/i, 'message notification source key must be stable');
assert.match(migration, /'conversation'/i, 'message notification must link to the conversation resource');
assert.doesNotMatch(migration, /new\.body/i, 'notification persistence must not copy the message body');

assert.match(api, /requireActor\(/, 'notification API must authenticate through the canonical actor boundary');
assert.match(api, /hm\.status = 'verified'/, 'notification API must remain resident-only');
assert.match(api, /u\.account_status = 'active'/, 'closed accounts must not use resident notification APIs');
assert.match(api, /where n\.user_id = \$\{actor\.id\}::uuid/i,
  'notification list must scope rows to the authenticated recipient');
assert.match(api, /where id = \$\{notificationId\}::uuid[\s\S]*and user_id = \$\{actor\.id\}::uuid/i,
  'single-read mutation must be recipient-owned');
assert.match(api, /where user_id = \$\{actor\.id\}::uuid[\s\S]*and read_at is null/i,
  'read-all mutation must only affect the authenticated recipient');
assert.doesNotMatch(api, /building_code|unit_code|\bemail\b|auth_user_id/i,
  'notification API must not read or expose residence/provider PII');

for (const route of [
  '/api/v1/me/notifications',
  '/api/v1/me/notifications/read-all',
  String.raw`\/notifications\/([0-9a-fA-F-]+)\/read$`
]) {
  assert.ok(api.includes(route), `missing route contract ${route}`);
}

assert.match(app, /handleResidentNotificationRequest/);
assert.match(app, /const residentNotificationResponse = await handleResidentNotificationRequest\(request, env, id\)/);
assert.doesNotMatch(messages, /insert into notifications/i,
  'message runtime should rely on the DB trigger so message + notification stay transactionally coupled');

console.log('PASS resident notification persistence/API/message-event contract');
