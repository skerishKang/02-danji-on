import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [surfaces, app, visualEntry, share, reviews] = await Promise.all([
  readFile(new URL('src/v2/visual/V2CurrentShopSurfaces.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2IntegratedApp.tsx', root), 'utf8'),
  readFile(new URL('src/v2/v2-visual.css', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2BusinessShareIntegration.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2BusinessReviewsIntegration.tsx', root), 'utf8')
]);

const CURRENT_008_SHOP_AUTHORITY = {
  discovery: {
    title: '01_이웃가게_발견.html',
    driveFileId: '1kQb6-xc9HO4sNYY4wcszq-E1xUnxpVox'
  },
  detail: {
    title: '02_이웃가게_상세.html',
    driveFileId: '1Olpb5HoguA98H1hdpTxeMF7P5pK39zNE'
  }
};

assert.equal(CURRENT_008_SHOP_AUTHORITY.discovery.driveFileId, '1kQb6-xc9HO4sNYY4wcszq-E1xUnxpVox');
assert.equal(CURRENT_008_SHOP_AUTHORITY.detail.driveFileId, '1Olpb5HoguA98H1hdpTxeMF7P5pK39zNE');

assert.match(surfaces, /가까이 사는<br \/>이웃의 일을 발견합니다\./,
  '01 current authority heading must remain the discovery heading');
assert.match(surfaces, /placeholder="무슨 일이 필요하세요\?"/,
  '01 current authority search placeholder must remain visible');
assert.match(surfaces, /v2-008-discovery-stage/,
  '01 current authority must preserve featured + side discovery geometry');
assert.match(surfaces, /v2-008-catalog/,
  '01 current authority must preserve the catalog continuation');
assert.match(surfaces, /V2FilterBar/,
  'current discovery must reuse canonical category/relation filter semantics');
assert.match(surfaces, /className={`v2-integrated-shop-card/,
  'current discovery cards must preserve canonical business selector hooks');
assert.match(surfaces, />상세보기<\/button>/,
  'current discovery must preserve the stable canonical detail action text');

for (const label of ['정보', '품목·서비스', '소식', '혜택', '후기']) {
  assert.ok(surfaces.includes(`label: '${label}'`), `02 detail must retain ${label} tab`);
}
assert.match(surfaces, /data-v2-detail-share-slot/,
  '02 current detail must expose the existing stable-share integration slot');
assert.match(surfaces, /data-v2-business-reviews-slot/,
  '02 current detail must expose the existing reviews lifecycle slot');
assert.match(surfaces, /onRevealContacts/,
  '02 current detail must delegate contact reveal to the existing authority callback');
assert.match(surfaces, /정확한 연락처는 기존 주민·세션 권한 확인 후 안내합니다\./,
  '02 current detail must keep private contact fields fail-closed');
assert.doesNotMatch(surfaces, /localStorage|sessionStorage|indexedDB/i,
  '01/02 parity surface must not create browser-storage authority');

assert.match(app, /V2CurrentShopDiscovery/,
  'the live V2 integration owner must render the current 01 discovery surface');
assert.match(app, /V2CurrentShopDetail/,
  'the live V2 integration owner must render the current 02 detail surface');
assert.match(app, /shops=\{visibleShops\}/,
  '01 parity must use the existing canonical filtered business collection');
assert.match(app, /onToggleSave=\{\(shop\) => void toggleSave\(shop\)\}/,
  '01/02 save affordances must reuse existing bookmark persistence');
assert.match(app, /contacts=\{contacts\.map\(contactLabel\)\}/,
  '02 detail must expose only contacts returned by the existing gated contact flow');
assert.match(app, /onRevealContacts=\{\(\) => void revealContacts\(\)\}/,
  '02 detail must reuse existing server/session contact reveal');

assert.match(share, /data-v2-detail-share-slot/,
  'stable share integration must mount in the current 02 header slot');
assert.match(share, /dataAdapter\.getBusinessShare\(businessId\)/,
  'detail sharing must continue to use the backend-issued share authority');
assert.match(share, /dataAdapter\.resolveBusinessShare\(shareSlug!\)/,
  'incoming share links must continue to resolve through backend authority');
assert.doesNotMatch(share, /localStorage|sessionStorage/,
  'share integration must not create local browser authority');

assert.match(reviews, /data-v2-business-reviews-slot/,
  'review integration must mount inside the active 02 후기 tab');
assert.match(reviews, /businessReviewsClient\.list\(id\)/,
  'review data must continue to use the canonical review client');
assert.match(reviews, /dialog\?\.dataset\.shopId/,
  'review authority must follow the canonical detail business ID even outside card-click entry');

assert.ok(visualEntry.trim().endsWith("@import './visual/v2-008-shops.css';"),
  'current 01/02 parity CSS must load after previous V2 visual layers');

console.log('PASS V2 20260904 current 01/02 shop discover/detail parity contract');
