import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #921: settings font-size preference must be a shared bootstrap, and the
// notification switches must write through the canonical settings/consent API
// with rollback — never localStorage-only fake persistence.

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

const [session, consistencyCss, settings, myinfo] = await Promise.all([
  read('assets/danjion-session.js'),
  read('assets/consistency.css'),
  read('24_설정.html'),
  read('19_내정보_메인.html')
]);

/* FONT_PREF shared bootstrap */
assert.ok(session.includes("FONT_SIZE_STORAGE_KEY = 'danjion-font-size'"),
  'danjion-session.js must own the font-size storage key');
assert.ok(session.includes('function applyFontSizePreference'),
  'danjion-session.js must expose applyFontSizePreference');
assert.ok(session.includes('function readFontSizePreference'),
  'danjion-session.js must expose readFontSizePreference');
assert.ok(session.includes('document.body.dataset.fontSize = size'),
  'shared bootstrap must set body[data-font-size]');
assert.ok(session.includes('bootFontSizePreference()'),
  'shared bootstrap must run on session load (before/at initial render)');
assert.ok(/DanjionSession[\s\S]*applyFontSizePreference/.test(session) &&
  session.includes('applyFontSizePreference,'),
  'applyFontSizePreference must be exported on DanjionSession');
console.log('FONT_PREF_SHARED_BOOTSTRAP=PASS');

/* FONT_PREF cross-page CSS application */
assert.ok(consistencyCss.includes('body[data-font-size="large"]'),
  'consistency.css must style large preference');
assert.ok(consistencyCss.includes('body[data-font-size="small"]'),
  'consistencyCss must style small preference');
assert.ok(/body\[data-font-size="large"\]\s+main\s*\{[^}]*zoom:/.test(consistencyCss),
  'large must measurably scale main content typography');
assert.ok(/body\[data-font-size="small"\]\s+main\s*\{[^}]*zoom:/.test(consistencyCss),
  'small must measurably scale main content typography');
assert.ok(consistencyCss.includes('mobile-bottom') === false ||
  /data-font-size[\s\S]{0,400}mobile-bottom/.test(consistencyCss) === true,
  'font-size rules must not rebind mobile-bottom geometry');
assert.ok(!/body\[data-font-size[^\]]*\]\s+\.mobile-bottom\s*\{[^}]*height/.test(consistencyCss),
  'fixed bottom-nav height must not be rewritten by font-size rules');
console.log('FONT_PREF_CROSS_PAGE_CSS=PASS');

/* Settings page uses shared path for font size */
assert.ok(settings.includes('DanjionSession.applyFontSizePreference'),
  'settings applyFontSize must use the shared DanjionSession bootstrap');
assert.ok(settings.includes("localStorage.getItem('danjion-font-size')") ||
  settings.includes('readFontSizePreference'),
  'settings must read the shared font-size preference');
assert.ok(!settings.includes("document.querySelectorAll('.toggle').forEach(button=>button.addEventListener('click',()=>{button.classList.toggle('on')"),
  'generic localStorage-free demo toggle handler must be removed from settings');
console.log('FONT_PREF_SETTINGS_WIRING=PASS');

/* Myinfo size control persists through shared path */
assert.ok(myinfo.includes('applyFontSizePreference'),
  '19 size control must write through the shared font-size preference');
console.log('FONT_PREF_CROSS_PAGE_WIRING=PASS');

/* Notification switches: explicit field mapping + canonical write + rollback */
const toggles = settings.match(/<button[^>]*data-notification-toggle[^>]*>/g) || [];
assert.ok(toggles.length >= 4, `expected >=4 notification toggles, got ${toggles.length}`);
const supported = toggles.filter((t) => t.includes('data-setting-support="supported"'));
const needsBackend = toggles.filter((t) => t.includes('data-setting-support="needs-backend"'));
assert.equal(supported.length, 1, 'exactly one switch maps to a server field (service_notifications)');
assert.equal(needsBackend.length, 3, 'three switches are classified needs-backend');
assert.ok(supported[0].includes('data-consent-type="service_notifications"'),
  'supported switch must name the explicit consent field');
console.log('NOTIFICATION_SWITCH_FIELD_MAP=PASS');

assert.ok(settings.includes('bridge.setConsent('),
  'supported notification switch must write via canonical consent API');
assert.ok(settings.includes("servicePolicyVersion||'service-notify-v1'") ||
  settings.includes('servicePolicyVersion'),
  'consent write must reuse/establish a policy version');
assert.ok(!/localStorage\.(setItem|getItem)\(['"]danjion[^'"]*notif/.test(settings) &&
  !/localStorage\.(setItem|getItem)\(['"]notification/.test(settings),
  'notification state must not be persisted in localStorage (LOCAL_ONLY_FAKE_PERSISTENCE=NO)');
assert.ok(settings.includes('applySwitch(btn,prev)'),
  'failed consent write must roll back optimistic UI');
assert.ok(settings.includes('role="switch"') && settings.includes('aria-checked'),
  'switches must keep role=switch and aria-checked');
assert.ok(settings.includes("setAttribute('aria-disabled','true')"),
  'unsupported switches must expose aria-disabled');
console.log('NOTIFICATION_SWITCH_WRITE_AND_ROLLBACK=PASS');

/* publicProfileEnabled path still present */
assert.ok(settings.includes("dataset.settingsKey='publicProfileEnabled'"),
  'publicProfileEnabled toggle must remain wired');
assert.ok(settings.includes('bridge.updateSetting('),
  'publicProfileEnabled must still PATCH /api/v1/me/settings');
console.log('SETTINGS_EXISTING_FIELDS_INTACT=PASS');

console.log('leaf-b921-settings-persistence-contract: PASS');
