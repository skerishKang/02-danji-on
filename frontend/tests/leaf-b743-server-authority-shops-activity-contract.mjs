import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL('../'+name, import.meta.url), 'utf8');
const home = await read('04_데일리홈.html');
const shops = await read('01_이웃가게_발견.html');
const activityHtml = await read('28_나의활동.html');
const activity = await read('assets/pages/activity-28.js');
const saved = await read('assets/saved-shops-bridge.js');

assert.match(saved, /const serverMode = Boolean\(base\)/);
assert.match(saved, /let saved = new Set\(serverMode \? \[\] : readLocal\(storage\)\)/);
assert.match(saved, /response\.status === 401.*auth-required/s);
assert.match(saved, /response\.status === 403.*forbidden/s);
assert.match(saved, /if \(serverMode\) \{[\s\S]*mode !== 'server'[\s\S]*throw error/,
  'server-mode bookmark mutation must fail closed when authority is unavailable');

assert.match(home, /if\(HOME_SERVER_MODE\)showHomeAuthorityState\('이웃가게를 불러오는 중입니다\.'/);
assert.match(home, /현재 공개된 이웃가게가 없습니다\./);
assert.match(home, /이웃가게를 불러오지 못했습니다\./);
assert.doesNotMatch(home, /keeping demo scenes|keeping demo copy/);
assert.match(home, /if\(HOME_SERVER_MODE\)\{const state=__homeBridge\?__homeBridge\.snapshot\(\):null/);

assert.match(shops, /if\(PRODUCTION_SERVER_MODE\)SHOP_DATA=\[\]/);
assert.doesNotMatch(shops, /danjion:demo:shop-inquiries/);
assert.doesNotMatch(shops, /push\(\['연블리','방금',v\]\)/);
assert.match(shops, /r\.mode==='static'\)\{flash\('서버에 등록된 이웃가게에서만 후기를 남길 수 있습니다\.'/);
assert.match(shops, /__benefitWalletMode='unknown'/);
assert.match(shops, /__benefitClaimBridge\.listMine\(\)/);
assert.match(shops, /if\(PRODUCTION_SERVER_MODE\).*__benefitWallet\.has\(benefitId\)/s);
assert.match(shops, /businessAuthorityState='error';draw\(\)/);

assert.match(activityHtml, /assets\/saved-shops-bridge\.js/);
assert.match(activityHtml, /assets\/benefit-claim-bridge\.js/);
assert.match(activity, /__danjionActivitySpecialServerOwned=true/);
assert.match(activity, /Runtime\.create\(\{apiBase\}\)[\s\S]*await bridge\.load\(\)/);
assert.match(activity, /createBenefitClaimBridge\(\{apiBase,complexSlug:'banglim-myeongji-roadhill'\}\)\.listMine\(\)/);
assert.match(activity, /if\(globalThis\.__danjionActivitySpecialServerOwned\)return/);
assert.match(activity, /summaryName\.textContent='나의 기록'/);
assert.match(activity, /applyCountsToDom\(\);\n  bridge\.summary\(\)/);

console.log('leaf-b743-server-authority-shops-activity-contract: PASS');
