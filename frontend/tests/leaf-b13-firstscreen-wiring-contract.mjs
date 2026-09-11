import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

// Assignment #364 [Leaf B13]: 05_우리단지_첫화면 wired to the existing public complexes/:slug
// authority ONLY (complex display name slots). sibling-final-v3 visible UI is locked by a
// visible-DOM sha256: no new visible element, attribute, or copy may be added by this wiring.
// CENTRAL #352 OPTION B stays in force: no channel-latest lines, no reveal logic, and the
// DanjionSession string must never appear on page 05 (public fetch only).
// Run: node frontend/tests/leaf-b13-firstscreen-wiring-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const f05 = await read('../05_우리단지_첫화면.html');
const CANON = 'banglim-myeongji-roadhill';
const DEMO_NAME = '방림명지로드힐';
const WIRING_ID = 'danjion-firstscreen-complex-wiring';

/* --- sibling-final-v3 UI authority: visible DOM (scripts stripped) is hash-locked --- */
const visibleDom = (html) => html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/\r\n/g, '\n').replace(/>\s+</g, '><').trim();
const visibleHash = (html) => createHash('sha256').update(visibleDom(html)).digest('hex');
assert.equal(visibleHash(f05), 'b5ca6eadeded279fbe83603fcd3acc1faf6b707b861a99b8e6ebe4553b85b1b8',
  '05 visible DOM must remain byte-identical to the sibling-final-v3 authority after the README-canonical entry rename (data-route index3.html -> index.html); no other visible UI, attribute, or copy may change');

/* --- existing semantic demo copy stays in markup (server may overwrite at runtime only) --- */
assert.ok(f05.includes(`<div class="identity">${DEMO_NAME}</div>`), '05 desktop identity slot must keep the demo complex name');
assert.ok(f05.includes(`<div class="mobile-head">${DEMO_NAME}</div>`), '05 mobile identity slot must keep the demo complex name');
assert.ok(f05.includes(`<div class="eyebrow">${DEMO_NAME}의 네 가지 소식 공간</div>`), '05 eyebrow must keep the demo-prefixed copy');
assert.ok(f05.includes('data-danjion-page="5"') && f05.includes('danjion-direct-router-v5'),
  '05 must keep its original static router surfaces');

/* --- wiring block: exists exactly once, appended after the router scripts, before </body> --- */
assert.equal((f05.match(new RegExp(WIRING_ID, 'g')) || []).length, 1, '05 must contain exactly one firstscreen wiring block');
const wiringAt = f05.indexOf(`id="${WIRING_ID}"`);
assert.ok(wiringAt > f05.indexOf('danjion-direct-router-v5'), 'wiring must be appended after the router scripts');
assert.ok(wiringAt < f05.indexOf('</body>'), 'wiring must live inside the document body');
const wiring = f05.slice(f05.indexOf(`>`, wiringAt) + 1, f05.indexOf('</script>', wiringAt));

/* --- wiring mutates text only: no DOM-adding APIs anywhere in the block --- */
for (const forbidden of ['createElement', 'innerHTML', 'insertAdjacentHTML', 'appendChild', 'prepend(', '.before(', '.after(', 'replaceChildren', 'setAttribute', 'classList']) {
  assert.ok(!wiring.includes(forbidden), `wiring must not use ${forbidden} (no new visible UI allowed)`);
}
assert.ok(wiring.includes('textContent='), 'wiring must update slots via textContent only');
assert.ok(/forEach\(el=>\{el\.textContent=name\}\)/.test(wiring), 'wiring must render the server name exactly once per slot (no duplicate render path)');

/* --- apiBase gate + fail-closed demo fallback (same contract as #347) --- */
assert.ok(wiring.includes("const FIRST_API_BASE=(new URLSearchParams(location.search).get('apiBase')||'').replace(/\\/+$/,'')"),
  'wiring must derive FIRST_API_BASE from the apiBase query param with trailing-slash trim');
assert.ok(/async function loadFirstScreenAuthority\(\)\{\s*if\(!FIRST_API_BASE\)return;/.test(wiring),
  'wiring must return before any fetch when apiBase is absent (demo/static fallback)');
assert.ok(wiring.includes('keeping demo name'), 'wiring must log and keep the demo name when the authority fails or is empty');

/* --- existing public authority only: complexes/:slug GET, nothing else --- */
assert.ok(wiring.includes(`'${CANON}'`), 'wiring must use the canonical complex slug');
assert(!/COMPLEX_SLUG='방/.test(wiring), 'wiring must not use the Korean display name as the API slug');
assert.ok(wiring.includes("'/api/v1/complexes/'+encodeURIComponent(FIRST_COMPLEX_SLUG)"),
  'wiring must read the existing GET /api/v1/complexes/:slug authority');
assert.ok(wiring.includes("credentials:'omit'"), 'wiring must use the anonymous public transport');
for (const forbidden of ['/posts', '/resident-news', '/businesses', '/community', '/api/v1/admin', '/api/v1/me', '/api/v1/storage', 'method:']) {
  assert.ok(!wiring.includes(forbidden), `wiring must not touch ${forbidden} (no post channels, no writes, no new routes)`);
}

/* --- CENTRAL #352 OPTION B re-lock: banned hub-reveal strings must stay absent on 05 --- */
for (const banned of ['channel-latest', 'data-latest-for', 'HUB_API_BASE', 'danjion-hub-latest-wiring', 'DanjionSession']) {
  assert.ok(!f05.includes(banned), `05 must not contain "${banned}" (OPTION B remains in force)`);
}

/* --- bounded scope: this wiring must not leak into other pages --- */
const f04 = await read('../04_데일리홈.html');
assert.ok(!f04.includes(WIRING_ID) && !f04.includes('FIRST_API_BASE'), '04 must stay outside the #364 wiring scope');

/* --- runtime harness: fake DOM with the three locked semantic slots --- */
const makeDom = () => {
  const identity = { textContent: DEMO_NAME };
  const mobileHead = { textContent: DEMO_NAME };
  const eyebrow = { textContent: `${DEMO_NAME}의 네 가지 소식 공간` };
  const table = { '.identity,.mobile-head': [identity, mobileHead], '.eyebrow': [eyebrow] };
  const document = { readyState: 'complete', querySelectorAll: (sel) => table[sel] || [] };
  return { identity, mobileHead, eyebrow, document, slotCount: 3 };
};
const runWiring = async ({ apiBase, fetchImpl, dom }) => {
  const logs = [];
  const ctx = {
    location: { search: apiBase ? `?apiBase=${encodeURIComponent(apiBase)}` : '' },
    document: dom.document,
    console: { info: (...a) => logs.push(a.join(' ')) },
    fetch: fetchImpl || (() => { throw new Error('fetch must not be called without apiBase'); }),
    setTimeout, clearTimeout, URLSearchParams, AbortController,
  };
  vm.runInNewContext(wiring, ctx);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  return logs;
};
const okFetch = (body, calls) => async (url, opts) => {
  calls.push({ url, opts });
  return { ok: true, status: 200, json: async () => body };
};

/* case 1: no apiBase → zero fetch, demo authority fully intact */
{
  const dom = makeDom();
  const calls = [];
  await runWiring({ apiBase: '', fetchImpl: async (u, o) => { calls.push({ u, o }); return { ok: true, json: async () => ({}) }; }, dom });
  assert.equal(calls.length, 0, 'no apiBase must issue zero fetches');
  assert.equal(dom.identity.textContent, DEMO_NAME, 'demo identity must survive the no-apiBase lane');
  assert.equal(dom.eyebrow.textContent, `${DEMO_NAME}의 네 가지 소식 공간`, 'demo eyebrow must survive the no-apiBase lane');
}

/* case 2: server authority name → slots updated once, suffix preserved, public GET shape */
{
  const dom = makeDom();
  const calls = [];
  const logs = await runWiring({ apiBase: 'https://api.test/', fetchImpl: okFetch({ data: { name: '테스트단지' } }, calls), dom });
  assert.equal(calls.length, 1, 'a successful authority read must render exactly once (no duplicate fetch/render)');
  assert.equal(calls[0].url, 'https://api.test/api/v1/complexes/banglim-myeongji-roadhill', 'trailing slash must be trimmed and the canonical slug encoded');
  assert.equal(calls[0].opts.credentials, 'omit', 'authority read must stay anonymous');
  assert.ok(calls[0].opts.signal, 'authority read must be timeout-guarded');
  assert.equal(dom.identity.textContent, '테스트단지');
  assert.equal(dom.mobileHead.textContent, '테스트단지');
  assert.equal(dom.eyebrow.textContent, '테스트단지의 네 가지 소식 공간', 'eyebrow must replace only the demo name prefix');
  assert.equal(logs.length, 0, 'success path must stay silent');
}

/* case 3: HTTP error → fail closed, demo intact */
{
  const dom = makeDom();
  const logs = await runWiring({ apiBase: 'https://api.test', fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }), dom });
  assert.equal(dom.identity.textContent, DEMO_NAME, 'HTTP failure must keep the demo name');
  assert.equal(dom.eyebrow.textContent, `${DEMO_NAME}의 네 가지 소식 공간`, 'HTTP failure must keep the demo eyebrow');
  assert.ok(logs.some((l) => l.includes('unavailable') && l.includes('keeping demo name')), 'HTTP failure must log the fail-closed lane');
}

/* case 4: empty/whitespace server name → keep demo, no blank render */
{
  const dom = makeDom();
  const logs = await runWiring({ apiBase: 'https://api.test', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: { name: '   ' } }) }), dom });
  assert.equal(dom.identity.textContent, DEMO_NAME, 'empty server name must never blank the identity slot');
  assert.ok(logs.some((l) => l.includes('empty')), 'empty authority result must log the keep-demo lane');
}

/* case 5: network rejection → fail closed, demo intact */
{
  const dom = makeDom();
  const logs = await runWiring({ apiBase: 'https://api.test', fetchImpl: async () => { throw new Error('network down'); }, dom });
  assert.equal(dom.identity.textContent, DEMO_NAME, 'network failure must keep the demo name');
  assert.ok(logs.some((l) => l.includes('network down')), 'network failure must be logged, never thrown');
}

/* case 6: idempotent re-run → no duplicate render, eyebrow prefix not double-replaced */
{
  const dom = makeDom();
  await runWiring({ apiBase: 'https://api.test', fetchImpl: okFetch({ data: { name: '테스트단지' } }, []), dom });
  await runWiring({ apiBase: 'https://api.test', fetchImpl: okFetch({ data: { name: '테스트단지' } }, []), dom });
  assert.equal(dom.identity.textContent, '테스트단지', 're-run must not duplicate the rendered name');
  assert.equal(dom.eyebrow.textContent, '테스트단지의 네 가지 소식 공간', 're-run must not touch an already-wired eyebrow');
}

console.log('leaf-b13-firstscreen-wiring-contract: PASS');
