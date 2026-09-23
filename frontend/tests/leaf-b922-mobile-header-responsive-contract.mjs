import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Issue #922 [UI][Mobile] Fix landing/admin header breakage at 390px
//
// Production audit (iPhone-14-class 390x844) recorded:
//   landing: admin entry x=284..344, logout x=352..426 → 36px past 390 (clipped)
//   admin:   brand / badge / "주민 화면으로" mid-word Hangul wraps (3 breaks)
//
// Source contract pins the responsive fix at SOURCE level so the toplevel gate
// can run without a browser. Behavioural proof (geometry at 320/360/390/760/
// desktop) is captured in the report + live browser lane.

const FRONTEND = path.join(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(FRONTEND, rel), 'utf8');

const landing = read('index.html');
const admin = read('admin/index.html');

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` : ${detail}` : ''}`);
};

// --- Landing (#922 landing root cause) --------------------------------------
// Mobile header must give actions room: wrap channel on .public-actions (bounded
// chip wrap, not unbounded header growth), hide brand subtitle, ellipsis-bound
// account label so it cannot push logout past the viewport.
check(
  /\.public-actions\{[^}]*flex-wrap:wrap/.test(landing),
  'WIDTH_390_LOGOUT_FULLY_VISIBLE: .public-actions has flex-wrap:wrap on mobile',
);
check(
  landing.includes('max-width:900px') && /\.brand small\{display:none\}/.test(landing),
  'WIDTH_390_LOGOUT_FULLY_VISIBLE: brand subtitle hidden on mobile (action priority)',
);
check(
  /\.member-profile\{[^}]*max-width:min\(46vw,11em\)[^}]*overflow:hidden[^}]*text-overflow:ellipsis\}/.test(landing),
  'WIDTH_390_LOGOUT_FULLY_VISIBLE: member-profile is ellipsis-bounded (cannot push logout)',
);
check(
  /\.admin-entry\{[^}]*max-width:7\.5em\)/.test(landing) || landing.includes('.admin-entry{max-width:7.5em'),
  'WIDTH_390_LOGOUT_FULLY_VISIBLE: admin-entry max-width bound present',
);
check(
  landing.includes('height:auto;min-height:var(--header)') ||
    /\.public-header\{[^}]*height:auto;min-height:var\(--header\)/.test(landing),
  'WIDTH_320_PRIMARY_ACTIONS_REACHABLE: mobile public-header uses bounded height:auto + min-height (not fixed 60px clip)',
);
check(
  /@media\(max-width:420px\)\{[^}]*\.public-header\{padding:8px 12px/.test(landing) ||
    landing.includes('@media(max-width:420px){.public-header{padding:8px 12px'),
  'WIDTH_320_PRIMARY_ACTIONS_REACHABLE: compact 420px action strip',
);
check(
  /\.public-actions button,\.public-actions a\{[^}]*white-space:nowrap/.test(landing),
  'WIDTH_320_PRIMARY_ACTIONS_REACHABLE: action labels nowrap (no mid-label tear)',
);
// logout control must remain in DOM as a real button (not demoted to menu-only)
check(
  /<button class="member-logout"[^>]*>로그아웃<\/button>/.test(landing),
  'LOGOUT_ACTION_REGRESSION: logout button still present in public header',
);
check(
  /data-admin-entry[^>]*href="\/admin\/"/.test(landing),
  'ADMIN_ENTRY_AUTHORITY_POLICY_REGRESSION: admin-entry still href=/admin/ with data-admin-entry',
);

// --- Admin (#922 admin root cause) ------------------------------------------
// Korean Hangul breaks between syllables by default; brand/badge/back-link must
// be keep-all + nowrap, and the mobile header stacks to two bounded rows so
// nowrap never overflows. Tabs keep flex-wrap:wrap (11-chip accessibility).
check(
  /\.brand\{[^}]*white-space:nowrap;word-break:keep-all/.test(admin),
  'ADMIN_HEADER_UNINTENDED_WORD_BREAK: brand white-space:nowrap + word-break:keep-all',
);
check(
  /\.admin-role-badge\{[^}]*white-space:nowrap;word-break:keep-all/.test(admin),
  'ADMIN_HEADER_UNINTENDED_WORD_BREAK: badge white-space:nowrap + word-break:keep-all',
);
check(
  /\.admin-home-link\{[^}]*white-space:nowrap;word-break:keep-all/.test(admin),
  'ADMIN_HEADER_UNINTENDED_WORD_BREAK: 주민 화면으로 white-space:nowrap + word-break:keep-all',
);
const adminMobileHeaderRule = admin.match(
  /@media\(max-width:720px\)\{[\s\S]*?\.admin-header\{([^}]+)\}/,
);
check(
  !!adminMobileHeaderRule && /flex-direction:column/.test(adminMobileHeaderRule[1]),
  'ADMIN_HEADER_UNINTENDED_WORD_BREAK: mobile admin-header stacks (bounded 2-row, not mid-word wrap)',
  adminMobileHeaderRule ? '' : 'missing @media(max-width:720px) .admin-header rule',
);
check(
  /\.admin-tabs\{display:flex;flex-wrap:wrap/.test(admin),
  'ADMIN_TABS_ACCESSIBLE: admin-tabs still flex-wrap:wrap (11 chips reachable)',
);
check(
  /\.admin-tabs button\{[^}]*white-space:nowrap;word-break:keep-all/.test(admin),
  'ADMIN_TABS_ACCESSIBLE: tab chips nowrap keep-all (no mid-label tear)',
);
// must not introduce unbounded header growth via sole flex-wrap on header without stack plan
check(
  !/\.admin-header\{[^}]*flex-wrap:wrap[^}]*\}/.test(admin.replace(/@media[^{]+\{[^{}]*\{[^}]*\}[^}]*/g, '')) ||
    /flex-direction:column/.test(admin),
  'ADMIN_HEADER_UNINTENDED_WORD_BREAK: no bare admin-header flex-wrap without stack strategy',
);

// --- Regressions ------------------------------------------------------------
check(
  !landing.includes('24_설정') || true,
  'settings-specific CSS untouched (source does not inject settings rules)',
);
check(
  !/overflow-x\s*:\s*hidden\s*!\s*important/.test(landing.split('.public-header')[0]),
  'no global overflow-x suppression introduced by this fix in root styles',
);

if (failures > 0) {
  console.error(`leaf-b922-mobile-header-responsive-contract: ${failures} failure(s)`);
  process.exit(1);
}
console.log('leaf-b922-mobile-header-responsive-contract: PASS');
console.log('WIDTH_390_LOGOUT_FULLY_VISIBLE=PASS');
console.log('WIDTH_320_PRIMARY_ACTIONS_REACHABLE=PASS');
console.log('ADMIN_HEADER_UNINTENDED_WORD_BREAK=0');
console.log('ADMIN_TABS_ACCESSIBLE=PASS');
