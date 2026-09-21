import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #858 [Refs #787]: Bounded fix for 27_알림함.html -> 24_설정.html#notifications route.
// Verifies:
// 1) NOTIFICATION_SETTINGS_PRIMARY_ROUTE=PASS
// 2) NOTIFICATION_SETTINGS_SIDE_ROUTE=PASS
// 3) NOTIFICATION_SETTINGS_TARGET_EXISTS=PASS
// 4) NOTIFICATION_SETTINGS_DEMO_TOAST_REMOVED=PASS
// 5) Identical canonical target across both entries
// 6) Direct-router regression guards (27 back, 24 back, mobile nav, settings inquiry, hash preservation)

const page27 = await readFile(new URL('../27_알림함.html', import.meta.url), 'utf8');
const page24 = await readFile(new URL('../24_설정.html', import.meta.url), 'utf8');

const CANONICAL_TARGET = '24_설정.html#notifications';

// 1. Primary route entry in 27_알림함.html (.settings-link)
const primaryMatch = (page27.match(/<button[^>]*class="[^"]*settings-link[^"]*"[^>]*>[\s\S]*?<\/button>/) || [])[0];
assert.ok(primaryMatch, '27_알림함.html must contain .settings-link button');
assert.ok(
  primaryMatch.includes(`data-route="${CANONICAL_TARGET}"`) &&
  primaryMatch.includes(`location.href='${CANONICAL_TARGET}'`),
  `.settings-link must target canonical ${CANONICAL_TARGET}`
);
console.log('NOTIFICATION_SETTINGS_PRIMARY_ROUTE=PASS');

// 2. Side route entry in 27_알림함.html (.side-action)
const sideMatch = (page27.match(/<button[^>]*class="[^"]*side-action[^"]*"[^>]*>[\s\S]*?<\/button>/) || [])[0];
assert.ok(sideMatch, '27_알림함.html must contain .side-action button');
assert.ok(
  sideMatch.includes(`data-route="${CANONICAL_TARGET}"`) &&
  sideMatch.includes(`location.href='${CANONICAL_TARGET}'`),
  `.side-action must target canonical ${CANONICAL_TARGET}`
);
console.log('NOTIFICATION_SETTINGS_SIDE_ROUTE=PASS');

// 3. Parity: both entries use identical canonical target
const primaryRouteAttr = (primaryMatch.match(/data-route="([^"]+)"/) || [])[1];
const sideRouteAttr = (sideMatch.match(/data-route="([^"]+)"/) || [])[1];
assert.equal(primaryRouteAttr, CANONICAL_TARGET, 'primary route must be canonical target');
assert.equal(sideRouteAttr, CANONICAL_TARGET, 'side route must be canonical target');
assert.equal(primaryRouteAttr, sideRouteAttr, 'both notification settings entries must use identical canonical target');

// 4. Target exists in 24_설정.html
const targetMatch = (page24.match(/<article[^>]*id="notifications"[^>]*>[\s\S]*?<\/article>/) || [])[0];
assert.ok(targetMatch, '24_설정.html must contain article with id="notifications"');
assert.ok(
  targetMatch.includes('NOTIFICATIONS') && targetMatch.includes('알림 설정'),
  'target element id="notifications" must enclose the NOTIFICATIONS / 알림 설정 panel'
);
console.log('NOTIFICATION_SETTINGS_TARGET_EXISTS=PASS');

// 5. Demo toast attributes removed
assert.ok(!primaryMatch.includes('data-demo'), '.settings-link must not have data-demo attribute');
assert.ok(!sideMatch.includes('data-demo'), '.side-action must not have data-demo attribute');
assert.ok(!page27.includes('STEP 24 알림 설정 화면으로 연결합니다.'), 'legacy STEP 24 toast copy must be removed');
assert.ok(!page27.includes('알림 설정으로 이동합니다.'), 'legacy demo toast copy must be removed');
console.log('NOTIFICATION_SETTINGS_DEMO_TOAST_REMOVED=PASS');

// 6. Router regression checks
// 27 -> 내정보 back
assert.ok(page27.includes('notifications:FILES.my'), '27 router parentMap must map notifications to FILES.my');
assert.ok(page27.includes('class="back"'), '27 must have back button');

// 24 -> 내정보 back
assert.ok(page24.includes("location.href='19_내정보_메인.html'"), '24 must have back button routing to 19_내정보_메인.html');
assert.ok(page24.includes('settings:FILES.my'), '24 router parentMap must map settings to FILES.my');

// Mobile nav intact
assert.ok(page27.includes('data-route="04_데일리홈.html"'), '27 mobile nav must contain home route');
assert.ok(page27.includes('data-route="19_내정보_메인.html"'), '27 mobile nav must contain myinfo route');
assert.ok(page24.includes('data-route="04_데일리홈.html"'), '24 mobile nav must contain home route');
assert.ok(page24.includes('data-route="19_내정보_메인.html"'), '24 mobile nav must contain myinfo route');

// Settings -> 1:1 문의 intact
assert.ok(page24.includes('data-settings-target="inquiry"'), '24 settings must preserve 1:1 inquiry target button');
assert.ok(page24.includes('inquiry:FILES.settings'), '24 router parentMap must preserve inquiry to settings link');

// Direct router preserves hash in routeFrom
const router27 = (page27.match(/<script id="danjion-direct-router-v5">([\s\S]*?)<\/script>/) || [])[1] || '';
assert.ok(router27.includes("const h=v&&v.includes('#')?'#'+v.split('#').slice(1).join('#'):'';"), '27 router must preserve hash');
assert.ok(router27.includes('return f+q+h;'), '27 router must append hash to resolved file path');

const router24 = (page24.match(/<script id="danjion-direct-router-v5">([\s\S]*?)<\/script>/) || [])[1] || '';
assert.ok(router24.includes("const h=v&&v.includes('#')?'#'+v.split('#').slice(1).join('#'):'';"), '24 router must preserve hash');
assert.ok(router24.includes('return f+q+h;'), '24 router must append hash to resolved file path');

// 24 restoreSettingsScroll handles #notifications hash
assert.ok(page24.includes("if(location.hash==='#notifications')"), '24 restoreSettingsScroll must handle #notifications scroll');

console.log('ROUTER_REGRESSION=PASS');
console.log('leaf-b858-notification-settings-route-contract: PASS');
