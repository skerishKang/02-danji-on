import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Issue #863 [25A 신청제보]: switching owner<->report used to carry the other side's
// upload state across the switch — a stale file selection, a leftover error message
// or a wrong count could survive the mode change (and a stale error could block the
// next submit). setMode must now reset the upload state. This is state hygiene only:
// the submission authority (submitOwner/submitReport gating, the canonical production
// lane, server success handling) must stay byte-for-byte unchanged.
//
// The behavioural 25A mount proof lives in leaf-b826 ; this contract pins the reset.

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', '25A_신청제보.html'), 'utf8');

// 1) the four accumulating file groups stay wired to their canonical input ids.
for (const id of ['photos', 'ownerProof', 'ownerOtherDocs', 'extraDocs']) {
  assert.match(
    src,
    new RegExp(`bindAccumulatingFiles\\(document\\.querySelector\\('#${id}'\\)`),
    `${id} group must stay bound to its canonical input`
  );
}

// 2) setMode resets the upload state, then re-asserts disabled/toggle state.
assert.match(src, /function resetUploadState\(\)\{/, 'the reset helper must exist');
assert.match(
  src,
  /resetUploadState\(\);\s*syncDisabled\(isReport\?'report':'owner'\);/,
  'setMode must reset upload state before syncDisabled re-asserts control state'
);

// 3) the reset covers every piece of state named by the issue.
assert.match(src, /Object\.keys\(fileGroups\)\.forEach/, 'the reset must sweep every file group');
assert.match(src, /group\.entries\.length=0;/, 'file entries must be cleared');
assert.match(src, /group\.input\.value='';/, 'the native file input value must be cleared');
assert.match(src, /group\.list\.replaceChildren\(\);/, 'the rendered file list must be cleared');
assert.match(src, /group\.error\.textContent='';/, 'the upload error text must be cleared');
assert.match(src, /group\.add\.disabled=false;/, 'the add button must be re-enabled');
assert.match(src, /group\.status\.textContent='0 \/ '\+group\.max\+group\.unit;/, 'the count/status label must reset to 0 / N');
assert.match(src, /resetOwnerSubmissionKey\(\)/, 'the owner submission idempotency key must be dropped');

// 4) the submission authority is intentionally untouched.
assert.match(
  src,
  /async function submitReport\(\)\{[\s\S]*?if\(!danjionApiBase\(\)&&!DanjionSession\.isCanonicalProduction\(\)\)\{/,
  'report demo-lane gating must stay unchanged'
);
assert.match(src, /if\(__ownerSubmitting\) return;/, 'owner duplicate-submit guard must stay unchanged');
assert.match(src, /if\(__reportSubmitting\) return;/, 'report duplicate-submit guard must stay unchanged');
assert.match(src, /bridge\.createOwnerApplication\(/, 'owner submission must still go through the canonical bridge');
assert.match(src, /bridge\.createRecommendation\(/, 'report submission must still go through the canonical bridge');

console.log('leaf-b863-25a-report-mode-reset-contract: PASS');
