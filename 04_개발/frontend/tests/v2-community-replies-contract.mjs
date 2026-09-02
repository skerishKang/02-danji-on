import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [client, view, replyApi, residentApi] = await Promise.all([
  readFile(new URL('src/community-api.ts', root), 'utf8'),
  readFile(new URL('src/v2/visual/V2CommunityView.tsx', root), 'utf8'),
  readFile(new URL('../backend/src/community-replies-v1.ts', root), 'utf8'),
  readFile(new URL('../backend/src/community-resident-v1.ts', root), 'utf8')
]);

assert.match(client, /export interface CommunityReply extends CommunityComment/,
  'frontend must model the canonical reply payload');
assert.match(client, /async listReplies\(postId: string, parentCommentId: string\)/,
  'frontend must expose reply listing');
assert.match(client, /async createReply\(postId: string, parentCommentId: string, body: string\)/,
  'frontend must expose reply creation');
assert.match(client, /comments\/\$\{encodeURIComponent\(parentCommentId\)\}\/replies/,
  'frontend reply client must use the canonical nested route');

assert.match(view, /communityApi\.listReplies\(selected\.id, parentCommentId\)/,
  'V2 Community must list replies from the backend');
assert.match(view, /communityApi\.createReply\(selected\.id, parentCommentId, text\)/,
  'V2 Community must create replies through the backend');
assert.match(view, /data-v2-community-replies/);
assert.match(view, /data-v2-community-reply-form/);
assert.match(view, /screenCommunityText\('', text\)/,
  'reply composition must retain the existing client-side safety screen while server policy remains authoritative');
assert.doesNotMatch(view, /buildingCode|unitCode|unitId|residentCode|evidenceObjectKey|authUserId/i,
  'nested reply UI must not expose exact residence or provider identity');

assert.match(replyApi, /requireVerifiedResident\(/,
  'nested reply backend remains verified-resident only');
assert.match(replyApi, /insert into community_comments/i,
  'nested replies must continue using canonical community_comments persistence');
assert.match(residentApi, /c\.parent_comment_id is null/i,
  'top-level comment feed must exclude nested reply rows');

console.log('PASS V2 Community nested reply authority/rendering contract');
