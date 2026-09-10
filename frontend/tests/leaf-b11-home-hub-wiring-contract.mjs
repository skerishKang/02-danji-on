import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Assignment #347 [Leaf B11]: daily-home 04 + complex-hub 05 wired to existing
// public/bookmark/news authorities only. Static demo fallback preserved without apiBase.
// Run: node frontend/tests/leaf-b11-home-hub-wiring-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const f04 = await read('../04_데일리홈.html');
const f05 = await read('../05_우리단지_첫화면.html');
const CANON = 'banglim-myeongji-roadhill';
const WRONG = '방님명지로드힐';

/* --- canonical filename audit: both surfaces exist at the locked names --- */
assert.ok(f04.includes('data-danjion-page="4"'), '04 daily-home must keep its page marker');
assert.ok(f05.includes('data-danjion-page="5"'), '05 complex-hub must keep its page marker');

/* --- canonical slug governance: DB slug only, never the Korean display name --- */
for (const [name, src] of [['f04', f04], ['f05', f05]]) {
  assert.ok(!src.includes(WRONG), `${name} must not contain the typo slug "${WRONG}"`);
  assert.ok(src.includes(`'${CANON}'`), `${name} must use the canonical complex slug`);
  assert(!/COMPLEX_SLUG='방/.test(src), `${name} must not use the Korean display name as the API slug`);
}

/* --- 04: saved-shops bridge loads before the inline authority wiring --- */
const bridgeTagAt = f04.indexOf('assets/saved-shops-bridge.js');
const wiringAt = f04.indexOf('loadHomeAuthority');
const bootAt = f04.indexOf('syncSaveButton();restart();');
assert.ok(bridgeTagAt > -1, '04 must load the saved-shops bridge script');
assert.ok(bootAt > -1 && bridgeTagAt < bootAt, '04 bridge script must load before the inline wiring boots');
assert.ok(wiringAt > bridgeTagAt, '04 authority wiring must come after the bridge tag');

/* --- 04: apiBase gate + fail-closed demo fallback --- */
assert.ok(f04.includes("const HOME_API_BASE=(new URLSearchParams(location.search).get('apiBase')||'').replace(/\\/+$/,'')"),
  '04 must derive HOME_API_BASE from the apiBase query param with trailing-slash trim');
assert.ok(/async function loadHomeAuthority\(\)\{\s*if\(!HOME_API_BASE\)return;/.test(f04),
  '04 must return before any fetch when apiBase is absent (demo/static fallback)');
assert.ok(f04.includes("food:{i:1,name:'오늘의 반찬'"), '04 static demo scenes must remain for the no-apiBase lane');
assert.ok(f04.includes('keeping demo scenes'), '04 must log and keep demo scenes when the businesses authority fails');

/* --- 04: existing authorities only, public GET, no invented endpoints --- */
assert.ok(f04.includes("'/businesses?limit=4'") || f04.includes('/businesses?limit=4'),
  '04 scenes must read the public businesses list authority');
assert.ok(f04.includes('/posts?channel=danjion_notice&limit=1'), '04 news row must use the danjion_notice post channel');
assert.ok(f04.includes('/posts?channel=apartment_news&limit=1'), '04 news row must use the apartment_news post channel');
assert.ok(f04.includes('/resident-news?limit=1'), '04 news row must use the public resident-news feed');
assert.ok(f04.includes("credentials:'omit'"), '04 public authority reads must omit credentials');
assert.ok(!f04.includes("method:'POST'") && !f04.includes('method: \'POST\''),
  '04 must not issue any POST directly (bookmark mutations stay inside the saved-shops bridge)');
for (const forbidden of ['/api/v1/me/benefits', '/api/v1/admin', '/api/v1/me/business-applications', '/api/v1/me/shop-recommendations']) {
  assert.ok(!f04.includes(forbidden), `04 must not touch ${forbidden}`);
}

/* --- 04: bookmark save routes through the server bridge only when present --- */
assert.ok(f04.includes('DanJionSavedShopsBridge.create({apiBase:HOME_API_BASE})'),
  '04 must create the saved-shops bridge with the same apiBase');
assert.ok(f04.includes('await __homeBridge.load()'), '04 must load server bookmark state before rendering');
assert.ok(f04.includes('__homeBridge?__homeBridge.isSaved(key):getSaved().includes(key)'),
  '04 save button state must prefer the bridge and fall back to local storage');
assert.ok(f04.includes('await __homeBridge.toggle(key)'), '04 save click must toggle via the bridge in server mode');
assert.ok(f04.includes('저장 상태를 서버에 반영하지 못했어요'), '04 must fail closed with an explicit toast on bridge errors');
assert.ok(f04.includes("const STORAGE_KEY") === false && f04.includes("'danjion:savedShops'"),
  '04 must keep the local danjion:savedShops fallback for the no-bridge lane');

/* --- 04: no fabricated server semantics --- */
assert.ok(f04.includes('등록된 주민 혜택 없음'), '04 must show an explicit no-benefit state instead of inventing one');
assert.ok(f04.includes('관계 확인 중'), '04 must label unknown relation types honestly');

/* --- 05: hidden latest slots on exactly the four channel cards --- */
for (const slot of ['danjion_notice', 'apartment_news', 'resident_news', 'community']) {
  assert.ok(f05.includes(`data-latest-for="${slot}" hidden`), `05 must keep the ${slot} slot hidden until authority data arrives`);
}
assert.equal((f05.match(/class="channel-latest"/g) || []).length, 4, '05 must expose exactly four latest slots');

/* --- 05: apiBase gate + existing authorities only --- */
assert.ok(f05.includes("const HUB_API_BASE=(new URLSearchParams(location.search).get('apiBase')||'').replace(/\\/+$/,'')"),
  '05 must derive HUB_API_BASE from the apiBase query param');
assert.ok(/const HUB_API_BASE=[\s\S]*?if\(!HUB_API_BASE\)return;/.test(f05),
  '05 must bail out before any fetch when apiBase is absent');
assert.ok(f05.includes('/posts?channel=danjion_notice&limit=1') && f05.includes('/posts?channel=apartment_news&limit=1')
  && f05.includes('/resident-news?limit=1') && f05.includes('/community/posts?limit=1'),
  '05 must reuse the four existing public/news/community authorities');
assert.ok(!f05.includes("method:'POST'") && !f05.includes('method: \'POST\''), '05 must stay read-only');

/* --- runtime: 05 wiring reveals slots only on non-empty titles, per-lane fail-closed --- */
const block = f05.slice(f05.indexOf('<script id="danjion-hub-latest-wiring-v1">'));
const body = block.slice(block.indexOf('>') + 1, block.indexOf('</script>'));
const slots = new Map(['danjion_notice', 'apartment_news', 'resident_news', 'community'].map((k) => [k, { textContent: '', hidden: true }]));
function makeEl() { return { textContent: '', hidden: true }; }
const els = { danjion_notice: makeEl(), apartment_news: makeEl(), resident_news: makeEl(), community: makeEl() };
const calls = [];
async function runHub(search, responses) {
  for (const el of Object.values(els)) { el.textContent = ''; el.hidden = true; }
  calls.length = 0;
  const context = {
    location: { search },
    URLSearchParams,
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    setTimeout: (fn) => setTimeout(fn, 50),
    clearTimeout: (t) => clearTimeout(t),
    Promise: Object.assign(Promise, {}),
    console: { info() {} },
    document: { querySelector: (sel) => { const m = sel.match(/data-latest-for="([^"]+)"/); return m ? els[m[1]] : null; } },
    fetch: async (url) => {
      calls.push(String(url));
      const hit = responses.find((r) => String(url).includes(r.match));
      return hit ? { ok: hit.ok, status: hit.status, json: async () => hit.body } : { ok: false, status: 500, json: async () => ({}) };
    },
  };
  vm.runInNewContext(body, context);
  await new Promise((r) => setTimeout(r, 120));
}

await runHub('?apiBase=https://api.test', [
  { match: 'channel=danjion_notice', ok: true, status: 200, body: { data: [{ title: '운영기준 변경 안내' }] } },
  { match: 'channel=apartment_news', ok: true, status: 200, body: { data: [] } },
  { match: 'resident-news', ok: true, status: 200, body: { data: [{ title: '우리 단지 새 이웃가게' }] } },
  { match: 'community/posts', ok: false, status: 401, body: {} },
]);
assert.equal(calls.length, 4, '05 runtime must call exactly the four authorities');
assert.ok(!els.danjion_notice.hidden && els.danjion_notice.textContent === '최근 소식 · 운영기준 변경 안내', '05 must reveal filled slots with the server title');
assert.ok(els.apartment_news.hidden, '05 must keep empty-feed slots hidden (no fabricated copy)');
assert.ok(!els.resident_news.hidden, '05 resident-news slot must fill from the public feed');
assert.ok(els.community.hidden, '05 must keep the community slot hidden on 401 (fail closed)');

await runHub('', [
  { match: 'posts', ok: true, status: 200, body: { data: [{ title: 'X' }] } },
]);
assert.equal(calls.length, 0, '05 must not fetch at all without apiBase (static demo preserved)');

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
