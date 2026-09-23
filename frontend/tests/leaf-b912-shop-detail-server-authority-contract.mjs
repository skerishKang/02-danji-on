import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const detail = readFileSync(join(frontend, '02_이웃가게_상세.html'), 'utf8');

/* Issue #912: 02 shop detail must be server-authoritative for save, review
 * write, inquiry write and detail hydration. Bounded demo/local behavior is
 * allowed only on the non-canonical unbound preview lane. No production
 * mutation, no merge. */

/* ------------------------------------------------------------------ *
 * 1. Authority runtimes load before the inline authority code
 * ------------------------------------------------------------------ */
const sessionAt = detail.indexOf('assets/danjion-session.js');
const savedAt = detail.indexOf('assets/saved-shops-bridge.js');
const reviewsAt = detail.indexOf('assets/reviews-bridge.js');
const inquiryAt = detail.indexOf('assets/inquiry-bridge.js');
const authorityAt = detail.indexOf('SHOP_DETAIL_SERVER_MODE=');
assert.ok(sessionAt > -1, '02 must load the session runtime');
assert.ok(savedAt > -1, '02 must load the saved-shops bridge');
assert.ok(reviewsAt > -1, '02 must load the reviews bridge');
assert.ok(inquiryAt > -1, '02 must load the inquiry bridge');
assert.ok(
  sessionAt < savedAt && savedAt < reviewsAt && reviewsAt < inquiryAt && inquiryAt < authorityAt,
  'session + bridges must load before the inline authority runtime'
);
assert.equal(
  (detail.match(/assets\/danjion-session\.js/g) || []).length,
  1,
  '02 must load danjion-session.js exactly once (no duplicate tail load)'
);
assert.equal(
  (detail.match(/assets\/reviews-bridge\.js/g) || []).length,
  1,
  '02 must load reviews-bridge.js exactly once'
);
assert.equal(
  (detail.match(/assets\/saved-shops-bridge\.js/g) || []).length,
  1,
  '02 must load saved-shops-bridge.js exactly once'
);
assert.equal(
  (detail.match(/assets\/inquiry-bridge\.js/g) || []).length,
  1,
  '02 must load inquiry-bridge.js exactly once'
);

assert.match(
  detail,
  /\.owner-note strong\{[^}]*font-family:inherit/,
  'owner-note headline must inherit the canonical page sans stack'
);
assert.doesNotMatch(
  detail,
  /\.owner-note strong\{[^}]*font-family:"Noto Serif KR",Batang,serif/,
  'owner-note must not regress to the isolated serif/Batang stack'
);

/* ------------------------------------------------------------------ *
 * 2. Server mode = explicit apiBase OR canonical production (empty base)
 * ------------------------------------------------------------------ */
assert.match(
  detail,
  /const SHOP_DETAIL_SERVER_MODE=Boolean\(SHOP_DETAIL_API_BASE\)\|\|\(window\.DanjionSession&&DanjionSession\.isCanonicalProduction\(\)\)/,
  'write/save server mode must include the canonical empty-base host'
);
assert.match(
  detail,
  /const SERVER_MODE=Boolean\(API_BASE\)\|\|\(window\.DanjionSession&&DanjionSession\.isCanonicalProduction\(\)\)/,
  'detail hydration server mode must include the canonical empty-base host'
);
assert.doesNotMatch(
  detail,
  /if\s*\(\s*SHOP_DETAIL_API_BASE\s*\)/,
  'server authority must never be gated on apiBase truthiness alone'
);

/* ------------------------------------------------------------------ *
 * 3. Save authority: bridge toggle, no legacy demo key, distinct failures
 * ------------------------------------------------------------------ */
assert.doesNotMatch(detail, /danjion:saved-shop:road-hill-flower/, 'legacy per-shop save key must be gone');
assert.doesNotMatch(
  detail,
  /localStorage\.setItem\([^)]*saved[^)]*\)/i,
  'save state must not be written straight to localStorage'
);
assert.match(
  detail,
  /const result=await savedShopsBridge\.toggle\(key\);[\s\S]{0,200}result\.saved\?/,
  'save success toast must come from the awaited bridge result, never optimistically'
);
assert.match(detail, /로그인 후 저장할 수 있습니다\./, 'bookmark 401 must stay distinct');
assert.match(detail, /이 가게를 저장할 권한이 없습니다\./, 'bookmark 403 must stay distinct');
assert.match(detail, /공개되지 않았거나 삭제된 가게입니다\./, 'bookmark 404 must stay distinct');
assert.match(
  detail,
  /저장 상태를 서버에 반영하지 못했습니다\. 잠시 후 다시 시도해 주세요\./,
  'bookmark 5xx/network must stay distinct'
);
assert.match(
  detail,
  /서버에 등록된 이웃가게만 저장할 수 있습니다\./,
  'save must fail closed for legacy presentation keys in server mode'
);
assert.match(
  detail,
  /if\(SHOP_DETAIL_SERVER_MODE&&!savedShopsBridge\.businessIdForKey\(key\)\)/,
  'save must resolve the business id before mutating server bookmarks'
);

/* ------------------------------------------------------------------ *
 * 4. Review / inquiry write authority
 * ------------------------------------------------------------------ */
assert.match(detail, /window\.__shopDetailWriteSubmit=submitShopWrite/, 'write sheet must delegate to one authority function');
assert.match(
  detail,
  /const submit=window\.__shopDetailWriteSubmit/,
  'write sheet must read the authority function at submit time'
);
assert.match(
  detail,
  /try\{result=await submit\(kind,payload\)\}catch\(_\)\{result=null\}/,
  'write sheet must await the authority result'
);
const submitIdx = detail.indexOf("body.querySelector('form')?.addEventListener('submit'");
assert.ok(submitIdx > -1, 'write sheet must keep its form submit handler');
const handler = detail.slice(submitIdx, submitIdx + 1800);
const failIdx = handler.indexOf('if(!result||!result.ok)');
const closeIdx = handler.indexOf('close();');
assert.ok(failIdx > -1, 'write sheet must branch on a failed authority result');
assert.ok(closeIdx > failIdx, 'write sheet must not close before a failed write is surfaced');
assert.ok(
  handler.lastIndexOf('close();') > handler.indexOf('if(!result||!result.ok)'),
  'the success close must sit behind the failure branch'
);

assert.match(
  detail,
  /await reviewsWriteBridge\.create\(key,payload&&payload\.text\)/,
  'production review write must go through the reviews bridge'
);
assert.match(
  detail,
  /inquiryWriteBridge\.submit\(\{shopKey:key,shopName:shopDetailName\(\),subject:payload&&payload\.subject,text:payload&&payload\.text\}\)/,
  'production inquiry write must go through the inquiry bridge'
);
assert.match(
  detail,
  /if\(result&&result\.ok\)\{\s*\n\s*if\(typeof window\.__shopDetailReviewReload==='function'\)window\.__shopDetailReviewReload\(\);/,
  'a successful review write must reload the server review lane'
);
assert.match(
  detail,
  /if\(result&&result\.ok\)return \{ok:true,message:'문의가 접수됐습니다\.'\};/,
  'inquiry success must be reported only on an ok bridge result'
);
assert.match(detail, /result\.mode==='auth-required'/, 'write 401 must stay distinct');
assert.match(detail, /result\.mode==='resident-verification-required'/, 'write 403 resident boundary must stay distinct');
assert.match(detail, /result\.mode==='forbidden'/, 'write 403 forbidden must stay distinct');
assert.match(detail, /result\.mode==='static'/, 'non-server business id must stay distinct');
assert.match(detail, /후기 등록에 실패했습니다\./, 'review failure must be surfaced honestly');
assert.match(detail, /문의 접수에 실패했습니다\./, 'inquiry failure must be surfaced honestly');

/* Bounded preview lane: demo storage keys may exist ONLY inside
 * if(!SHOP_DETAIL_SERVER_MODE){ ... }. */
const previewGuardAt = detail.indexOf('if(!SHOP_DETAIL_SERVER_MODE){');
assert.ok(previewGuardAt > -1, '02 must keep a bounded non-server preview lane');
const previewGuardEnd = detail.indexOf("if(kind==='review'){", previewGuardAt);
assert.ok(previewGuardEnd > previewGuardAt, 'preview lane must end before the server write branches');
for (const hit of detail.matchAll(/danjion:demo:shop-(?:reviews|inquiries)/g)) {
  assert.ok(
    hit.index > previewGuardAt && hit.index < previewGuardEnd,
    'demo write keys must stay inside the bounded preview lane (production uses bridges only)'
  );
}

/* ------------------------------------------------------------------ *
 * 5. Server business detail hydrates the displayed shop
 * ------------------------------------------------------------------ */
assert.match(
  detail,
  /API_BASE\+'\/api\/v1\/complexes\/'\+encodeURIComponent\(COMPLEX_SLUG\)\+'\/businesses\/'\+businessId/,
  'detail hydration must call the existing business-detail endpoint'
);
assert.match(detail, /applyServer\(business\)/, 'a server business payload must hydrate the detail view');
assert.match(
  detail,
  /RELATION_LABEL=\{'resident':'우리 주민 가게','resident_family':'주민 가족 가게','neighbor':'이웃단지 가게'\}/,
  'relation badge must come from the server relation_type map'
);
assert.match(detail, /gdrive\/public\/business-image\//, 'images must reuse the storage public URL contract');
assert.match(detail, /availability_text/, 'operating hours must hydrate from the server');
assert.match(detail, /service_area/, 'address must hydrate from the server');
assert.match(detail, /price_text/, 'method/price must hydrate from the server');
assert.match(detail, /business\.benefits/, 'benefit rows must hydrate from the server');
assert.match(detail, /business\.media/, 'hero image must hydrate from server media');
assert.match(detail, /아직 등록된 소식이 없습니다/, 'news panel must stay the generic empty state');

/* Honest failure states, never a false shop. */
assert.match(detail, /서버에 등록된 이웃가게가 아닙니다\./, 'legacy key in server mode must be an honest notice');
assert.match(detail, /요청하신 이웃가게를 찾을 수 없습니다\./, 'detail 404 must stay distinct');
assert.match(detail, /가게 정보를 불러오지 못했습니다\. 잠시 후 다시 시도해 주세요\./, 'detail network/5xx must stay distinct');

/* SHOPS stays a non-production preview fallback only. */
const applyCallCount = (detail.match(/\bapply\(next\);/g) || []).length;
assert.equal(applyCallCount, 1, 'SHOPS apply() must be reachable only from the preview branch');
assert.match(
  detail,
  /if\(SERVER_MODE\)\{[\s\S]{0,400}businessIdFromKey\(next\)[\s\S]{0,400}\}else\{\s*apply\(next\);\s*\}/,
  'server mode must branch on businessIdFromKey before any SHOPS apply'
);

/* ------------------------------------------------------------------ *
 * 6. Regression guards (b535 / b638 / b800 lanes stay intact)
 * ------------------------------------------------------------------ */
assert.match(detail, /id="canonical-shop-popup-redirect-535"/, 'b535 canonical popup redirect must stay');
assert.match(detail, /danjion\.pages\.dev/, 'b535 redirect must stay production-host scoped');
assert.match(detail, /event\.key==='Escape'&&shareModal\.classList\.contains\('open'\)/, 'share sheet Escape must stay');
assert.match(detail, /e\.key==='Escape'&&layer\.classList\.contains\('open'\)/, 'write sheet Escape must stay');
assert.match(detail, /id="danjion-shop-detail-reviews-server-lane"/, 'b800 server review lane must stay');
assert.match(detail, /data-server-placeholder="true"/, 'b800 loading placeholder must stay');
assert.match(detail, /window\.__shopDetailReviewReload=load;\s*\n\s*void load\(\);/, 'review lane must boot and export its reload');
assert.match(
  detail,
  /if\(typeof window\.__shopDetailReviewReload==='function'\)window\.__shopDetailReviewReload\(\)/,
  'review write success must reach the exported review reload'
);
assert.match(detail, /SHOP_DETAIL_SERVER_MODE/, 'authority runtime must remain inspectable');

console.log('leaf-b912-shop-detail-server-authority-contract: PASS');
