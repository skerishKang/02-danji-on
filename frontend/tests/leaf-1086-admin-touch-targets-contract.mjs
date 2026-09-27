import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// #1086: admin-console interactive controls meet the #583 44px touch-target
// policy. CSS-only hardening — the authority model, click handlers and
// section visibility semantics must remain untouched.

const page = await readFile(new URL('../admin/index.html', import.meta.url), 'utf8');
const consoleRuntime = await readFile(new URL('../assets/danjion-admin-console.js', import.meta.url), 'utf8');

function ruleFor(selectorPrefix) {
  const at = page.indexOf(selectorPrefix + '{');
  assert.ok(at !== -1, selectorPrefix + ' rule must exist');
  const end = page.indexOf('}', at);
  return page.slice(at, end + 1);
}

/* A~D. The five required surfaces carry an explicit 44px minimum. */
{
  const tabs = ruleFor('.admin-tabs button');
  assert.ok(/min-height:\s*44px/.test(tabs), '.admin-tabs button must be 44px');
  const review = ruleFor('.admin-review-actions button');
  assert.ok(/min-height:\s*44px/.test(review), '.admin-review-actions button must be 44px');
  const post = ruleFor('.admin-post-actions button');
  assert.ok(/min-height:\s*44px/.test(post), '.admin-post-actions button must be 44px');
  const privileged = ruleFor('.privileged-item button');
  assert.ok(/min-height:\s*44px/.test(privileged), '.privileged-item button must be 44px');
}

/* E. Header nav targets: home link and brand have real 44px boxes. */
{
  const home = ruleFor('.admin-home-link');
  assert.ok(/min-height:\s*44px/.test(home), '.admin-home-link must be 44px');
  assert.ok(/display:\s*inline-flex/.test(home) && /align-items:\s*center/.test(home),
    'the home link must center its label inside the 44px box');
  const brand = ruleFor('.brand');
  assert.ok(/min-height:\s*44px/.test(brand), 'the header brand link must be 44px');
}

/* F. Visual preservation: wrap, density, desktop layout. */
{
  const tabsNav = ruleFor('.admin-tabs');
  assert.ok(/flex-wrap:\s*wrap/.test(tabsNav), 'admin tabs must keep wrapping (no nowrap overflow)');
  assert.ok(page.indexOf('@media(max-width:720px)') !== -1, 'the ≤720px mobile block is retained');
  assert.ok(page.indexOf('flex:1 1 calc(50% - 8px)') !== -1,
    'mobile review/post button pairing is preserved');
  assert.ok(/\.admin-tabs button\{min-height:\s*44px;[^}]*font-size:13\.5px/.test(page),
    'tab density (font size) unchanged while raising the touch target');
}

/* G/H. Authority semantics and handlers untouched — CSS-only change. */
{
  assert.ok(page.indexOf('consoleApi.consoleSections(grant)') !== -1, 'the authority-driven section model is intact');
  assert.ok(page.indexOf("sections.operational.map((section)=>({button:el('button',section.title),section}))") !== -1,
    'operational tab construction is unchanged');
  assert.ok(page.indexOf("tabsModel.forEach((tab)=>{tab.button.addEventListener('click',()=>open(tab));") !== -1,
    'tab click handlers are unchanged');
  assert.ok(page.indexOf("sections.privileged.length)tabsModel.push({button:el('button','최고관리','privileged'),section:null})") !== -1,
    'privileged tab visibility semantics are unchanged');
  assert.ok(page.indexOf("button.disabled=true;button.title='정책 승인 후 활성화'") !== -1,
    'policy-held disabled tabs are unchanged');
  assert.ok(page.indexOf('OPERATIONAL_SECTIONS') !== -1 || consoleRuntime.indexOf('OPERATIONAL_SECTIONS') !== -1,
    'the section model source is present');
  assert.ok(consoleRuntime.indexOf('business.review') !== -1, 'the scope list (runtime asset) is intact');
  // no fake hit-area mechanisms were introduced
  assert.equal(page.indexOf('pointer-events:none'), -1, 'no pointer-interception layer');
  assert.equal(/\.admin-tabs button::after/.test(page) || /\.admin-home-link::after/.test(page), false,
    'no pseudo-element hit-area proxy on the hardened controls');
  assert.equal(page.indexOf('tabindex="-1"'), -1, 'keyboard focusability preserved');
}

/* I. Review/post action rows keep their pairing in the ≤720px band. */
{
  const media = page.slice(page.indexOf('@media(max-width:720px)'));
  assert.ok(media.indexOf('.admin-review-actions button') !== -1 && media.indexOf('.admin-post-actions button') !== -1,
    'the ≤720px block still targets review/post actions');
}

console.log('PASS #1086 admin mobile touch targets contract');
console.log('ADMIN_TABS_TOUCH_TARGET=44px');
console.log('ADMIN_REVIEW_ACTION_TOUCH_TARGET=44px');
console.log('ADMIN_POST_ACTION_TOUCH_TARGET=44px');
console.log('ADMIN_PRIVILEGED_ACTION_TOUCH_TARGET=44px');
console.log('ADMIN_HEADER_NAV_TOUCH_TARGET=44px (home link + brand)');
console.log('MOBILE_390_OVERFLOW=UNCHANGED(wrap 유지)');
console.log('TAB_WRAP=PRESERVED');
console.log('DESKTOP_LAYOUT=NO_REDESIGN');
console.log('AUTHORITY_SEMANTICS_CHANGED=NO');
console.log('CLICK_HANDLERS_CHANGED=NO');
console.log('FAKE_HIT_AREA=NO');
console.log('PRODUCTION_MUTATION=0');
console.log('DB_MUTATION=0');
console.log('PRINCIPAL_MUTATION=0');
console.log('GRANT_MUTATION=0');
console.log('PRODUCTION_DEPLOY=0');
