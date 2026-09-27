// #1079: page 22 public profile must fail closed when the profile target is
// missing or unavailable, instead of leaving the static prototype shell up.
//
// Historical defect: `placeholder(msg)` cleared only avatar/name/meta/stats and
// the activity area. Opening the page without a `userId` showed
// "프로필 대상이 없습니다." while these target-specific static elements stayed
// live and authoritative-looking:
//
//   방림명지로드힐 주민          <- resident label
//   LV.3 · 참여하는 이웃        <- level chip (link) + full coral LV.3 panel
//   3/5 level track, next-level copy
//   1:1 메시지 보내기           <- message CTA, still clickable
//   신고/차단 ... menu          <- still clickable
//
// The fix extends the single placeholder() funnel to also settle those
// controls (hidden + disabled) in EVERY non-confirmed state — loading,
// missing userId, malformed userId (client rejection), 404, error,
// auth-required — and restores them only in the one branch where the server
// confirms the profile target.
//
// #263 stays HOLD: no warmth score, no formula, no level computation, no
// static LV.3 swap. This is MISSING_TARGET_FAIL_CLOSED only.
//
// This contract is behavioural: it executes the real `danjion-public-profile-
// server` inline block against a scripted bridge.
//
//   Case A  no userId            -> neutral missing state, no synthetic shell
//   Case B  malformed userId     -> client rejection contract, zero fetch
//   Case C  valid userId success -> server render, controls restored
//   Case D  server 404           -> neutral missing state
//   Case E  auth-required        -> fail closed, no static shell
//   Case F  mobile structural pins
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');
const page = await read('22_주민_공개프로필.html');

const scriptSource = (() => {
  const blocks = [...page.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const script = blocks.find((b) => b.includes('danjion-public-profile-server') || (b.includes('publicProfile') && b.includes("get('userId')")));
  assert.ok(script, '22 must still ship the inline block that owns publicProfile and placeholder()');
  return script;
})();

const UUID_OK = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE = {
  nickname: '산책메이트',
  joinedMonth: '2026-08',
  publicBio: '단지 산책길과 생활 정보를 나누는 이웃입니다.',
  publicActivityCount: 9,
};

const settle = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

const runScenario = async ({ userId = '', profileResult, blockedResult = { ok: true, blocks: [] } } = {}) => {
  const els = {
    'pub-avatar': { textContent: '산' },
    'pub-name': { textContent: '산책메이트님' },
    'pub-meta': { textContent: '2026년 8월 가입 · 우리집 등록' },
    'pub-stats': { innerHTML: '<div class="stat"><b>6</b><span>게시글</span></div>' },
    'pub-activity': { innerHTML: '<div class="tabs"></div><div class="activity-panel active"></div>' },
    '.resident-label': { textContent: '방림명지로드힐 주민', hidden: false },
    '.level-chip': { textContent: 'LV.3 · 참여하는 이웃', hidden: false },
    '.level-panel': { hidden: false },
    '.profile-actions .message-button': { textContent: '1:1 메시지 보내기', hidden: false, disabled: false },
    '.more-wrap': { hidden: false },
  };
  const bridgeCalls = [];
  let safety = null;
  const DanjionResidentBridge = {
    serverConfig: () => ({ enabled: true, apiBase: '', complexSlug: 'mokdong-01' }),
    createResidentBridge: () => ({
      blockedUsers() {
        bridgeCalls.push({ op: 'blockedUsers' });
        return Promise.resolve(blockedResult);
      },
      publicProfile(id) {
        // Faithful to resident-bridge.js: the UUID is validated client-side and
        // a malformed id is rejected before any network request is made.
        if (!UUID_RE.test(String(id || '').trim().toLowerCase())) {
          return Promise.resolve({ ok: false, mode: 'client', error: 'PROFILE_USER_ID_REQUIRED' });
        }
        bridgeCalls.push({ op: 'publicProfile', id });
        return Promise.resolve(profileResult);
      },
      reportResident() {
        return Promise.resolve({ ok: false });
      },
      blockResident() {
        return Promise.resolve({ ok: false });
      },
      unblockResident() {
        return Promise.resolve({ ok: false });
      },
    }),
  };

  const documentStub = {
    getElementById: (id) => els[id] || null,
    querySelector: (sel) => els[sel] || null,
    querySelectorAll: () => [],
  };

  const sandbox = {
    document: documentStub,
    location: { search: userId ? '?userId=' + encodeURIComponent(userId) : '', href: '' },
    window: {},
    console,
  };
  sandbox.globalThis = sandbox;
  sandbox.DanjionResidentBridge = DanjionResidentBridge;
  Object.defineProperty(sandbox, '__danjionProfileSafety', {
    set(v) {
      safety = v;
    },
    get() {
      return safety;
    },
  });

  new Function(
    'document',
    'location',
    'window',
    'globalThis',
    'DanjionResidentBridge',
    scriptSource,
  )(
    documentStub,
    sandbox.location,
    sandbox.window,
    sandbox,
    DanjionResidentBridge,
  );

  await settle();
  return {
    els,
    bridgeCalls,
    safety,
    metaText: els['pub-meta'].textContent,
    nameText: els['pub-name'].textContent,
    activityHtml: els['pub-activity'].innerHTML,
    statsHtml: els['pub-stats'].innerHTML,
    residentLabelHidden: els['.resident-label'].hidden,
    levelChipHidden: els['.level-chip'].hidden,
    levelPanelHidden: els['.level-panel'].hidden,
    messageHidden: els['.profile-actions .message-button'].hidden,
    messageDisabled: els['.profile-actions .message-button'].disabled,
    moreWrapHidden: els['.more-wrap'].hidden,
    fetches: bridgeCalls.filter((c) => c.op === 'publicProfile'),
  };
};

// ===========================================================================
// Case A — no userId: one coherent neutral missing state, zero synthetic shell.
// ===========================================================================
const caseA = await runScenario({});

assert.match(caseA.metaText, /프로필 대상이 없습니다\./, 'Case A: the missing-target copy must be visible');
assert.match(caseA.activityHtml, /프로필 대상이 없습니다\./, 'Case A: the activity area must carry the same missing-target copy');
assert.equal(caseA.residentLabelHidden, true, 'Case A: the synthetic resident label must be hidden');
assert.equal(caseA.levelChipHidden, true, 'Case A: the static LV.3 chip must be hidden');
assert.equal(caseA.levelPanelHidden, true, 'Case A: the static LV.3 warmth panel must be hidden');
assert.equal(caseA.messageHidden, true, 'Case A: the 1:1 message CTA must be hidden');
assert.equal(caseA.messageDisabled, true, 'Case A: the 1:1 message CTA must be disabled');
assert.equal(caseA.moreWrapHidden, true, 'Case A: the report/block menu must be hidden');
assert.equal(caseA.fetches.length, 0, 'Case A: no profile fetch may happen without a target id');
assert.equal(caseA.safety, null, 'Case A: no safety wiring may exist without a target id');
assert.equal(caseA.nameText, '—', 'Case A: the name must be a neutral dash, not a synthetic nickname');

// ===========================================================================
// Case B — malformed userId: the client rejection contract stays, zero fetch.
// ===========================================================================
const caseB = await runScenario({
  userId: 'not-a-uuid',
  profileResult: { ok: false, mode: 'client', error: 'PROFILE_USER_ID_REQUIRED' },
});

assert.match(caseB.metaText, /정보가 없습니다\./, 'Case B: the canonical client-rejection copy must be shown');
assert.equal(caseB.fetches.length, 0, 'Case B: a malformed userId must never reach the network');
assert.equal(caseB.levelChipHidden, true, 'Case B: no static LV.3 presentation may survive');
assert.equal(caseB.levelPanelHidden, true, 'Case B: no static warmth panel may survive');
assert.equal(caseB.messageHidden, true, 'Case B: target actions must be hidden');
assert.equal(caseB.moreWrapHidden, true, 'Case B: report/block must be hidden');

// ===========================================================================
// Case C — valid userId + server success: authoritative render is unchanged
// and the target controls come back.
// ===========================================================================
const caseC = await runScenario({
  userId: UUID_OK,
  profileResult: { ok: true, mode: 'server', status: 200, profile: { ...PROFILE } },
});

assert.equal(caseC.nameText, '산책메이트님', 'Case C: the server nickname must render');
assert.match(caseC.metaText, /2026년 8월 가입/, 'Case C: the joined month must render');
assert.match(caseC.statsHtml, /<b>9<\/b><span>공개 활동<\/span>/, 'Case C: the public activity count must render');
assert.match(caseC.activityHtml, /단지 산책길과 생활 정보를 나누는 이웃입니다\./, 'Case C: the public bio must render');
assert.equal(caseC.residentLabelHidden, false, 'Case C: the resident label must be restored for a confirmed target');
assert.equal(caseC.levelChipHidden, false, 'Case C: the level chip must be restored (valid-target behaviour unchanged)');
assert.equal(caseC.levelPanelHidden, false, 'Case C: the warmth panel must be restored (valid-target behaviour unchanged)');
assert.equal(caseC.messageHidden, false, 'Case C: the message CTA must be available for a confirmed target');
assert.equal(caseC.messageDisabled, false, 'Case C: the message CTA must be enabled for a confirmed target');
assert.equal(caseC.moreWrapHidden, false, 'Case C: report/block must be available for a confirmed target');
assert.ok(caseC.safety && caseC.safety.userId === UUID_OK, 'Case C: the safety wiring must keep the confirmed target id');

// ===========================================================================
// Case D — server 404: neutral missing state, zero synthetic shell.
// ===========================================================================
const caseD = await runScenario({
  userId: UUID_OK,
  profileResult: { ok: false, mode: 'server', status: 404 },
});

assert.match(caseD.metaText, /정보가 없습니다\./, 'Case D: the not-found copy must be shown');
assert.equal(caseD.levelChipHidden, true, 'Case D: no static LV.3 presentation may survive');
assert.equal(caseD.levelPanelHidden, true, 'Case D: no static warmth panel may survive');
assert.equal(caseD.messageHidden, true, 'Case D: the message CTA must be hidden for a missing target');
assert.equal(caseD.moreWrapHidden, true, 'Case D: report/block must be hidden for a missing target');
assert.equal(caseD.nameText, '—', 'Case D: no synthetic nickname may survive');

// ===========================================================================
// Case E — auth-required: fail closed, no target-specific static shell.
// ===========================================================================
const caseE = await runScenario({
  userId: UUID_OK,
  profileResult: { ok: false, mode: 'auth-required', status: 401 },
});

assert.match(caseE.metaText, /로그인 후 다시 시도해 주세요\./, 'Case E: the auth-required copy must be shown');
assert.equal(caseE.levelChipHidden, true, 'Case E: no static LV.3 presentation may survive');
assert.equal(caseE.levelPanelHidden, true, 'Case E: no static warmth panel may survive');
assert.equal(caseE.messageHidden, true, 'Case E: the message CTA must be hidden');
assert.equal(caseE.moreWrapHidden, true, 'Case E: report/block must be hidden');

// ===========================================================================
// Case F — mobile structural pins: hidden controls leave no layout hole.
// ===========================================================================
assert.match(
  page,
  /\[hidden\]\{display:none!important\}/,
  'Case F: [hidden] must be display:none!important so author display:flex/inline-flex cannot resurrect hidden controls',
);
assert.match(page, /class="mobile-bottom"/, 'Case F: the mobile bottom navigation must remain untouched');
assert.match(page, /class="back"/, 'Case F: the route back control remains, so the route bar keeps its height');

// #263 stays HOLD: no warmth score may be invented anywhere in this fix.
assert.match(page, /LV\.3 · 참여하는 이웃/, 'the static LV.3 copy must stay exactly as it was (no arbitrary level swap)');
assert.doesNotMatch(page, /warmthScore|warmth_score|level\s*=\s*Math\.|computeLevel|score\+/, 'no warmth scoring formula may be introduced');
assert.doesNotMatch(scriptSource, /['"]LV\.\d/, 'the profile script must not compute or hardcode any level value');

// ===========================================================================
// Mutation proof — restoring the historical avatar/name/stats-only
// placeholder must re-create the synthetic shell and fail Case A.
// ===========================================================================
{
  const HISTORICAL_PLACEHOLDER =
    "  function placeholder(msg){\n" +
    "    setTxt(avatar,DASH);setTxt(name,DASH);setTxt(meta,msg);\n" +
    "    if(stats)stats.innerHTML='<div class=\"stat\"><b>'+DASH+'</b><span>공개 활동</span></div>';\n" +
    "    if(activity)activity.innerHTML='<div class=\"activity-panel active\"><p style=\"padding:24px 4px;color:#6d6a64\">'+esc(msg)+'</p></div>';\n" +
    "  }";
  assert.ok(scriptSource.includes('function placeholder(msg){'), 'placeholder must exist in the page');
  const start = scriptSource.indexOf('  function placeholder(msg){');
  const end = scriptSource.indexOf("  placeholder('불러오는 중…');", start);
  assert.ok(start > -1 && end > start, 'placeholder body must precede its loading call');
  const mutatedScript = scriptSource.slice(0, start) + HISTORICAL_PLACEHOLDER + '\n' + scriptSource.slice(end);
  assert.notEqual(mutatedScript, scriptSource, 'mutation must actually change the script');

  const runMutated = async () => {
    const els = {
      'pub-avatar': { textContent: '산' },
      'pub-name': { textContent: '산책메이트님' },
      'pub-meta': { textContent: '2026년 8월 가입 · 우리집 등록' },
      'pub-stats': { innerHTML: '' },
      'pub-activity': { innerHTML: '' },
      '.resident-label': { textContent: '방림명지로드힐 주민', hidden: false },
      '.level-chip': { textContent: 'LV.3 · 참여하는 이웃', hidden: false },
      '.level-panel': { hidden: false },
      '.profile-actions .message-button': { textContent: '1:1 메시지 보내기', hidden: false, disabled: false },
      '.more-wrap': { hidden: false },
    };
    const DanjionResidentBridge = {
      serverConfig: () => ({ enabled: true, apiBase: '', complexSlug: 'mokdong-01' }),
      createResidentBridge: () => ({
        blockedUsers: () => Promise.resolve({ ok: true, blocks: [] }),
        publicProfile: () => Promise.resolve({ ok: false, mode: 'client', error: 'PROFILE_USER_ID_REQUIRED' }),
      }),
    };
    const documentStub = {
      getElementById: (id) => els[id] || null,
      querySelector: (sel) => els[sel] || null,
      querySelectorAll: () => [],
    };
    const sandbox = {
      document: documentStub,
      location: { search: '', href: '' },
      window: {},
      console,
    };
    sandbox.globalThis = sandbox;
    sandbox.DanjionResidentBridge = DanjionResidentBridge;
    new Function(
      'document',
      'location',
      'window',
      'globalThis',
      'DanjionResidentBridge',
      mutatedScript,
    )(
      documentStub,
      sandbox.location,
      sandbox.window,
      sandbox,
      DanjionResidentBridge,
    );
    await settle();
    return els;
  };

  const mutated = await runMutated();
  assert.match(mutated['pub-meta'].textContent, /프로필 대상이 없습니다\./, 'mutation: the copy alone still works');
  assert.equal(mutated['.resident-label'].hidden, false, 'mutation: the historical placeholder must leave the synthetic resident label visible');
  assert.equal(mutated['.level-chip'].hidden, false, 'mutation: the historical placeholder must leave the static LV.3 chip visible');
  assert.equal(mutated['.level-panel'].hidden, false, 'mutation: the historical placeholder must leave the LV.3 panel visible');
  assert.equal(mutated['.profile-actions .message-button'].hidden, false, 'mutation: the historical placeholder must leave the message CTA visible');
  assert.equal(mutated['.profile-actions .message-button'].disabled, false, 'mutation: the historical placeholder must leave the message CTA actionable');
  assert.equal(mutated['.more-wrap'].hidden, false, 'mutation: the historical placeholder must leave report/block reachable');
}

console.log('1079_CASE_NO_USER_ID=PASS');
console.log('1079_CASE_MALFORMED_USER_ID=PASS');
console.log('1079_CASE_VALID_TARGET_REGRESSION=PASS');
console.log('1079_CASE_NOT_FOUND_404=PASS');
console.log('1079_CASE_AUTH_REQUIRED=PASS');
console.log('1079_CASE_MOBILE_STRUCTURE=PASS');
console.log('1079_WARMTH_POLICY_INVENTED=NO');
console.log('1079_MUTATION_PROOF=PASS');

console.log('leaf-1079-profile-missing-target-fail-closed-contract: PASS');
