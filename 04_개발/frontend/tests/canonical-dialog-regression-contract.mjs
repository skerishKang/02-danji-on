import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../frontend/', import.meta.url);
const focus = await readFile(new URL('assets/dialog-focus.js', root), 'utf8');
const shops = await readFile(new URL('01_이웃가게_발견.html', root), 'utf8');
const coupon = await readFile(new URL('03_주민혜택_쿠폰.html', root), 'utf8');

assert.match(focus, /const stack = \[\]/);
assert.match(focus, /function restoreFocus\(item\)/);
assert.match(focus, /parent\.dialog\.contains\(item\.trigger\)/);
assert.match(shops, /layer\.inert=false;layer\.classList\.add\('open'\)/);
assert.match(shops, /DanjionDialogFocus\.sync\(\)/);
assert.doesNotMatch(shops, /gallery\.innerHTML=.*s\.image/s);
assert.match(shops, /const image=document\.createElement\('img'\);image\.src=s\.image/);
assert.match(coupon, /class="sheet-backdrop" inert/);
assert.match(coupon, /backdrop\.inert=false/);
assert.match(coupon, /backdrop\.inert=true/);

process.stdout.write('CANONICAL_DIALOG_REGRESSION=PASS\n');
