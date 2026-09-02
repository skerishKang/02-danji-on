import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [client, panel, portal, main] = await Promise.all([
  readFile(new URL('src/resident-settings-client.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2SettingsPanel.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2SettingsPortal.tsx', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

assert.match(client, /export type ResidentSettings/);
assert.match(client, /\/api\/v1\/me\/settings\?\$\{query\}/,
  'API settings client must use canonical resident settings route');
assert.match(client, /authenticatedFetch\(/,
  'API settings must use the authenticated resident session');
assert.match(client, /method: 'PATCH'/);
assert.match(client, /JSON\.stringify\(\{ publicProfileEnabled: enabled \}\)/,
  'settings client may mutate only public profile visibility');
assert.doesNotMatch(client, /localStorage|sessionStorage|indexedDB/i,
  'server-owned settings must never be reconstructed from browser persistence');
assert.doesNotMatch(client, /consentType|policyVersion.*PATCH/s,
  'settings client must not fabricate versioned consent mutations');

assert.match(panel, /data-v2-settings-panel/);
assert.match(panel, /residentSettingsClient\.get\(\)/,
  'panel must load settings from typed settings authority');
assert.match(panel, /residentSettingsClient\.setPublicProfileEnabled/,
  'public profile toggle must round-trip through settings authority');
assert.match(panel, /서비스 알림/);
assert.match(panel, /혜택·이벤트 알림/);
assert.match(panel, /정책 버전이 확인되는 약관 동의 화면에서 처리/,
  'notification changes must remain gated on explicit legal-policy versioning');
assert.match(panel, /이 기기의 접근성 설정을 따릅니다/,
  'font size must remain device-local as reconciled');
assert.doesNotMatch(panel, /localStorage|sessionStorage|consent_records|\/api\/v1\/me\/consents/,
  'presentation layer must not create a second settings or consent authority');

assert.match(portal, /\.v2-profile-dialog/,
  'settings must be scoped to the existing V2 My dialog');
assert.match(portal, /createPortal\(<V2SettingsPanel \/>, target\)/);
assert.match(main, /V2SettingsPortal/);
assert.match(main, /v2=\{<>[\s\S]*<V2IntegratedApp \/>[\s\S]*<V2SettingsPortal \/>[\s\S]*<\/\>\}/,
  'settings portal must mount only in the V2 surface');

console.log('PASS V2 resident settings backend-authority/privacy contract');
