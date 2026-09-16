import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [css, consistency, shops, home, complex, myinfo, warmth] = await Promise.all([
  readFile(new URL('assets/danjion-interaction-polish.css', root), 'utf8'),
  readFile(new URL('assets/consistency.css', root), 'utf8'),
  readFile(new URL('01_이웃가게_발견.html', root), 'utf8'),
  readFile(new URL('04_데일리홈.html', root), 'utf8'),
  readFile(new URL('05_우리단지_첫화면.html', root), 'utf8'),
  readFile(new URL('19_내정보_메인.html', root), 'utf8'),
  readFile(new URL('23_이웃온기.html', root), 'utf8')
]);

for (const [name, html] of [
  ['shops', shops],
  ['myinfo', myinfo],
  ['warmth', warmth]
]) {
  assert.match(
    html,
    /assets\/danjion-interaction-polish\.css/,
    `#583: ${name} canonical page must load the shared non-header interaction policy directly`
  );
}
for (const [name, html] of [['home', home], ['complex', complex]]) {
  assert.match(
    html,
    /assets\/consistency\.css/,
    `#583: ${name} must retain its existing consistency stylesheet authority`
  );
}
assert.match(
  consistency,
  /^@import url\("\.\/danjion-interaction-polish\.css"\);/m,
  '#583: consistency-owned pages must receive interaction polish without changing their visible DOM'
);

assert.match(css, /:focus-visible\{/,
  '#583: keyboard focus feedback must be explicit');
assert.match(css, /@media \(any-hover:hover\) and \(any-pointer:fine\)/,
  '#583/#598: hover feedback must work when any available mouse-like pointer can hover');
assert.doesNotMatch(css, /@media \(hover:hover\) and \(pointer:fine\)/,
  '#598: canonical hover feedback must not regress to primary-pointer-only detection');
assert.match(css, /\.scene-tab:not\(\.active\):hover/,
  '#583: Home hover feedback must preserve active state');
assert.match(css, /\.filter:not\(\.active\):hover/,
  '#583: Shops hover feedback must preserve active state');
assert.match(css, /\.level-button:not\(\.active\):hover/,
  '#583: Warmth hover feedback must preserve active state');
assert.match(css, /min-height:44px!important/,
  '#583: mobile/coarse-pointer policy must encode a 44px minimum hit dimension');
assert.match(css, /bottom:calc\(88px \+ env\(safe-area-inset-bottom,0px\)\)!important/,
  '#583: Warmth toast must clear the 68px bottom navigation with an explicit gap');
assert.match(css, /\.danjion-account-trigger/,
  '#583: signed-in member chip must receive interaction feedback');
assert.match(css, /\.danjion-service-header \.brand/,
  '#583: canonical brand control must receive interaction feedback');

assert.match(
  shops,
  /class="b-shop-card \$\{cls\}"[^>]*tabindex="0"[^>]*aria-label="\$\{esc\(s\.name\)\} 상세 보기"/,
  '#583: visual shop cards must be keyboard focusable'
);
assert.match(
  shops,
  /class="b-text-shop"[^>]*tabindex="0"[^>]*aria-label="\$\{esc\(s\.name\)\} 상세 보기"/,
  '#583: text shop rows must be keyboard focusable'
);
assert.match(
  shops,
  /grid\.addEventListener\('keydown',[\s\S]*e\.key==='Enter'\|\|e\.key===' '/,
  '#583: focused shop rows/cards must open with Enter or Space'
);
assert.match(
  myinfo,
  /id="b583-level-card-keyboard"[\s\S]*event\.key==='Enter'\|\|event\.key===' '/,
  '#583: My Info warmth card must support keyboard activation'
);

console.log('PASS #583 canonical interaction feedback, keyboard activation, touch targets, and toast clearance are contract-locked');
