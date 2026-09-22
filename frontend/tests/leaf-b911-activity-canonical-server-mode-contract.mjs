import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Issue #911: canonical Production resolves DanjionSession.danjionApiBase() to ''
// on purpose (same-origin Pages facade), so `if (activityApiBase)` can never be
// the server-owned gate for the page-28 special views. Canonical Production must
// enter the server lane for view=saved and view=benefits even with an empty base,
// while non-canonical unbound previews keep the bounded demo behavior.

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');

const activityHtml = await read('28_나의활동.html');
const activity = await read('assets/pages/activity-28.js');
const sessionSource = await read('assets/danjion-session.js');
const residentSource = await read('assets/resident-bridge.js');
const savedSource = await read('assets/saved-shops-bridge.js');
const benefitSource = await read('assets/benefit-claim-bridge.js');

const UUID = 'a0a1c4a1-1111-4111-8111-111111111111';
const CLAIM_UUID = 'b1b2c3d4-2222-4222-8222-222222222222';

/* ---------------- SOURCE_CONTRACT ---------------- */
assert.match(
  activity,
  /activityServerMode=Boolean\(activityApiBase\|\|\(globalThis\.DanjionSession&&typeof DanjionSession\.isCanonicalProduction==='function'&&DanjionSession\.isCanonicalProduction\(\)\)\)/,
  'page 28 must OR the empty apiBase with the canonical production resolver'
);
assert.match(
  activity,
  /if\(view==='saved'\|\|view==='benefits'\)\{if\(activityServerMode\)prepareServerSpecial\(view\);else renderSpecial\(view\)\}/,
  'saved/benefits lane selection must use the combined server mode'
);
assert.doesNotMatch(
  activity,
  /if\(activityApiBase\)prepareServerSpecial/,
  'the truthiness-only activityApiBase gate must be gone from the special view branch'
);
assert.match(
  activityHtml,
  /assets\/danjion-session\.js.*assets\/saved-shops-bridge\.js.*assets\/benefit-claim-bridge\.js.*assets\/pages\/activity-28\.js/s,
  'page 28 must keep the sanctioned script order (session → bridges → page)'
);
assert.match(activity, /__danjionActivitySpecialServerOwned=true/, 'server lane must claim ownership');
assert.match(activity, /if\(globalThis\.__danjionActivitySpecialServerOwned\)return/, 'demo lane must yield to the server lane');
assert.match(
  activity,
  /if\(!apiBase&&!DanjionSession\.isCanonicalProduction\(\)\)/,
  'server IIFE must keep its canonical empty-base continuation'
);
console.log('SOURCE_CONTRACT=PASS');

/* ---------------- page runtime harness ---------------- */
const rejections = [];
process.on('unhandledRejection', (error) => rejections.push(error));

function makeClassList() {
  const set = new Set();
  return {
    add: (...names) => names.forEach((name) => set.add(name)),
    remove: (...names) => names.forEach((name) => set.delete(name)),
    toggle: (name, force) => {
      if (force === undefined) (set.has(name) ? set.delete(name) : set.add(name));
      else if (force) set.add(name);
      else set.delete(name);
    },
    contains: (name) => set.has(name)
  };
}

function makeElement(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    style: {},
    dataset: {},
    hidden: false,
    disabled: false,
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    children: [],
    classList: makeClassList(),
    listeners: {},
    addEventListener(type, handler) { (el.listeners[type] ||= []).push(handler); },
    removeEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    appendChild(child) { el.children.push(child); return child; },
    append(...nodes) { el.children.push(...nodes); },
    prepend() {},
    querySelector() { return makeElement(); },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains() { return false; },
    matches() { return false; },
    focus() {},
    click() {},
    remove() {},
    getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  };
  return el;
}

function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    clear() { map.clear(); }
  };
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => ({ data })
  };
}

function makeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, method: String(init.method || 'GET'), init });
    for (const [match, handler] of routes) {
      if (typeof match === 'string' ? target === match || target.includes(match) : match.test(target)) {
        return handler(target, init);
      }
    }
    return jsonResponse(null, 404);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

async function runPage({ hostname, origin, pathname, search, fetchImpl, seedLocal = {} }) {
  const selectorCache = new Map();
  const idCache = new Map();
  const document = {
    readyState: 'loading',
    body: makeElement('body'),
    documentElement: makeElement('html'),
    head: makeElement('head'),
    querySelector(selector) {
      if (!selectorCache.has(selector)) selectorCache.set(selector, makeElement());
      return selectorCache.get(selector);
    },
    querySelectorAll() { return []; },
    getElementById(id) {
      if (!idCache.has(id)) idCache.set(id, makeElement());
      return idCache.get(id);
    },
    createElement() { return makeElement(); },
    addEventListener() {},
    removeEventListener() {}
  };

  const context = {
    console,
    URL,
    URLSearchParams,
    document,
    location: { hostname, origin, pathname, search, href: origin + pathname + search },
    localStorage: makeStorage(seedLocal),
    sessionStorage: makeStorage(),
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener() {},
    removeEventListener() {},
    postMessage() {}
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);

  // Exact page-28 script order from 28_나의활동.html (consistency.js is routing-only).
  vm.runInContext(sessionSource, context, { filename: 'danjion-session.js' });
  vm.runInContext(residentSource, context, { filename: 'resident-bridge.js' });
  vm.runInContext(savedSource, context, { filename: 'saved-shops-bridge.js' });
  vm.runInContext(benefitSource, context, { filename: 'benefit-claim-bridge.js' });
  vm.runInContext(activity, context, { filename: 'activity-28.js' });

  // Drain the server-lane async IIFE (all fetch stubs resolve immediately).
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  return { context, document };
}

const CANONICAL = { hostname: 'danjion.pages.dev', origin: 'https://danjion.pages.dev', pathname: '/28_나의활동.html' };
const PREVIEW = { hostname: 'localhost', origin: 'http://localhost:4173', pathname: '/28_나의활동.html' };
const DEMO_SEED = { 'danjion:savedShops': JSON.stringify(['food']) };

/* ---------------- CANONICAL_EMPTY_BASE_SAVED ---------------- */
{
  const fetchImpl = makeFetch([
    ['/api/v1/me/bookmarks', () => jsonResponse([{ id: UUID }])],
    ['/api/v1/complexes/banglim-myeongji-roadhill/businesses', () =>
      jsonResponse([{ id: UUID, name: '서버 정원꽃집', summary: '서버 응답 저장 가게입니다.' }])]
  ]);
  const { context, document } = await runPage({
    ...CANONICAL,
    search: '?view=saved',
    fetchImpl,
    seedLocal: DEMO_SEED
  });

  assert.equal(context.DanjionSession.danjionApiBase(), '', 'canonical production must resolve an empty apiBase');
  assert.equal(context.DanjionSession.isCanonicalProduction(), true);
  assert.equal(context.__danjionActivitySpecialServerOwned, true, 'canonical saved view must enter the server lane');
  assert.equal(document.body.classList.contains('visual-special'), false, 'demo lane must not run on canonical production');

  assert.ok(
    fetchImpl.calls.some((call) => call.url === '/api/v1/me/bookmarks'),
    'saved-shops bridge must be called same-origin'
  );
  assert.ok(
    fetchImpl.calls.some((call) => call.url.includes('/api/v1/complexes/banglim-myeongji-roadhill/businesses')),
    'saved businesses must render from the server catalogue'
  );

  const rows = document.querySelector('.rows');
  assert.ok(rows.innerHTML.includes('서버 정원꽃집'), 'server row must render');
  assert.ok(rows.innerHTML.includes('data-server-business'), 'rows must be server-owned markup');
  assert.ok(!rows.innerHTML.includes('오늘의 반찬'), 'seeded local demo rows must not surface as production data');
  assert.ok(!rows.innerHTML.includes('visual-shop-card'), 'demo presentation must not render on canonical production');
  console.log('CANONICAL_EMPTY_BASE_SAVED=PASS');
}

/* ---------------- CANONICAL_EMPTY_BASE_BENEFITS ---------------- */
{
  const fetchImpl = makeFetch([
    ['/api/v1/me/benefits', () => jsonResponse([{
      id: CLAIM_UUID,
      benefit_id: UUID,
      claim_code: 'CLAIM-911',
      status: 'issued',
      claimed_at: '2026-09-20T00:00:00.000Z',
      title: '서버 발급 주민 혜택',
      business_name: '정원 꽃집',
      description: '서버에 실제로 발급된 혜택입니다.',
      complex_slug: 'banglim-myeongji-roadhill'
    }])]
  ]);
  const { context, document } = await runPage({
    ...CANONICAL,
    search: '?view=benefits',
    fetchImpl,
    seedLocal: { 'danjion:savedBenefits': JSON.stringify(['food']) }
  });

  assert.equal(context.DanjionSession.danjionApiBase(), '');
  assert.equal(context.DanjionSession.isCanonicalProduction(), true);
  assert.equal(context.__danjionActivitySpecialServerOwned, true, 'canonical benefits view must enter the server lane');
  assert.equal(document.body.classList.contains('visual-special'), false, 'demo lane must not run on canonical production');

  assert.ok(
    fetchImpl.calls.some((call) => call.url === 'https://danjion.pages.dev/api/v1/me/benefits'),
    'benefit wallet must load through the same-origin facade'
  );

  const rows = document.querySelector('.rows');
  assert.ok(rows.innerHTML.includes('서버 발급 주민 혜택'), 'server-issued benefit row must render');
  assert.ok(rows.innerHTML.includes('CLAIM-911'), 'server claim code must render');
  assert.ok(!rows.innerHTML.includes('시연용'), 'demo benefit badge must not render on canonical production');
  assert.ok(!rows.innerHTML.includes('visual-benefit-card'), 'demo benefit card must not render on canonical production');
  console.log('CANONICAL_EMPTY_BASE_BENEFITS=PASS');
}

/* ---------------- NON_CANONICAL_PREVIEW ---------------- */
{
  const fetchImpl = makeFetch([]);
  const { context, document } = await runPage({
    ...PREVIEW,
    search: '?view=saved',
    fetchImpl,
    seedLocal: DEMO_SEED
  });

  assert.equal(context.DanjionSession.danjionApiBase(), '');
  assert.equal(context.DanjionSession.isCanonicalProduction(), false);
  assert.ok(!context.__danjionActivitySpecialServerOwned, 'non-canonical preview must stay in the demo lane');
  assert.equal(document.body.classList.contains('visual-special'), true, 'bounded demo presentation must remain available');
  assert.equal(fetchImpl.calls.length, 0, 'unbound preview must not emit server traffic');

  const rows = document.querySelector('.rows');
  assert.ok(rows.innerHTML.includes('오늘의 반찬'), 'bounded local demo row must still render');
  assert.ok(rows.innerHTML.includes('visual-shop-card'), 'demo presentation markup must remain for previews');
  console.log('NON_CANONICAL_PREVIEW=PASS');
}

/* ---------------- JS_RUNTIME ---------------- */
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(rejections, [], 'page runtime must not produce unhandled rejections');
console.log('JS_RUNTIME=PASS');

console.log('leaf-b911-activity-canonical-server-mode-contract: PASS');
