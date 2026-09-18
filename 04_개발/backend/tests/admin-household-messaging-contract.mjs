import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [api, app, adminBridge, adminPage, notificationMigration] = await Promise.all([
  readFile(new URL('src/admin-household-messaging-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('../../frontend/assets/danjion-admin-console.js', root), 'utf8'),
  readFile(new URL('../../frontend/admin/index.html', root), 'utf8'),
  readFile(new URL('migrations/025_resident_notifications.sql', root), 'utf8')
]);

assert.match(api, /const SCOPE = 'household\.message\.manage'/,
  'household messaging must have a dedicated capability separate from resident verification');
assert.match(api, /resolvePadiemAuthority/,
  'initial household messaging target access must resolve from the PADIEM authority plane');
assert.doesNotMatch(api, /requireOperationalAuthority|complex_operator_grants|resident_council/,
  'initial rollout must not broaden household targeting to council/complex standing authority');

assert.match(api, /household-messages\\\/targets/,
  'server-authoritative target inventory route must exist');
assert.match(api, /household-messages\\\/preview/,
  'server-authoritative dry-run preview route must exist');
assert.match(api, /request\.method !== 'POST'/,
  'preview transport must be an explicit POST');
assert.match(api, /targetType must be unit, units, building or all/,
  'preview must support the four approved targeting modes');
assert.match(api, /MAX_SELECTED_UNITS = 100/,
  'selected-unit targeting must be bounded');
assert.match(api, /HOUSEHOLD_MAPPING_AMBIGUOUS/,
  'ambiguous household mappings must fail closed');
assert.match(api, /hm\.status = 'verified'/,
  'recipient count must derive only from verified household memberships');
assert.match(api, /count\(distinct hm\.user_id\)/,
  'recipient preview must count server-authoritative accounts without returning identities');

assert.match(api, /recipientAccountCount/,
  'preview may expose aggregate recipient count');
assert.match(api, /sendEnabled: false/,
  'source slice must keep dispatch disabled');
assert.match(api, /disabled_pending_activation/,
  'preview state must make the activation boundary explicit');
assert.match(api, /HOUSEHOLD_MESSAGE_SEND_MODE/,
  'source-level dispatch must remain behind an explicit runtime gate');
assert.match(api, /HOUSEHOLD_MESSAGE_DISPATCH_DISABLED/,
  'disabled dispatch must fail closed before fan-out mutation');
assert.match(api, /insert into notifications/i,
  'activated source-level dispatch may reuse the metadata-only notification fan-out');
assert.doesNotMatch(api, /insert into messages|update\s+household_memberships|household_verification_codes/i,
  'household messaging must not overload direct chat messages, change membership, or touch verification credentials');
assert.doesNotMatch(api, /email|phone|contact/i,
  'target inventory and preview must not expose resident contact PII');

assert.match(app, /handleAdminHouseholdMessagingRequest/);
assert.ok(
  app.indexOf('handleAdminHouseholdMessagingRequest(request, env, id)') <
    app.indexOf('handleAdminRequest(request, env, id)'),
  'household messaging handler must intercept before the terminal admin fallback'
);

assert.match(adminBridge, /id: 'householdMessages'/);
assert.match(adminBridge, /requiredScope: 'household\.message\.manage'/);
assert.match(adminBridge, /household-messages\/targets/);
assert.match(adminBridge, /previewHouseholdMessageTargets/);
assert.match(adminBridge, /household-messages\/preview/);
assert.match(adminPage, /세대별 메시지/);
assert.match(adminPage, /대상 미리보기/);
assert.match(adminPage, /Production 발송은 별도 승인 후 활성화됩니다/);
assert.match(adminPage, /disabled=true/,
  'admin send control must remain disabled in this slice');

assert.match(notificationMigration, /create table if not exists notifications/i,
  'existing resident in-app notification infrastructure remains reusable for a later activated dispatch slice');
assert.doesNotMatch(notificationMigration, /body text|message_body/i,
  'existing notifications table must not be misrepresented as a message-body store');

console.log('PASS #756 household message target preview + send-disabled boundary');
