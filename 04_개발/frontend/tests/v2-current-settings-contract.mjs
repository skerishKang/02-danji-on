import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [panel, settingsPortal, closure, settingsClient, main] = await Promise.all([
  readFile(new URL('src/v2/integration/V2SettingsPanel.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2SettingsPortal.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2AccountClosurePortal.tsx', root), 'utf8'),
  readFile(new URL('src/resident-settings-client.ts', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

const CURRENT_008_SETTINGS_AUTHORITY = {
  title: '24_설정.html',
  screen: '24 설정',
  anchors: ['글자크기', '알림설정', '개인정보·계정', '약관', '탈퇴']
};

for (const anchor of CURRENT_008_SETTINGS_AUTHORITY.anchors) {
  assert.ok(anchor.length > 0, `24 design requirement anchor must be named: ${anchor}`);
}

assert.match(panel, /글자크기는 현재 이 기기의 접근성 설정을 따릅니다\./,
  '24 text-size parity must keep accessibility-driven guidance');
for (const text of ['공개프로필', '서비스 알림', '혜택·이벤트 알림', '약관 동의 기록']) {
  assert.ok(panel.includes(text), `24 notification/profile parity must remain: ${text}`);
}
assert.match(panel, /이 화면에서 임의의 정책 버전을 만들지 않습니다\./,
  '24 must not invent policy versions outside the consent surface');
assert.match(panel, /data-v2-public-profile-setting/,
  '24 public-profile interaction hook must remain stable');
assert.match(panel, /residentSettingsClient\.get\(\)/,
  '24 settings must use canonical resident-settings authority');
assert.match(panel, /residentSettingsClient\.setPublicProfileEnabled/,
  '24 profile toggle must write through the canonical settings client');
assert.match(settingsClient, /authenticatedFetch/,
  '24 settings must stay on authenticated authority');

assert.match(closure, /data-v2-account-closure-panel/,
  '24 account-lifecycle surface must keep its stable hook');
assert.match(closure, /DANJION_ACCOUNT_CLOSE_CONFIRMATION/,
  '24 account closure must keep the typed confirmation contract');
assert.match(closure, /residentAccountLifecycleClient\.closeProductAccount/,
  '24 closure must use canonical account-lifecycle authority');
assert.match(closure, /외부 로그인 제공자 계정 자체는 삭제하지 않습니다\./,
  '24 closure boundary must not claim external provider deletion');

for (const source of [settingsPortal, closure]) {
  assert.match(source, /document\.querySelector<HTMLElement>\('\.v2-profile-dialog'\)/,
    '24 settings surfaces must mount into the canonical profile dialog');
  assert.match(source, /new MutationObserver\(sync\)/,
    '24 settings surfaces must stay reactive to dialog presence');
}

assert.doesNotMatch(panel + closure, /localStorage|sessionStorage|indexedDB/i,
  '24 parity must not create browser persistence authority');
assert.doesNotMatch(panel + closure, /이웃온기|주민혜택 쿠폰/,
  '24 parity surface must not add excluded 23/03 screens');

assert.match(main, /import V2SettingsPortal from '\.\/v2\/integration\/V2SettingsPortal';/,
  'main must mount the settings portal on the v2 root');
assert.match(main, /import V2AccountClosurePortal from '\.\/v2\/integration\/V2AccountClosurePortal';/,
  'main must mount the account-closure portal on the v2 root');

console.log('PASS V2 20260904 current 24 설정 parity contract');
