import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [panel, portal, main] = await Promise.all([
  readFile(new URL('src/v2/integration/V2ActivityPanel.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2ActivityPortal.tsx', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

const CURRENT_008_ACTIVITY_AUTHORITY = {
  title: '28_나의활동.html',
  screen: '28 나의활동',
  anchors: ['나의활동'],
  // 2026-09-05 TRACK K: type/state labels are shared with the public profile.
  relocated: [
    { anchor: '게시글', authority: '22_주민_공개프로필.html', impl: 'V2ActivityPanel.tsx' },
    { anchor: '숨김', authority: '28_나의활동.html', impl: 'V2ActivityPanel.tsx' }
  ]
};

for (const anchor of CURRENT_008_ACTIVITY_AUTHORITY.anchors) {
  assert.ok(anchor.length > 0, `28 design requirement anchor must be named: ${anchor}`);
}

for (const reloc of CURRENT_008_ACTIVITY_AUTHORITY.relocated) {
  assert.ok(reloc.anchor.length > 0 && reloc.authority.length > 0 && reloc.impl.length > 0,
    `28 relocated anchor must name its new authority/impl: ${reloc.anchor}`);
}

assert.ok(panel.includes('나의 활동'), '28 panel title parity must remain');
for (const label of ['게시글', '댓글', '답글', '공감', '후기']) {
  assert.ok(panel.includes(label), `28 activity type labels must remain: ${label}`);
}
for (const text of ['삭제됨', '숨김', '기록됨', '숨김 또는 삭제된 활동', '아직 남긴 활동이 없습니다.', '활동 더 보기', '불러오는 중…']) {
  assert.ok(panel.includes(text), `28 activity surface copy must remain: ${text}`);
}
assert.match(panel, /dataAdapter\.listMyActivity\(\{ type: 'all', limit: 5 \}\)/,
  '28 list must use canonical activity authority');
assert.match(panel, /cursor: nextCursor/,
  '28 pagination must stay cursor-based');
assert.match(panel, /data-v2-profile-activity/,
  '28 panel must expose a stable browser-test selector');
assert.match(panel, /data-activity-type=\{item\.type\}/,
  '28 activity rows must expose stable type selectors');

assert.doesNotMatch(panel, /localStorage|sessionStorage|indexedDB/i,
  '28 parity must not create browser persistence authority');
assert.doesNotMatch(panel, /이웃온기|주민혜택 쿠폰/,
  '28 parity surface must not add excluded 23/03 screens');

assert.match(portal, /<V2ActivityPanel \/>/,
  '28 portal must reuse the canonical activity panel');
assert.match(portal, /'\.v2-profile-dialog'/,
  '28 panel must mount into the canonical profile dialog');

assert.match(main, /import V2ActivityPortal from '\.\/v2\/integration\/V2ActivityPortal';/,
  'main must mount the activity portal on the v2 root');

console.log('PASS V2 20260904 current 28 나의활동 parity contract');
