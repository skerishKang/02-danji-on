import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..');
const read = (name) => fs.readFileSync(path.join(frontend, name), 'utf8');

const application = read('25A_신청제보.html');
const labelledControls = {
  ownerShopName: 'ownerShopName',
  ownerRelation: 'ownerRelation',
  ownerRelationEtc: 'ownerEtc',
  reportShopName: 'reportShopName',
  reportRelation: 'reportRelation',
  reportRelationEtc: 'reportEtc',
  category: 'category',
  hours: 'hours',
  servicePrice: 'servicePrice',
  locationUse: 'locationUse',
  benefit: 'benefit',
  contact: 'contact',
  extraIntro: 'extraIntro',
  reportWhat: 'reportWhat',
  reportPrice: 'reportPrice',
  reportHours: 'reportHours',
  reportLocation: 'reportLocation',
  reportReason: 'reportReason',
};

for (const [name, id] of Object.entries(labelledControls)) {
  assert.ok(application.includes(`for="${id}"`), `25A visible label must target ${id}`);
  assert.match(application, new RegExp(`<(?:input|select|textarea)[^>]*id="${id}"[^>]*name="${name}"`),
    `25A control ${name} must keep its name and expose id ${id}`);
}

for (const [id, label] of Object.entries({
  ownerProof: '운영 확인서류',
  ownerOtherDocs: '기타 증빙자료',
  photos: '가게·작업 사진',
  extraDocs: '추가 참고자료',
})) {
  assert.ok(application.includes(`id="${id}" aria-label="${label}"`),
    `25A hidden file input ${id} must expose an accessible name`);
}

const communityDetail = read('13_이웃대화_글상세_댓글.html');
assert.ok(communityDetail.includes('<label for="commentText"><b>댓글 쓰기</b></label>'),
  'community comment composer must label #commentText');

const messageDetail = read('21_메시지_대화상세.html');
assert.ok(messageDetail.includes('<h2 id="replyComposerTitle">답장 쓰기</h2>'));
assert.ok(messageDetail.includes('id="reply" aria-labelledby="replyComposerTitle"'),
  'message reply textarea must reference its visible heading');

const profile = read('22_주민_공개프로필.html');
assert.ok(profile.includes('<h2 id="profileMessageTitle">산책메이트님에게 메시지</h2>'));
assert.ok(profile.includes('aria-labelledby="profileMessageTitle" maxlength="500"'),
  'profile message textarea must reference its visible heading');

const residentNews = read('10_주민소식_목록.html');
assert.ok(residentNews.includes('<label for="residentFiles">사진·자료</label><input id="residentFiles"'),
  'resident-news file input must be bound to its visible label');

for (const name of [
  '00_APP_390_통합검토.html',
  '00_주민혜택_AB비교.html',
  '03_주민혜택_쿠폰_v2.html',
]) {
  assert.ok(read(name).includes('<meta name="robots" content="noindex,nofollow">'),
    `${name} must not be indexable on the Production hostname`);
}

console.log('LEAF_1119_1120_SIGNED_OUT_A11Y_HYGIENE=PASS');
