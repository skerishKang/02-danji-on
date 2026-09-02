import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [profileClient, safetyClient, integration, messages, main] = await Promise.all([
  readFile(new URL('src/resident-profile-client.ts', root), 'utf8'),
  readFile(new URL('src/resident-safety-client.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2ResidentProfileIntegration.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2MessagesIntegration.tsx', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

assert.match(profileClient, /\/api\/v1\/me\/profile\?\$\{query\(\)\}/,
  'self profile must use canonical backend profile authority');
assert.match(profileClient, /\/api\/v1\/profiles\/\$\{encodeURIComponent\(userId\)\}\?\$\{query\(\)\}/,
  'other resident profile must use canonical same-complex backend route');
assert.match(profileClient, /authenticatedFetch\(/);
assert.doesNotMatch(profileClient, /localStorage|sessionStorage|indexedDB/i);

assert.match(safetyClient, /\/api\/v1\/me\/blocks\?\$\{query\(\)\}/,
  'blocking must reuse canonical blocks authority');
assert.match(safetyClient, /\/api\/v1\/me\/reports\?\$\{query\(\)\}/,
  'resident reports must reuse canonical safety report authority');
assert.match(safetyClient, /targetType: 'resident'/);
assert.doesNotMatch(safetyClient, /localStorage|sessionStorage|indexedDB/i);

assert.match(integration, /data-v2-self-profile-panel/);
assert.match(integration, /data-v2-resident-profile-dialog/);
assert.match(integration, /residentProfileClient\.getSelf\(\)/);
assert.match(integration, /residentProfileClient\.updateSelf/);
assert.match(integration, /residentProfileClient\.getResident\(userId\)/);
assert.match(integration, /residentMessagesClient\.startConversation\(otherProfile\.userId\)/);
assert.match(integration, /residentSafetyClient\.blockResident\(userId\)/);
assert.match(integration, /residentSafetyClient\.reportResident\(otherProfile\.userId/);
assert.match(integration, /nextNickname\.length > 40/);
assert.match(integration, /nextBio\.length > 300/);
assert.match(integration, /reportDetail\.trim\(\)\.length > 1000/);
assert.doesNotMatch(integration, /warmth|score|building|unitCode|buildingCode|auth_user|provider/i,
  'V2 resident profile must not invent warmth or expose exact residence/provider identity');

assert.match(messages, /danjion:v2-open-resident-profile/,
  'profile entry must originate from a known canonical message participant');
assert.doesNotMatch(messages, /placeholder=.*UUID|name=.*participantUserId/is,
  'message/profile surface must not expose raw user ID entry');
assert.match(main, /V2ResidentProfileIntegration/);

console.log('PASS V2 resident profile/message/block/report authority and privacy contract');
