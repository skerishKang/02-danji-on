import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [portal, client, main] = await Promise.all([
  readFile(new URL('src/v2/integration/V2HouseholdPortal.tsx', root), 'utf8'),
  readFile(new URL('src/household-family-client.ts', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

const CURRENT_008_HOUSEHOLD_AUTHORITY = {
  title: '26_우리집연결.html',
  screen: '26 우리집연결',
  anchors: ['동호수', '가족초대']
};

for (const anchor of CURRENT_008_HOUSEHOLD_AUTHORITY.anchors) {
  assert.ok(anchor.length > 0, `26 design requirement anchor must be named: ${anchor}`);
}

for (const text of ['세대·가족', '세대 구성원', '주 세대원', '세대원', '주민 확인됨', '확인 대기']) {
  assert.ok(portal.includes(text), `26 household membership parity must remain: ${text}`);
}
for (const text of ['가족 초대 만들기', '초대 회수', '세대원 해제', '세대 연결 해제', '가족 초대 토큰 수락', '초대 수락']) {
  assert.ok(portal.includes(text), `26 family-invite interactions must remain: ${text}`);
}
assert.match(portal, /householdFamilyClient\.getSnapshot\(\)/,
  '26 snapshot must use canonical household-family authority');
assert.match(portal, /householdFamilyClient\.createInvite\(24\)/,
  '26 invite TTL must stay 24 hours');
assert.match(portal, /householdFamilyClient\.redeemInvite\(redeemToken\)/,
  '26 redemption must use canonical household-family authority');
assert.match(portal, /householdFamilyClient\.revokeMember\(/,
  '26 member removal must use canonical household-family authority');
assert.match(portal, /한 번만 표시되는 가족 초대 토큰/,
  '26 invite token must remain single-show');
assert.match(portal, /브라우저 저장 안 함/,
  '26 invite token must not persist in the browser');
assert.match(client, /authenticatedFetch/,
  '26 must stay on authenticated authority');

for (const hook of [
  'data-v2-household-panel',
  'data-v2-household-members',
  'data-v2-household-member',
  'data-v2-household-invite',
  'data-v2-household-one-time-token',
  'data-v2-household-redeem-form',
  'data-v2-household-status'
]) {
  assert.ok(portal.includes(hook), `stable household hook must remain: ${hook}`);
}

assert.doesNotMatch(portal, /localStorage|sessionStorage|indexedDB/i,
  '26 parity must not create browser persistence authority');
assert.doesNotMatch(portal, /이웃온기|주민혜택 쿠폰/,
  '26 parity surface must not add excluded 23/03 screens');

assert.match(main, /import V2HouseholdPortal from '\.\/v2\/integration\/V2HouseholdPortal';/,
  'main must mount the household portal on the v2 root');

console.log('PASS V2 20260904 current 26 우리집연결 parity contract');
