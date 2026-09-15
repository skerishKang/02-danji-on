import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (name) => readFile(new URL('../'+name, import.meta.url), 'utf8');
const list = await read('12_이웃대화_첫화면.html');
const detail = await read('13_이웃대화_글상세_댓글.html');
const write = await read('14_가입인사_글쓰기.html');
const bridge = await read('assets/community-bridge.js');

assert.ok(write.includes("bridge.createPost({kind:'greeting'"),
  'greeting writer must persist the canonical greeting server kind');
assert.ok(bridge.includes("'greeting'"),
  'community bridge must continue accepting greeting as a canonical post kind');

assert.ok(list.includes("hello:'greeting'"),
  'greeting tab must query the server greeting kind');
assert.ok(list.includes("greeting:'가입인사'"),
  'server greeting rows must have a visible label');
assert.ok(list.includes("greeting:'hello'"),
  'server greeting rows must map back to the greeting tab');
assert.ok(list.includes("hello:'14_가입인사_글쓰기.html'"),
  'server-mode greeting write action must route to the greeting writer');
assert.ok(list.includes("13_이웃대화_글상세_댓글.html?apiBase=") &&
          list.includes("&post="),
  'server greeting rows must use the canonical server detail route');
assert.equal(list.includes('가입인사는 아직 server kind가 없으므로'), false,
  'stale built-in-only greeting authority must be removed');

assert.ok(detail.includes("greeting:'가입인사'"),
  'server greeting detail must render the greeting label');
assert.ok(detail.includes("greeting:'hello'"),
  'server greeting detail back link must return to the greeting tab');
assert.ok(detail.includes("backLink.href='12_이웃대화_첫화면.html?type='+CHIP[post.kind]"),
  'detail back link must use the canonical server-kind chip map');

console.log('PASS #530 greeting write -> list -> detail server continuity');
