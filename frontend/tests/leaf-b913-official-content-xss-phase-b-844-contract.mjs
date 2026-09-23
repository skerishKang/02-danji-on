import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #913 Phase B (#844-owned surfaces): 08 list, 08A detail, and the shared
// news bridge must never assign server-authored strings to an HTML parser.
// Phase A covered 06/07/09; this file closes the deferred #844 sinks.
// Bounded, offline, deterministic: static source assertions + extracted-function runtime.

const root = new URL('../', import.meta.url);
const [list, detail, bridge] = await Promise.all([
  readFile(new URL('08_아파트소식_목록.html', root), 'utf8'),
  readFile(new URL('08A_아파트소식_상세.html', root), 'utf8'),
  readFile(new URL('assets/danjion-news-bridge.js', root), 'utf8')
]);

const moduleOf = (html, label) => {
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(m, `${label}: must expose its module wiring`);
  return m[1];
};

const listModule = moduleOf(list, '08');
const detailModule = moduleOf(detail, '08A');

/* ---------------- 1. static sink audit ---------------- */

for (const [label, src] of [['08', listModule], ['08A', detailModule], ['bridge', bridge]]) {
  assert.equal(/\binnerHTML\s*=/.test(src), false,
    `${label}: must not assign innerHTML (server strings stay out of the HTML parser)`);
  assert.equal(/\bouterHTML\s*=/.test(src), false,
    `${label}: must not assign outerHTML`);
}
assert.ok(/document\.createElement\(/.test(listModule) && /textContent/.test(listModule),
  '08: must render via createElement + textContent');
assert.ok(/document\.createElement\(/.test(detailModule) && /textContent/.test(detailModule),
  '08A: must render via createElement + textContent');
assert.ok(!list.includes('${chair.title}') && !list.includes('${chair.body}') &&
  !list.includes('${p.title}') && !list.includes('${p.authorityLabel}') &&
  !list.includes('${p.category}'),
  '08: server title/body/authority/category must not be interpolated into a template');
assert.ok(!detail.includes("replace(/\\n/g, '<br/>')"),
  '08A: the server body path must not rebuild HTML with string <br/>');
assert.ok(detail.includes('renderParagraphs(post.body') && detail.includes('node.textContent = paragraph'),
  '08A: article paragraphs are text nodes, never re-injected HTML');
assert.equal(detail.includes('.innerHTML ='), false,
  '08A: the detail page must not use an innerHTML write path');

/* ---------------- 2. mini DOM harness ---------------- */

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
    this.src = '';
    this.alt = '';
    this.href = '';
    const store = {};
    this.dataset = new Proxy(store, {
      set(target, key, value) { target[key] = String(value); return true; }
    });
  }
  set innerHTML(_value) {
    throw new Error(`innerHTML write path is forbidden on ${this.tagName} (#913 Phase B)`);
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
  addEventListener() {}
  setAttribute(name, value) { this.attributes[String(name)] = String(value); }
  getAttribute(name) { return this.attributes[String(name)] ?? null; }
}

const miniDocument = {
  createElement: (tag) => new MiniElement(tag),
  createTextNode: (data) => new MiniText(data)
};

const FORBIDDEN_TAGS = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'LINK', 'STYLE']);
const scanTree = (node, hits) => {
  if (node.nodeType === 3) return;
  // <img> is a legitimate feature/article media node on 08/08A; only handler/jsUrl matter for it.
  if (node.tagName !== 'IMG' && FORBIDDEN_TAGS.has(node.tagName)) hits.tags.push(node.tagName);
  for (const [name, value] of Object.entries(node.attributes)) {
    if (/^on/i.test(name)) hits.handlers.push(name);
    if (/^\s*javascript:/i.test(String(value))) jsUrlHit(hits, value);
  }
  for (const child of node.childNodes) scanTree(child, hits);
};
const jsUrlHit = (hits, value) => {
  if (/^\s*javascript:/i.test(String(value))) hits.jsUrls.push(String(value));
};
const newHits = () => ({ tags: [], handlers: [], jsUrls: [] });
const assertClean = (rootNode, label) => {
  const hits = newHits();
  scanTree(rootNode, hits);
  assert.deepEqual(hits, { tags: [], handlers: [], jsUrls: [] },
    `${label}: SCRIPT/IFRAME/EVENT_HANDLER/JAVASCRIPT_URL nodes must all be 0`);
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

/* ---------------- 3. payloads on every 08/08A sink ---------------- */

const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg onload=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  '</div><script>alert(1)</script>',
  'quotes " \' < > & mixed',
  '첫 번째 문단\n\n둘째 문단\n줄바꿈까지'
];

// --- 08: renderStories ---
{
  const featureEl = new MiniElement('article');
  featureEl.className = 'feature';
  const newsList = new MiniElement('div');
  newsList.className = 'news-list';
  const factory = new Function(
    'document', 'formatDate', 'categoryLabel', '__featureEl', '__newsList',
    `const featureEl = __featureEl;
     const newsList = __newsList;
     ${extractFunction(listModule, 'renderStories', '08')}
     return { renderStories };`
  );
  const noopFormat = (ts) => (ts ? '2026.09.23' : '');
  const noopCategory = (value) => String(value || '아파트소식');
  const api = factory(miniDocument, noopFormat, noopCategory, featureEl, newsList);

  PAYLOADS.forEach((payload, index) => {
    featureEl.replaceChildren();
    newsList.replaceChildren();
    const posts = [
      {
        id: `11111111-1111-4111-8111-11111111111${index % 10}`,
        channel: 'chair_greeting',
        title: payload,
        body: payload,
        authorityLabel: payload,
        category: payload,
        publishedAt: '2026-09-23T00:00:00.000Z',
        displayMode: 'highlight'
      },
      {
        id: `22222222-2222-4222-8222-22222222222${index % 10}`,
        channel: 'apartment_news',
        title: payload,
        body: payload,
        authorityLabel: payload,
        category: payload,
        publishedAt: '2026-09-22T00:00:00.000Z',
        displayMode: index % 2 === 0 ? 'article' : 'highlight'
      },
      {
        id: `33333333-3333-4333-8333-33333333333${index % 10}`,
        channel: 'management_office',
        title: payload,
        body: payload,
        authorityLabel: payload,
        category: payload,
        publishedAt: '2026-09-21T00:00:00.000Z',
        displayMode: 'article'
      }
    ];
    api.renderStories(posts);
    assertClean(featureEl, `08 feature payload#${index}`);
    assertClean(newsList, `08 rows payload#${index}`);
    assert.ok(featureEl.textContent.includes(payload.split('\n')[0].slice(0, 40)) ||
      featureEl.textContent.includes(payload.slice(0, 40)),
      `08 feature payload#${index}: payload must surface as plain text`);
    const rows = newsList.childNodes.filter(node => node.className === 'news-row');
    assert.equal(rows.length, 2, '08 must render two non-chair rows');
    assert.ok(rows[0].textContent.includes(payload.split('\n')[0].slice(0, 40)) ||
      rows[0].textContent.includes(payload.slice(0, 40)),
      `08 row payload#${index}: payload must surface as plain text`);
    assert.ok(rows[0].dataset.postId, '08 rows must keep data-post-id for delegated click routing');
    const featureLink = featureEl.childNodes
      .flatMap(photoCopy => photoCopy.childNodes)
      .find(node => node.className === 'feature-link');
    assert.ok(featureLink && featureLink.href.includes('postId='),
      '08 feature link must keep the postId in its href query');
  });
}

// --- 08A: renderParagraphs + renderMedia ---
{
  const renderParagraphs = new Function(
    'document', '__bodyEl', '__stateEl',
    `const bodyEl = __bodyEl;
     const stateEl = __stateEl;
     ${extractFunction(detailModule, 'renderParagraphs', '08A')}
     return renderParagraphs;`
  )(miniDocument, new MiniElement('div'), new MiniElement('p'));

  PAYLOADS.forEach((payload, index) => {
    const bodyEl = new MiniElement('div');
    // rebind bodyEl for this iteration by reconstructing factory is heavy; call via factory instead
    const factory = new Function(
      'document', '__bodyEl', '__stateEl',
      `const bodyEl = __bodyEl;
       const stateEl = __stateEl;
       ${extractFunction(detailModule, 'renderParagraphs', '08A')}
       return renderParagraphs;`
    );
    const fn = factory(miniDocument, bodyEl, new MiniElement('p'));
    fn(payload);
    assertClean(bodyEl, `08A body payload#${index}`);
    assert.ok(bodyEl.childNodes.length >= 1, '08A payload must produce at least one paragraph');
    assert.ok(bodyEl.textContent.includes(payload.split('\n')[0].slice(0, 40)) ||
      bodyEl.textContent.includes(payload.slice(0, 40)),
      '08A payload text must render verbatim as text');
    for (const paragraph of bodyEl.childNodes) {
      assert.equal(paragraph.tagName, 'P');
    }
  });
}

{
  const mediaFactory = new Function(
    'document', '__mediaEl', '__resolve', '__apiBase',
    `const mediaEl = __mediaEl;
     const resolveOfficialNewsImageUrl = __resolve;
     const apiBase = __apiBase;
     function clearMedia() { mediaEl.replaceChildren(); mediaEl.hidden = true; }
     ${extractFunction(detailModule, 'renderMedia', '08A')}
     return renderMedia;`
  );
  const resolveOfficialNewsImageUrl = (_apiBase, key) =>
    (typeof key === 'string' && /^gdrive\/public\/official-news-image\/[A-Za-z0-9_-]{12,}$/.test(key)
      ? `/api/api/v1/storage/public?objectKey=${encodeURIComponent(key)}`
      : null);

  PAYLOADS.forEach((payload, index) => {
    const mediaEl = new MiniElement('figure');
    const renderMedia = mediaFactory(miniDocument, mediaEl, resolveOfficialNewsImageUrl, '/api');
    renderMedia({
      attachmentObjectKey: 'gdrive/public/official-news-image/aaaaaaaaaaaa',
      title: payload
    });
    assertClean(mediaEl, `08A media payload#${index}`);
    const img = mediaEl.childNodes.find(node => node.tagName === 'IMG');
    assert.ok(img, '08A media payload must render one figure image');
    assert.equal(img.alt, payload, '08A image alt must be the payload as inert text');
  });

  // NO_ATTACHMENT_TEXT_ONLY: invalid/missing keys render no figure
  const mediaEl = new MiniElement('figure');
  const renderMedia = mediaFactory(miniDocument, mediaEl, resolveOfficialNewsImageUrl, '/api');
  renderMedia({ attachmentObjectKey: null, title: 'text only' });
  assert.equal(mediaEl.childNodes.length, 0, 'NO_ATTACHMENT_TEXT_ONLY: no figure without a valid key');
  assert.equal(mediaEl.hidden, true, 'NO_ATTACHMENT_TEXT_ONLY: figure stays hidden');
}

/* ---------------- 4. bridge + detail static guards ---------------- */

assert.ok(!bridge.includes('innerHTML') && !bridge.includes('outerHTML'),
  'bridge: the shared news bridge must not use an HTML parser');
assert.ok(bridge.includes('resolveOfficialNewsImageUrl') && bridge.includes('OFFICIAL_NEWS_IMAGE_KEY'),
  'bridge: the official-news public URL helper must remain the single key authority');
assert.ok(detail.includes('resolveOfficialNewsImageUrl(apiBase, post.attachmentObjectKey)'),
  '08A: photo URL comes from the shared bridge helper');
assert.equal(detail.includes('attachment_object_key'), false,
  '08A: page consumes only the bridge-normalized camelCase key');
assert.equal(detail.includes('googleapis.com'), false,
  '08A: page must never address Google Drive directly');

console.log('SCRIPT_EXECUTION=0 EVENT_HANDLER_NODE=0 JAVASCRIPT_URL_NODE=0');
console.log('leaf-b913-official-content-xss-phase-b-844-contract: PASS');
