import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../13_이웃대화_글상세_댓글.html', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../assets/community-bridge.js', import.meta.url), 'utf8');

assert.ok(bridge.includes('async listReplies(postId, parentCommentId, options = {})'),
  'top-level community bridge must expose nested reply listing with explicit options');
assert.ok(bridge.includes('async addReply(postId, parentCommentId, body)'),
  'top-level community bridge must expose nested reply creation');
assert.ok(
  bridge.includes('/comments/${encodeURIComponent(parent.id)}/replies'),
  'top-level community bridge must use the canonical nested reply route'
);
assert.ok(bridge.includes('parentCommentId: String(raw.parentCommentId || \'\')'),
  'reply normalization must preserve parentCommentId');

assert.ok(page.includes('data-server-reply=') &&
          page.includes('data-server-reply-form=') &&
          page.includes('data-server-replies='),
  'server-rendered comments must include reply control, composer and reply list host');
assert.ok(page.includes('bridge.listReplies(postId,commentId)'),
  'server comment rendering must load nested replies');
assert.ok(page.includes('bridge.addReply(postId,parentId,v)'),
  'server reply form must submit through the canonical bridge');

assert.ok(page.includes("result.status===403?'본인 확인된 입주민만 이용할 수 있습니다.'"),
  '403 interaction failures must surface explicit resident-verification copy');
assert.ok(page.includes("if(!post){flash(loadFailure||'게시물을 불러온 뒤 이용해 주세요.');return}"),
  'reaction click must never silently no-op before server post readiness');
assert.ok(page.includes('id="interactionStatus"') && page.includes('aria-live="polite"'),
  'community detail must expose a visible live interaction status near the action buttons');

const live = page.match(/<script id="danjion-community-detail-live-wiring-329">([\s\S]*?)<\/script>/);
assert.ok(live, 'community detail live wiring script must exist');
assert.doesNotThrow(() => new Function(live[1]),
  'community detail live wiring must remain valid JavaScript');
assert.doesNotThrow(() => new Function(bridge),
  'community bridge must remain valid JavaScript');

assert.ok(page.includes("if(!UUID.test(postId))return;"),
  'non-server prototype/detail mode must remain separate and preserve static behavior');

console.log('PASS #527 community detail server replies + visible resident gate feedback');
