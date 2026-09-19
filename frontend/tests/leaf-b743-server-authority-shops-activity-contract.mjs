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
const shopDataStart=shops.indexOf(" let SHOP_DATA=[");
const shopDataEnd=shops.indexOf(" const __V3_PRESENTATION",shopDataStart);
assert.ok(shopDataStart>=0&&shopDataEnd>shopDataStart,'SHOP_DATA bounds must remain inspectable');
const shopFallback=shops.slice(shopDataStart,shopDataEnd);
assert.equal((shopFallback.match(/reviews:\[\]/g)||[]).length,8,
  'presentation fallback may keep shop copy but must not ship resident-authored review facts');
assert.doesNotMatch(shopFallback,/연블리|산책메이트|하루한잔|방림회관|방림생활/,
  'prototype resident identities must not exist in shop review fallback');
assert.match(shops,/const __V3_COPY_FALLBACK=SHOP_DATA\.map\(s=>\(\{\.\.\.s,reviews:\[\]\}\)\);/,
  'copy fallback must defensively scrub review authority');
assert.match(shops,/cm\.author\.nickname/,
  'server review comments must render the server-returned author nickname');
assert.match(shops,/c\.comment\.author\.nickname/,
  'new review comments must append the server-returned author nickname');
assert.doesNotMatch(shops, /danjion:demo:shop-inquiries/);
assert.doesNotMatch(shops, /push\(\['연블리','방금',v\]\)/);
assert.match(shops, /r\.mode==='static'\)\{flash\('서버에 등록된 이웃가게에서만 후기를 남길 수 있습니다\.'/);
assert.match(shops, /__benefitWalletMode='unknown'/);
assert.match(shops, /__benefitClaimBridge\.listMine\(\)/);
assert.match(shops, /if\(PRODUCTION_SERVER_MODE\).*__benefitWallet\.has\(benefitId\)/s);
assert.match(shops, /businessAuthorityState='error';draw\(\)/);
assert.match(shops, /r\.mode==='resident-verification-required'\)\{flash\('우리집 연결과 주민 확인을 완료한 뒤 후기를 등록할 수 있습니다\.'/,
  'review 403 resident boundary must never be shown as logged out');
assert.match(shops, /r\.mode==='resident-verification-required'\)\{flash\('우리집 연결과 주민 확인을 완료한 뒤 가게에 문의할 수 있습니다\.'/,
  'shop inquiry 403 resident boundary must stay distinct from 401');
assert.match(shops, /r\.mode==='resident-verification-required'\)\{flash\('우리집 연결과 주민 확인을 완료한 뒤 혜택을 받을 수 있습니다\.'/,
  'benefit 403 resident boundary must stay distinct from 401');
assert.match(shops, /r\.mode==='forbidden'\)\{flash\('이 후기를 등록할 권한이 없습니다\.'/,
  'bounded review 403 must surface as forbidden');
assert.match(shops, /r\.mode==='forbidden'\)\{flash\('이 가게에 문의할 권한이 없습니다\.'/,
  'bounded inquiry 403 must surface as forbidden');
assert.match(shops, /r\.mode==='forbidden'\)\{flash\('이 혜택을 받을 권한이 없습니다\.'/,
  'bounded benefit 403 must surface as forbidden');

assert.match(activityHtml, /assets\/saved-shops-bridge\.js/);
assert.match(activityHtml, /assets\/benefit-claim-bridge\.js/);
assert.match(activity, /__danjionActivitySpecialServerOwned=true/);
assert.match(activity, /Runtime\.create\(\{apiBase\}\)[\s\S]*await bridge\.load\(\)/);
assert.match(activity, /createBenefitClaimBridge\(\{apiBase,complexSlug:'banglim-myeongji-roadhill'\}\)\.listMine\(\)/);
assert.match(activity, /if\(globalThis\.__danjionActivitySpecialServerOwned\)return/);
assert.match(activity, /summaryName\.textContent='나의 기록'/);
assert.match(activity, /applyCountsToDom\(\);\n  bridge\.summary\(\)/);

console.log('leaf-b743-server-authority-shops-activity-contract: PASS');
