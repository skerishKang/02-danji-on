import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const files = {
  home: '04_데일리홈.html',
  shops: '01_이웃가게_발견.html',
  complex: '05_우리단지_첫화면.html',
  my: '19_내정보_메인.html'
};
const pages = {};
for (const [key,file] of Object.entries(files)) {
  pages[key] = await readFile(new URL('../'+file, import.meta.url), 'utf8');
}
const css = await readFile(new URL('../assets/danjion-service-header.css', import.meta.url), 'utf8');
const session = await readFile(new URL('../assets/danjion-session.js', import.meta.url), 'utf8');

const labels=['홈','인트로','이웃가게','우리단지','내정보'];
const expectedActive={home:'홈',shops:'이웃가게',complex:'우리단지',my:'내정보'};

for (const [key,html] of Object.entries(pages)) {
  assert.ok(html.includes('class="site-header topbar danjion-service-header"'),
    `${key}: canonical service header class must be present`);
  assert.ok(html.includes('class="header-inner topbar-inner"'),
    `${key}: canonical inner geometry class must be present`);
  assert.ok(html.includes('class="desktop-nav nav"'),
    `${key}: canonical nav classes must be present`);
  assert.ok(html.includes('data-account-host'),
    `${key}: canonical account host must be present`);
  assert.ok(html.includes('data-route="04_데일리홈.html"'),
    `${key}: brand/home route must stay canonical`);
  assert.ok(html.includes('assets/danjion-service-header.css'),
    `${key}: shared service header stylesheet must be loaded`);
  assert.ok(html.includes('assets/danjion-session.js'),
    `${key}: shared account/session runtime must be explicitly loaded`);

  const nav=(html.match(/<nav aria-label="주요 메뉴" class="desktop-nav nav">([\s\S]*?)<\/nav>/)||[])[1]||'';
  let last=-1;
  for (const label of labels) {
    const i=nav.indexOf(`>${label}</button>`);
    assert.ok(i>-1, `${key}: nav must contain ${label}`);
    assert.ok(i>last, `${key}: nav order must be canonical`);
    last=i;
  }
  assert.ok(nav.includes(`aria-current="page" class="active" data-route="${
    expectedActive[key]==='홈'?'04_데일리홈.html':
    expectedActive[key]==='인트로'?'index.html?intro=1':
    expectedActive[key]==='이웃가게'?'01_이웃가게_발견.html':
    expectedActive[key]==='우리단지'?'05_우리단지_첫화면.html':
    '19_내정보_메인.html'
  }" type="button">${expectedActive[key]}</button>`),
    `${key}: only its own primary page must own the active nav marker`);
}

assert.ok(css.includes('grid-template-columns:auto minmax(0,1fr) auto!important'),
  'desktop header must share one three-column geometry');
assert.ok(css.includes('width:min(1440px,calc(100% - 80px))!important'),
  'desktop header must share one canonical inner width');
assert.ok(css.includes('body .danjion-service-header .identity.danjion-account-host'),
  'shared CSS must override page-specific identity display rules with sufficient specificity');
assert.ok(css.includes('flex-direction:row!important') && css.includes('flex-wrap:nowrap!important'),
  'admin quick entry and account identity must remain on one row');
assert.ok(css.includes('@media (any-hover:hover) and (any-pointer:fine)'),
  'desktop hover styling must activate when any available mouse-like pointer can hover');
assert.ok(!css.includes('@media (hover:hover) and (pointer:fine)'),
  'desktop hover styling must not depend only on the primary pointer capability');
assert.ok(css.includes('.desktop-nav button:hover::after,.danjion-service-header .desktop-nav a:hover::after'),
  'shared header must expose the same hover affordance for button and anchor nav items');
assert.ok(css.includes('.desktop-nav button:focus-visible::after,.danjion-service-header .desktop-nav a:focus-visible::after'),
  'shared header must expose keyboard focus affordance for button and anchor nav items');
assert.ok(css.includes('.desktop-nav button.active::after,.danjion-service-header .desktop-nav a.active::after') &&
  css.includes('transform:scaleX(1)!important'),
  'active section underline must remain persistent while hover/focus are transient');
assert.ok(!session.includes("authority.label + ' · ' + loginMethodLabel"),
  'always-visible account trigger must not expose authority/login-method metadata');
assert.ok(session.includes("authorityNode.textContent = authority.label ? '권한 · ' + authority.label"),
  'authority detail must remain available in the account dropdown');
assert.ok(session.includes("소셜 로그인 계정"),
  'social login-method detail must remain available in the account dropdown');
assert.ok(session.includes("label.append(labelMain)"),
  'persistent account trigger must render the display name only');

assert.ok(css.includes('@media (min-width:761px) and (max-width:986px)'),
  'measured mid-width collision range must have a dedicated service-header rule');
assert.ok(css.includes('.desktop-nav [data-route="index.html?intro=1"]') &&
          css.includes('display:none!important'),
  'mid-width header may hide only the duplicate Intro nav item while the wordmark keeps Intro reachable');
assert.ok(css.includes('justify-content:space-evenly!important') &&
          css.includes('font-size:13px!important'),
  'mid-width primary nav must compress instead of overflowing into the brand');
assert.match(css, /@media \(min-width:761px\) and \(max-width:986px\)[\s\S]*\.danjion-account-label\{[\s\S]*display:none!important/,
  'mid-width authenticated account label must collapse to the compact trigger');
for (const [key,html] of Object.entries(pages)) {
  assert.ok(html.includes('data-route="index.html?intro=1"'),
    `${key}: hiding duplicate Intro nav must not remove the wordmark/Intro route from source`);
}

console.log('PASS #520/#633 canonical service header + collision-safe mid-width geometry');
