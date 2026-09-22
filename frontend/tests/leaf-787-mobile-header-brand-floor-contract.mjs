import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #787 DEFECT-1 [mobile header responsive hardening].
//
// Background: the mobile service header lays itself out with
//   grid-template-columns:minmax(0,1fr) auto
// where column 1 owns the brand and column 2 owns the account strip. Because the
// brand carried min-width:0 with no intrinsic floor, a wide account strip could
// shrink the brand track below the `단지온` wordmark's intrinsic width and let the
// chip overlap it. Forced worst-case measurement on the unfixed build collapsed
// the brand track to 32.58px against a 62.3px wordmark at 320px (gap -17.7px,
// overlap=true). This was NOT reachable from the default signed-in session
// (measured gap +161…+271px, overlap=false), so it is a latent fragility rather
// than a live production break.
//
// Separately, the mobile hide of .danjion-account-label was decided purely by
// declaration order inside the JS-injected account-menu style block: neither
// `.danjion-account-label{display:grid}` nor the `@media(max-width:760px)`
// `{display:none}` carried !important, so an equal-specificity tie was resolved
// by source order alone. Reordering that injected string would silently re-expose
// the label and re-widened the strip.
//
// This contract pins the hardening so a later CSS reshuffle cannot reintroduce
// the collapse. It is a source-level contract (string presence + ordering), which
// is what the toplevel frontend gate can run without a browser. The behavioural
// proof (measured geometry, chip retained, no overflow) is recorded in
// E:/danjion260914/verify787/DEFECT1_FIX_REPORT.md.

const read = (rel) => readFile(new URL('../' + rel, import.meta.url), 'utf8');

const css = await read('assets/consistency.css');
const session = await read('assets/danjion-session.js');

// --- 1. Locate the mobile header block that owns the brand track ------------
// consistency.css contains several @media (max-width:760px) blocks. Only one
// owns the shared service-header brand, so scan every occurrence and take the
// first whose body actually selects the header brand. We then slice to the next
// top-level @media so the assertions cannot be satisfied by a desktop rule.
const MOBILE_QUERY = '@media (max-width:760px){';
const mobileCandidates = [];
for (let at = css.indexOf(MOBILE_QUERY); at > -1; at = css.indexOf(MOBILE_QUERY, at + 1)) {
  mobileCandidates.push(at);
}
assert.ok(mobileCandidates.length > 0,
  'mobile breakpoint block must exist in consistency.css');

const mobileStart = mobileCandidates.find((at) =>
  css.slice(at, at + 1200).includes('html body header.site-header .brand'));
assert.ok(mobileStart !== undefined,
  'one mobile breakpoint block must own the shared service-header brand');

const afterMobile = css.indexOf('@media ', mobileStart + MOBILE_QUERY.length);
const mobileBlockRaw = css.slice(mobileStart, afterMobile === -1 ? undefined : afterMobile);

// Strip /* ... */ comments before parsing. Without this, a comment sitting above
// a rule is swallowed into the following selector by the [^{}]+ matcher, so the
// selector list no longer matches the element the rule actually targets.
const mobileBlock = mobileBlockRaw.replace(/\/\*[\s\S]*?\*\//g, '');

assert.ok(mobileBlock.includes('html body header.site-header .brand'),
  'mobile block must still style the shared service-header brand');
assert.ok(mobileBlock.includes('html body header.topbar .brand') ||
          mobileBlock.includes('html body header.site-header .brand .brand-word'),
  'mobile block must still cover the topbar brand variant');

// Parse the mobile block into { selector, body } pairs. A loose "selector then
// N chars then a declaration" window is NOT enough: it happily reaches across
// into a later rule and reports a declaration that the matched selector does not
// own at all. Every assertion below must read the body of the block whose
// selector actually targets the element.
const declarations = [];
{
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(mobileBlock)) !== null) {
    const selector = m[1].replace(/\s+/g, ' ').trim();
    const body = m[2];
    if (selector.startsWith('@media')) continue;
    declarations.push({ selector, body });
  }
}
// Combined selector text for "does any rule target X" questions, plus a helper
// that returns every body whose selector list contains a given selector token.
const owners = (token) =>
  declarations.filter((d) => d.selector.split(',').some((s) => s.trim() === token));
const ownerBody = (token) => owners(token).map((d) => d.body).join(';');

assert.ok(declarations.length > 0, 'mobile block must contain parseable declarations');

// --- 2. The brand must carry an intrinsic floor -----------------------------
// min-width:max-content pins the brand to its own width so the flexible
// minmax(0,1fr) track can never squeeze it below the wordmark.
const brandBodies = ownerBody('html body header.site-header .brand');
assert.ok(brandBodies.length > 0,
  'mobile block must own a declaration for the shared service-header brand');
assert.ok(brandBodies.includes('min-width:max-content!important'),
  'mobile brand must be pinned to its intrinsic width (min-width:max-content) so the flexible track cannot compress it');
assert.ok(brandBodies.includes('flex:0 0 auto!important'),
  'mobile brand must not be allowed to shrink (flex:0 0 auto)');
assert.ok(!brandBodies.includes('min-width:0!important'),
  'mobile brand must not fall back to min-width:0, which is the original collapse cause');

// --- 3. The account strip must be bounded -----------------------------------
const hostBodies = ownerBody('html body header.site-header .identity.danjion-account-host');
assert.ok(hostBodies.length > 0,
  'mobile block must own a declaration for the signed-in account strip');
assert.ok(hostBodies.includes('max-width:min(100%,52vw)!important'),
  'mobile account strip must be clamp-bounded so it cannot widen past its grid track');
assert.ok(hostBodies.includes('overflow:hidden!important'),
  'mobile account strip must clip rather than paint over the brand');
assert.ok(hostBodies.includes('min-width:0!important'),
  'mobile account strip must remain shrinkable inside the track it is given');
assert.ok(hostBodies.includes('display:flex!important'),
  'mobile account strip must stay a row so avatar + caret remain inline');

// the bare .identity rule (guest + signed-in host) must also be bounded
const identityBodies = ownerBody('html body header.site-header .identity');
assert.ok(identityBodies.length > 0,
  'mobile block must own a declaration for the shared identity track');
assert.ok(identityBodies.includes('max-width:min(100%,52vw)!important'),
  'mobile identity track must be bounded for both guest and signed-in variants');

// --- 4. The label hide must not depend on declaration order ------------------
const labelBodies = ownerBody('html body header.site-header .danjion-account-label');
assert.ok(labelBodies.length > 0,
  'mobile block must explicitly own the account-label hide');
assert.ok(labelBodies.includes('display:none!important'),
  'mobile account label must be hidden with !important so the outcome is order-independent, not a declaration-order tie-break');

// The injected account-menu stylesheet carries the original pair of label
// display rules without !important. consistency.css must therefore win by
// importance, because in the injected sheet the tie is settled by source order.
const sessionBase = session.match(/\.danjion-account-label\{display:grid[^}]*\}/);
const sessionHide = session.match(/\.danjion-account-label\{display:none\}/);
assert.ok(sessionBase,
  'session runtime must still define the base label layout');
assert.ok(sessionHide,
  'session runtime must still define its own mobile label hide');
assert.ok(!/!important/.test(sessionBase[0]) && !/!important/.test(sessionHide[0]),
  'the injected label rules are intentionally !important-free, so the consistency.css hide must carry the importance that breaks the tie');
assert.ok(session.indexOf(sessionBase[0]) < session.indexOf(sessionHide[0]),
  'the injected hide only wins by being later in the string; consistency.css must not rely on that ordering');

// --- 5. Trigger stays shrinkable inside the strip ---------------------------
const triggerBodies = ownerBody('html body header.site-header .danjion-account-trigger');
assert.ok(triggerBodies.length > 0,
  'mobile block must own a declaration for the account trigger');
assert.ok(triggerBodies.includes('flex:0 1 auto!important'),
  'mobile account trigger must stay shrinkable so a long name cannot force overflow');
assert.ok(triggerBodies.includes('min-width:0!important'),
  'mobile account trigger must be allowed to shrink below its content width');

// --- 6. Scope guard: hardening must not smuggle in unrelated behaviour -------
assert.ok(!css.includes('!important!important'),
  'hardening must not introduce doubled !important artifacts');

const accountHostRules = (mobileBlock.match(/danjion-account-host/g) || []).length;
assert.ok(accountHostRules > 0 && accountHostRules < 12,
  `mobile account-host rule count must stay bounded (saw ${accountHostRules})`);

console.log('PASS #787 mobile header brand floor + account strip clamp contract');
