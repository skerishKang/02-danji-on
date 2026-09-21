import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/*
 * #787 UX honesty contract — notification samples and auth-copy states.
 *
 * Two user-confusion defects from the sibling test round and the LOCAL2/LOCAL3
 * UX audit, both fixable without touching auth/session structure:
 *
 *  1. 27_알림함 shipped five fabricated "unread" notifications, a hardcoded
 *     `5개` unread label and 1/2/1/1 summary counts in the DEFAULT document.
 *     The live wiring replaced them only when it ran, so a non-canonical host
 *     (review preview, local static) bailed out and left fake alerts standing
 *     as if they were the member's real notifications.
 *  2. The community write screens answered every 401 with
 *     "로그인이 만료되었습니다" — including the `no-cookie` disposition, where
 *     the browser never had a session at all. The honest ask there is to log in,
 *     and neither case pointed at the action that resolves it.
 *
 * This contract pins the corrective shape and, just as importantly, pins that
 * the REAL API path and the #525 auth-gate branches are still intact — the fix
 * removes a lie from the markup, not a data path.
 */

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

const WRITE_PAGES = [
  '14_가입인사_글쓰기.html',
  '15_단지이야기_글쓰기.html',
  '16_궁금해요_글쓰기.html',
  '17_같이해요_글쓰기.html'
];

/* ---------- 1. page 27 ships no fabricated notifications ---------- */
{
  const html = await read('27_알림함.html');
  const templateStart = html.indexOf('<template id="danjionNotificationSampleRows"');
  assert.ok(templateStart > 0, 'the sample fixture must exist inside its own template');
  const templateEnd = html.indexOf('</template>', templateStart);
  assert.ok(templateEnd > templateStart, 'the sample template must close');
  const outside = html.slice(0, templateStart) + html.slice(templateEnd + '</template>'.length);
  const count = (needle) => html.split(needle).length - 1;
  /*
   * Scope: the shipped MARKUP, not the renderer. itemHTML() legitimately builds
   * `class="notice-item"` strings from server rows, so the claim "no fake alert
   * is on the page before the API answers" must be tested against the shipped
   * body minus the <template>, or it fails on the renderer's own string literals.
   */
  const bodyStart = html.indexOf('<body');
  const firstScript = html.indexOf('<script', bodyStart);
  assert.ok(bodyStart > 0 && firstScript > bodyStart, 'page 27 must expose a static markup region to test');
  const staticMarkup = html.slice(bodyStart, templateStart)
    + html.slice(templateEnd + '</template>'.length, firstScript);

  assert.equal((staticMarkup.match(/class="notice-item/g) || []).length, 0,
    'no sample notification may be present in the shipped markup');
  assert.ok(staticMarkup.length > 500, 'the markup region must cover the page body, not collapse to a fragment');
  assert.equal(count('class="notice-item unread" data-demo='), 5,
    'exactly five unread sample alerts may exist, and only as demo fixtures');
  assert.equal(count('class="notice-item" data-demo='), 2,
    'the two "지난 알림" samples stay demo fixtures too');
  assert.ok(!/class="unread-count">[0-9]/.test(outside),
    'the unread label must not ship a fabricated count');
  assert.ok(!/class="side-count">[0-9]/.test(outside),
    'the side panel must not ship a fabricated unread number');
  assert.ok(!/<b class="hot" data-summary=/.test(outside),
    'the summary badges must not ship pre-lit per-kind counts');
  assert.match(staticMarkup, /class="unread-count">—</, 'the unread label starts as an unknown-value placeholder');
  assert.match(staticMarkup, /data-notifications-state="loading"/, 'the feed starts in an explicit loading state');
  assert.match(staticMarkup, /알림을 불러오는 중입니다\./, 'the loading state says so in words');
}

/* ---------- 2. the samples are opt-in and labelled as samples ---------- */
{
  const html = await read('27_알림함.html');
  assert.match(html, /<template id="danjionNotificationSampleRows" data-notifications-demo="1">/,
    'the fixture must be opt-in markup, not live DOM');
  assert.ok(html.includes("get('demo')==='1'"),
    'the samples may only render when ?demo=1 is requested');
  assert.match(html, /미리보기용 샘플 알림입니다\. 실제 알림이 아닙니다\./,
    'rendered samples must be labelled as not real notifications');
  assert.match(html, /setAttribute\('data-notifications-demo-note',''\)/,
    'the sample label must be assertable for a visual test');
  assert.ok(html.indexOf('function showDemoRows()') > html.indexOf("const feed=document.querySelector('.feed');"),
    'the demo renderer must run after the feed node is resolved');
}

/* ---------- 3. the old silent bail-out is gone, the real path is intact ---------- */
{
  const html = await read('27_알림함.html');
  /*
   * The stage5j contract pins the bare `...return;` bail-out verbatim so an
   * unbound host can never issue a notification call. This asserts the property
   * that was actually missing: the honest state is announced BEFORE that return,
   * and in the shipped order — not that the return itself disappears.
   */
  const pin = html.indexOf('if(!apiBase&&!DanjionSession.isCanonicalProduction())return;');
  const stated = html.indexOf("showState('알림을 불러오지 못했습니다. 이 화면은 서버에 연결되지 않은 미리보기 상태입니다.')");
  assert.ok(pin > 0, 'stage5j: the unbound bail-out must stay byte-identical');
  assert.ok(stated > 0 && stated < pin,
    'an unbound host must name its state before bailing out, not leave markup standing');
  // #525 authority: these branches are the fail-closed auth gate and must survive.
  assert.ok(html.includes("if(result.mode==='auth-required'){showState(result.status===403?'본인 확인된 입주민만 알림함을 볼 수 있습니다.':'로그인이 필요합니다.');return}"),
    '#525 auth-required gate must stay byte-identical');
  assert.ok(html.includes('render(result.notifications,result.unreadCount)'),
    'real notification data must still drive the feed');
  assert.ok(html.includes('bridge.markAllNotificationsRead()'),
    'the read-all action must stay on the server bridge');
  assert.match(html, /\.notifications-demo-note\{/, 'the sample label needs its own style, not an inline hack');
}

/* ---------- 4. write screens: 401 is not always "expired" ---------- */
{
  const runtime = await read('assets/danjion-session.js');
  const dispositions = runtime.match(/const AUTH_BRIDGE_FAILURES = Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(dispositions, 'the session runtime must keep its closed disposition enum');
  assert.ok(/'no-cookie'/.test(dispositions[1]), "'no-cookie' must remain a real disposition");

  for (const page of WRITE_PAGES) {
    const html = await read(page);
    assert.match(html, /if\(r&&r\.authBridge==='no-cookie'\)return '로그인이 필요합니다\. 로그인한 뒤 글을 남길 수 있어요\.'/,
      `${page}: a browser that never had a session must be asked to log in, not to log in again`);
    assert.match(html, /return '로그인이 만료되었습니다\. 다시 로그인한 뒤 이용해 주세요\.'/,
      `${page}: a session that resolved and then went invalid is still reported as expired`);
    assert.match(html, /if\(kind==='bridge-fault'\)return '서버 인증 연결이 일시적으로 원활하지 않습니다\./,
      `${page}: #810 bridge-fault wording must not be regressed`);
    assert.match(html, /RESIDENT_VERIFICATION_REQUIRED\|HOUSEHOLD_ASSOCIATION_REQUIRED/,
      `${page}: the 403 resident-verification codes must keep their own message`);
    assert.match(html, /\.catch\(\(\)=>\{clearAuthHelp\(\);toast\('서버 연결에 실패했습니다\. 잠시 후 다시 시도해 주세요\.'\);\}\)/,
      `${page}: the network branch keeps its retry wording and clears the auth notice`);
  }
}

/* ---------- 5. each state names the action that resolves it ---------- */
{
  const loginTarget = await read('index.html');
  assert.match(loginTarget, /get\('auth'\)/, "index.html must keep reading the ?auth= intent");
  for (const page of WRITE_PAGES) {
    const html = await read(page);
    assert.equal((html.match(/<p class="auth-help" data-auth-help role="status" hidden><\/p>/g) || []).length, 1,
      `${page}: exactly one hidden-by-default auth notice slot`);
    assert.equal((html.match(/function showAuthHelp\(r\)\{/g) || []).length, 1,
      `${page}: one auth-notice renderer`);
    assert.match(html, /function clearAuthHelp\(\)\{/, `${page}: the notice must be clearable`);
    assert.match(html, /cta\.href=href;/, `${page}: the CTA must be a real link, not a toast word`);
    assert.match(html, /href='index\.html\?auth=login'/,
      `${page}: 401 must offer the canonical landing auth entry, the same route the account strip uses`);
    assert.match(html, /href='26_우리집연결\.html'/,
      `${page}: the resident 403 must offer the canonical household route`);
    assert.match(html, /clearAuthHelp\(\);/, `${page}: a successful post must clear the notice`);
    assert.match(html, /\}else\{const message=serverMessage\(r\);showAuthHelp\(r\);toast\(message\);\}/,
      `${page}: the failure path must both explain and offer the action`);
  }
}

/* ---------- 6. the shared stylesheet stays scoped ---------- */
{
  const css = await read('assets/pages/write-common.css');
  assert.match(css, /\.auth-help\{/, 'the notice needs its own visible styling');
  assert.match(css, /\.auth-help\[hidden\]\{display:none\}/,
    'the notice must hide itself — an author rule would otherwise beat the UA [hidden] rule');
  assert.ok(!/\}\[hidden\]\{/.test(css), 'no global [hidden] override may be introduced from this stylesheet');
  assert.match(css, /\.auth-help a\{[^}]*min-height:44px/, 'the CTA must stay a 44px tap target');
}

console.log('leaf-b787-notification-auth-honesty-contract: PASS pages=%d', 1 + WRITE_PAGES.length);
