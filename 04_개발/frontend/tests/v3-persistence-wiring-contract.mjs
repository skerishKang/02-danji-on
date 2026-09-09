import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../../frontend/01_이웃가게_발견_v3.html', import.meta.url), 'utf8');

/* --- bridge runtimes are loaded before the shop runtime consumes them --- */
const savedTag = html.indexOf('<script src="assets/saved-shops-bridge.js"></script>');
const reviewsTag = html.indexOf('<script src="assets/reviews-bridge.js"></script>');
const runtimeTag = html.indexOf('<script id="frontend2-b-shop-runtime-20260905">');
assert.ok(savedTag > -1, 'saved-shops bridge script tag must be present');
assert.ok(reviewsTag > -1, 'reviews bridge script tag must be present');
assert.ok(runtimeTag > -1, 'shop runtime script must be present');
assert.ok(savedTag < runtimeTag, 'saved-shops bridge must load before the shop runtime');
assert.ok(reviewsTag < runtimeTag, 'reviews bridge must load before the shop runtime');

/* --- application/report bridge is an ES module and exposes a live instance --- */
assert.match(html, /<script type="module">/, 'application/report bridge must be loaded as an ES module');
assert.match(html, /import \{ createApplicationReportBridge/, 'application/report bridge factory must be imported');
assert.match(html, /window\.__applicationReportBridge = createApplicationReportBridge\(/,
  'application/report bridge instance must be constructed for the page');

/* --- saved shops: localStorage replaced by bridge --- */
assert.doesNotMatch(html, /function savedKeys\(/, 'savedKeys localStorage reader must be removed');
assert.doesNotMatch(html, /function setSaved\(/, 'setSaved localStorage writer must be removed');
assert.doesNotMatch(html, /localStorage\.(get|set)Item\('danjion:savedShops'\)/,
  'page must not touch the savedShops storage key directly');
assert.match(html, /DanJionSavedShopsBridge\.create\(\{apiBase:DISCOVERY_API_BASE\}\)/,
  'saved shops bridge must be created with the discovery API base');
assert.match(html, /__savedShopsBridge\.toggle\(/, 'save toggle must go through the bridge');
assert.match(html, /__savedShopsBridge\.isSaved\(/, 'modal save state must be read from the bridge');
assert.doesNotMatch(html, /const\{saved\}=__savedShopsBridge\.snapshot\(\)/,
  'regression: snapshot() returns {mode,keys}, not {saved} - grid state must not destructure `saved`');
assert.match(html, /initSavedShopsBridge\(\)/, 'saved shops bridge must be booted');

/* --- reviews: localStorage array mutation replaced by bridge --- */
assert.match(html, /DanjionReviewsBridge\.createReviewsBridge\(\{apiBase:DISCOVERY_API_BASE,complexSlug:DISCOVERY_COMPLEX_SLUG\}\)/,
  'reviews bridge must be created with the discovery API base and complex slug');
assert.match(html, /__reviewsBridge\.create\(active,v\)/, 'review submit must go through the bridge');
assert.match(html, /__reviewsBridge\.reply\(active,reviewId,v\)/, 'review comment/reply must go through the bridge');
assert.match(html, /initReviewsBridge\(\)/, 'reviews bridge must be booted');
assert.doesNotMatch(html, /s\.reviews\[ri\]\[5\]\.push\(/,
  'review comments must no longer be pushed into a local demo array');

/* --- fail-closed: auth-required surfaces a Korean login prompt, not a silent local write --- */
assert.match(html, /r\.error==='auth-required'\?'로그인 후 이용 가능합니다\.'/,
  '401/403 must surface a Korean auth-required notice');

/* --- product parity guard: copy / labels / SHOP_DATA unchanged --- */
assert.match(html, /♡ 저장/, 'unsaved save label must be preserved');
assert.match(html, /♥ 저장됨/, 'saved save label must be preserved');
assert.match(html, /'저장한 이웃가게에 담았습니다\.'/, 'save confirmation copy must be preserved');
assert.match(html, /'저장을 취소했습니다\.'/, 'save cancellation copy must be preserved');
assert.match(html, /'후기 내용을 입력해 주세요\.'/, 'review validation copy must be preserved');
assert.match(html, /'댓글 내용을 입력해 주세요\.'/, 'comment validation copy must be preserved');
assert.match(html, /로드힐 꽃작업실/, 'SHOP_DATA demo shop must be preserved');
assert.match(html, /오늘의 반찬/, 'SHOP_DATA demo shop must be preserved');
assert.match(html, /부모님 생신 꽃다발을 정성스럽게 준비해 주셨어요\./, 'SHOP_DATA demo review copy must be preserved');
assert.match(html, /'아직 등록된 후기가 없습니다\.'/, 'empty review copy must be preserved');

console.log('PASS V3 discovery persistence wiring contract (saved-shops / reviews / application-report bridges)');
