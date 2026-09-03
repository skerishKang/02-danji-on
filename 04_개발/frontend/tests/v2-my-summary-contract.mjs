import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [client, panel, portal, main, pkg] = await Promise.all([
  readFile(new URL('src/resident-summary-client.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2MySummaryPanel.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2MySummaryPortal.tsx', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8'),
  readFile(new URL('package.json', root), 'utf8')
]);

assert.match(client, /import \{ authenticatedFetch \} from '\.\/auth-fetch'/,
  'My summary must use the canonical authenticated fetch');
assert.match(client, /authenticatedFetch\([\s\S]*'resident'\)/,
  'My summary API mode must use the resident auth surface');
assert.match(client, /\/api\/v1\/me\/summary\?complexSlug=\$\{encodeURIComponent\(COMPLEX_SLUG\)\}/,
  'My summary must call the canonical backend projection');
assert.doesNotMatch(client, /localStorage|sessionStorage|indexedDB|getBookmarks|listMyActivity|listConversations/i,
  'My summary must not reconstruct authority from browser stores or sibling domain clients');

for (const field of [
  'postCount',
  'commentCount',
  'receivedReactionCount',
  'savedBusinessCount',
  'unreadMessageCount',
  'membershipRole'
]) {
  assert.match(panel, new RegExp(`summary\\.${field}|summary\\.household\\.${field}`),
    `V2 My summary must render ${field}`);
}
assert.match(panel, /data-v2-my-summary/,
  'V2 My summary needs a stable browser-test surface');
assert.doesNotMatch(panel, /warmth|receivedBenefit|buildingCode|unitCode|householdId|membershipId|residentCode|verificationProof|providerIdentity/i,
  'V2 My summary must not add HOLD metrics or private residence/provider identifiers');
assert.match(portal, /document\.querySelector<HTMLElement>\('\.v2-profile-dialog'\)/,
  'summary must augment the existing My dialog instead of redesigning V2');
assert.match(main, /<V2MySummaryPortal \/>/,
  'V2 bootstrap must mount the My summary portal');
assert.match(pkg, /test:v2-my-summary-contract/,
  'frontend typecheck must permanently execute the My summary contract');

console.log('PASS V2 My DanjiOn canonical safe summary authority/privacy contract');
