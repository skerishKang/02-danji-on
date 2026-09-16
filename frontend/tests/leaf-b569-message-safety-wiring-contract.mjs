import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [page, bridge] = await Promise.all([
  readFile(new URL('../21_메시지_대화상세.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/resident-bridge.js', import.meta.url), 'utf8')
]);

assert.match(page, /<script src="assets\/resident-bridge\.js"><\/script>/);
assert.match(page, /globalThis\.__danjionConversationSafety=\{bridge:safetyBridge,userId:participantUserId,complexSlug:participantComplexSlug\}/);
assert.match(page, /await safetyBridge\.blockedUsers\(\)/);
assert.match(page, /globalThis\.__danjionSetConversationBlocked\(isBlocked\)/);
assert.match(page, /await safety\.bridge\.blockResident\(safety\.userId\)/);
assert.match(page, /await safety\.bridge\.unblockResident\(safety\.userId\)/);

assert.doesNotMatch(page, /차단한 시연입니다\. 실제 상태는 바뀌지 않습니다\./);
assert.doesNotMatch(page, /신고가 접수된 시연입니다\. 실제 전송은 하지 않습니다\./);
assert.match(page, /대화 단위 신고는 아직 전송하지 않습니다/);
assert.doesNotMatch(page, /targetType\s*:\s*['"]message['"]/,
  'conversation-level report UI must not be silently reinterpreted as a specific-message report');

assert.match(bridge, /async function blockedUsers\(\)/);
assert.match(bridge, /async function blockResident\(userId\)/);
assert.match(bridge, /async function unblockResident\(userId\)/);

console.log('PASS message-detail resident block authority is server-persisted; ambiguous conversation report stays fail-closed');
