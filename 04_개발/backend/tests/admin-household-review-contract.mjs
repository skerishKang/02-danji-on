import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [api, app, adminBridge, adminPage, onboarding] = await Promise.all([
  readFile(new URL('src/admin-household-review-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('../../frontend/assets/danjion-admin-console.js', root), 'utf8'),
  readFile(new URL('../../frontend/admin/index.html', root), 'utf8'),
  readFile(new URL('src/household-unit-association-v1.ts', root), 'utf8')
]);

assert.match(api, /resident\.verification\.manage/,
  'household review must use the bounded resident.verification.manage capability');
assert.match(api, /resolvePadiemAuthority/,
  'household review authority must resolve from the PADIEM authority plane');
assert.doesNotMatch(api, /requireOperationalAuthority|complex_operator_grants|resident_council/,
  'initial rollout must not grant household review to council/complex operational authority');

assert.match(api, /\/household-memberships\$\//,
  'pending queue must have a dedicated admin household-memberships route');
assert.match(api, /ranked\.status = 'pending'/,
  'admin queue must expose pending memberships only');
assert.match(api, /ranked\.member_position >= 3/,
  'admin queue must be bounded to third-and-later household memberships');
assert.match(api, /row_number\(\) over[\s\S]*partition by hm\.household_id/,
  'member position must be server-derived per household');
assert.doesNotMatch(api, /where hm\.status in \('pending','verified'\)[\s\S]{0,240}row_number/,
  'historical member position must not collapse when earlier members are revoked');

assert.match(api, /decision !== 'approve' && decision !== 'reject'/,
  'review mutation must accept only approve/reject decisions');
assert.match(api, /status = \$\{nextStatus\}/,
  'review result must be persisted in the canonical membership row');
assert.match(api, /hm\.status = 'pending'/,
  'review mutation must only transition a still-pending membership');
assert.match(api, /for update of hm/,
  'review mutation must lock the target membership before changing it');
assert.match(api, /household\.membership\.review/,
  'approve/reject must write an explicit audit action');
assert.match(api, /HOUSEHOLD_MEMBERSHIP_APPROVED/);
assert.match(api, /HOUSEHOLD_MEMBERSHIP_REJECTED/);

assert.match(api, /accountReference: String\(row\.user_id\)\.slice\(0, 8\)/,
  'queue must return a bounded account reference rather than a full user identifier');
assert.doesNotMatch(api, /email|phone|contact/i,
  'review response must not broaden into resident contact/PII fields');

assert.match(app, /handleAdminHouseholdReviewRequest/);
assert.ok(
  app.indexOf('handleAdminHouseholdReviewRequest(request, env, id)') <
    app.indexOf('handleAdminRequest(request, env, id)'),
  'household review handler must intercept before the terminal admin fallback'
);

assert.match(adminBridge, /id: 'householdReviews'/);
assert.match(adminBridge, /household-memberships\?status=pending/);
assert.match(adminBridge, /reviewHouseholdMembership/);
assert.match(adminBridge, /JSON\.stringify\(\{ decision: nextDecision \}\)/);

assert.match(adminPage, /우리집 연결 승인/);
assert.match(adminPage, /function householdReviewControls/);
assert.match(adminPage, /'approve','승인'/);
assert.match(adminPage, /'reject','거절·해제'/);
assert.match(adminPage, /appendHouseholdReviewFacts/);
assert.match(adminPage, /계정 참조/);
assert.match(adminPage, /세대 순번/);

assert.match(onboarding, /AUTO_CONNECT_MEMBER_LIMIT = 2/);
assert.match(onboarding, /member_count < \$\{AUTO_CONNECT_MEMBER_LIMIT\} then 'verified' else 'pending'/,
  'first-two auto-connect rule must remain unchanged');

console.log('PASS #755 bounded PADIEM household membership review contract');
