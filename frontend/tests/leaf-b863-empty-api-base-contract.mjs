import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Issue #863 [residual user issues]: the community / message leaves used to emit an
// unconditionally concatenated apiBase query parameter, so canonical Production
// (same-origin, apiBase === '') linked to itself as `...?apiBase=` — an empty query
// parameter. The 08 reference pattern only appends apiBase when it is actually set.
// This contract pins that invariant for every affected leaf, statically and at runtime.

const read = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');

const PAGES = {
  '12_이웃대화_첫화면.html': await read('12_이웃대화_첫화면.html'),
  '13_이웃대화_글상세_댓글.html': await read('13_이웃대화_글상세_댓글.html'),
  '14_가입인사_글쓰기.html': await read('14_가입인사_글쓰기.html'),
  '15_단지이야기_글쓰기.html': await read('15_단지이야기_글쓰기.html'),
  '16_궁금해요_글쓰기.html': await read('16_궁금해요_글쓰기.html'),
  '17_같이해요_글쓰기.html': await read('17_같이해요_글쓰기.html'),
  '20_메시지함_목록.html': await read('20_메시지함_목록.html')
};

// The exact unconditional emissions this issue removes. Each one appends apiBase
// even when it is the empty string.
const FORBIDDEN = [
  [/\?apiBase='\s*\+\s*encodeURIComponent\(apiBase\)/, "?'+encodeURIComponent(apiBase)"],
  [/&apiBase='\s*\+\s*encodeURIComponent\(apiBase\)/, "&'+encodeURIComponent(apiBase)"],
  [/\?apiBase=\$\{encodeURIComponent\(apiBase\)\}/, '?apiBase=${encodeURIComponent(apiBase)}'],
  [/WRITE\[selected\]\+'\?apiBase='/, "WRITE[selected]+'?apiBase='"]
];

for (const [name, src] of Object.entries(PAGES)) {
  for (const [re, label] of FORBIDDEN) {
    assert.doesNotMatch(src, re, `${name} must not emit an unconditional empty apiBase (${label})`);
  }
  assert.match(
    src,
    /function withApiBase\(url\)\{return apiBase\?url\+/,
    `${name} must define the conditional withApiBase helper`
  );
  assert.match(src, /withApiBase\(/, `${name} must route its apiBase links through withApiBase`);
}

// Runtime: the helper extracted from each leaf keeps an empty base out of the URL
// on both the first-parameter and the subsequent-parameter branch, and keeps the
// real base when one exists (behaviour preserved for controlled previews).
for (const [name, src] of Object.entries(PAGES)) {
  const helper = src.match(/function withApiBase\(url\)\{[^\n]*\}/);
  assert.ok(helper, `${name} exposes a single-line withApiBase helper`);

  for (const [base, hasQuery] of [['', false], ['', true], ['https://api.example.test', false], ['https://api.example.test', true]]) {
    const url = hasQuery ? 'page.html?post=1' : 'page.html';
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(
      `const apiBase=${JSON.stringify(base)};\n${helper[0]}\nglobalThis.__href=withApiBase(${JSON.stringify(url)});`,
      ctx
    );
    const href = String(ctx.__href);
    if (base) {
      const expected = url + (hasQuery ? '&' : '?') + 'apiBase=' + encodeURIComponent(base);
      assert.equal(href, expected, `${name} must carry a real apiBase exactly once`);
    } else {
      assert.equal(href, url, `${name} must not alter the url when apiBase is empty`);
      assert.doesNotMatch(href, /apiBase=/, `${name} must never emit an empty apiBase query`);
    }
  }
}

console.log('leaf-b863-empty-api-base-contract: PASS');
