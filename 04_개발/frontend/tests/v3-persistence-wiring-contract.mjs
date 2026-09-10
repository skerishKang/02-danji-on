import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../../frontend/01_이웃가게_발견_v3.html', import.meta.url), 'utf8');
const apply25a = await readFile(new URL('../../../frontend/25A_신청제보.html', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

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
assert.match(html, /\.catch\(\(\)=>\{syncSaveButtons\(\)/,
  'server toggle failure must fail closed and re-sync buttons instead of faking state');

/* --- A/B. reviews: real GET list wiring + real create wiring through the bridge --- */
assert.match(html, /DanjionReviewsBridge\.createReviewsBridge\(\{apiBase:DISCOVERY_API_BASE,complexSlug:DISCOVERY_COMPLEX_SLUG\}\)/,
  'reviews bridge must be created with the discovery API base and complex slug');
assert.match(html, /initReviewsBridge\(\)/, 'reviews bridge must be booted');
assert.match(html, /__reviewsBridge\.list\(key\)/, 'A: opening the review sheet must fetch server reviews through bridge.list()');
assert.match(html, /if\(r\.mode!=='server'\)return/, 'A: static fallback keys must not apply server data (bridge.list returns mode:static without network)');
assert.match(html, /__reviewsBridge\.create\(active,v\)/, 'B: review submit must go through the bridge create()');
assert.match(html, /if\(r\.mode==='static'\)\{s\.reviews=\[\.\.\.\(s\.reviews\|\|\[\]\),\['나도 이용한 이웃','방금',v\]\]/,
  'B: static fallback shops keep local demo review semantics (no server call)');

/* --- C/D. RESIDENT COMMENT ≠ OWNER REPLY: comment handler must never call owner reply API --- */
assert.doesNotMatch(html, /__reviewsBridge\.reply\(/,
  'C: resident comment must NOT be wired to the owner-only reply API (backend has no resident-comment lane)');
assert.match(html, /s\.reviews\[ri\]\[5\]=s\.reviews\[ri\]\[5\]\|\|\[\];s\.reviews\[ri\]\[5\]\.push\(\['연블리','방금',v\]\)/,
  'D: resident comment keeps the pre-existing local demo behavior');
/* --- E. owner reply presentation rendering must stay exactly as before --- */
assert.match(html, /<span class="owner-badge">가게 주인<\/span>/, 'E: owner reply badge markup must be preserved');
assert.match(html, /r\[3\]\?`<div class="review-reply">/, 'E: owner reply rendering from the review tuple must be preserved');
assert.match(html, /data-send="\$\{ri\}"/, 'E: comment form index-based send target must be preserved (not bridge review ids)');

/* --- fail-closed: auth-required surfaces a Korean login prompt, not a silent local write --- */
assert.match(html, /r\.mode==='auth-required'\?'로그인 후 이용 가능합니다\.'/,
  '401/403 on review create must surface a Korean auth-required notice');
assert.doesNotMatch(html, /danjion:demo:reviews|localStorage\.(get|set)Item\([^)]*review/i,
  'reviews must never be fake-persisted to localStorage as a success stand-in');

/* --- F/G/H. 25A owner form: real bridge wiring, report lane never fakes server success, no coercion --- */
assert.match(apply25a, /bridge\.createOwnerApplication\(/, 'F: owner submit must call the real bridge createOwnerApplication()');
assert.match(apply25a, /idempotencyKey:ownerSubmissionKey\(\)/, 'F: owner submit must carry a stable idempotency key');
assert.match(apply25a, /function ownerSubmissionKey\(\)\{if\(!__ownerSubmissionKey\)__ownerSubmissionKey='application:/,
  'F: submission key must be stable across retries (generated once, reset only on input change)');
assert.match(apply25a, /if\(isReport\|\|!danjionApiBase\(\)\)/,
  'G: report lane (and no-API demo mode) must return before any server write');
assert.doesNotMatch(apply25a, /createRecommendation\(/,
  'G: report lane must not be wired to a server success it cannot ground (no recommendation create call)');
assert.match(apply25a, /const OWNER_RELATION_MAP=\{self:'resident',family:'resident_family'\};/,
  'H: only the grounded owner relations may be mapped; co/etc must never be coerced to a backend enum');
assert.doesNotMatch(apply25a, /OWNER_RELATION_MAP\s*=\s*\{[^}]*(co|etc):/,
  'H: 공동 운영자/기타 must not be mapped to any backend relation');
assert.match(apply25a, /선택한 관계로는 아직 서버 신청을 연결할 수 없습니다\./,
  'H: unmapped relation must fail closed with an honest notice instead of a guessed relation');
/* photo handling: never silently dropped, canonical storage contract only, sibling visual authority kept */
assert.match(apply25a, /const MAX_PHOTOS=3;/, 'PHOTO: selection must cap at the backend 0..3 photo contract');
assert.match(apply25a, /photos\.files\.length>MAX_PHOTOS\)\{alert\(/,
  'PHOTO: over-cap selection must be rejected at the existing file input, not silently trimmed');
assert.match(apply25a, /const photoFiles=Array\.from\(photos\.files\|\|\[\]\)\.slice\(0,MAX_PHOTOS\);/,
  'PHOTO: submit must consume the existing file input selection order (no parallel gallery state)');
assert.match(apply25a, /for\(const file of photoFiles\)\{[\s\S]*?await uploadBusinessImage\(file\)/,
  'PHOTO: submit must upload every selected photo file in order, never silently discard extras');
assert.match(apply25a, /body\.set\('kind','business-image'\)/, 'PHOTO: upload must use the canonical business-image kind');
assert.match(apply25a, /\/api\/v1\/storage\/objects',\{method:'POST',credentials:'include'/,
  'PHOTO: upload must hit POST /api/v1/storage/objects with credentials');
assert.match(apply25a, /if\(!upload\.ok\)\{[\s\S]*?return;[\s\S]*?uploadedKeys\.push\(upload\.objectKey\);/,
  'PHOTO: upload failure must abort the submit (fail closed, no keyless fake); success collects object keys in order');
assert.match(apply25a, /photoObjectKeys:uploadedKeys/,
  'PHOTO: submit payload must carry the canonical photoObjectKeys array (representative mirrors keys[0] in the bridge)');
assert.doesNotMatch(apply25a, /gallery[A-Za-z]*\s*:|imageObjectKeys/,
  'PHOTO: only the canonical photoObjectKeys field may be added to the payload');
assert.doesNotMatch(apply25a, /photo-gallery|photoGallery|photo-thumb|photo-remove|renderPhotoGallery/,
  'PHOTO: no new gallery presentation may be added; persistence uses the sibling file-input UI unchanged');

/* --- I. product parity guard: copy / labels / SHOP_DATA unchanged --- */
assert.match(html, /♡ 저장/, 'unsaved save label must be preserved');
assert.match(html, /♥ 저장됨/, 'saved save label must be preserved');
assert.match(html, /'저장한 이웃가게에 담았습니다\.'/, 'save confirmation copy must be preserved');
assert.match(html, /'저장을 취소했습니다\.'/, 'save cancellation copy must be preserved');
assert.match(html, /'후기 내용을 입력해 주세요\.'/, 'review validation copy must be preserved');
assert.match(html, /'댓글 내용을 입력해 주세요\.'/, 'comment validation copy must be preserved');
assert.match(html, /댓글 달기/, 'resident comment label must be preserved verbatim');
assert.match(html, /로드힐 꽃작업실/, 'SHOP_DATA demo shop must be preserved');
assert.match(html, /오늘의 반찬/, 'SHOP_DATA demo shop must be preserved');
assert.match(html, /부모님 생신 꽃다발을 정성스럽게 준비해 주셨어요\./, 'SHOP_DATA demo review copy must be preserved');
assert.match(html, /'아직 등록된 후기가 없습니다\.'/, 'empty review copy must be preserved');

/* --- J. stage5a/b/c/d + new wiring test preserved in the typecheck chain (additive only) --- */
const chain = pkg.scripts['typecheck'];
for (const step of ['test:stage5a', 'test:stage5b', 'test:stage5c', 'test:stage5d-application-report-bridge-runtime']) {
  assert.ok(chain.includes(`npm run ${step}`), `J: typecheck chain must still run ${step}`);
}
assert.ok(chain.includes('npm run test:v3-persistence-wiring-contract'),
  'J: the persistence wiring contract test must run inside the typecheck chain');
assert.ok(chain.indexOf('npm run test:stage5a') < chain.indexOf('npm run test:v3-persistence-wiring-contract'),
  'J: the new test must be appended after the stage5 chain, not replace it');

console.log('PASS V3 discovery persistence wiring contract (saved-shops / reviews / application-report bridges)');
