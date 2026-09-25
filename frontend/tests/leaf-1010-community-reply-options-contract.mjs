import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bridge = await readFile(new URL('../assets/community-bridge.js', import.meta.url), 'utf8');

function assertExplicitReplyOptions(source) {
  assert.match(source, /async listReplies\(postId, parentCommentId, options = \{\}\)/,
    'listReplies must expose an explicit options parameter');
  assert.doesNotMatch(source, /listReplies\([\s\S]*arguments\[2\]/,
    'listReplies must not read its third argument through arguments');
  const block = source.slice(source.indexOf('async listReplies('), source.indexOf('async addReply('));
  assert.match(block, /hasLimit = Object\.prototype\.hasOwnProperty\.call\(options, 'limit'\)/,
    'reply pagination must preserve explicit limit handling');
  assert.match(block, /const cursor = trimmedString\(options\.cursor\);[\s\S]*params\.set\('cursor', cursor\)/,
    'reply pagination must preserve cursor handling');
}

assertExplicitReplyOptions(bridge);

const mutation = bridge.replace(
  'async listReplies(postId, parentCommentId, options = {})',
  'async listReplies(postId, parentCommentId) { const options = arguments[2] || {};'
);
assert.notEqual(mutation, bridge, 'reply options mutation must change the source');
assert.throws(() => assertExplicitReplyOptions(mutation), /explicit options parameter/);

console.log('PASS Issue #1010 explicit reply options contract');
