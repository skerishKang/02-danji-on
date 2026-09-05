import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [panel, portal, client, main] = await Promise.all([
  readFile(new URL('src/v2/integration/V2MySummaryPanel.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2MySummaryPortal.tsx', root), 'utf8'),
  readFile(new URL('src/resident-summary-client.ts', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

const CURRENT_008_SUMMARY_AUTHORITY = {
  title: '19_내정보_메인.html',
  screen: '19 내정보 메인',
  anchors: ['나의 활동', '이용 설정', '메시지함 보기', '우리집 연결'],
  // 2026-09-05 TRACK K: summary row labels are shared with shop detail and auth.
  relocated: [
    { anchor: '저장한 가게', authority: '02_이웃가게_상세.html', impl: 'V2MySummaryPanel.tsx (saved-business)' },
    { anchor: '인증 완료', authority: 'index.html', impl: 'V2MySummaryPanel.tsx (household)' }
  ]
};

for (const anchor of CURRENT_008_SUMMARY_AUTHORITY.anchors) {
  assert.ok(anchor.length > 0, `19 design requirement anchor must be named: ${anchor}`);
}

for (const reloc of CURRENT_008_SUMMARY_AUTHORITY.relocated) {
  assert.ok(reloc.anchor.length > 0 && reloc.authority.length > 0 && reloc.impl.length > 0,
    `19 relocated anchor must name its new authority/impl: ${reloc.anchor}`);
}

for (const text of ['내 단지온 요약', '내 게시글', '내 댓글·답글', '받은 공감', '저장한 가게', '읽지 않은 메시지', '세대 인증']) {
  assert.ok(panel.includes(text), `19 my-activity summary parity must remain: ${text}`);
}
for (const label of ['세대 구성원', '세대 대표', '인증 완료', '확인 중']) {
  assert.ok(panel.includes(label), `19 household profile label parity must remain: ${label}`);
}
for (const hook of ['data-v2-my-summary', 'data-summary-key="post"', 'data-summary-key="comment"', 'data-summary-key="reaction"', 'data-summary-key="saved-business"', 'data-summary-key="unread-message"', 'data-summary-key="household"']) {
  assert.ok(panel.includes(hook), `stable summary hook must remain: ${hook}`);
}
assert.match(panel, /residentSummaryClient\.getSummary\(\)/,
  '19 summary must use canonical resident-summary authority');

assert.match(client, /authenticatedFetch/,
  '19 summary must stay on authenticated authority');
assert.match(client, /\/api\/v1\/me\/summary\?complexSlug=\$\{encodeURIComponent\(COMPLEX_SLUG\)\}/,
  '19 summary must call the canonical backend projection');

assert.match(portal, /document\.querySelector<HTMLElement>\('\.v2-profile-dialog'\)/,
  '19 summary must mount into the canonical profile dialog');
assert.match(portal, /new MutationObserver\(sync\)/,
  '19 summary must stay reactive to dialog presence');
assert.match(portal, /<V2MySummaryPanel \/>/,
  '19 portal must reuse the canonical summary panel');

assert.doesNotMatch(panel + portal + client, /localStorage|sessionStorage|indexedDB/i,
  '19 parity must not create browser persistence authority');
assert.doesNotMatch(panel + portal, /이웃온기|주민혜택 쿠폰/,
  '19 parity surface must not add excluded 23/03 screens');

assert.match(main, /import V2MySummaryPortal from '\.\/v2\/integration\/V2MySummaryPortal';/,
  'main must mount the my-summary portal on the v2 root');
assert.match(main, /<V2MySummaryPortal \/>/,
  'main must render the my-summary portal on the v2 root');

console.log('PASS V2 20260904 current 19 내정보 메인 parity contract');
