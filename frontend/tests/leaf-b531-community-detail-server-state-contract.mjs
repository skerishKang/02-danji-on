import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../13_이웃대화_글상세_댓글.html', import.meta.url), 'utf8');

assert.ok(page.includes('<textarea id="commentText" maxlength="300"'),
  'comment composer must expose the canonical 300-character server limit');
assert.equal(page.includes('<textarea id="commentText" maxlength="500"'), false,
  'legacy 500-character comment UI contract must be removed');

const uuidGate = page.indexOf("if(!UUID.test(postId))return;");
const loadingCall = page.indexOf('enterServerLoadingState();');
assert.ok(uuidGate >= 0 && loadingCall > uuidGate,
  'prototype state must be cleared only after a valid server UUID is confirmed');

assert.ok(page.includes("document.getElementById('title').textContent='게시물을 불러오는 중입니다.'"),
  'server detail must replace prototype title with an explicit loading state');
assert.ok(page.includes("commentList.innerHTML='<li class=\"comment\"><p>댓글을 불러오는 중입니다.</p></li>'"),
  'server detail must replace prototype comments before asynchronous loading');

assert.ok(page.includes("gatedCommentState(msg);\n   flash(msg);"),
  'comment-list failures must replace, not retain, prototype comments');
assert.ok(page.includes("host.replaceChildren();") &&
          page.includes("message.textContent=failMessage(result);"),
  'reply-list failures must render a safe explicit failure state');

const live = page.match(/<script id="danjion-community-detail-live-wiring-329">([\s\S]*?)<\/script>/);
assert.ok(live, 'community detail live wiring must exist');
assert.doesNotThrow(() => new Function(live[1]),
  'community detail live wiring must remain valid JavaScript');

console.log('PASS #531 community detail 300-char contract + server-mode prototype fail-safe');
