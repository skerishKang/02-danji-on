import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [api, app, bridge, page] = await Promise.all([
  readFile(new URL('src/household-unit-association-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('../../frontend/assets/household-claim-bridge.js', root), 'utf8'),
  readFile(new URL('../../frontend/26_우리집연결.html', root), 'utf8')
]);

assert.match(api, /household\\\/associate\$?\//,
  'unit association must have a dedicated household/associate route');
assert.match(api, /requireActor\(/, 'association requires an authenticated account');
assert.match(api, /Object\.keys\(record\)\.some\(\(key\) => key !== 'unitId'\)/,
  'client may submit only the selected unitId');
assert.match(api, /AUTO_CONNECT_MEMBER_LIMIT = 2/,
  'owner pilot rule: the first two accounts in a household auto-connect');
assert.match(api, /member_count < \$\{AUTO_CONNECT_MEMBER_LIMIT\} then 'verified' else 'pending'/,
  'third and later accounts must remain pending for operations review');
assert.match(api, /for update/,
  'household row must be locked before deciding the auto-connect position');
assert.match(api, /membership_role[\s\S]*primary_count = 0 then 'primary' else 'member'/,
  'first household account becomes primary and later accounts become members');
assert.match(api, /HOUSEHOLD_ASSOCIATION_CONFLICT/,
  'an account already associated with another unit must fail closed');
assert.doesNotMatch(api, /residentCode|verificationCode|code_verifier|HOUSEHOLD_CODE_PEPPER/,
  'owner unit-selection onboarding must not depend on household SMS codes');

assert.match(app, /handleHouseholdUnitAssociationRequest/);
assert.ok(
  app.indexOf('handleHouseholdUnitMasterRequest(request, env, id)') <
    app.indexOf('handleHouseholdUnitAssociationRequest(request, env, id)'),
  'unit master read must remain available before the association mutation'
);

assert.match(bridge, /async associate\(unitIdInput\)/);
assert.match(bridge, /\$\{householdPath\}\/associate/);
assert.match(bridge, /JSON\.stringify\(\{ unitId \}\)/);

assert.doesNotMatch(page, /id="nickname"|resident\.updateProfile\(\{nickname/,
  'nickname editing belongs to My Info, not household association');
assert.match(page, /id="buildingSelect"/);
assert.match(page, /id="unitSelect"/);
assert.match(page, /household\.listUnits\(\)/);
assert.match(page, /household\.associate\(unitId\)/);
assert.match(page, /같은 세대 기본 2명까지 자동 연결/);
assert.match(page, /3명째부터 운영팀이 확인/);
assert.doesNotMatch(page, /resident-verification-code-bridge|id="residentCode"|세대별 코드 하나/,
  'canonical onboarding page must not expose the retired household-code flow');

console.log('PASS owner-approved unit selection household onboarding contract');
