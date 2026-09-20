import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Issue #826 [Owner Production QA][25A]: a hidden .owner-only required control
// (ownerRelationEtc) could re-enable itself on first ?mode=report mount because
// toggleEtc ran after setMode/syncDisabled with no mode gating. The browser's
// native constraint validation then silently dropped the submit:
//   console: "An invalid form control with name='ownerRelationEtc' is not focusable."
// This contract pins the source-level invariants; the behavioural proof lives in
// 04_개발/frontend/e2e-top-level-v3/shop-report-initial-validation.spec.ts.

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, '..', '25A_신청제보.html');
const src = readFileSync(file, 'utf8');

// toggleEtc must be mode-gated: 'etc' only counts while its own side is the
// active mode, so inactive required/disabled state can never leak.
assert.match(
  src,
  /function toggleEtc\(select,wrap,input,side\)\s*\{\s*const on=select\.value==='etc'&&currentMode\(\)===side;?/,
  'toggleEtc must require currentMode()===side before marking the etc field active'
);
assert.match(
  src,
  /wrap\.hidden=!on;input\.required=on;input\.disabled=!on;/,
  'etc field must bind visible/required/enabled to the mode-gated on flag'
);
assert.doesNotMatch(
  src,
  /const on=select\.value==='etc';\s*wrap\.hidden=!on;input\.required=on;input\.disabled=!on;/,
  'ungated legacy toggleEtc body must be gone'
);

// setMode must re-assert BOTH etc fields after syncDisabled so every deep link
// and every owner<->report transition ends with a consistent state (no second
// tab click required).
assert.match(
  src,
  /syncDisabled\(isReport\?'report':'owner'\);\s*toggleEtc\(ownerRelation,ownerEtcWrap,ownerEtc,'owner'\);\s*toggleEtc\(reportRelation,reportEtcWrap,reportEtc,'report'\);\s*\}/,
  'setMode must re-apply the gated etc state for both sides after syncDisabled'
);

// change listeners and initialisation pass the side argument.
assert.match(
  src,
  /ownerRelation\.addEventListener\('change',\(\)=>toggleEtc\(ownerRelation,ownerEtcWrap,ownerEtc,'owner'\)\);/,
  'owner relation change listener must pass the owner side'
);
assert.match(
  src,
  /reportRelation\.addEventListener\('change',\(\)=>toggleEtc\(reportRelation,reportEtcWrap,reportEtc,'report'\)\);/,
  'report relation change listener must pass the report side'
);
assert.match(
  src,
  /toggleEtc\(ownerRelation,ownerEtcWrap,ownerEtc,'owner'\);toggleEtc\(reportRelation,reportEtcWrap,reportEtc,'report'\);/,
  'initialisation must pass both sides'
);

// Inactive-mode disabling must stay DOM-level (disabled attribute), never only CSS.
assert.match(
  src,
  /document\.querySelectorAll\('\.owner-only input,\.owner-only textarea,\.owner-only select'\)\.forEach\(el=>el\.disabled=mode!=='owner'\);/,
  'owner-only controls must be disabled whenever mode is not owner'
);
assert.match(
  src,
  /document\.querySelectorAll\('\.report-only input,\.report-only textarea,\.report-only select'\)\.forEach\(el=>el\.disabled=mode!=='report'\);/,
  'report-only controls must be disabled whenever mode is not report'
);

console.log('LEAF_B826_25A_REPORT_INIT_CONTRACT_PASS');
