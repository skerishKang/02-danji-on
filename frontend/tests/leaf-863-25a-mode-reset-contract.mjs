import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #863 [LOCAL1] TASK2: 25A 신청/제보 owner<->report tab switches kept the
// previous mode's accumulated file selections (fileGroups[*).entries, the
// hidden <input type=file> value, list rows, status text, add-button state).
// setMode must now reset every attachment group through the group's own sync()
// so entries/list/status/input/add-button all return to 0-N empty.

const src = await readFile(new URL('../25A_신청제보.html', import.meta.url), 'utf8');

// bindAccumulatingFiles must expose its sync() on the group so an external
// reset can rebuild list/status/input.files/add-disabled from entries.
assert.match(src, /group\.sync=sync;/,
  'bindAccumulatingFiles must expose sync() on the file group');

// The reset helper must clear entries, error, and the native file input, then
// re-sync the group UI.
assert.ok(src.includes(
  "function resetAttachmentGroups(){Object.values(fileGroups).forEach(g=>{g.entries=[];g.error.textContent='';g.input.value='';if(g.sync)g.sync()})}"
),
  'resetAttachmentGroups must clear entries/error/input and re-sync every group');

// setMode must invoke the reset on EVERY mode transition, before the
// syncDisabled/toggleEtc sequence pinned by leaf-b826.
assert.match(src, /function setMode\(m\)\{[\s\S]*?resetAttachmentGroups\(\);\s*syncDisabled\(isReport\?'report':'owner'\);/,
  'setMode must reset attachment groups before re-asserting disabled/etc state');

// The initial ?mode= mount also goes through setMode, so deep links start clean.
assert.match(src, /const initial=new URLSearchParams\(location\.search\)\.get\('mode'\)==='report'\?'report':'owner';\s*setMode\(initial\);/,
  'initial mode mount must flow through setMode (and therefore the reset)');

console.log('PASS #863 25A setMode resets attachment groups on every mode transition');
