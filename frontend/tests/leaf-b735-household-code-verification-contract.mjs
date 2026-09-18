import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [page, bridge, adminBridge, adminHtml] = await Promise.all([
  readFile(new URL('26_우리집연결.html', root), 'utf8'),
  readFile(new URL('assets/resident-verification-code-bridge.js', root), 'utf8'),
  readFile(new URL('assets/danjion-admin-console.js', root), 'utf8'),
  readFile(new URL('admin/index.html', root), 'utf8')
]);

assert.match(page, /주민인증[\s\S]*우리집 연결/);
assert.match(page, /세대별 코드를 입력해 주세요/);
assert.match(page, /동·호를 다시 입력할 필요 없이/);
assert.match(page, /id="residentCode"/);
assert.match(page, /인증코드 요청/);
assert.match(page, /문의하기/);
assert.match(page, /사진이나 서류 첨부는 필요하지 않습니다/);
assert.match(page, /assets\/resident-verification-code-bridge\.js/);
assert.match(page, /assets\/inquiry-bridge\.js/);
assert.doesNotMatch(page, /localStorage|sessionStorage/,
  'canonical resident verification page must never mint household/resident authority in browser storage');
assert.doesNotMatch(page, /danjionResidentCodeEntered|danjionDong|danjionHo/,
  'legacy prototype resident authority markers must not survive on page 26');

assert.match(bridge, /\/api\/v1\/complexes\/'/);
assert.match(bridge, /resident-verification\/code/);
assert.match(bridge, /\/household'/);
assert.match(bridge, /resident_verification_code_request/);
assert.match(bridge, /inquiry\.submitGeneral/);
assert.match(bridge, /HOUSEHOLD_ASSOCIATION_REQUIRED/);
assert.match(bridge, /RESIDENT_CODE_INVALID/);
assert.doesNotMatch(bridge, /localStorage|sessionStorage/);

assert.match(adminBridge, /requiredScope: 'resident\.verification\.manage'/);
assert.match(adminBridge, /resident-verification\/household-codes/);
assert.match(adminBridge, /householdCodeActions: true/);
assert.match(adminBridge, /provisionHouseholdCode/);
assert.match(adminBridge, /revokeHouseholdCode/);
assert.doesNotMatch(adminBridge, /id: 'verifications'[\s\S]{0,260}policyHold: true/,
  'new household code admin surface must supersede the old policy-hold placeholder');

assert.match(adminHtml, /세대 코드 생성 · 재발급/);
assert.match(adminHtml, /ONE-TIME DISPLAY/);
assert.match(adminHtml, /코드 폐기/);
assert.match(adminHtml, /navigator\.clipboard\.writeText/);
assert.match(adminHtml, /분실하면 기존 코드를 조회하지 말고 재발급/);

console.log('leaf-b735-household-code-verification-contract: PASS');
