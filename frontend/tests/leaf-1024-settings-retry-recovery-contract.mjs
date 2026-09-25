import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// #1024: a transient GET /me/settings failure must not strand server-backed
// controls for the lifetime of the page. Retry must re-read authoritative
// server truth before any mutation becomes possible.

const FRONTEND = path.join(import.meta.dirname, '..');
const page = readFileSync(path.join(FRONTEND, '24_설정.html'), 'utf8');
const start = page.indexOf('<script id="danjion-settings-server">');
const end = page.indexOf('</script>', start);
assert.ok(start >= 0 && end > start, 'settings server wiring must exist');
const wiring = page.slice(start, end);

assert.match(wiring, /var settingsTruthBusy=false;/,
  'settings truth reload must have an in-flight guard');
assert.match(wiring, /function loadSettingsTruth\(\)/,
  'one shared settings truth loader must exist');
assert.equal((wiring.match(/bridge\.settings\(\)/g) || []).length, 1,
  'settings truth must be read through one shared loader rather than divergent reads');
assert.match(wiring, /if\(settingsTruthBusy\)return Promise\.resolve\(false\);/,
  'repeated retry taps must not multiply concurrent settings reads');
assert.match(wiring, /if\(r&&r\.ok&&r\.settings\)\{[\s\S]*applyServerSettings\(r\.settings\);[\s\S]*return true;/,
  'successful retry must apply authoritative server settings');
assert.match(wiring, /if\(r&&r\.mode==='auth-required'\)\{[\s\S]*로그인 후 다시 시도해 주세요/,
  'expired auth must remain fail-closed with truthful copy');
assert.match(wiring, /설정 상태를 불러오지 못했습니다\. 다시 눌러 재시도해 주세요\./,
  'transient failure must explicitly tell the user an in-page retry is available');
assert.match(wiring, /finally\(function\(\)\{settingsTruthBusy=false;\}\)/,
  'truth-loader busy state must always recover');

const applyServer = wiring.match(/function applyServerSettings\(settings\)\{([\s\S]*?)\n  \}/)?.[0] || '';
assert.ok(applyServer, 'server settings application helper must exist');
assert.match(applyServer, /supportedNotificationToggles\(\)[\s\S]*btn\.removeAttribute\('aria-disabled'\)/,
  'supported notification controls unlock only after server truth');
assert.match(applyServer, /publicProfileToggle\.removeAttribute\('aria-disabled'\)/,
  'public profile control unlocks only after server truth');

const notificationHandler = wiring.match(
  /if\(btn\.dataset\.settingSupport!=='supported'\)[\s\S]*?btn\.addEventListener\('click',function\(\)\{([\s\S]*?)\n    \}\);\n  \}\);/
)?.[0] || '';
assert.ok(notificationHandler, 'supported notification click handler must exist');
const notifRetry = notificationHandler.indexOf("if(btn.getAttribute('aria-disabled')==='true')");
const notifRead = notificationHandler.indexOf('loadSettingsTruth();', notifRetry);
const notifMutation = notificationHandler.indexOf('bridge.setConsent(');
assert.ok(notifRetry >= 0 && notifRead > notifRetry && notifMutation > notifRead,
  'disabled notification click must re-read truth before the mutation path');
assert.match(notificationHandler, /loadSettingsTruth\(\);[\s\S]*?return;/,
  'retry click must return without mutating on the same click');
assert.match(notificationHandler, /applySwitch\(btn,prev\)/,
  'notification mutation failure must restore the authoritative prior state');

assert.match(wiring, /toggle\.setAttribute\('aria-disabled','true'\)/,
  'public profile must start fail-closed but remain focusable/retryable');
assert.doesNotMatch(wiring, /toggle\.disabled=true/,
  'public profile must not use native disabled state that blocks retry clicks');
const profileHandler = wiring.match(
  /toggle\.addEventListener\('click',function\(\)\{([\s\S]*?)\n    \}\);/
)?.[0] || '';
assert.ok(profileHandler, 'public profile click handler must exist');
const profileRetry = profileHandler.indexOf("if(toggle.getAttribute('aria-disabled')==='true')");
const profileRead = profileHandler.indexOf('loadSettingsTruth();', profileRetry);
const profileMutation = profileHandler.indexOf('bridge.updateSetting(');
assert.ok(profileRetry >= 0 && profileRead > profileRetry && profileMutation > profileRead,
  'disabled public-profile click must re-read truth before mutation');
assert.match(profileHandler, /loadSettingsTruth\(\);[\s\S]*?return;/,
  'public-profile retry click must not also mutate');
assert.match(profileHandler, /var prev=toggle\.classList\.contains\('on'\)/,
  'public-profile mutation must retain the prior authoritative state');
assert.match(profileHandler, /applySwitch\(toggle,prev\)/,
  'public-profile mutation failure must restore prior state');

const unsupported = wiring.match(
  /if\(btn\.dataset\.settingSupport!=='supported'\)\{([\s\S]*?)\n      return;/
)?.[0] || '';
assert.ok(unsupported, 'unsupported notification branch must exist');
assert.match(unsupported, /아직 서버에서 저장하지 못하는 알림 설정입니다/,
  'unsupported notification settings must remain explicitly unavailable');
assert.doesNotMatch(unsupported, /loadSettingsTruth|setConsent/,
  'unsupported notification settings must not enter retry or mutation paths');

assert.match(wiring, /loadSettingsTruth\(\)\.catch\(function\(\)\{\}\);/,
  'authenticated hydration must attempt the initial authoritative read');

// Mutation-proof the key recoverability invariants.
const isRecoverable = source =>
  /function loadSettingsTruth\(\)/.test(source) &&
  /btn\.removeAttribute\('aria-disabled'\)/.test(source) &&
  /publicProfileToggle\.removeAttribute\('aria-disabled'\)/.test(source) &&
  /if\(btn\.getAttribute\('aria-disabled'\)==='true'\)\{\s*loadSettingsTruth\(\);\s*return;/.test(source) &&
  /if\(toggle\.getAttribute\('aria-disabled'\)==='true'\)\{\s*loadSettingsTruth\(\);\s*return;/.test(source) &&
  !/toggle\.disabled=true/.test(source);

const mutations = [
  ['notification-no-retry', wiring.replace("loadSettingsTruth();\n        return;\n      }\n      var consentType", "return;\n      }\n      var consentType")],
  ['profile-native-disabled', wiring.replace("toggle.setAttribute('aria-disabled','true');", "toggle.disabled=true;")],
  ['profile-no-unlock', wiring.replace("publicProfileToggle.removeAttribute('aria-disabled');", "/* mutated: stays locked */")]
];
for (const [name, mutated] of mutations) {
  assert.equal(isRecoverable(mutated), false, `mutation ${name} must be killed`);
}

console.log('PASS #1024 settings transient-read recovery contract');
console.log('SETTINGS_INITIAL_READ_TRANSIENT_FAILURE=RECOVERABLE');
console.log('SETTINGS_RETRY_RELOAD_REQUIRED=NO');
console.log('NOTIFICATION_SUPPORTED_TOGGLE_PERMA_DISABLED=NO');
console.log('PUBLIC_PROFILE_TOGGLE_PERMA_DISABLED=NO');
console.log('RETRY_READS_SERVER_TRUTH_BEFORE_MUTATION=YES');
console.log('AUTH_SESSION_EXPIRED_FAIL_CLOSED=YES');
console.log('MUTATION_FAILURE_RESTORES_PRIOR_STATE=YES');
console.log('UNSUPPORTED_NOTIFICATION_CONTROLS_UNCHANGED=YES');
