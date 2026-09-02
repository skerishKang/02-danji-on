import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, settings, profile, lifecycle, app] = await Promise.all([
  readFile(new URL('migrations/033_resident_settings.sql', root), 'utf8'),
  readFile(new URL('src/resident-settings-v1.ts', root), 'utf8'),
  readFile(new URL('src/resident-profile-v1.ts', root), 'utf8'),
  readFile(new URL('src/account-lifecycle-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8')
]);

assert.match(migration, /'service_notifications'/);
assert.match(migration, /'benefit_marketing'/);
assert.match(migration, /add column if not exists is_discoverable boolean not null default true/i);
assert.doesNotMatch(migration, /create table/i,
  'settings migration must reuse canonical consent/profile tables instead of creating a second preferences authority');

assert.match(lifecycle, /'service_notifications'/);
assert.match(lifecycle, /'benefit_marketing'/);
assert.match(lifecycle, /insert into consent_records/,
  'notification choices must continue using canonical versioned consent records');

assert.match(settings, /\/api\/v1\/me\/settings/);
assert.match(settings, /requireVerifiedResident\(/,
  'settings are resident-only');
assert.match(settings, /consent_type in \('service_notifications','benefit_marketing'\)/,
  'settings read projection must reuse canonical consent rows');
assert.match(settings, /Only publicProfileEnabled may be patched here/,
  'settings PATCH must not invent policy versions for notification consent');
assert.match(settings, /fontSizeStorage: 'device'/,
  'font size remains device-local per handoff instead of inventing a server enum');
assert.doesNotMatch(settings, /marketing_enabled|service_notifications_enabled|benefit_marketing_enabled/i,
  'settings runtime must not create duplicate consent boolean authorities');

assert.match(profile, /coalesce\(p\.is_discoverable, true\) as is_discoverable/,
  'profile loader must read the canonical visibility preference');
assert.match(profile, /!isSelf && row\.is_discoverable !== true/,
  'cross-resident profile reads must fail closed after opt-out');
assert.match(profile, /const isSelf = targetUserId === viewer\.id\.toLowerCase\(\)/,
  'self profile access must remain distinguishable from cross-resident access');
assert.doesNotMatch(profile, /isDiscoverable|is_discoverable.*presentProfile/s,
  'public profile response must not expose the privacy-control flag itself');

assert.match(app, /handleResidentSettingsRequest/);
assert.match(app, /const residentSettingsResponse = await handleResidentSettingsRequest\(request, env, id\)/);

console.log('PASS resident settings canonical consent/profile visibility contract');
