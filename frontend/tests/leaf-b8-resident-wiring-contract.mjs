import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Assignment #331 [Leaf B8]: static wiring contract + bridge HTTP runtime contract
// for the five resident surfaces (19/22/24/25/28) and the two shared bridges.
// Run: node frontend/tests/leaf-b8-resident-wiring-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const f19 = await read('../19_내정보_메인.html');
const f22 = await read('../22_주민_공개프로필.html');
const f24 = await read('../24_설정.html');
const f25 = await read('../25_1대1문의.html');
const f28 = await read('../28_나의활동.html');
const activityJs = await read('../assets/pages/activity-28.js');
const residentJs = await read('../assets/resident-bridge.js');
const inquiryJs = await read('../assets/inquiry-bridge.js');

const CANON = 'banglim-myeongji-roadhill';
const WRONG = 'bangnim-myeongji-roadhill';
const before = (hay, a, b, label) => {
  const ia = hay.indexOf(a), ib = hay.indexOf(b);
  assert.ok(ia > -1, `${label}: missing "${a}"`);
  assert.ok(ib > -1, `${label}: missing "${b}"`);
  assert.ok(ia < ib, `${label}: "${a}" must load before "${b}"`);
};

/* --- canonical slug governance: no typo slug anywhere --- */
for (const [name, src] of [['f19', f19], ['f22', f22], ['f24', f24], ['f25', f25], ['f28', f28],
  ['activityJs', activityJs], ['residentJs', residentJs], ['inquiryJs', inquiryJs]]) {
  assert.ok(!src.includes(WRONG), `${name} must not contain the typo slug "${WRONG}"`);
}
assert.ok(residentJs.includes(`'${CANON}'`), 'resident bridge must own the canonical complex slug');

/* --- 19 내정보: profile + summary, fail-closed --- */
before(f19, 'assets/resident-bridge.js', 'danjion-myinfo-server', 'f19');
assert.ok(f19.includes('serverConfig()'), 'f19 must gate on serverConfig()');
assert.ok(f19.includes('.profile()') && f19.includes('.summary()'), 'f19 must fetch profile and summary');
assert.ok(f19.includes('Promise.allSettled'), 'f19 must settle profile+summary independently');
assert.ok(f19.includes('—'), 'f19 must render an em-dash for unsourced stats (fail closed)');

/* --- 22 공개프로필: userId-driven public profile --- */
before(f22, 'assets/resident-bridge.js', 'danjion-public-profile-server', 'f22');
assert.ok(f22.includes('publicProfile'), 'f22 must call publicProfile()');
assert.ok(f22.includes("get('userId')"), 'f22 must read the target userId from the query');
assert.ok(f22.includes('정보가 없습니다'), 'f22 must fail closed with the canonical not-found copy');

/* --- 24 설정: server-backed publicProfileEnabled, never optimistic --- */
before(f24, 'assets/resident-bridge.js', 'danjion-settings-server', 'f24');
assert.ok(f24.includes('data-settings-target="profile"'), 'f24 must anchor on the profile settings row');
assert.ok(f24.includes("dataset.settingsKey='publicProfileEnabled'"), 'f24 toggle must key on publicProfileEnabled (avoids router target)');
assert.ok(f24.includes('bridge.settings(') && f24.includes('bridge.updateSetting('), 'f24 must GET then PATCH the setting');
assert.match(f24, /updateSetting\([\s\S]*?\.then\(function\(r\)\{[\s\S]*?if\(r&&r\.ok&&r\.settings\)\{apply\(/,
  'f24 must apply the toggle state only after a successful PATCH (no optimistic write)');
const clickStart = f24.indexOf("click',function(){");
assert.ok(clickStart > -1, 'f24 click handler must exist');
const thenAt = f24.indexOf('.then(', clickStart);
assert.ok(thenAt > clickStart, 'f24 click handler must resolve updateSetting via .then()');
assert.ok(!f24.slice(clickStart, thenAt).includes('apply('),
  'f24 must not mutate the toggle before the server responds (no optimistic write)');

/* --- 25 1:1문의: submit + list through the inquiry bridge --- */
before(f25, 'assets/inquiry-bridge.js', 'danjion-inquiry-server', 'f25');
assert.ok(f25.includes("get('apiBase')"), 'f25 must gate on ?apiBase=');
assert.ok(f25.includes(`createInquiryBridge({apiBase:API_BASE,complexSlug:COMPLEX})`), 'f25 must build the inquiry bridge with the api base + slug');
assert.ok(f25.includes(`COMPLEX='${CANON}'`), 'f25 must pin the canonical complex slug');
assert.ok(f25.includes('bridge.submitGeneral(') && f25.includes('bridge.listMine('), 'f25 must submit and list via the bridge');
assert.ok(f25.includes('문의를 접수했습니다.'), 'f25 success copy');
assert.ok(f25.includes('로그인 후 이용 가능합니다.'), 'f25 auth-required copy');
assert.ok(f25.includes('문의 접수에 실패했습니다.'), 'f25 submit-failure copy');
assert.ok(f25.includes('불러오는 중'), 'f25 must show a loading state');
assert.ok(!f25.includes('localStorage'), 'f25 server path must not fabricate local persistence');

/* --- 28 나의활동: activity + summary, hide unsourced controls --- */
before(f28, 'assets/resident-bridge.js', 'assets/pages/activity-28.js', 'f28');
assert.ok(activityJs.includes('DanjionResidentBridge'), 'f28 must consume the resident bridge');
assert.ok(activityJs.includes('serverConfig()'), 'f28 must gate on serverConfig()');
assert.ok(activityJs.includes("get('view')==='saved'"), 'f28 must skip server rewire for the demo saved/benefits views');
assert.ok(activityJs.includes("likes:'reactions'"), 'f28 likes tab must map to the reactions activity type');
assert.ok(activityJs.includes('bridge.activity(apiType,50)') && activityJs.includes('bridge.summary()'), 'f28 must fetch activity + summary');
assert.ok(activityJs.includes(".toolbar')") && activityJs.includes("display='none'"), 'f28 must hide the unsupported subfilter/search toolbar');
assert.ok(activityJs.includes('이번 달'), 'f28 must hide the monthly +N deltas');
assert.ok((activityJs.match(/'—'/g) || []).length >= 2, 'f28 must render em-dash for unsourced counts (likes/reviews)');

/* ================= bridge HTTP runtime contract (no DOM) ================= */
function loadBridge(source, apiBase) {
  const calls = [];
  let resp = { ok: true, status: 200, json: {} };
  const sandbox = {
    URLSearchParams,
    console,
    fetch: (url, init = {}) => {
      calls.push({ url: String(url), init });
      return Promise.resolve({ ok: resp.ok, status: resp.status, json: () => Promise.resolve(resp.json) });
    },
    location: { search: apiBase ? `?apiBase=${apiBase}` : '', origin: 'https://demo.test' },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { calls, setResp: (r) => { resp = r; }, resident: sandbox.DanjionResidentBridge, inquiry: sandbox.DanjionInquiryBridge };
}
const API = 'https://api.test';

/* --- serverConfig gate --- */
assert.equal(loadBridge(residentJs, API).resident.serverConfig().enabled, true, 'serverConfig enabled when ?apiBase present');
assert.equal(loadBridge(residentJs).resident.serverConfig().enabled, false, 'serverConfig disabled without ?apiBase');
assert.equal(loadBridge(residentJs, API).resident.serverConfig().complexSlug, CANON, 'serverConfig pins canonical slug');

/* --- resident request shapes + fail-closed auth --- */
const rEnv = loadBridge(residentJs, API);
const rb = rEnv.resident.createResidentBridge({ apiBase: API });
rEnv.setResp({ ok: true, status: 200, json: { data: { nickname: '연', residentLabel: 'verified_resident' } } });
const prof = await rb.profile();
assert.equal(prof.mode, 'server', 'profile success is server mode');
assert.match(rEnv.calls.at(-1).url, new RegExp(`/api/v1/me/profile\\?complexSlug=${CANON}$`), 'profile GET carries complex slug');
assert.equal(rEnv.calls.at(-1).init.credentials, 'include', 'bridge requests send cookies');

await rb.activity('likes', 50);
assert.match(rEnv.calls.at(-1).url, /type=all/, 'unknown activity type coerces to all');
await rb.activity('reactions', 50);
assert.match(rEnv.calls.at(-1).url, /type=reactions/, 'reactions activity type is forwarded');
assert.match(rEnv.calls.at(-1).url, /limit=50/, 'activity limit is forwarded');

rEnv.setResp({ ok: false, status: 403, json: { error: { code: 'FORBIDDEN' } } });
const denied = await rb.summary();
assert.equal(denied.ok, false, 'summary failure is not ok');
assert.equal(denied.mode, 'auth-required', '403 maps to auth-required (fail closed)');

const badSetting = await rb.updateSetting('yes');
assert.equal(badSetting.mode, 'client', 'non-boolean setting value is rejected client-side');
assert.ok(!rEnv.calls.some((c) => c.init.method === 'PATCH'), 'no PATCH fires for an invalid setting value');

/* --- inquiry submit + list shapes --- */
const iEnv = loadBridge(inquiryJs, API);
const ib = iEnv.inquiry.createInquiryBridge({ apiBase: API, complexSlug: CANON });
iEnv.setResp({ ok: true, status: 201, json: { data: { id: '1', inquiryType: 'general', title: 't', body: 'b', status: 'received' } } });
const submitted = await ib.submitGeneral({ inquiryType: 'general', subject: 't', text: 'b' });
assert.equal(submitted.mode, 'server', 'submitGeneral success is server mode');
assert.equal(iEnv.calls.at(-1).init.method, 'POST', 'submitGeneral POSTs');
assert.match(iEnv.calls.at(-1).url, /\/api\/v1\/me\/inquiries$/, 'submitGeneral targets /me/inquiries');
const sentBody = JSON.parse(iEnv.calls.at(-1).init.body);
assert.deepEqual(sentBody, { complexSlug: CANON, inquiryType: 'general', title: 't', body: 'b' }, 'submit body matches the inquiries contract');

iEnv.setResp({ ok: true, status: 200, json: { data: { inquiries: [{ id: '9', inquiryType: 'general', title: 'x', status: 'answered' }] } } });
const listed = await ib.listMine();
assert.match(iEnv.calls.at(-1).url, new RegExp(`/api/v1/me/inquiries\\?complexSlug=${CANON}$`), 'listMine GET carries complex slug');
assert.equal(listed.inquiries[0].id, '9', 'listMine normalizes server rows');

iEnv.setResp({ ok: false, status: 401, json: {} });
const unauth = await ib.listMine();
assert.equal(unauth.mode, 'auth-required', 'listMine 401 maps to auth-required');
assert.equal(unauth.inquiries.length, 0, 'listMine fails closed with an empty list');

console.log('OK: leaf-b8-resident-wiring-contract passed');
