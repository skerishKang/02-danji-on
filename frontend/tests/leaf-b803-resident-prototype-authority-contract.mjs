import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');

const [
  community,
  shops,
  consistency,
  activityHtml,
  activity,
  communityDetail,
  reviewsBridge,
] = await Promise.all([
  read('12_이웃대화_첫화면.html'),
  read('01_이웃가게_발견.html'),
  read('assets/consistency.js'),
  read('28_나의활동.html'),
  read('assets/pages/activity-28.js'),
  read('13_이웃대화_글상세_댓글.html'),
  read('assets/reviews-bridge.js'),
]);

// #803: canonical community must never paint prototype resident posts before
// server authority resolves.
assert.doesNotMatch(community, /const\s+POSTS\s*=/);
assert.doesNotMatch(community, /연블리|초록문|길고양이|봄날/);
assert.match(community, /data-server-placeholder="true"/);
assert.match(community, /result\.posts/);
assert.match(community, /p\.author\.nickname/);

// The non-production shop presentation fallback may keep shop copy/images, but
// it must not carry resident-authored review facts or identities.
const shopStart = shops.indexOf(' let SHOP_DATA=[');
const shopEnd = shops.indexOf(' const __V3_PRESENTATION', shopStart);
assert.ok(shopStart >= 0 && shopEnd > shopStart, 'SHOP_DATA bounds must remain inspectable');
const shopFallback = shops.slice(shopStart, shopEnd);
assert.doesNotMatch(shopFallback, /reviews:\[\[/);
assert.doesNotMatch(shopFallback, /연블리|산책메이트|하루한잔|방림회관|방림생활/);
assert.equal((shopFallback.match(/reviews:\[\]/g) || []).length, 8);
assert.match(shops, /r\.author\?\.nickname\|\|''/);
assert.match(shops, /c\.comment\.author\.nickname/);

// Legacy detail enhancement must not invent resident reviews or local review
// writes. Canonical review writes live on the server-backed shop surface.
assert.match(consistency, /const storeReviews=\(\)=>\{\};/);
assert.doesNotMatch(consistency, /연블리 · 방림명지로드힐 주민|산책메이트 · 방림명지로드힐 주민/);
assert.doesNotMatch(consistency, /review\.innerHTML='<header><b>/);

// My Activity must not ship a resident identity or fake personal activity rows
// that can flash before server hydration.
assert.doesNotMatch(activityHtml, /연블리/);
assert.match(activityHtml, />나의 기록</);
assert.doesNotMatch(activity, /연블리/);
assert.equal((activity.match(/items:\[\]/g) || []).length >= 4, true);

// Canonical comment/reply rendering remains exclusively server-authored.
assert.doesNotMatch(communityDetail, /연블리/);
assert.match(communityDetail, /c\.author\.nickname/);
assert.match(communityDetail, /r\.author\.nickname/);
assert.match(communityDetail, /post\.author\.nickname/);
assert.doesNotMatch(reviewsBridge, /연블리/);
assert.match(reviewsBridge, /nickname:String\(author\.nickname\|\|''\)/);

console.log('leaf-b803-resident-prototype-authority-contract: PASS');
