import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [bridge, profile] = await Promise.all([
  readFile(new URL('../assets/resident-bridge.js', import.meta.url), 'utf8'),
  readFile(new URL('../22_주민_공개프로필.html', import.meta.url), 'utf8')
]);

assert.match(bridge, /async function blockedUsers\(\)/);
assert.match(bridge, /\/api\/v1\/me\/blocks/);
assert.match(bridge, /async function blockResident\(userId\)/);
assert.match(bridge, /async function unblockResident\(userId\)/);
assert.match(bridge, /async function reportResident\(userId, reason, detail\)/);
assert.match(bridge, /targetType: 'resident'/);
assert.match(bridge, /\/api\/v1\/me\/reports/);

for (const reason of ['abuse', 'spam', 'privacy', 'other']) {
  assert.ok(profile.includes(`data-report-reason="${reason}"`), `profile report UI must map ${reason}`);
}

assert.match(profile, /globalThis\.__danjionProfileSafety=\{bridge:bridge,userId:userId\}/);
assert.match(profile, /bridge\.blockedUsers\(\)\.then/);
assert.match(profile, /reportResident\(safety\.userId,selected\.dataset\.reportReason\)/);
assert.match(profile, /blockResident\(safety\.userId\)/);
assert.match(profile, /unblockResident\(safety\.userId\)/);
assert.doesNotMatch(profile, /if\(pendingAction==='block'\)blocked=true;if\(pendingAction==='unblock'\)blocked=false/,
  'profile must not treat local state mutation as safety authority');

console.log('PASS profile safety controls persist through canonical blocks/reports APIs');
