import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const pages = {
  greeting: await readFile(new URL('14_가입인사_글쓰기.html', root), 'utf8'),
  story: await readFile(new URL('15_단지이야기_글쓰기.html', root), 'utf8'),
  question: await readFile(new URL('16_궁금해요_글쓰기.html', root), 'utf8'),
  together: await readFile(new URL('17_같이해요_글쓰기.html', root), 'utf8'),
  detail: await readFile(new URL('13_이웃대화_글상세_댓글.html', root), 'utf8')
};

const writeScripts = [
  ['greeting', 'danjion-community-write-greeting-live-wiring-348'],
  ['story', 'danjion-community-write-story-live-wiring-329'],
  ['question', 'danjion-community-write-question-live-wiring-329'],
  ['together', 'danjion-community-write-together-live-wiring-329']
].map(([name,id]) => {
  const match = pages[name].match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
  assert.ok(match, `${name} live write wiring must exist`);
  return [name, match[1]];
});

for (const [name, script] of writeScripts) {
  assert.match(script, /bridge\.createPost\(/, `${name}: server create is authoritative`);
  assert.match(script, /13_이웃대화_글상세_댓글\.html/, `${name}: accepted post opens server detail evidence`);
  assert.match(script, /UUID\.test\(postId\)/, `${name}: returned id is validated before detail navigation`);
  assert.match(script, /r\.status===403/, `${name}: 403 is not mislabeled as an expired login`);
  assert.match(script, /우리집 연결과 주민 확인을 완료한 뒤/, `${name}: resident authorization copy is actionable`);
  assert.match(script, /setBusy\(true\)/, `${name}: duplicate submit is gated`);
  assert.match(script, /\.finally\(\(\)=>\{busy=false;setBusy\(false\)\}\)/,
    `${name}: submit buttons recover after success or failure`);
}

for (const name of ['greeting','story','question']) {
  const script = writeScripts.find(([n]) => n === name)[1];
  assert.match(script, /photoBtn\.disabled=true/);
  assert.match(script, /현재 미지원/);
}

const question = writeScripts.find(([n]) => n === 'question')[1];
assert.match(question, /toggle\.disabled=true/, 'question: the unsupported per-post 1:1 receive setting stays disabled');
assert.equal(question.includes("querySelectorAll('.type-tab').forEach(b=>{b.disabled=true"), false,
  'question: 말머리 tabs stay selectable now that the server stores the category');
assert.match(question, /kind:'question',category,/, 'question: the selected 말머리 is part of the server write payload');
assert.match(question, /POST_CATEGORY_INVALID/, 'question: an unsupported 말머리 is reported, never silently dropped');

const together = writeScripts.find(([n]) => n === 'together')[1];
assert.match(together, /dynamic\.hidden=true/);
assert.match(together, /kind:'together',category,/, 'together: the selected 유형 is part of the server write payload');
assert.match(together, /body:body\.value\.trim\(\)/);
assert.doesNotMatch(together, /function compose\(|fieldLabel\(i\)\+': '\+v/,
  'unsupported structured together fields must never be body-encoded');

const detailMatch = pages.detail.match(/<script id="danjion-community-detail-live-wiring-329">([\s\S]*?)<\/script>/);
assert.ok(detailMatch, 'detail live wiring must exist');
const detail = detailMatch[1];
assert.match(detail, /post\.category\?kindLabel\+' · '\+post\.category:kindLabel/,
  'detail renders the server category as the 말머리, truthfully absent when unsupported');
assert.match(detail, /if\(post\.status!=='published'\)/);
assert.match(detail, /다른 주민에게는 아직 보이지 않습니다/);
assert.match(detail, /likeBtn\.disabled=true/);
assert.match(detail, /commentText\.disabled=true/);
assert.match(detail, /글이 공개된 뒤 댓글과 공감을 이용할 수 있습니다/);

console.log('leaf-b753-community-write-correctness-contract: PASS');
