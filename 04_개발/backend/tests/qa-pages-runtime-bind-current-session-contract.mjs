import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { bindQaPagesRuntime, validateQaApi } from '../scripts/qa-pages-runtime-bind.mjs';

// Issue #830 [QA Pages runtime binder repair]: the QA Pages runtime binder still targeted the
// pre-#830 anchors (`PRODUCTION_API_BASE` / `CANONICAL_PAGES_API_BASE`) and a generic branch line
// that now appears in BOTH resolver functions. Against the current same-origin DanjionSession
// runtime the old binder fails closed with ANCHOR_MISSING:constants, so the QA Pages artifact
// could never be produced.
//
// This contract runs the REAL binder against the REAL current runtime, executes the produced
// artifact in a bounded vm, and proves the resolver contract on the QA host plus full canonical
// Production preservation. It also proves the stale/ambiguous anchor guards fail closed.
//
// Run: node 04_개발/backend/tests/qa-pages-runtime-bind-current-session-contract.mjs

const RUNTIME_URL = new URL('../../../frontend/assets/danjion-session.js', import.meta.url);
const runtime = await readFile(RUNTIME_URL, 'utf8');

const QA_API_ORIGIN = 'https://padiem-danjion-api-qa.padiem.workers.dev';
const QA_PAGES_HOST = 'danjion-qa.pages.dev';
const QA_PAGES_API_BASE = 'https://danjion-qa.pages.dev';
const PRODUCTION_PRIMARY_HOST = 'danjion.padiem.net';
const PRODUCTION_PAGES_HOST = 'danjion.pages.dev';
const PRODUCTION_WORKER = 'padiem-danjion-api-production.padiem.workers.dev';
const CRAFTED = 'https://evil.example/collect';

const count = (haystack, needle) => {
  let total = 0;
  let at = 0;
  while ((at = haystack.indexOf(needle, at)) >= 0) {
    total += 1;
    at += needle.length;
  }
  return total;
};

// Execute a runtime artifact in a bounded context. No secrets, no network, no DOM.
const load = (source, location) => {
  const ctx = { location, URLSearchParams, console };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  assert.ok(ctx.DanjionSession, 'runtime artifact must expose DanjionSession');
  return ctx.DanjionSession;
};

const craftedSearch = `?apiBase=${encodeURIComponent(CRAFTED)}`;
const GENERIC_PRODUCTION_PAGES_BRANCH = "    if (hostname === PRODUCTION_PAGES_HOSTNAME) return '';";

/* ============ 1. pre-fix proof: the OLD binder cannot transform the current runtime ============ */
{
  // The exact anchors the previous binder required.
  const OLD_CONSTANTS_ANCHOR =
    "  const PRODUCTION_API_BASE = 'https://padiem-danjion-api-production.padiem.workers.dev';";
  const OLD_API_ANCHOR =
    '    if (hostname === PRODUCTION_PAGES_HOSTNAME) return CANONICAL_PAGES_API_BASE;';

  assert.equal(count(runtime, OLD_CONSTANTS_ANCHOR), 0,
    'the pre-#830 constants anchor must be absent from the current runtime (old binder => ANCHOR_MISSING:constants)');
  assert.equal(count(runtime, 'CANONICAL_PAGES_API_BASE'), 0,
    'the pre-#830 CANONICAL_PAGES_API_BASE identifier must be absent from the current runtime');
  assert.equal(count(runtime, OLD_API_ANCHOR), 0,
    'the pre-#830 api-base anchor must be absent from the current runtime (old binder => ANCHOR_MISSING:api-base)');

  // The generic production-pages branch now lives in BOTH resolver functions, so a
  // whole-source replaceOnce() would be ambiguous rather than merely missing.
  assert.equal(count(runtime, GENERIC_PRODUCTION_PAGES_BRANCH), 2,
    'the generic production-pages branch must appear in both danjionApiBase and danjionAuthBase '
    + '(old binder => ANCHOR_AMBIGUOUS:auth-base)');

  const first = runtime.indexOf(GENERIC_PRODUCTION_PAGES_BRANCH);
  const beforeFirst = runtime.slice(0, first);
  const firstFn = [...beforeFirst.matchAll(/\n  (?:async )?function ([A-Za-z_$][\w$]*)\s*\(/g)].pop();
  assert.equal(firstFn?.[1], 'danjionApiBase',
    'the first generic branch must belong to danjionApiBase, confirming cross-function ambiguity');

  console.log('OLD_BINDER_CURRENT_RUNTIME=FAIL');
  console.log('OLD_BINDER_FAILURE_REASON=ANCHOR_MISSING:constants (then ANCHOR_AMBIGUOUS:auth-base)');
}

/* ============ 2. the NEW binder produces a QA artifact from the real current runtime ============ */
const bound = bindQaPagesRuntime(runtime, QA_API_ORIGIN);
{
  assert.notEqual(bound, runtime, 'the binder must return a transformed copy');
  assert.ok(bound.includes(`const QA_PAGES_HOSTNAME = '${QA_PAGES_HOST}';`),
    'the QA artifact must declare the QA Pages hostname');
  assert.ok(bound.includes(`const QA_PAGES_API_BASE = '${QA_PAGES_API_BASE}';`),
    'the QA artifact must declare the QA Pages API base');
  assert.ok(bound.includes('if (hostname === QA_PAGES_HOSTNAME) return QA_PAGES_API_BASE;'),
    'the QA artifact must bind the application API base on the QA host');
  assert.ok(bound.includes("if (hostname === QA_PAGES_HOSTNAME) return '';"),
    'the QA artifact must bind the Better Auth base to a same-origin relative URL');
  console.log('NEW_BINDER_CURRENT_RUNTIME=PASS');
}

/* ============ 3. QA host resolver semantics (executed artifact) ============ */
{
  const plain = load(bound, { hostname: QA_PAGES_HOST, search: '' });
  assert.equal(plain.danjionApiBase(), QA_PAGES_API_BASE,
    'QA host application API base must be the same-origin QA Pages base');
  assert.equal(plain.danjionAuthBase(), '',
    'QA host Better Auth base must be same-origin relative');
  console.log('QA_API_BASE_BINDING=PASS');
  console.log('QA_AUTH_SAME_ORIGIN=PASS');

  const crafted = load(bound, { hostname: QA_PAGES_HOST, search: craftedSearch });
  assert.equal(crafted.danjionApiBase(), QA_PAGES_API_BASE,
    'a crafted ?apiBase= must not move QA application API traffic off the QA Pages facade');
  assert.equal(crafted.danjionAuthBase(), '',
    'a crafted ?apiBase= must not move QA Better Auth traffic off the QA Pages facade');
  console.log('QA_CRAFTED_API_BASE_OVERRIDE_BLOCKED=PASS');

  // QA is a separate same-origin facade, not canonical Production; server mode on QA is driven by
  // the truthy QA API base, not by isCanonicalProduction().
  assert.equal(plain.isCanonicalProduction(), false,
    'the QA Pages host must not be reported as canonical Production');
}

/* ============ 4. canonical Production semantics preserved ============ */
{
  const cases = [
    [PRODUCTION_PRIMARY_HOST, 'PRODUCTION_PRIMARY'],
    [PRODUCTION_PAGES_HOST, 'PRODUCTION_PAGES'],
  ];
  for (const [hostname, label] of cases) {
    const plain = load(bound, { hostname, search: '' });
    assert.equal(plain.danjionApiBase(), '', `${label} application API base must stay same-origin`);
    assert.equal(plain.danjionAuthBase(), '', `${label} Better Auth base must stay same-origin`);
    assert.equal(plain.isCanonicalProduction(), true, `${label} must stay canonical Production`);
    console.log(`${label}_PRESERVED=PASS`);

    const crafted = load(bound, { hostname, search: craftedSearch });
    assert.equal(crafted.danjionApiBase(), '',
      `${label} must refuse a crafted ?apiBase= override`);
    assert.equal(crafted.danjionAuthBase(), '',
      `${label} must refuse a crafted ?apiBase= for Better Auth`);
    console.log(`${label}_CRAFTED_OVERRIDE_BLOCKED=PASS`);
  }
}

/* ============ 5. non-canonical controlled-preview semantics preserved ============ */
{
  const preview = load(bound, {
    hostname: 'danjion-review.pages.dev',
    search: `?apiBase=${encodeURIComponent('https://preview.test/api//')}`,
  });
  assert.equal(preview.danjionApiBase(), 'https://preview.test/api',
    'non-canonical controlled-preview ?apiBase= must keep its #419 meaning (trailing slashes trimmed)');
  assert.equal(preview.danjionAuthBase(), 'https://preview.test/api',
    'non-canonical controlled-preview ?apiBase= must keep its meaning for Better Auth');

  const demo = load(bound, { hostname: 'danjion-review.pages.dev', search: '' });
  assert.equal(demo.danjionApiBase(), '',
    'non-canonical origins must stay fail-closed without an explicit override');
  assert.equal(demo.danjionAuthBase(), '',
    'non-canonical origins must stay fail-closed without an explicit override');
}

/* ============ 6. no direct Production Worker binding in the browser artifact ============ */
{
  assert.ok(!bound.includes(PRODUCTION_WORKER),
    'the QA browser artifact must never embed the fixed Production Worker URL');
  assert.ok(!runtime.includes(PRODUCTION_WORKER),
    'the canonical browser runtime must never embed the fixed Production Worker URL');
  console.log('DIRECT_PRODUCTION_WORKER_BROWSER_BINDING=ABSENT');
}

/* ============ 7. stale and ambiguous anchors fail closed ============ */
{
  const staleSource = runtime.replace(
    "  const PRODUCTION_PAGES_HOSTNAME = 'danjion.pages.dev';",
    "  const PRODUCTION_PAGES_HOSTNAME = 'danjion.pages.dev.renamed';"
  );
  assert.notEqual(staleSource, runtime, 'stale fixture must actually change the source');
  assert.throws(() => bindQaPagesRuntime(staleSource, QA_API_ORIGIN), /ANCHOR_MISSING:constants/,
    'a runtime without the current constants anchor must fail closed');
  console.log('STALE_ANCHOR=FAIL_CLOSED');

  // Duplicate the branch INSIDE danjionApiBase only: the function region must detect ambiguity.
  const ambiguousBranch = runtime.replace(
    GENERIC_PRODUCTION_PAGES_BRANCH,
    `${GENERIC_PRODUCTION_PAGES_BRANCH}\n${GENERIC_PRODUCTION_PAGES_BRANCH}`
  );
  assert.notEqual(ambiguousBranch, runtime, 'ambiguous fixture must actually change the source');
  assert.throws(() => bindQaPagesRuntime(ambiguousBranch, QA_API_ORIGIN), /ANCHOR_AMBIGUOUS:api-base/,
    'two matching branches inside one resolver function must fail closed');

  // Duplicate the resolver declaration itself: the function region must detect ambiguity.
  const ambiguousFunction = runtime.replace(
    'function danjionApiBase(loc) {',
    'function danjionApiBase(loc) {\n  }\n  function danjionApiBase(loc) {'
  );
  assert.notEqual(ambiguousFunction, runtime, 'ambiguous function fixture must actually change the source');
  assert.throws(() => bindQaPagesRuntime(ambiguousFunction, QA_API_ORIGIN), /ANCHOR_AMBIGUOUS:api-function/,
    'two resolver declarations must fail closed');
  console.log('AMBIGUOUS_ANCHOR=FAIL_CLOSED');
}

/* ============ 8. QA API validation boundary is preserved ============ */
{
  assert.equal(validateQaApi(QA_API_ORIGIN), QA_API_ORIGIN, 'the dedicated QA Worker origin must be accepted');
  assert.throws(() => validateQaApi('http://padiem-danjion-api-qa.padiem.workers.dev'), /QA_API_MUST_USE_HTTPS/,
    'plaintext QA API origins must be rejected');
  assert.throws(() => validateQaApi(`https://${PRODUCTION_WORKER}`), /PRODUCTION_API_FORBIDDEN/,
    'the Production Worker host must be rejected');
  assert.throws(() => validateQaApi('https://other.workers.dev'), /QA_WORKER_HOST_REQUIRED/,
    'a non-QA workers.dev host must be rejected');
  assert.throws(() => validateQaApi('https://padiem-danjion-api-qa.padiem.workers.dev/extra'), /QA_API_ORIGIN_ONLY/,
    'a QA API origin with a path must be rejected');
  assert.throws(() => validateQaApi('https://padiem-danjion-api-qa.padiem.workers.dev?x=1'), /QA_API_ORIGIN_ONLY/,
    'a QA API origin with a query must be rejected');
  assert.throws(() => validateQaApi('https://padiem-danjion-api-qa.padiem.workers.dev#frag'), /QA_API_ORIGIN_ONLY/,
    'a QA API origin with a hash must be rejected');

  // The binder itself must refuse an out-of-boundary origin.
  assert.throws(() => bindQaPagesRuntime(runtime, 'https://evil.example'), /QA_WORKER_HOST_REQUIRED/,
    'the binder must fail closed on a non-QA origin');
  assert.throws(() => bindQaPagesRuntime(runtime, `https://${PRODUCTION_WORKER}`), /PRODUCTION_API_FORBIDDEN/,
    'the binder must fail closed on the Production Worker origin');
}

console.log('OK: qa-pages-runtime-bind-current-session-contract passed');
