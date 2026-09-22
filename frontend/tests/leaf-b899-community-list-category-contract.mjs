import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Issue #899 [Leaf B899]: the community LIST (12) must surface the server-authoritative
// category (말머리) with the same semantics the DETAIL page (13) already uses:
//   category ? kindLabel + ' · ' + category : kindLabel
// The list previously rendered only LABEL[p.kind], silently dropping the category that
// community-bridge.js already normalizes into the payload. Backend / DB / bridge are
// intentionally untouched: this contract guards the render only.
// Run: node frontend/tests/leaf-b899-community-list-category-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const list = await read('../12_이웃대화_첫화면.html');
const detail = await read('../13_이웃대화_글상세_댓글.html');
const bridge = await read('../assets/community-bridge.js');

/* --- 1. the list must route its label through a category-aware helper --- */
assert.match(list, /function labelFor\(p\)\{/, '#899: list must define a category-aware labelFor()');
assert.match(list, /\$\{labelFor\(p\)\}/, '#899: list row template must render labelFor(p)');
assert.ok(!list.includes('${LABEL[p.kind]}</span>'),
  '#899: row must no longer render the kind-only label');

/* --- 2. semantics parity with the detail page (13) --- */
assert.ok(detail.includes("post.category?kindLabel+' · '+post.category:kindLabel"),
  '#899: detail page reference semantics must remain intact');
assert.match(list, /p\.category\?LABEL\[p\.kind\]\+' · '\+esc\(p\.category\):LABEL\[p\.kind\]/,
  '#899: list must render "kindLabel · category" (esc-wrapped) and fall back to kindLabel only');

/* --- 3. data path is already live (community-bridge normalizes category) --- */
assert.match(bridge, /category:\s*raw\.category == null \|\| raw\.category === '' \? null : String\(raw\.category\)/,
  '#899: bridge must keep normalizing category; no bridge change is expected');

/* --- 4. behavior of the extracted helper --- */
const LABEL = { greeting: '가입인사', resident_story: '단지이야기', question: '궁금해요', together: '같이해요' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const extract = (src) => {
  const m = src.match(/function labelFor\(p\)\{[^\n]*\}/);
  assert.ok(m, '#899: labelFor() must stay a single-line function for this extraction');
  return m[0];
};
const evalLabel = (src) => vm.runInNewContext('(' + extract(src) + ')', { LABEL, esc });

const fn = evalLabel(list);

assert.equal(fn({ kind: 'question', category: '생활·살림' }), '궁금해요 · 생활·살림',
  '#899: category present -> "kind · category"');
assert.equal(fn({ kind: 'together', category: '산책·운동' }), '같이해요 · 산책·운동',
  '#899: category present (together) -> "kind · category"');
assert.equal(fn({ kind: 'resident_story' }), '단지이야기',
  '#899: allowlist-less kind (no category) -> kind label only');
assert.equal(fn({ kind: 'greeting', category: '' }), '가입인사',
  '#899: empty category -> kind label only');
assert.equal(fn({ kind: 'question', category: '<script>' }), '궁금해요 · &lt;script&gt;',
  '#899: category must be escaped');
assert.equal(fn({ kind: 'question', category: null }), '궁금해요',
  '#899: null category -> kind label only');

/* --- 5. mutation verification: removing the category branch must be caught --- */
const mutatedSrc = list.replace(extract(list), 'function labelFor(p){return LABEL[p.kind]}');
assert.notEqual(mutatedSrc, list, '#899: mutation harness must actually alter the source');
const mutatedFn = evalLabel(mutatedSrc);
let mutationCaught = false;
try {
  assert.equal(mutatedFn({ kind: 'question', category: '생활·살림' }), '궁금해요 · 생활·살림');
} catch {
  mutationCaught = true;
}
assert.ok(mutationCaught, '#899: contract must FAIL if the category branch is removed');

console.log('leaf-b899-community-list-category-contract: PASS');
