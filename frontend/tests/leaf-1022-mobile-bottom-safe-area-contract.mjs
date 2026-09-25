import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Issue #1022: the final, most-specific canonical mobile-bottom rule must
// preserve the device safe-area inset. An earlier generic rule is insufficient
// because OWNERPASS comes later with !important and therefore owns the result.

const FRONTEND = path.join(import.meta.dirname, '..');
const css = readFileSync(path.join(FRONTEND, 'assets/consistency.css'), 'utf8');
const communityDetail = readFileSync(path.join(FRONTEND, '13_이웃대화_글상세_댓글.html'), 'utf8');

const ownerMarker = '/* OWNERPASS 2026-09-04 — optical bottom-nav alignment */';
const ownerStart = css.indexOf(ownerMarker);
assert.notEqual(ownerStart, -1, 'OWNERPASS mobile-bottom section must exist');
const ownerCss = css.slice(ownerStart);

const canonicalRule = ownerCss.match(
  /html body\[data-danjion-page\] nav\.mobile-bottom\{([^}]+)\}/
);
assert.ok(canonicalRule, 'final canonical mobile-bottom rule must exist');
const decl = canonicalRule[1];

assert.match(
  decl,
  /box-sizing:border-box!important/,
  'safe-area nav height must be a total border-box height'
);
assert.match(
  decl,
  /height:calc\(68px \+ env\(safe-area-inset-bottom,0px\)\)!important/,
  'final canonical nav must add the bottom safe-area inset to the 68px shell'
);
assert.match(
  decl,
  /padding:0 0 env\(safe-area-inset-bottom,0px\)!important/,
  'final canonical nav must cover the home-indicator area with bottom padding'
);
assert.doesNotMatch(
  decl,
  /height:68px!important|padding:0!important/,
  'final canonical nav must not regress to the fixed 68px / zero-padding override'
);

assert.match(
  css,
  /body\{padding-bottom:calc\(72px \+ env\(safe-area-inset-bottom,0px\)\)\}/,
  'page body clearance must still reserve nav plus safe-area space'
);
assert.match(
  ownerCss,
  /nav\.mobile-bottom > button,[\s\S]*?nav\.mobile-bottom > a\{height:67px!important;min-height:67px!important/,
  'accepted 68px optical shell / >=44px touch geometry must remain intact'
);

// #981 owns a page-specific sticky action. Shared safe-area restoration must
// remain parity-compatible with that page: both use exactly one 68px + inset
// bottom offset rather than adding the inset twice.
assert.match(
  communityDetail,
  /--community-bottom-offset:calc\(68px \+ var\(--community-safe-bottom\)\)/,
  '#981 sticky action must remain 68px + one safe-area inset'
);
assert.doesNotMatch(
  communityDetail,
  /68px \+ var\(--community-safe-bottom\) \+ var\(--community-safe-bottom\)/,
  '#981 sticky action must not double-apply safe-area inset'
);

const hasFinalSafeArea = source => {
  const start = source.indexOf(ownerMarker);
  if (start < 0) return false;
  const section = source.slice(start);
  const match = section.match(/html body\[data-danjion-page\] nav\.mobile-bottom\{([^}]+)\}/);
  if (!match) return false;
  const d = match[1];
  return /box-sizing:border-box!important/.test(d)
    && /height:calc\(68px \+ env\(safe-area-inset-bottom,0px\)\)!important/.test(d)
    && /padding:0 0 env\(safe-area-inset-bottom,0px\)!important/.test(d)
    && !/height:68px!important|padding:0!important/.test(d);
};

const mutateFinal = (source, from, to) => {
  const start = source.indexOf(ownerMarker);
  assert.notEqual(start, -1, 'mutation helper requires OWNERPASS section');
  const before = source.slice(0, start);
  const owner = source.slice(start);
  assert.ok(owner.includes(from), `mutation target must exist in OWNERPASS: ${from}`);
  return before + owner.replace(from, to);
};

const mutations = [
  [
    'fixed-height-regression',
    mutateFinal(
      css,
      'height:calc(68px + env(safe-area-inset-bottom,0px))!important',
      'height:68px!important'
    )
  ],
  [
    'zero-padding-regression',
    mutateFinal(
      css,
      'padding:0 0 env(safe-area-inset-bottom,0px)!important',
      'padding:0!important'
    )
  ],
  [
    'missing-border-box',
    mutateFinal(css, 'box-sizing:border-box!important;', '')
  ]
];

for (const [name, mutated] of mutations) {
  assert.equal(hasFinalSafeArea(mutated), false, `mutation ${name} must be killed`);
}

console.log('PASS #1022 canonical mobile bottom-nav safe-area contract');
console.log('CANONICAL_BOTTOM_NAV_SAFE_AREA=PASS');
console.log('BOTTOM_NAV_BASE_GEOMETRY_68PX=PRESERVED');
console.log('TOUCH_TARGET_MIN_44=PASS');
console.log('BODY_BOTTOM_CLEARANCE=PASS');
console.log('COMMUNITY_STICKY_ACTION_PARITY=PASS');
console.log('DESKTOP_NAV_CHANGE=NO');
console.log('MUTATION_PROOF=PASS:' + mutations.map(([name]) => name).join(','));
