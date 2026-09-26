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

/* --- 6. #1041 topic visual state == programmatic pressed state --- */
{
  const topicButtons = [...list.matchAll(/<button ([^>]*class="topic[^"]*"[^>]*)>/g)].map((match) => match[1]);
  assert.equal(topicButtons.length, 4, '#1041: page 12 must keep exactly four topic buttons');
  assert.equal(topicButtons.filter((attrs) => /aria-pressed="true"/.test(attrs)).length, 1,
    '#1041: initial markup must expose exactly one pressed topic');
  assert.equal(topicButtons.filter((attrs) => /aria-pressed="false"/.test(attrs)).length, 3,
    '#1041: initial markup must expose the other three topics as unpressed');

  const renderMatch = list.match(/function render\(\)\{[\s\S]*?\n\}/);
  assert.ok(renderMatch, '#1041: canonical topic render() must remain extractable');
  assert.match(renderMatch[0], /classList\.toggle\('active',active\)/,
    '#1041: render must derive the visual state from one active boolean');
  assert.match(renderMatch[0], /setAttribute\('aria-pressed',String\(active\)\)/,
    '#1041: render must expose the same active boolean through aria-pressed');

  const makeTopic = (type) => {
    const classes = new Set();
    const attrs = {};
    return {
      dataset: { type },
      classList: {
        toggle(name, state) {
          if (state) classes.add(name); else classes.delete(name);
        },
        contains(name) { return classes.has(name); }
      },
      setAttribute(name, value) { attrs[name] = value; },
      getAttribute(name) { return attrs[name] ?? null; }
    };
  };
  const topics = ['hello', 'story', 'question', 'together'].map(makeTopic);
  const context = {
    document: { querySelectorAll: (selector) => selector === '.topic' ? topics : [] },
    selected: 'hello',
    TYPES: {
      hello: { label: '가입인사' },
      story: { label: '단지이야기' },
      question: { label: '궁금해요' },
      together: { label: '같이해요' }
    },
    writeMain: { childNodes: [{ nodeValue: '' }] },
    allBtn: { classList: { toggle() {} } },
    showAll: false,
    list: { innerHTML: '' }
  };
  const renderTopics = vm.runInNewContext('(' + renderMatch[0] + ')', context);

  const assertParity = (selected) => {
    context.selected = selected;
    renderTopics();
    for (const topic of topics) {
      const expected = topic.dataset.type === selected;
      assert.equal(topic.classList.contains('active'), expected,
        '#1041: visual active state must follow the selected topic');
      assert.equal(topic.getAttribute('aria-pressed'), String(expected),
        '#1041: aria-pressed must exactly match the visual active state');
    }
    assert.equal(topics.filter((topic) => topic.getAttribute('aria-pressed') === 'true').length, 1,
      '#1041: every render must expose exactly one pressed topic');
  };

  assertParity('hello');
  assertParity('question');
}

console.log('1041_COMMUNITY_TOPIC_VISUAL_STATE_PROGRAMMATIC_PARITY=PASS');
console.log('1041_COMMUNITY_TOPIC_INITIAL_SELECTED_STATE_EXPOSED=YES');
console.log('1041_COMMUNITY_TOPIC_CLICK_STATE_EXPOSED=YES');

console.log('leaf-b899-community-list-category-contract: PASS');
