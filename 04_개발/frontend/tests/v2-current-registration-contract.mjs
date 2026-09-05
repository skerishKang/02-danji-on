import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [flows, app, integrated, share, reviews, main] = await Promise.all([
  readFile(new URL('src/v2/flows/V2ProductFlows.tsx', root), 'utf8'),
  readFile(new URL('src/v2/V2App.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2IntegratedApp.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2BusinessShareIntegration.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2BusinessReviewsIntegration.tsx', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

const CURRENT_008_REGISTRATION_AUTHORITY = {
  title: '25A_신청제보.html',
  screen: '25A 신청제보',
  anchors: ['가게등록', '제보', '확인서류', '가게사진']
};

for (const anchor of CURRENT_008_REGISTRATION_AUTHORITY.anchors) {
  assert.ok(anchor.length > 0, `25A design requirement anchor must be named: ${anchor}`);
}

assert.match(flows, /stepTitles = \['주민 관계', '하는 일', '사진과 혜택', '공개 경계 확인'\]/,
  '25A registration must keep the four-step parity surface');
for (const label of ['내가 직접 운영', '주민 가족이 운영', '이웃 단지 주민 운영', '우리 동네 가게']) {
  assert.ok(flows.includes(label), `25A registration/recommendation split must remain: ${label}`);
}
assert.match(flows, /storageAdapter\.upload\('business-image', file\)/,
  '25A shop photo must keep canonical StorageAdapter business-image policy');
assert.match(flows, /대표 이미지 선택/,
  '25A shop photo upload surface must remain');
assert.match(flows, /운영 확인 · 공개하지 않음/,
  '25A verification docs must stay out of the public surface');
assert.match(flows, /동·호수\/증빙/,
  '25A address/proof must remain a private boundary');

assert.match(app, /import \{[\s\S]*V2RegistrationFlow[\s\S]*\} from '\.\/flows\/V2ProductFlows';/,
  'V2App must reuse the product-flow registration surface');
assert.match(app, /<V2RegistrationFlow/,
  'V2App must render the registration flow');
assert.match(app, /dataAdapter\.createBusinessApplication\(input\)/,
  '25A owner registration must submit via canonical application authority');
assert.match(app, /dataAdapter\.resubmitBusinessApplication\(/,
  '25A resubmit must stay on canonical application authority');

assert.match(integrated, /v2-registration-dialog/,
  'integrated shell must keep the 25A registration dialog');
assert.match(integrated, /STEP \{registrationStep\} \/ 4/,
  'integrated 25A must keep four registration steps');
assert.match(integrated, /현재 단지 주민 직접 운영 · 내 가게 등록/,
  'integrated relation split must remain');
assert.match(integrated, /등록 검토 요청/,
  'integrated owner registration action must remain');
assert.match(integrated, /이웃가게 추천 접수/,
  'integrated recommendation action must remain');
assert.match(integrated, /대표 이미지/,
  'integrated 25A must keep the shop photo upload');

assert.match(share, /\.v2-integrated-shop-card\[data-shop-id\]/,
  '25A share must target integrated shop cards');
assert.match(share, /\.v2-detail-dialog\[data-shop-id\]/,
  '25A share must target integrated shop detail');
assert.match(share, /dataAdapter\.getBusinessShare\(businessId\)/,
  '25A share must use canonical business-share authority');
assert.match(share, /dataAdapter\.resolveBusinessShare\(/,
  '25A shared-link reopen must use canonical resolution');
assert.match(share, /data-v2-share-action/,
  '25A share must expose a stable integration hook');
assert.match(share, /공유 링크 복사/,
  '25A share interaction must remain');

assert.match(reviews, /\.v2-integrated-shop-card\[data-shop-id\]/,
  '25A reviews must capture integrated shop-card clicks');
assert.match(reviews, /businessReviewsClient\.list\(id\)/,
  '25A reviews must use canonical business-reviews authority');
assert.match(reviews, /businessReviewsClient\.create\(businessId, body\)/,
  '25A review create must use canonical business-reviews authority');
assert.match(reviews, /businessReviewsClient\.upsertOwnerReply\(/,
  '25A owner replies must stay on canonical authority');
assert.match(reviews, /입주민 후기/,
  '25A review surface title must remain');
assert.match(reviews, /후기 등록/,
  '25A review submission interaction must remain');
assert.match(reviews, /data-v2-business-reviews/,
  '25A reviews must expose a stable integration hook');

assert.doesNotMatch(flows + integrated, /localStorage|sessionStorage|indexedDB/i,
  '25A parity must not create browser persistence authority');
assert.doesNotMatch(flows + integrated, /이웃온기|주민혜택 쿠폰/,
  '25A parity surface must not add excluded 23/03 screens');

assert.match(main, /import V2BusinessShareIntegration from '\.\/v2\/integration\/V2BusinessShareIntegration';/,
  'main must mount the business-share integration on the v2 root');
assert.match(main, /import V2BusinessReviewsIntegration from '\.\/v2\/integration\/V2BusinessReviewsIntegration';/,
  'main must mount the business-reviews integration on the v2 root');

console.log('PASS V2 20260904 current 25A 신청제보 parity contract');
