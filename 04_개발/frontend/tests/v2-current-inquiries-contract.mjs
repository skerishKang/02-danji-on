import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [portal, client, main] = await Promise.all([
  readFile(new URL('src/v2/integration/V2InquiriesPortal.tsx', root), 'utf8'),
  readFile(new URL('src/resident-inquiries-client.ts', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

const CURRENT_008_INQUIRIES_AUTHORITY = {
  title: '25_1대1문의.html',
  screen: '25 1:1문의',
  anchors: ['내문의']
};

for (const anchor of CURRENT_008_INQUIRIES_AUTHORITY.anchors) {
  assert.ok(anchor.length > 0, `25 design requirement anchor must be named: ${anchor}`);
}

assert.match(portal, /residentInquiriesClient\.list\(\)/,
  '25 list must use canonical inquiries authority');
assert.match(portal, /residentInquiriesClient\.create\(/,
  '25 create must use canonical inquiries authority');
assert.match(portal, /residentInquiriesClient\.get\(id\)/,
  '25 detail must use canonical inquiries authority');
assert.match(portal, /residentInquiriesClient\.close\(/,
  '25 closure must use canonical inquiries authority');
assert.match(portal, /createPortal\([\s\S]*document\.body/,
  '25 detail dialog must portal to the document body');
for (const text of ['문의 유형', '제목', '내용', '문의 접수', '새로고침', '내용 보기', '아직 접수한 문의가 없습니다.']) {
  assert.ok(portal.includes(text), `25 inquiry form/list parity must remain: ${text}`);
}
for (const label of ['접수됨', '처리 중', '답변 완료', '종료']) {
  assert.ok(portal.includes(label), `25 status labels must remain: ${label}`);
}
assert.match(portal, /사진 첨부는 운영 기준 확정 후 지원됩니다\./,
  '25 photo-upload boundary must stay explicit');
assert.match(portal, /RESIDENT INQUIRY/,
  '25 detail authority eyebrow must remain');
assert.match(portal, /아직 등록된 답변이 없습니다\./,
  '25 unanswered boundary must remain explicit');
assert.match(portal, /답변 확인 후 종료/,
  '25 answered-close interaction must remain');
assert.match(client, /authenticatedFetch/,
  '25 must stay on authenticated authority');

for (const hook of [
  'data-v2-inquiries-panel',
  'data-v2-inquiry-list',
  'data-v2-inquiry-item',
  'data-v2-inquiry-form',
  'data-v2-inquiry-status',
  'data-v2-inquiry-dialog',
  'data-v2-inquiry-backdrop'
]) {
  assert.ok(portal.includes(hook), `stable inquiries hook must remain: ${hook}`);
}

assert.doesNotMatch(portal, /localStorage|sessionStorage|indexedDB/i,
  '25 parity must not create browser persistence authority');
assert.doesNotMatch(portal, /이웃온기|주민혜택 쿠폰/,
  '25 parity surface must not add excluded 23/03 screens');

assert.match(main, /import V2InquiriesPortal from '\.\/v2\/integration\/V2InquiriesPortal';/,
  'main must mount the inquiries portal on the v2 root');

console.log('PASS V2 20260904 current 25 1:1문의 parity contract');
