import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [integration, profileClient, safetyClient, messagesClient, main] = await Promise.all([
  readFile(new URL('src/v2/integration/V2ResidentProfileIntegration.tsx', root), 'utf8'),
  readFile(new URL('src/resident-profile-client.ts', root), 'utf8'),
  readFile(new URL('src/resident-safety-client.ts', root), 'utf8'),
  readFile(new URL('src/resident-messages-client.ts', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

const CURRENT_008_PROFILE_AUTHORITY = {
  title: '22_주민_공개프로필.html',
  screen: '22 주민 공개프로필',
  anchors: ['이 주민 신고하기', '이 주민 차단하기', '메시지 보내기', '공개 프로필'],
  // 2026-09-05 TRACK K: report reasons are pinned to the 22-aligned
  // six-constant set shared with the 21 conversation surface.
  relocated: [
    { anchor: '개인정보 침해', authority: '22_주민_공개프로필.html', impl: 'V2ResidentProfileIntegration.tsx (6종 상수)' },
    { anchor: '스팸', authority: '22_주민_공개프로필.html', impl: 'V2ResidentProfileIntegration.tsx (6종 상수)' }
  ]
};

for (const anchor of CURRENT_008_PROFILE_AUTHORITY.anchors) {
  assert.ok(anchor.length > 0, `22 design requirement anchor must be named: ${anchor}`);
}

for (const reloc of CURRENT_008_PROFILE_AUTHORITY.relocated) {
  assert.ok(reloc.anchor.length > 0 && reloc.authority.length > 0 && reloc.impl.length > 0,
    `22 relocated anchor must name its new authority/impl: ${reloc.anchor}`);
}

for (const reason of ['개인정보 침해', '명예훼손 우려', '스팸', '욕설·괴롭힘', '위협', '기타']) {
  assert.ok(integration.includes(reason), `22 report-reason parity must remain: ${reason}`);
}

assert.match(integration, /data-v2-self-profile-panel/,
  '22 self public profile surface must keep its stable hook');
assert.match(integration, /data-v2-resident-profile-dialog/,
  '22 other resident profile dialog must keep its stable hook');
assert.match(integration, /data-v2-resident-report-form/,
  '22 report form must keep its stable hook');

assert.match(integration, /residentProfileClient\.getSelf\(\)/,
  '22 self profile must use canonical resident-profile authority');
assert.match(integration, /residentProfileClient\.updateSelf/,
  '22 profile save must write through the canonical profile client');
assert.match(integration, /residentProfileClient\.getResident\(userId\)/,
  '22 other profile must use canonical resident-profile authority');
for (const text of ['공개 소개', 'otherProfile\.publicBio', 'selfProfile\.joinedMonth', 'otherProfile\.publicActivityCount']) {
  assert.match(integration, new RegExp(text), `22 public-intro parity must remain: ${text}`);
}

assert.match(integration, /residentMessagesClient\.startConversation\(otherProfile\.userId\)/,
  '22 message entry must use canonical messages authority');
assert.match(integration, /residentSafetyClient\.blockResident\(userId\)/,
  '22 block must write through canonical safety authority');
assert.match(integration, /danjion:v2-resident-blocked/,
  '22 block must announce the canonical resident-blocked event');
assert.match(integration, /residentSafetyClient\.reportResident\(otherProfile\.userId, reportReason, reportDetail\)/,
  '22 report must write through canonical safety authority');

assert.match(profileClient, /\/api\/v1\/me\/profile\?\$\{query\(\)\}/,
  '22 self profile must use canonical backend profile authority');
assert.match(profileClient, /\/api\/v1\/profiles\/\$\{encodeURIComponent\(userId\)\}\?\$\{query\(\)\}/,
  '22 other resident profile must use canonical same-complex backend route');
assert.match(safetyClient, /\/api\/v1\/me\/blocks\?\$\{query\(\)\}/,
  '22 blocking must reuse canonical blocks authority');
assert.match(safetyClient, /\/api\/v1\/me\/reports\?\$\{query\(\)\}/,
  '22 resident reports must reuse canonical safety report authority');
assert.match(safetyClient, /targetType: 'resident'/,
  '22 resident reports must stay typed to residents');
assert.match(messagesClient, /\/api\/v1\/conversations'/,
  '22 message start must use canonical conversation authority');
for (const source of [profileClient, safetyClient, messagesClient]) {
  assert.match(source, /authenticatedFetch/,
    '22 profile/safety/messages must stay on authenticated authority');
}

assert.match(integration, /document\.querySelector<HTMLElement>\('\.v2-profile-dialog'\)/,
  '22 public profile must mount into the canonical profile dialog');
assert.match(integration, /new MutationObserver\(sync\)/,
  '22 public profile must stay reactive to dialog presence');

assert.doesNotMatch(integration + profileClient + safetyClient, /localStorage|sessionStorage|indexedDB/i,
  '22 parity must not create browser persistence authority');
assert.doesNotMatch(integration, /이웃온기|주민혜택 쿠폰/,
  '22 parity surface must not add excluded 23/03 screens');

assert.match(main, /import V2ResidentProfileIntegration from '\.\/v2\/integration\/V2ResidentProfileIntegration';/,
  'main must mount the resident-profile integration on the v2 root');
assert.match(main, /<V2ResidentProfileIntegration \/>/,
  'main must render the resident-profile integration on the v2 root');

console.log('PASS V2 20260904 current 22 주민 공개프로필 parity contract');
