// #1080: the My Info message card copy must follow the authoritative unread
// count instead of claiming new messages unconditionally.
//
// Historical defect: the card headline was static markup
//
//   <h3>새 메시지가 있어요.<span class="unread" id="mi-unread">2</span></h3>
//
// and the server wiring updated only `#mi-unread` from
// `summary.unreadMessageCount`. A fresh resident with `전체 0 / 안 읽음 0`
// still saw "새 메시지가 있어요." — and when the summary was unavailable the
// badge fell back to the em-dash init, producing the visibly contradictory
// "새 메시지가 있어요. —".
//
// The fix makes the headline a reconciled node: unread > 0 may use the
// message-arrival copy; unread === 0 and unknown/unavailable use a neutral
// copy ("메시지함을 확인해 보세요.") and never claim a new message. The count
// itself stays server-authoritative (summary.unreadMessageCount) and the
// inbox CTA is untouched.
//
// This contract is behavioural: it runs the real danjion-session.js,
// resident-bridge.js and the page's real myinfo wiring in a VM with a
// scripted fetch, then drives the summary outcomes.
//
//   Case A  unread 2            -> arrival copy + count 2
//   Case B  unread 1            -> arrival copy + count 1
//   Case C  unread 0            -> neutral copy, NO new-message claim
//   Case D  unread unknown      -> neutral copy, em-dash badge
//   Case E  summary failure     -> card coherent, page still usable
//   Case F  authenticated profile regression
//   Case G  structural pins (neutral initial document, no client count math)
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const sessionSrc = await read('../assets/danjion-session.js');
const residentSrc = await read('../assets/resident-bridge.js');
const f19 = await read('../19_내정보_메인.html');

const wiringStart = f19.indexOf('<script id="danjion-myinfo-server-wiring">');
assert.ok(wiringStart > -1, 'f19 must keep the myinfo server wiring script');
const wiringRaw = f19.slice(wiringStart, f19.indexOf('</script>', wiringStart));
const wiring = wiringRaw.replace(/^\s*<script[^>]*>\s*/, '');

const ARRIVAL_COPY = '새 메시지가 있어요.';
const NEUTRAL_COPY = '메시지함을 확인해 보세요.';

const response = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
  headers: { get: () => null },
});

function makeHarness({ summaryAnswer, profileAnswer } = {}) {
  const calls = [];
  const nodes = new Map();
  const doc = {
    readyState: 'loading',
    addEventListener() {},
    getElementById(id) {
      if (!nodes.has(id)) {
        nodes.set(id, {
          textContent: '', hidden: true, className: '', value: '', disabled: false, attributes: {},
          focus() {}, addEventListener() {},
          setAttribute(name, value) { this.attributes[name] = String(value); },
          removeAttribute(name) { delete this.attributes[name]; },
        });
      }
      return nodes.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, classList: { add() {} }, dataset: {}, append() {}, appendChild() {}, addEventListener() {}, setAttribute() {} }; },
    head: { appendChild() {} },
  };
  const ctx = {
    URL,
    URLSearchParams,
    console,
    document: doc,
    location: { hostname: 'danjion.pages.dev', pathname: '/19_내정보_메인.html', search: '', origin: 'https://danjion.pages.dev' },
    fetch: async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/api/auth/get-session')) {
        return response(200, { session: { id: 'sess-1' }, user: { name: '이웃주민', email: 'signed-in@example.invalid', emailVerified: true, createdAt: '2026-01-15T00:00:00Z' } });
      }
      if (u.includes('/api/v1/me/profile')) {
        return profileAnswer || response(200, { data: { nickname: '이웃별명', publicBio: '소개', joinedMonth: '2026-08' } });
      }
      if (u.includes('/api/v1/me/summary')) {
        return summaryAnswer || response(200, { data: { postCount: 1, commentCount: 2, receivedReactionCount: 3, savedBusinessCount: 4, unreadMessageCount: 0, household: { status: 'verified' } } });
      }
      return response(404, { error: { code: 'NOT_FOUND' } });
    },
  };
  // The real page defines showToast on window; mirror a browser so the
  // wiring's guarded toast() can evaluate `window.showToast` and the session
  // runtime attaches to the same global it would in a browser.
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(sessionSrc, ctx);
  vm.runInContext(residentSrc, ctx);
  vm.runInContext(wiring, ctx);
  const drain = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
  return { calls, nodes, drain };
}

const summaryWith = (unreadMessageCount) => response(200, {
  data: { postCount: 1, commentCount: 2, receivedReactionCount: 3, savedBusinessCount: 4, unreadMessageCount, household: { status: 'verified' } },
});

const cardState = (h) => ({
  copy: h.nodes.get('mi-unread-copy').textContent,
  badge: h.nodes.get('mi-unread').textContent,
});

// ===========================================================================
// Case A — unread 2: the arrival copy is truthful and shows the server count.
// ===========================================================================
{
  const h = makeHarness({ summaryAnswer: summaryWith(2) });
  await h.drain();
  const { copy, badge } = cardState(h);
  assert.equal(copy, ARRIVAL_COPY, 'Case A: unread 2 must use the message-arrival copy');
  assert.equal(badge, '2', 'Case A: the badge must show the authoritative server count');
}

// ===========================================================================
// Case B — unread 1.
// ===========================================================================
{
  const h = makeHarness({ summaryAnswer: summaryWith(1) });
  await h.drain();
  const { copy, badge } = cardState(h);
  assert.equal(copy, ARRIVAL_COPY, 'Case B: unread 1 must use the message-arrival copy');
  assert.equal(badge, '1', 'Case B: the badge must show 1');
}

// ===========================================================================
// Case C — unread 0: no new-message claim; badge stays the truthful 0.
// ===========================================================================
{
  const h = makeHarness({ summaryAnswer: summaryWith(0) });
  await h.drain();
  const { copy, badge } = cardState(h);
  assert.equal(copy, NEUTRAL_COPY, 'Case C: unread 0 must reconcile the headline to the neutral copy');
  assert.notEqual(copy, ARRIVAL_COPY, 'Case C: unread 0 must not claim a new message');
  assert.equal(badge, '0', 'Case C: the badge must show the truthful zero');
  assert.ok(h.calls.some((u) => u.includes('/api/v1/me/summary')), 'Case C: the count must come from the real summary read');
}

// ===========================================================================
// Case D — summary ok but the count is absent/unknown: neutral, em-dash.
// ===========================================================================
{
  const h = makeHarness({
    summaryAnswer: response(200, { data: { postCount: 1, commentCount: 2, receivedReactionCount: 3, savedBusinessCount: 4, household: { status: 'verified' } } }),
  });
  await h.drain();
  const { copy, badge } = cardState(h);
  assert.equal(copy, NEUTRAL_COPY, 'Case D: an unknown count must use the neutral copy');
  assert.notEqual(copy, ARRIVAL_COPY, 'Case D: an unknown count must not claim a new message');
  assert.equal(badge, '—', 'Case D: an unknown count must keep the em-dash badge, never a fake number');
}

// ===========================================================================
// Case E — summary failure: the card stays coherent and the page stays usable.
// ===========================================================================
{
  const h = makeHarness({ summaryAnswer: response(500, { error: { code: 'SUMMARY_DB_ERROR' } }) });
  await h.drain();
  const { copy, badge } = cardState(h);
  assert.notEqual(copy, ARRIVAL_COPY, 'Case E: a failed summary must not claim a new message');
  assert.equal(badge, '—', 'Case E: a failed summary must keep the em-dash badge');
  assert.equal(h.nodes.get('mi-nickname').textContent, '이웃별명님', 'Case E: the profile render must survive the summary failure');
  assert.equal(h.nodes.get('myinfoAccessGate').hidden, true, 'Case E: a summary failure must not gate the whole page');
  assert.equal(h.nodes.get('myinfoPrivateContent').hidden, false, 'Case E: private content must stay visible');
}

// ===========================================================================
// Case F — authenticated normal profile: other cards/stats unchanged.
// ===========================================================================
{
  const h = makeHarness({ summaryAnswer: summaryWith(0) });
  await h.drain();
  assert.equal(h.nodes.get('mi-nickname').textContent, '이웃별명님', 'Case F: server-backed nickname renders');
  assert.equal(h.nodes.get('mi-joined').textContent, '2026년 8월 가입', 'Case F: joined month renders from the server-backed profile');
  assert.equal(h.nodes.get('mi-stat-posts').textContent, '1', 'Case F: post count renders from summary');
  assert.equal(h.nodes.get('mi-stat-comments').textContent, '2', 'Case F: comment count renders from summary');
  assert.equal(h.nodes.get('mi-stat-reactions').textContent, '3', 'Case F: reaction count renders from summary');
  assert.equal(h.nodes.get('mi-household').textContent, '우리집 연결 완료', 'Case F: household badge renders from summary');
  assert.ok(
    f19.includes("onclick=\"location.href='20_메시지함_목록.html'\""),
    'Case F: the message inbox CTA must remain untouched',
  );
}

// ===========================================================================
// Case G — structural pins.
// ===========================================================================
{
  // The initial document must be neutral: no synthetic "2", no arrival claim.
  assert.match(f19, /<span id="mi-unread-copy">메시지함을 확인해 보세요\.<\/span>/, 'Case G: the static headline must start neutral');
  assert.match(f19, /<span class="unread" id="mi-unread">—<\/span>/, 'Case G: the static badge must start at the em-dash, not a fake 2');
  assert.ok(!f19.includes('>새 메시지가 있어요.<'), 'Case G: the arrival copy must exist only in the reconciliation, never as static markup');
  assert.ok(wiring.includes('새 메시지가 있어요.'), 'Case G: the arrival copy must be applied only from the authoritative summary path');
  // Count authority: the wiring must not compute or fake counts client-side.
  assert.ok(wiring.includes('syncUnread(s.unreadMessageCount)'), 'Case G: the summary remains the only unread authority');
  assert.doesNotMatch(wiring, /unreadMessageCount\s*[+\-*\/]/, 'Case G: no client-side unread arithmetic');
  assert.doesNotMatch(wiring, /unread\s*=\s*unread\s*\+\s*1|unread\+\+/, 'Case G: no client-side unread increments');
  // Mobile 390: the h3 is two inline spans inside the existing card; the
  // established mobile band already sizes .side-card h3 and the card keeps
  // its padding, so a longer neutral line wraps instead of overflowing.
  assert.match(f19, /\.side-card h3\{font-size:23px\}/, 'Case G: the mobile band keeps the card headline sized (no overflow introduced)');
  assert.match(f19, /class="card-link"/, 'Case G: the inbox CTA stays in the card');
}

console.log('1080_CASE_UNREAD_2=PASS');
console.log('1080_CASE_UNREAD_1=PASS');
console.log('1080_CASE_UNREAD_0=PASS');
console.log('1080_CASE_UNREAD_UNKNOWN=PASS');
console.log('1080_CASE_SUMMARY_FAILURE=PASS');
console.log('1080_CASE_AUTHENTICATED_REGRESSION=PASS');
console.log('1080_CASE_STRUCTURE=PASS');

console.log('leaf-1080-myinfo-unread-copy-contract: PASS');
