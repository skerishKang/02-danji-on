import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const frontend=join(here,'..');
const read=(name)=>readFileSync(join(frontend,name),'utf8');

const landing=read('index.html');
const shop=read('01_이웃가게_발견.html');
const shopDetail=read('02_이웃가게_상세.html');
const coupon=read('03_주민혜택_쿠폰.html');
const apartment=read('08_아파트소식_목록.html');
const residentNews=read('10_주민소식_목록.html');
const conversation=read('21_메시지_대화상세.html');
const profile=read('22_주민_공개프로필.html');
const settings=read('24_설정.html');
const activity=read('assets/pages/activity-28.js');

assert.ok(
  landing.includes("event.key==='Escape'&&!layer.hidden") && landing.includes('authModal.close()'),
  'landing auth dialog must dismiss through authModal.close() on Escape'
);

assert.ok(
  shop.includes("if(e.key==='Escape'){if(document.getElementById('shopInquiryModal').classList.contains('open'))closeShopInquiry();else if(document.getElementById('shopReviewWriteModal').classList.contains('open'))closeReviewWrite();else if(coupon.classList.contains('open'))closeCoupon();else if(review.classList.contains('open'))closeReview();else if(modal.classList.contains('open'))closeShop()}"),
  'neighbor-shop popup stack must dismiss the topmost custom modal on Escape'
);

assert.ok(
  shopDetail.includes("event.key==='Escape'&&shareModal.classList.contains('open')") &&
  shopDetail.includes("e.key==='Escape'&&layer.classList.contains('open')"),
  'shop detail share and write/inquiry sheets must both support Escape'
);

assert.ok(
  coupon.includes("event.key==='Escape'&&backdrop.classList.contains('open')"),
  'resident-benefit coupon sheet must dismiss on Escape'
);

assert.ok(
  apartment.includes('<dialog id="storyDialog">'),
  'apartment-news detail must remain a native dialog so browser Escape semantics apply'
);

assert.ok(
  residentNews.includes("if(e.key==='Escape')setDrawer(false)"),
  'resident-news submission drawer must dismiss on Escape'
);

assert.ok(
  conversation.includes("if(event.key==='Escape'){layer.classList.remove('open');more.classList.remove('open')"),
  'message conversation overlay must dismiss on Escape'
);

assert.ok(
  profile.includes("event.key==='Escape'&&document.querySelector('.overlay.open')") &&
  profile.includes('closeTopLayer()'),
  'resident profile must dismiss only the topmost open custom overlay on Escape'
);

assert.ok(
  settings.includes("e.key==='Escape'&&layer.classList.contains('open')") &&
  settings.includes("event.key==='Escape'&&layer.classList.contains('open')"),
  'settings account/legal/delete dialogs must preserve Escape dismissal'
);

assert.ok(
  activity.includes("e.key==='Escape'&&activityDetailModal?.classList.contains('open')") &&
  activity.includes("if(e.key==='Escape'){if(coupon.classList.contains('open'))closeCoupon();else if(modal.classList.contains('open'))closeShop()}"),
  'activity detail/shop/coupon modals must preserve Escape dismissal'
);

for (const page of [landing,shop,shopDetail,coupon,profile,settings]) {
  assert.ok(page.includes('aria-modal="true"'), 'custom modal surfaces must retain aria-modal semantics');
}

console.log('leaf-b638-modal-escape-contract: PASS');
