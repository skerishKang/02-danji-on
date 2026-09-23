import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #913 [Phase A]: server-authored official-content strings (title/body/category)
// must never reach an HTML parser on the non-colliding public surfaces
// 06_단지온공지_목록 / 07_단지온공지_상세 / 09_회장인사_상세.
// Rendering is DOM-only (createElement/textContent/createTextNode); no raw server
// interpolation into innerHTML, no regex pseudo-sanitizer, no rich-HTML contract.
// #844-owned surfaces (08/08A/danjion-news-bridge) are covered by Phase B in
// leaf-b913-official-content-xss-phase-b-844-contract.mjs; Phase A still pins
// that 08 no longer keeps the deferred innerHTML sinks.
// Bounded, offline, deterministic: static source assertions + extracted-function runtime.

const root = new URL('../', import.meta.url);
const [list, detail, chair] = await Promise.all([
  readFile(new URL('06_단지온공지_목록.html', root), 'utf8'),
  readFile(new URL('07_단지온공지_상세.html', root), 'utf8'),
  readFile(new URL('09_회장인사_상세.html', root), 'utf8')
]);

const moduleOf = (html, label) => {
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(m, `${label}: must expose its module wiring`);
  return m[1];
};

const listModule = moduleOf(list, '06');
const detailModule = moduleOf(detail, '07');
const chairModule = moduleOf(chair, '09');

// ---------------------------------------------------------------------------
// 1. static sink audit — no server-field innerHTML path remains on Phase A files
// ---------------------------------------------------------------------------
for (const [label, src] of [['06', listModule], ['07', detailModule], ['09', chairModule]]) {
  assert.equal(/\binnerHTML\s*=/.test(src), false,
    `${label}: the module must not assign innerHTML (server strings stay out of the HTML parser)`);
  assert.equal(/\bouterHTML\s*=/.test(src), false,
    `${label}: the module must not assign outerHTML`);
  assert.ok(/document\.createElement\(/.test(src) && /textContent/.test(src),
    `${label}: the module must render via createElement + textContent`);
}
assert.ok(!list.includes('${pinned.title}') && !list.includes('${p.title}'),
  '06: server title must not be interpolated into a template');
assert.ok(!list.includes('${(pinned.body') && !list.includes('${p.category') && !list.includes('${p.channel'),
  '06: server body/category/channel must not be interpolated into a template');
assert.ok(!detail.includes('contentEl.innerHTML') &&
  !detail.includes("replace(/\\n/g, '<br/>')"),
  '07: the server body path must not rebuild HTML with innerHTML or string <br/>');
assert.ok(detail.includes('renderPlainBody(contentEl, post.body || \'\')') &&
  detail.includes('indexEl.replaceChildren()'),
  '07: the server body path must render through renderPlainBody + replaceChildren');
assert.ok(detail.includes('document.getElementById("noticeContent").innerHTML=data.html'),
  '07: the static sibling demo renderer contract must stay intact (#354)');
assert.ok(!chair.includes('bodyEl.innerHTML') &&
  chair.includes('renderPlainBody(bodyEl, post.body)'),
  '09: the server body path must render through renderPlainBody, never innerHTML');
assert.ok(chair.includes('titleEl.textContent = post.title'),
  '09: the server title must render via textContent');
// #913 newline contract: literal \n and real newlines are both honoured as boundaries.
for (const [label, src] of [['07', detailModule], ['09', chairModule]]) {
  assert.ok(src.includes('replace(/\\\\r\\\\n|\\\\n|\\\\r/g') && src.includes('document.createElement(\'br\')'),
    `${label}: renderPlainBody must normalize literal and real newlines and break lines with DOM <br>`);
}
// Locked #354/#358 intents on 06 survive the DOM rebuild.
assert.ok(list.includes('function renderPinned(pinned) {') &&
  list.includes('renderPinned(pinned);') &&
  list.includes('pinnedSlot.dataset.postId = pinned.id;') &&
  list.includes('pinnedSlot.remove();'),
  '06: pinned slot contract (#358) must stay verbatim');
assert.ok(list.includes("document.querySelectorAll('.notice-row, .pinned')") &&
  list.includes('el.dataset.category || el.dataset.kind') &&
  list.includes("row.dataset.category = p.category || p.channel || 'danjion_notice'"),
  '06: sibling filter authority (#354) must stay intact with a non-empty data-category');

// ---------------------------------------------------------------------------
// 2. mini DOM harness — innerHTML is a hard failure, payload tags are counted
// ---------------------------------------------------------------------------
class MiniText {
  constructor(data) { this.nodeType = 3; this.data = String(data); this.parentNode = null; }
  get textContent() { return this.data; }
  set textContent(value) { this.data = String(value); }
}

class MiniElement {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = {};
    this.className = '';
    this.id = '';
    this.hidden = false;
    this.type = '';
    const store = {};
    this.dataset = new Proxy(store, {
      set(target, key, value) { target[key] = String(value); return true; }
    });
  }
  set innerHTML(_value) {
    throw new Error(`innerHTML write path is forbidden on ${this.tagName} (#913)`);
  }
  get innerHTML() {
    return this.childNodes.map(child => child.nodeType === 3
      ? child.data.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      : `<${child.tagName.toLowerCase()}>${child.innerHTML}</${child.tagName.toLowerCase()}>`).join('');
  }
  get textContent() { return this.childNodes.map(child => child.textContent).join(''); }
  set textContent(value) {
    this.childNodes = value === '' ? [] : [new MiniText(value)];
    for (const child of this.childNodes) child.parentNode = this;
  }
  _adopt(node) {
    const child = (node instanceof MiniElement || node instanceof MiniText)
      ? node : new MiniText(node);
    child.parentNode = this;
    return child;
  }
  append(...nodes) { for (const node of nodes) this.childNodes.push(this._adopt(node)); }
  replaceChildren(...nodes) {
    this.childNodes = [];
    for (const node of nodes) this.childNodes.push(this._adopt(node));
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.childNodes = this.parentNode.childNodes.filter(child => child !== this);
    this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes[String(name)] = String(value); }
  getAttribute(name) { return this.attributes[String(name)] ?? null; }
}

const miniDocument = {
  createElement: (tag) => new MiniElement(tag),
  createTextNode: (data) => new MiniText(data)
};

const FORBIDDEN_TAGS = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'SVG', 'A', 'LINK', 'STYLE']);
const scanTree = (node, hits) => {
  if (node.nodeType === 3) return;
  if (FORBIDDEN_TAGS.has(node.tagName)) hits.tags.push(node.tagName);
  for (const [name, value] of Object.entries(node.attributes)) {
    if (/^on/i.test(name)) hits.handlers.push(name);
    if (/^\s*javascript:/i.test(String(value))) hits.jsUrls.push(String(value));
  }
  for (const child of node.childNodes) scanTree(child, hits);
};
const newHits = () => ({ tags: [], handlers: [], jsUrls: [] });
const assertClean = (rootNode, label) => {
  const hits = newHits();
  scanTree(rootNode, hits);
  assert.deepEqual(hits, { tags: [], handlers: [], jsUrls: [] },
    `${label}: SCRIPT_EXECUTION/EVENT_HANDLER/JAVASCRIPT_URL nodes must all be 0`);
};

const extractFunction = (src, name, label) => {
  const start = src.indexOf(`function ${name}`);
  assert.ok(start > -1, `${label}: expected function ${name}`);
  let depth = 0;
  let end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  assert.ok(end > -1, `${label}: function ${name} must be brace-balanced`);
  return src.slice(start, end + 1);
};

// ---------------------------------------------------------------------------
// 3. payloads — every required vector, on title and body of every surface
// ---------------------------------------------------------------------------
const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg onload=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  '</div><script>alert(1)</script>',
  'quotes " \' < > & mixed',
  '첫 번째 문단\n\n둘째 문단\n줄바꿈까지'
];
const MULTILINE = 'line one\nline two\nline three';

// --- 06: renderPinned + renderPosts ---
{
  let filterCalls = 0;
  const pinnedSlot = new MiniElement('article');
  pinnedSlot.className = 'pinned';
  pinnedSlot.attributes['data-kind'] = 'essential';
  const noticeContainer = new MiniElement('div');
  noticeContainer.className = 'notice-list';
  const factory = new Function(
    'document', '__pinnedSlot', '__noticeContainer', '__applyNoticeFilter',
    `let pinnedSlot = __pinnedSlot;
     const noticeContainer = __noticeContainer;
     let applyNoticeFilter = __applyNoticeFilter;
     ${extractFunction(listModule, 'formatDate', '06')}
     ${extractFunction(listModule, 'renderPinned', '06')}
     ${extractFunction(listModule, 'renderPosts', '06')}
     return { renderPinned, renderPosts };`
  );
  const api = factory(miniDocument, pinnedSlot, noticeContainer, () => { filterCalls++; });

  PAYLOADS.forEach((payload, index) => {
    pinnedSlot.replaceChildren();
    pinnedSlot.className = 'pinned';
    noticeContainer.replaceChildren();
    const posts = [
      { id: `pinned-${index}`, title: payload, body: payload, category: 'essential', channel: 'danjion_notice', publishedAt: '2026-09-23T00:00:00.000Z' },
      { id: `row-${index}`, title: payload, body: payload, category: payload, channel: 'danjion_notice', publishedAt: '2026-09-22T00:00:00.000Z' }
    ];
    api.renderPosts(posts);
    assertClean(pinnedSlot, `06 pinned payload#${index}`);
    assertClean(noticeContainer, `06 rows payload#${index}`);
    assert.ok(pinnedSlot.textContent.includes(payload.split('\n')[0].slice(0, 60)),
      `06 pinned payload#${index}: payload must surface as plain text`);
    assert.equal(pinnedSlot.dataset.postId, `pinned-${index}`,
      '06 pinned slot must keep the server postId on the dataset');
    const rows = noticeContainer.childNodes.filter(node => node.className === 'notice-row');
    assert.equal(rows.length, 1, '06 must render one non-pinned row');
    assert.equal(rows[0].dataset.postId, `row-${index}`);
    assert.ok(rows[0].dataset.category.length > 0,
      '06 data-category must never be empty (filter membership)');
    assert.ok(rows[0].textContent.includes(payload.split('\n')[0].slice(0, 60)),
      `06 row payload#${index}: payload must surface as plain text`);
    const empty = noticeContainer.childNodes.find(node => node.id === 'noticeEmpty');
    assert.ok(empty, '06 server render must re-emit #noticeEmpty');
    assert.equal(empty.hidden, true, '06 empty state starts hidden when rows exist');
    assert.equal(empty.textContent, '검색 결과가 없습니다.');
    const head = noticeContainer.childNodes.find(node => node.className === 'list-head');
    assert.ok(head && head.textContent.includes('전체 공지'), '06 list head structure preserved');
  });
  assert.equal(filterCalls, PAYLOADS.length,
    '06 renderPosts must hand every render to applyNoticeFilter');

  // no-pinned lane: the sibling slot is dropped, not blanked with demo copy
  noticeContainer.replaceChildren();
  const layout = new MiniElement('section');
  const unpinnedSlot = new MiniElement('article');
  unpinnedSlot.className = 'pinned';
  layout.append(unpinnedSlot);
  const apiNoPinned = factory(
    miniDocument, unpinnedSlot, noticeContainer, () => { filterCalls++; }
  );
  apiNoPinned.renderPosts([{ id: 'only-row', title: '일반 공지', body: 'x', category: 'guide', channel: 'other_channel', publishedAt: '' }]);
  assert.equal(layout.childNodes.length, 0,
    '06 must remove the sibling pinned slot when the server has no pinned post');
  assert.equal(unpinnedSlot.parentNode, null,
    '06 removed pinned slot must detach from the layout');
  assertClean(noticeContainer, '06 no-pinned lane');
  const reEmptied = noticeContainer.childNodes.find(node => node.id === 'noticeEmpty');
  assert.ok(reEmptied && reEmptied.hidden === true,
    '06 empty state node must be re-emitted (filter owns its visibility)');
  assert.ok(noticeContainer.childNodes.some(node => node.dataset && node.dataset.postId === 'only-row'),
    '06 no-pinned lane still renders the server row');
}

// --- 07: renderPlainBody ---
{
  const renderPlainBody = new Function(
    'document',
    `${extractFunction(detailModule, 'renderPlainBody', '07')}\nreturn renderPlainBody;`
  )(miniDocument);

  PAYLOADS.forEach((payload, index) => {
    const container = new MiniElement('div');
    container.id = 'noticeContent';
    renderPlainBody(container, payload);
    assertClean(container, `07 body payload#${index}`);
    assert.ok(container.childNodes.length >= 1, '07 payload must produce at least one paragraph');
    assert.ok(container.textContent.includes(payload.split('\n')[0].slice(0, 60)),
      '07 payload text must render verbatim as text');
    for (const paragraph of container.childNodes) {
      assert.equal(paragraph.tagName, 'P');
      assert.equal(paragraph.className, 'opening');
    }
  });

  const multiline = new MiniElement('div');
  renderPlainBody(multiline, MULTILINE);
  assertClean(multiline, '07 multiline');
  assert.equal(multiline.childNodes.length, 1, '07 single-section body stays one paragraph');
  const multiParagraph = multiline.childNodes[0];
  assert.equal(multiParagraph.childNodes.length, 5, '07 text/br/text/br/text child sequence');
  assert.equal(multiParagraph.childNodes[0].textContent, 'line one');
  assert.equal(multiParagraph.childNodes[1].tagName, 'BR');
  assert.equal(multiParagraph.childNodes[2].textContent, 'line two');
  assert.equal(multiParagraph.childNodes[3].tagName, 'BR');
  assert.equal(multiParagraph.childNodes[4].textContent, 'line three');

  const literalNewlines = new MiniElement('div');
  renderPlainBody(literalNewlines, 'a\\nb\\n\\nc');
  assert.equal(literalNewlines.childNodes.length, 2, '07 literal \\n sequences split paragraphs');
  assert.equal(literalNewlines.childNodes[0].childNodes[0].textContent, 'a');
  assert.equal(literalNewlines.childNodes[0].childNodes[2].textContent, 'b');
  assert.equal(literalNewlines.childNodes[1].textContent, 'c');

  const sections = new MiniElement('div');
  renderPlainBody(sections, 'p one\n\np two\n\np three');
  assert.equal(sections.childNodes.length, 3, '07 blank-line sections become paragraphs');

  const emptyContainer = new MiniElement('div');
  renderPlainBody(emptyContainer, '');
  assert.equal(emptyContainer.childNodes.length, 0, '07 empty body clears the container');

  // empty-state behaviour of the detail index: replaceChildren clears siblings
  const indexEl = new MiniElement('nav');
  indexEl.append(new MiniElement('a'));
  indexEl.replaceChildren();
  assert.equal(indexEl.childNodes.length, 0, '07 index clear must empty the nav');
}

// --- 09: renderPlainBody (no className) ---
{
  const renderPlainBody = new Function(
    'document',
    `${extractFunction(chairModule, 'renderPlainBody', '09')}\nreturn renderPlainBody;`
  )(miniDocument);

  PAYLOADS.forEach((payload, index) => {
    const bodyEl = new MiniElement('div');
    bodyEl.className = 'article-body';
    renderPlainBody(bodyEl, payload);
    assertClean(bodyEl, `09 body payload#${index}`);
    assert.ok(bodyEl.childNodes.length >= 1, '09 payload must produce at least one paragraph');
    for (const paragraph of bodyEl.childNodes) {
      assert.equal(paragraph.tagName, 'P');
      assert.equal(paragraph.className, '', '09 paragraphs carry no demo classes');
    }
  });

  const multiline = new MiniElement('div');
  renderPlainBody(multiline, MULTILINE);
  assertClean(multiline, '09 multiline');
  assert.equal(multiline.childNodes.length, 1);
  const multiParagraph = multiline.childNodes[0];
  assert.equal(multiParagraph.childNodes.length, 5, '09 text/br/text/br/text child sequence');
  assert.equal(multiParagraph.childNodes[0].textContent, 'line one');
  assert.equal(multiParagraph.childNodes[1].tagName, 'BR');
  assert.equal(multiParagraph.childNodes[2].textContent, 'line two');
  assert.equal(multiParagraph.childNodes[3].tagName, 'BR');
  assert.equal(multiParagraph.childNodes[4].textContent, 'line three');
}

// ---------------------------------------------------------------------------
// 4. Phase B landed on 08 — the old deferred sinks must be gone
// ---------------------------------------------------------------------------
const apartment = await readFile(new URL('08_아파트소식_목록.html', root), 'utf8');
const apartmentModule = moduleOf(apartment, '08');
assert.equal(/\binnerHTML\s*=/.test(apartmentModule), false,
  'PHASE_B #844: 08 list module must not assign innerHTML');
assert.equal(/\bouterHTML\s*=/.test(apartmentModule), false,
  'PHASE_B #844: 08 list module must not assign outerHTML');
assert.ok(/document\.createElement\(/.test(apartmentModule) && /textContent/.test(apartmentModule),
  'PHASE_B #844: 08 list module must render via createElement + textContent');
assert.ok(!apartment.includes('${chair.title}') && !apartment.includes('${chair.body}') &&
  !apartment.includes('${p.title}'),
  'PHASE_B #844: server title/body must not be interpolated into a template');

console.log('SCRIPT_EXECUTION=0 EVENT_HANDLER_NODE=0 JAVASCRIPT_URL_NODE=0');
console.log('leaf-b913-official-content-xss-phase-a-contract: PASS');
