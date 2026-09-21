import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #863 [LOCAL1] TASK1: seven pages appended an unconditionally-built
// `apiBase=` query parameter, so when DanjionSession.danjionApiBase() resolved
// to '' the emitted URLs carried an empty `?apiBase=`/`&apiBase=` token.
// This contract pins the fix shape: every attachment is conditional
// (value present -> preserved byte-for-byte; value empty -> parameter omitted).

const read = async (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');

const PAGES = {
  '12_이웃대화_첫화면.html': {
    required: [
      "13_이웃대화_글상세_댓글.html?post=",
      "apiBase?'&apiBase='+encodeURIComponent(apiBase):''",
      "WRITE[selected]+(apiBase?'?apiBase='+encodeURIComponent(apiBase):'')",
      'encodeURIComponent(apiBase)',
    ],
    forbidden: [
      '13_이웃대화_글상세_댓글.html?apiBase=',
      "WRITE[selected]+'?apiBase='+encodeURIComponent(apiBase)",
    ],
  },
  '13_이웃대화_글상세_댓글.html': {
    required: [
      "CHIP[post.kind]+(apiBase?'&apiBase='+encodeURIComponent(apiBase):'')",
      'encodeURIComponent(apiBase)',
    ],
    forbidden: [
      "CHIP[post.kind]+'&apiBase='+encodeURIComponent(apiBase)",
    ],
  },
  '14_가입인사_글쓰기.html': {
    required: [
      "'12_이웃대화_첫화면.html?type=hello'+(apiBase?'&apiBase='+encodeURIComponent(apiBase):'')",
      "DETAIL+'?post='+encodeURIComponent(postId)+(apiBase?'&apiBase='+encodeURIComponent(apiBase):'')",
    ],
    forbidden: [
      'type=hello&apiBase=',
      "DETAIL+'?apiBase='+encodeURIComponent(apiBase)",
    ],
  },
  '15_단지이야기_글쓰기.html': {
    required: [
      "'12_이웃대화_첫화면.html?type=story'+(apiBase?'&apiBase='+encodeURIComponent(apiBase):'')",
      "DETAIL+'?post='+encodeURIComponent(postId)+(apiBase?'&apiBase='+encodeURIComponent(apiBase):'')",
    ],
    forbidden: [
      'type=story&apiBase=',
      "DETAIL+'?apiBase='+encodeURIComponent(apiBase)",
    ],
  },
  '16_궁금해요_글쓰기.html': {
    required: [
      "'12_이웃대화_첫화면.html?type=question'+(apiBase?'&apiBase='+encodeURIComponent(apiBase):'')",
      "DETAIL+'?post='+encodeURIComponent(postId)+(apiBase?'&apiBase='+encodeURIComponent(apiBase):'')",
    ],
    forbidden: [
      'type=question&apiBase=',
      "DETAIL+'?apiBase='+encodeURIComponent(apiBase)",
    ],
  },
  '17_같이해요_글쓰기.html': {
    required: [
      "'12_이웃대화_첫화면.html?type=together'+(apiBase?'&apiBase='+encodeURIComponent(apiBase):'')",
      "DETAIL+'?post='+encodeURIComponent(postId)+(apiBase?'&apiBase='+encodeURIComponent(apiBase):'')",
    ],
    forbidden: [
      'type=together&apiBase=',
      "DETAIL+'?apiBase='+encodeURIComponent(apiBase)",
    ],
  },
  '20_메시지함_목록.html': {
    required: [
      "'21_메시지_대화상세.html?conversation='+encodeURIComponent(row.dataset.conversation)+(apiBase?'&apiBase='+encodeURIComponent(apiBase):'')",
      'encodeURIComponent(apiBase)',
    ],
    forbidden: [
      '21_메시지_대화상세.html?apiBase=',
    ],
  },
};

for (const [name, spec] of Object.entries(PAGES)) {
  const src = await read(name);
  for (const needle of spec.forbidden) {
    assert.equal(src.includes(needle), false,
      `${name}: unguarded empty apiBase pattern must be removed: ${needle}`);
  }
  for (const needle of spec.required) {
    assert.ok(src.includes(needle),
      `${name}: conditional apiBase attachment missing: ${needle}`);
  }
}

console.log('PASS #863 empty apiBase param is never emitted; value-present passthrough preserved');
