import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, adminApi, residentApi, app, notifications] = await Promise.all([
  readFile(new URL('migrations/051_household_messages.sql', root), 'utf8'),
  readFile(new URL('src/admin-household-messaging-v1.ts', root), 'utf8'),
  readFile(new URL('src/resident-household-messages-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('migrations/025_resident_notifications.sql', root), 'utf8')
]);

assert.match(migration, /create table if not exists household_messages\b/i);
assert.match(migration, /body text not null/i);
assert.match(migration, /target_selector jsonb not null/i);
assert.match(migration, /uq_household_messages_complex_idempotency/i);
assert.match(migration, /create table if not exists household_message_deliveries\b/i);
assert.match(migration, /primary key \(message_id, user_id\)/i);
assert.match(migration, /create table if not exists household_message_events\b/i);
assert.match(migration, /unique \(message_id, event_type\)/i);
assert.match(migration, /before update or delete on household_message_events/i);
assert.match(migration, /create or replace function resident_household_message_feed/i);
assert.match(migration, /where d\.user_id = p_user_id/i);
assert.match(migration, /hm\.status = 'verified'/);

assert.match(adminApi, /const SCOPE = 'household\.message\.manage'/);
assert.match(adminApi, /HOUSEHOLD_MESSAGE_SEND_MODE/);
assert.match(adminApi, /=== 'enabled'/);
assert.match(adminApi, /HOUSEHOLD_MESSAGE_DISPATCH_DISABLED/);
assert.match(adminApi, /insert into household_messages/i);
assert.match(adminApi, /request_fingerprint/i);
assert.match(adminApi, /dispatch_started/i);
assert.match(adminApi, /hm\.status = 'verified'/);
assert.match(adminApi, /HOUSEHOLD_MAPPING_AMBIGUOUS/);
assert.match(adminApi, /insert into household_message_deliveries/i);
assert.match(adminApi, /insert into notifications/i);
assert.match(adminApi, /'household_message'/);
assert.doesNotMatch(adminApi, /update\s+household_memberships|household_verification_codes|\bsms\b|phone|email/i);

assert.match(residentApi, /requireActor\(/);
assert.match(residentApi, /resident_household_message_feed/);
assert.doesNotMatch(residentApi, /target_selector|building_code|unit_code|sender_user_id|email|phone/i);

assert.match(app, /handleResidentHouseholdMessageRequest/);
assert.ok(
  app.indexOf('handleResidentHouseholdMessageRequest(request, env, id)') <
    app.indexOf('handleResidentNotificationRequest(request, env, id)')
);
assert.doesNotMatch(notifications, /body text|message_body/i);

console.log('PASS #761 household message persistence + disabled dispatch + resident isolation contract');
