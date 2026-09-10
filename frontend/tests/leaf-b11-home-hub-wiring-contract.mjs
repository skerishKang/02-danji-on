import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Assignment #347 [Leaf B11]: daily-home 04 wired to existing public/bookmark/news
// authorities only. Static demo fallback preserved without apiBase.
// CENTRAL review 5623904320: verified-resident lane (resident-news) uses the canonical
// DanjionSession credentials-included transport; representative_image_object_key must
// never become an <img src> — only the proven /api/v1/storage/public proxy or local fallback.
// CENTRAL #352 OPTION B (comment 5624249980): page 05 keeps its original static UI —
// no new visible channel-latest lines and no reveal logic; this contract locks that removal.
// Run: node frontend/tests/leaf-b11-home-hub-wiring-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const f04 = await read('../04_데일리홈.html');
const f05 = await read('../05_우리단지_첫화면.html');
const CANON = 'banglim-myeongji-roadhill';
const WRONG = '방님명지로드힐';

/* --- canonical filename audit: both surfaces exist at the locked names --- */
assert.ok(f04.includes('data-danjion-page="4"'), '04 daily-home must keep its page marker');
assert.ok(f05.includes('data-danjion-page="5"'), '05 complex-hub must keep its page marker');

/* --- canonical slug governance (wiring lives only in 04 after OPTION B) --- */
assert.ok(!f04.includes(WRONG), 'f04 must not contain the typo slug');
assert.ok(f04.includes(`'${CANON}'`), 'f04 must use the canonical complex slug');
assert(!/COMPLEX_SLUG='방/.test(f04), 'f04 must not use the Korean display name as the API slug');

/* --- OPTION B: page 05 static UI restored — no new visible lines, no reveal logic --- */
for (const banned of ['channel-latest', 'data-latest-for', 'HUB_API_BASE', 'danjion-hub-latest-wiring', 'DanjionSession']) {
  assert.ok(!f05.includes(banned), `05 must not contain "${banned}" (OPTION B removes the hub reveal UI)`);
}
assert.ok(f05.includes('data-danjion-page="5"') && f05.includes('danjion-direct-router-v5'),
  '05 must keep its original static router surfaces');

/* --- 04: canonical session + bridge scripts load before the wiring --- */
assert.ok(f04.includes('assets/danjion-session.js'), '04 must load the canonical DanjionSession runtime');
const bridgeTagAt = f04.indexOf('assets/saved-shops-bridge.js');
const wiringAt = f04.indexOf('loadHomeAuthority');
const bootAt = f04.indexOf('syncSaveButton();restart();');
assert.ok(bridgeTagAt > -1, '04 must load the saved-shops bridge script');
assert.ok(f04.indexOf('assets/danjion-session.js') < bootAt, '04 session script must load before the inline wiring boots');
assert.ok(bootAt > -1 && bridgeTagAt < bootAt, '04 bridge script must load before the inline wiring boots');
assert.ok(wiringAt > bridgeTagAt, '04 authority wiring must come after the bridge tag');

/* --- 04: apiBase gate + fail-closed demo fallback --- */
assert.ok(f04.includes("const HOME_API_BASE=(new URLSearchParams(location.search).get('apiBase')||'').replace(/\\/+$/,'')"),
  '04 must derive HOME_API_BASE from the apiBase query param with trailing-slash trim');
assert.ok(/async function loadHomeAuthority\(\)\{\s*if\(!HOME_API_BASE\)return;/.test(f04),
  '04 must return before any fetch when apiBase is absent (demo/static fallback)');
assert.ok(f04.includes("food:{i:1,name:'오늘의 반찬'"), '04 static demo scenes must remain for the no-apiBase lane');
assert.ok(f04.includes('keeping demo scenes'), '04 must log and keep demo scenes when the businesses authority fails');

/* --- 04: existing authorities only, public GET for public lanes --- */
assert.ok(f04.includes('/businesses?limit=4'), '04 scenes must read the public businesses list authority');
assert.ok(f04.includes('/posts?channel=danjion_notice&limit=1'), '04 news row must use the danjion_notice post channel');
assert.ok(f04.includes('/posts?channel=apartment_news&limit=1'), '04 news row must use the apartment_news post channel');
assert.ok(f04.includes("credentials:'omit'"), '04 public authority reads must omit credentials');
assert.ok(!f04.includes("method:'POST'") && !f04.includes('method: \'POST\''),
  '04 must not issue any POST directly (bookmark mutations stay inside the saved-shops bridge)');
for (const forbidden of ['/api/v1/me/benefits', '/api/v1/admin', '/api/v1/me/business-applications', '/api/v1/me/shop-recommendations']) {
  assert.ok(!f04.includes(forbidden), `04 must not touch ${forbidden}`);
}

/* --- CENTRAL review fix 1: verified-resident lane uses the canonical authenticated transport --- */
assert.ok(f04.includes("await DanjionSession.request(fetch,DanjionSession.joinUrl(HOME_API_BASE,newsBase+'/resident-news'))"),
  '04 resident-news row must go through the canonical DanjionSession credentials-included transport');
assert.ok(!/homePublicJson\([^)]*resident-news/.test(f04) && !f04.includes("newsBase+'/resident-news?limit=1'"),
  '04 must not fetch resident-news over the anonymous public transport');
assert.ok(f04.includes('result.data.posts'), '04 must read the server {data:{posts}} envelope shape for resident-news');
assert.ok(f04.includes('home resident-news lane unavailable, keeping demo copy'),
  '04 resident-news lane must fail closed to the demo copy');

/* --- 04: bookmark save routes through the server bridge only when present --- */
assert.ok(f04.includes('DanJionSavedShopsBridge.create({apiBase:HOME_API_BASE})'),
  '04 must create the saved-shops bridge with the same apiBase');
assert.ok(f04.includes('await __homeBridge.load()'), '04 must load server bookmark state before rendering');
assert.ok(f04.includes('__homeBridge?__homeBridge.isSaved(key):getSaved().includes(key)'),
  '04 save button state must prefer the bridge and fall back to local storage');
assert.ok(f04.includes('await __homeBridge.toggle(key)'), '04 save click must toggle via the bridge in server mode');
assert.ok(f04.includes('저장 상태를 서버에 반영하지 못했어요'), '04 must fail closed with an explicit toast on bridge errors');
assert.ok(f04.includes("'danjion:savedShops'"), '04 must keep the local danjion:savedShops fallback for the no-bridge lane');

/* --- CENTRAL review fix 2: raw object keys must never become img src --- */
assert.ok(!/image:\s*b\.representative_image_object_key/.test(f04),
  '04 must not place the raw representative_image_object_key into the scene image');
assert.ok(f04.includes('image:homeSceneImage(b.representative_image_object_key??b.representativeImageObjectKey,i)'),
  '04 scene image must be built through the guarded homeSceneImage helper');
assert.ok(f04.includes("'/api/v1/storage/public?objectKey='+encodeURIComponent(k)"),
  '04 may only use the proven /api/v1/storage/public media proxy authority for server images');
assert.ok(f04.includes('HOME_PUBLIC_IMAGE_KEY=/^gdrive\\/public\\/business-image\\/'),
  '04 must restrict proxy URLs to the public business-image object-key contract only');
assert.ok(f04.includes('HOME_SCENE_IMAGES[i%4]'), '04 must keep the bounded local scene fallback image');

/* --- runtime: homeSceneImage proxy guard is fail-closed to the local fallback --- */
const imgHelper = f04.slice(f04.indexOf('const HOME_PUBLIC_IMAGE_KEY'), f04.indexOf('function homeSceneFromBusiness'));
assert.ok(imgHelper.length > 40 && imgHelper.includes('function homeSceneImage'), '04 image helper block must be extractable');
const imgCtx = { HOME_API_BASE: 'https://api.test', HOME_SCENE_IMAGES: ['assets/scene-food.webp', 'assets/scene-learning.webp', 'assets/scene-home-care.webp', 'assets/scene-professional.webp'] };
vm.runInNewContext(imgHelper + ';this.homeSceneImage=homeSceneImage;', imgCtx);
assert.equal(imgCtx.homeSceneImage('gdrive/public/business-image/AbC-1_2', 0), 'https://api.test/api/v1/storage/public?objectKey=gdrive%2Fpublic%2Fbusiness-image%2FAbC-1_2',
  'public business-image keys must resolve through the approved proxy URL');
for (const bad of ['gdrive/private/resident-evidence/x', 'gdrive/public/business-image/../etc', '', null, 'https://evil.test/x', 'arbitrary-object-key']) {
  assert.ok(String(imgCtx.homeSceneImage(bad, 1)).startsWith('assets/scene-'),
    `non-contract key ${JSON.stringify(bad)} must fall back to the local bounded scene image, never enter the DOM raw`);
}

/* --- 04: no fabricated server semantics --- */
assert.ok(f04.includes('등록된 주민 혜택 없음'), '04 must show an explicit no-benefit state instead of inventing one');
assert.ok(f04.includes('관계 확인 중'), '04 must label unknown relation types honestly');

/* --- bounded scope: excluded surfaces untouched by this wiring --- */
const f03 = await read('../03_주민혜택_쿠폰_v2.html');
const f23 = await read('../23_이웃온기.html');
const f25a = await read('../25A_신청제보.html');
const fv3 = await read('../01_이웃가게_발견_v3.html');
for (const [name, src] of [['03', f03], ['23', f23], ['25A', f25a], ['01_v3', fv3]]) {
  assert.ok(!src.includes('HOME_API_BASE') && !src.includes('HUB_API_BASE') && !src.includes('data-latest-for'),
    `${name} must stay outside the #347 wiring scope`);
}
assert.ok(!f03.includes('loadHomeAuthority'), '03 benefit policy surface must remain untouched');

console.log('leaf-b11-home-hub-wiring-contract: PASS');
