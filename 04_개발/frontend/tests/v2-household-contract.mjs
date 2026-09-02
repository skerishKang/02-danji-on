import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [client, portal, main, backend] = await Promise.all([
  readFile(new URL('src/household-family-client.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2HouseholdPortal.tsx', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8'),
  readFile(new URL('../backend/src/household-family-v2.ts', root), 'utf8')
]);

assert.match(client, /authenticatedFetch\(/);
assert.match(client, /\/api\/v1\/complexes\/\$\{encodeURIComponent\(COMPLEX_SLUG\)\}\/household/);
assert.match(client, /\/family-invites/);
assert.match(client, /\/api\/v1\/household\/family-invites\/redeem/);
assert.match(client, /\/members\/me/);
assert.match(client, /\/members\/\$\{encodeURIComponent\(membershipId\)\}/);
assert.doesNotMatch(client, /localStorage|sessionStorage|indexedDB/i,
  'household authority and invite token must never be persisted in browser storage');
assert.doesNotMatch(client, /buildingCode|unitCode|unitId|evidenceObjectKey|provider/i,
  'safe Household client model must discard exact residence/provider fields returned by backend');

assert.match(portal, /data-v2-household-panel/);
assert.match(portal, /createInvite\(24\)/);
assert.match(portal, /data-v2-household-one-time-token/);
assert.match(portal, /revokeInvite\(invite\.inviteId\)/);
assert.match(portal, /redeemInvite\(redeemToken\)/);
assert.match(portal, /verificationRequired/);
assert.match(portal, /주민 권한은 아직 부여되지 않습니다/);
assert.match(portal, /confirmRemoveId !== membershipId/,
  'first member-removal click must arm confirmation instead of mutating');
assert.match(portal, /confirmRemoveId === member\.membershipId/,
  'armed member must render the explicit second-step confirmation action');
assert.match(portal, /confirmLeave/);
assert.doesNotMatch(portal, /buildingCode|unitCode|unitId|evidenceObjectKey|provider/i,
  'V2 Household UI must not render exact residence/provider identity');
assert.match(main, /V2HouseholdPortal/);

assert.match(backend, /unit: \{ buildingCode:/,
  'backend may carry exact unit data internally; frontend must intentionally drop it');
assert.match(backend, /residentVerified: false,[\s\S]*verificationRequired: true/,
  'family invite redemption must stay pending verification');
assert.match(backend, /PRIMARY_TRANSFER_REQUIRED/,
  'primary member cannot leave through the ordinary member-leave path');

console.log('PASS V2 Household-v2 authority/privacy/invite-token contract');
