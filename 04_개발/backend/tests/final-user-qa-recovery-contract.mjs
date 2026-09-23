import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const repo = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, repo), 'utf8');
const [settings, blocks, inquiries, accountPage, myPage, notifications, coupon, applyPage, inquiryPage] = await Promise.all([
  read('04_개발/backend/src/resident-settings-v1.ts'),
  read('04_개발/backend/src/resident-blocks-v1.ts'),
  read('04_개발/backend/src/inquiries-v1.ts'),
  read('frontend/24_설정.html'),
  read('frontend/19_내정보_메인.html'),
  read('frontend/27_알림함.html'),
  read('frontend/03_주민혜택_쿠폰.html'),
  read('frontend/25A_신청제보.html'),
  read('frontend/25_1대1문의.html')
]);

// #862: account-owned settings do not issue or require resident authority.
assert.match(settings, /import \{ requireActor \} from '\.\/auth-v1'/);
assert.doesNotMatch(settings, /requireVerifiedResident/);
assert.match(settings, /GET'.*actor\.id|GET'\) return ok\(await loadSettings\(sql, actor\.id\)/s);
assert.match(settings, /PATCH'.*actor\.id|PATCH'\) return updateSettings\(request, sql, actor\.id/);
console.log('PASS #862 settings anonymous=401 via requireActor; unverified GET/PATCH account scope; no resident grant');

// #862 split authority: list/unblock are actor-owned, creation remains resident-only.
assert.match(blocks, /const actor = await requireActor\(request, env, sql, requestId\)/);
assert.match(blocks, /where b\.blocker_user_id = \$\{actor\.id\}/);
assert.match(blocks, /where blocker_user_id = \$\{actor\.id\}/);
assert.match(blocks, /const resident = await requireVerifiedResident\(request, env, sql, requestId, complexSlug\)/);
assert.match(blocks, /targetVerifiedInComplex\(sql, targetUserId, resident\.complexId\)/);
console.log('PASS #862 blocks GET/DELETE account scope; POST resident scope; target verification retained');

// #864: only the three recovery categories are exempt from resident verification.
assert.match(inquiries, /RECOVERY_INQUIRY_TYPES = new Set\(\['resident_verification_code_request', 'account_login', 'household_link'\]\)/);
assert.match(inquiries, /RECOVERY_INQUIRY_TYPES\.has\(String\(row\.inquiry_type\)\)/);
assert.match(inquiries, /const resident = await requireVerifiedResident\(request, env, sql, requestId, String\(row\.complex_slug\)\)/);
assert.match(inquiries, /inquiryType === 'resident_verification_code_request'[\s\S]*requireActor/);
assert.match(inquiries, /RECOVERY_INQUIRY_TYPES\.has\(inquiryType\)[\s\S]*requireActor/);
assert.doesNotMatch(inquiries, /insert into household_memberships|insert into resident_verifications/);
// CASE matrix: signed-out recovery is 401; ordinary resident-scoped stays fail-closed.
assert.match(inquiries, /requireActor\(request, env, sql, requestId\)/);
assert.match(inquiries, /else \{[\s\S]*requireVerifiedResident\(request, env, sql, requestId, complexSlug\)/);
// #864 frontend: canonical recovery enums only — never the dead 'account' alias.
assert.match(inquiryPage, /'계정·로그인':'account_login'/);
assert.match(inquiryPage, /'우리집 연결':'household_link'/);
assert.doesNotMatch(inquiryPage, /activeType\(\)===['"]account['"]/,
  'f25 must not compare against the non-canonical account enum');
assert.match(inquiryPage, /t==='account_login'\|\|t==='household_link'/);
assert.match(inquiryPage, /로그인 후 이용 가능합니다\./);
console.log('PASS #864 recovery create/read/close account scope; ordinary inquiry resident-gated; no grant mutation; f25 uses canonical recovery enums');

// #861/#865: application API close, explicit provider boundary, and truthful sign-out failure.
assert.match(accountPage, /DanjionSession\.danjionApiBase\(\)/);
assert.match(accountPage, /CLOSE_DANJION_ACCOUNT/);
assert.match(accountPage, /외부 로그인 제공자 계정 자체는 이 요청으로 삭제되지 않습니다/);
assert.match(accountPage, /DanjionSession\.danjionAuthBase\(\)/);
assert.match(accountPage, /10000/);
assert.match(accountPage, /제품 계정과 권한은 종료되었습니다/);
assert.doesNotMatch(accountPage, /시연입니다\. 실제 계정은 삭제되지 않았습니다/);
console.log('PASS #861 product API close/provider boundary/sign-out distinction; #865 bounded auth recovery');

// #858: canonical mobile-visible settings target survives consistency CSS.
assert.match(notifications, /24_설정\.html#notifications/);
assert.match(notifications, /settings-link\{display:block/);
assert.match(accountPage, /id="notifications"/);
console.log('PASS #858 notification settings entry target/panel/mobile visibility');

// Coupon sheet owns the mobile stacking context over the bottom navigation.
assert.match(coupon, /\.sheet-backdrop\{[^}]*z-index:120/);
assert.match(coupon, /\.coupon-sheet\{[^}]*z-index:121/);
console.log('PASS coupon sheet close CTA is above mobile navigation hit-test layer');

// #866/#809: report mode has no unsupported photo control; owner mode keeps photos.
const reportSection = applyPage.match(/<section class="section report-only">[\s\S]*?<\/section>/)?.[0] || '';
assert.ok(reportSection, 'report mode section must exist');
assert.doesNotMatch(reportSection, /data-file-add|type="file"/);
assert.match(applyPage, /<div class="upload owner-only">[\s\S]*id="photos"[\s\S]*type="file"/);
console.log('PASS #866 report photo affordance removed; #809 owner photos control retained');

// #863: public-bio link is hidden without a server userId and encoded when present.
assert.match(myPage, /id="mi-public-profile-link"[^>]*hidden/);
assert.match(myPage, /String\(serverProfile&&serverProfile\.userId\|\|''\)/);
assert.match(myPage, /22_주민_공개프로필\.html\?userId='\+encodeURIComponent\(userId\)/);
assert.match(myPage, /serverProfile=r\.profile;syncPublicProfileLink\(\)/);
console.log('PASS #863 public-bio link hidden without userId; encoded exact profile URL persists after save');

console.log('final-user-qa-recovery-contract: PASS');
