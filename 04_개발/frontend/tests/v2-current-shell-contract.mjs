import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [topbar, shellCss, visualEntry] = await Promise.all([
  readFile(new URL('src/v2/visual/V2Topbar.tsx', root), 'utf8'),
  readFile(new URL('src/v2/visual/v2-008-shell.css', root), 'utf8'),
  readFile(new URL('src/v2/v2-visual.css', root), 'utf8')
]);

const navBlock = topbar.match(/const NAV:[\s\S]*?= \[([\s\S]*?)\n\];/);
assert.ok(navBlock, 'V2Topbar must expose an explicit primary NAV list');
const primaryKeys = [...navBlock[1].matchAll(/key: '([^']+)'/g)].map((match) => match[1]);
assert.deepEqual(primaryKeys, ['home', 'shops', 'community', 'me'],
  '008 shell primary navigation must be exactly home/shops/community/me');
assert.doesNotMatch(navBlock[1], /key: 'benefits'/,
  'benefits must remain outside the primary shell navigation');

assert.match(topbar, /<span className="v2-wordmark">단지온<\/span>/,
  '008 shell must use the Korean DanjiOn wordmark');
assert.match(topbar, /<span className="v2-byline">DANJION by PADIEM<\/span>/,
  '008 shell must preserve the PADIEM byline');
assert.match(topbar, /<nav className="v2-desktop-nav"[\s\S]*?\{NAV\.map/,
  'desktop navigation must expose the same current primary destinations');
assert.match(topbar, /<div className="v2-header-tools">/,
  'auth/session integrations must retain the canonical header tools host');

assert.match(shellCss, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/,
  'mobile bottom navigation must use four equal columns');
assert.match(shellCss, /height:calc\(68px \+ env\(safe-area-inset-bottom\)\)/,
  'mobile shell must preserve 68px geometry plus bottom safe area');
assert.match(shellCss, /grid-template-rows:22px 14px/,
  'mobile navigation must preserve 22px icon and 14px label rows');
assert.match(shellCss, /button\.is-active\{color:#ee6045\}/,
  'active mobile destination must use the current coral emphasis');
assert.match(shellCss, /button\.is-active::before\{display:none\}/,
  'legacy top indicator must not reappear over the current bottom-nav contract');

const shellImport = "@import './visual/v2-008-shell.css';";
const homeImport = "@import './visual/v2-008-home.css';";
const shellIndex = visualEntry.indexOf(shellImport);
const homeIndex = visualEntry.indexOf(homeImport);
assert.ok(shellIndex >= 0, '008 shell override must remain loaded after historical responsive rules');
assert.ok(homeIndex < 0 || homeIndex > shellIndex,
  'narrow page-level parity overrides may load after the shell, but must never precede or displace it');

console.log('PASS V2 20260904 current common-shell navigation contract');
