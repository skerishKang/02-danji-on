import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Historical filename retained so the test manifest stays stable.
// Owner operations supersede #735's per-household SMS-code UX for the
// canonical resident flow: the management office can send only one common
// broadcast message to all households.
const root = new URL('../', import.meta.url);
const [page, index, bridge, adminBridge, adminHtml] = await Promise.all([
  readFile(new URL('26_우리집연결.html', root), 'utf8'),
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/household-claim-bridge.js', root), 'utf8'),
  readFile(new URL('assets/danjion-admin-console.js', root), 'utf8'),
  readFile(new URL('admin/index.html', root), 'utf8')
]);

assert.match(page, /우리집[\s\S]*연결/);
assert.match(page, /가입한 뒤 살고 있는 동·호를 직접 선택해 주세요/);
assert.doesNotMatch(page, /id="nickname"|resident\.updateProfile\(\{nickname/,
  'nickname editing belongs to My Info, not household association');
assert.match(page, /id="buildingSelect"/);
assert.match(page, /id="unitSelect"/);
assert.match(page, /household\.listUnits\(\)/);
assert.match(page, /household\.associate\(unitId\)/);
assert.match(page, /같은 세대 기본 2명까지 자동 연결/);
assert.match(page, /3명째부터 운영팀이 확인/);
assert.doesNotMatch(page, /resident-verification-code-bridge\.js|id="residentCode"|인증코드 요청/,
  'canonical resident UI must not require a household-specific SMS code');

assert.match(bridge, /async associate\(unitIdInput\)/);
assert.match(bridge, /\$\{householdPath\}\/associate/);
assert.match(bridge, /JSON\.stringify\(\{ unitId \}\)/);
const associateFn = bridge.match(/async associate\(unitIdInput\) \{([\s\S]*?)\n    \},\n    async claim/);
assert.ok(associateFn, 'associate function must be statically bounded before the legacy token claim function');
assert.doesNotMatch(associateFn[1], /token/i,
  'unit association itself must not require an invitation or household code');

assert.match(index, /location\.replace\('26_우리집연결\.html\?from=onboarding'\)/,
  'successful social signup must continue to the canonical unit-selection onboarding');
assert.match(index, /location\.href='26_우리집연결\.html\?from=onboarding'/,
  'successful email signup must continue to the canonical unit-selection onboarding');

// Code-management source may remain staged while #735/#746 are reconciled,
// but it must no longer be the resident-facing canonical authority.
assert.match(adminBridge, /resident-verification\/household-codes/);
assert.match(adminHtml, /세대 코드 생성 · 재발급/);
assert.doesNotMatch(page, /household-codes|세대 코드 생성 · 재발급/);

console.log('leaf-b735 owner-operations override contract: PASS');
