import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Issue #1032 — canonical Intro routing on frontend/04_데일리홈.html.
//
// The direct router used to read an undeclared identifier `B`:
//
//     if(p==='index.html') return B?'index2.html':'index.html';
//
// `B` is never declared on this page, so evaluating the canonical Intro
// navigation path threw `ReferenceError: B is not defined` and the
// `data-route="index.html?intro=1"` Intro control became dead.
//
// This contract is deliberately NOT a `node --check` syntax gate. It extracts
// the real `routeFrom()` source out of the shipped page and *executes* it, so a
// syntactically-valid but undeclared identifier cannot pass unnoticed.

const FRONTEND = path.join(import.meta.dirname, '..');
const PAGE = path.join(FRONTEND, '04_데일리홈.html');
const source = readFileSync(PAGE, 'utf8');

// --- source-level guards -------------------------------------------------

const ROUTER_SCRIPT_ID = 'danjion-direct-router-v5';
const scriptStart = source.indexOf(`<script id="${ROUTER_SCRIPT_ID}">`);
assert.notEqual(scriptStart, -1, 'canonical direct-router script must exist');
const scriptEnd = source.indexOf('</script>', scriptStart);
assert.notEqual(scriptEnd, -1, 'direct-router script must be terminated');
const router = source.slice(scriptStart, scriptEnd);

assert.doesNotMatch(
  router,
  /\bindex2\.html\b/,
  'index2.html authority must not be reintroduced in the Daily Home direct router'
);
assert.doesNotMatch(
  router,
  /\breturn\s+B\s*\?/,
  'the undeclared variant selector B must not be restored'
);

assert.match(
  source,
  /data-route="index\.html\?intro=1"/,
  'Daily Home must keep the canonical Intro control wired to index.html?intro=1'
);
assert.doesNotMatch(
  source,
  /\bindex2\.html\b/,
  'no index2.html authority anywhere in the Daily Home page'
);

// --- deterministic execution of the real router -------------------------

const fnStart = router.indexOf('function routeFrom(');
assert.notEqual(fnStart, -1, 'routeFrom() must exist in the direct router');

// brace-match so nested query parsing cannot truncate the extraction
let depth = 0;
let fnEnd = -1;
for (let i = router.indexOf('{', fnStart); i < router.length; i += 1) {
  if (router[i] === '{') depth += 1;
  else if (router[i] === '}') {
    depth -= 1;
    if (depth === 0) {
      fnEnd = i + 1;
      break;
    }
  }
}
assert.notEqual(fnEnd, -1, 'routeFrom() body must be brace-balanced');
const fnSource = router.slice(fnStart, fnEnd);

function loadRouteFrom(code) {
  // eslint-disable-next-line no-new-func
  return new Function(`${code}\n;return routeFrom;`)();
}

const routeFrom = loadRouteFrom(fnSource);

// canonical Intro navigation path executes without ReferenceError
let introRoute;
assert.doesNotThrow(
  () => {
    introRoute = routeFrom('index.html?intro=1');
  },
  'canonical Intro navigation must not throw (undeclared identifier regression)'
);
assert.equal(
  introRoute,
  'index.html?intro=1',
  'canonical Intro route must resolve to index.html?intro=1'
);

// hash-fragment forms used by in-page anchors stay canonical
assert.equal(
  routeFrom('index.html?intro=1#top'),
  'index.html?intro=1',
  'Intro route must survive anchor fragments'
);

// plain root landing keeps its own (non-intro) semantics
assert.equal(
  routeFrom('index.html'),
  'index.html',
  'plain index.html must not be silently rewritten into the Intro route'
);

// unrelated routing behaviour is untouched
assert.equal(routeFrom('01_이웃가게_발견.html'), '01_이웃가게_발견.html');
assert.equal(
  routeFrom('01_이웃가게_발견.html?shop=abc'),
  '01_이웃가게_발견.html?shop=abc',
  'query strings of other routes must still be preserved'
);
assert.equal(routeFrom('04_데일리홈.html'), '04_데일리홈.html');
assert.equal(routeFrom('19_내정보_메인.html'), '19_내정보_메인.html');
assert.equal(routeFrom('nope.html'), null, 'unknown routes must still return null');

// --- mutation proof ------------------------------------------------------
// Re-insert the exact historical defect into the extracted router source and
// prove the same harness detects it. This guards against the contract silently
// becoming a tautology.

const FIXED_BRANCH = "if(p==='index.html') return 'index.html'+q;";
assert.ok(
  fnSource.includes(FIXED_BRANCH),
  'router must use the canonical query-preserving index fallback'
);

const MUTATION = "if(p==='index.html') return B?'index2.html':'index.html';";
const mutatedSource = fnSource.replace(FIXED_BRANCH, MUTATION);
assert.notEqual(
  mutatedSource,
  fnSource,
  'mutation guard: the historical defect must actually be re-injected'
);
assert.ok(mutatedSource.includes(MUTATION), 'mutation must be present in the mutated router');

let mutatedThrew = null;
try {
  loadRouteFrom(mutatedSource)('index.html?intro=1');
} catch (error) {
  mutatedThrew = error;
}
assert.ok(mutatedThrew, 'the historical defect must still fail this harness');
assert.equal(
  mutatedThrew.name,
  'ReferenceError',
  'the regression class is an undeclared-identifier ReferenceError'
);
assert.match(
  String(mutatedThrew.message),
  /\bB\b/,
  'the ReferenceError must name the undeclared identifier B'
);

console.log('PASS #1032 canonical Daily Home Intro routing contract');
console.log('HOME_INTRO_NAV_REFERENCE_ERROR=NO');
console.log('HOME_INTRO_ROUTE=index.html?intro=1');
console.log('UNDECLARED_ROUTER_IDENTIFIER=NO');
console.log('CANONICAL_ROUTE_AUTHORITY_PRESERVED=YES');
console.log('INDEX2_AUTHORITY_PRESENT=NO');
console.log('UNRELATED_ROUTES_PRESERVED=PASS');
console.log('MUTATION_PROOF=PASS');
