import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Issue #804 [Pages release same-origin guard]: the Production Pages release
// workflow drifted from the canonical #830 architecture. Its authority scan used
// to grep the BROWSER artifact (`dist/assets/danjion-session.js`) for the fixed
// production Worker absolute URL:
//
//   grep -R -q 'padiem-danjion-api-production.padiem.workers.dev' \
//     dist/assets/danjion-session.js
//
// Since the same-origin cutover (#830: commits 48e6678 / 9175ced) the canonical
// production hosts resolve danjionApiBase()/danjionAuthBase() to '' so
// DanjionSession-managed browser API/Auth traffic stays on the same-origin Pages
// Function facade. The existing OPTION B bounded public read-only fetch in
// 05_우리단지_첫화면.html remains a separate direct Worker path for its
// complex-name authority lookup; the Worker upstream used by managed traffic is
// pinned in the server-side Pages Functions.
//
// That stale guard made every release off current main fail-fast. This contract
// pins the corrected three-layer scan so the drift cannot silently return.
//
// Run: node frontend/tests/leaf-b804-pages-release-same-origin-guard-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const WORKFLOW_PATH = '../../.github/workflows/pages-production-release.yml';
const SESSION_ASSET = '../assets/danjion-session.js';
const APP_FACADE = '../../functions/_lib/app-facade.js';
const AUTH_FACADE = '../../functions/_lib/auth-facade.js';

const PRODUCTION_WORKER = 'https://padiem-danjion-api-production.padiem.workers.dev';
const PRODUCTION_WORKER_LITERAL = 'padiem-danjion-api-production.padiem.workers.dev';
const CANONICAL_HOSTS = ['danjion.padiem.net', 'danjion.pages.dev'];

const workflow = await read(WORKFLOW_PATH);
const sessionSource = await read(SESSION_ASSET);
const appFacade = await read(APP_FACADE);
const authFacade = await read(AUTH_FACADE);

/* ============ 1. the stale browser-artifact Worker-literal guard is gone ============ */
{
  // No `grep ... 'padiem-danjion-api-production...' ... dist/assets/danjion-session.js`
  // may remain. A plain `grep` over the session asset for the Worker literal is the
  // exact pre-#830 drift this contract exists to prevent.
  const staleGrep = /grep[^\n]*padiem-danjion-api-production\.padiem\.workers\.dev[^\n]*dist\/assets\/danjion-session\.js/;
  assert.ok(!staleGrep.test(workflow),
    'release workflow must no longer grep the browser session asset for the production Worker literal');

  // Also forbid the reverse ordering defensive form (path first, pattern later).
  const staleGrepAlt = /dist\/assets\/danjion-session\.js[^\n]*padiem-danjion-api-production\.padiem\.workers\.dev/;
  assert.ok(!staleGrepAlt.test(workflow),
    'release workflow must not require the production Worker literal inside the browser session asset');
}

/* ============ 2. the workflow evaluates REAL browser same-origin semantics ============ */
{
  assert.ok(workflow.includes('verify-same-origin-authority.mjs'),
    'release workflow must evaluate the assembled browser artifact in a bounded runtime');
  assert.ok(workflow.includes('vm.createContext'),
    'release workflow must load the artifact into a real vm context, not guess from text');
  assert.ok(workflow.includes('vm.runInContext'),
    'release workflow must execute the artifact to obtain its resolver');
  assert.ok(workflow.includes('DanjionSession'),
    'release workflow must assert against the exported DanjionSession runtime');
  assert.ok(workflow.includes('BROWSER_SAME_ORIGIN_FACADE_AUTHORITY_SCAN: PASS'),
    'release workflow must emit a bounded browser same-origin authority scan disposition');

  // Both canonical hostnames must be exercised.
  for (const host of CANONICAL_HOSTS) {
    assert.ok(workflow.includes(`'${host}'`),
      `release workflow must exercise the canonical production hostname ${host}`);
  }

  // The three resolver semantics must all be asserted.
  assert.ok(workflow.includes('isCanonicalProduction'),
    'release workflow must assert isCanonicalProduction() on canonical hosts');
  assert.ok(workflow.includes('danjionApiBase'),
    'release workflow must assert danjionApiBase() on canonical hosts');
  assert.ok(workflow.includes('danjionAuthBase'),
    'release workflow must assert danjionAuthBase() on canonical hosts');

  // Same-origin expectation must be the empty-string contract for canonical hosts.
  assert.match(workflow, /danjionApiBase\(\)\s*!==\s*''/,
    'release workflow must require the canonical application API base to be same-origin (empty string)');
  assert.match(workflow, /danjionAuthBase\(\)\s*!==\s*''/,
    'release workflow must require the canonical Better Auth base to be same-origin (empty string)');

  // The crafted-override fail-closed check must be present.
  assert.ok(workflow.includes('evil.example'),
    'release workflow must supply a crafted external ?apiBase= and prove canonical production refuses it');
}

/* ============ 3. the workflow requires the Workers literal in the SERVER facades ============ */
{
  assert.ok(workflow.includes('functions/_lib/app-facade.js'),
    'release workflow must verify the app facade upstream pin');
  assert.ok(workflow.includes('functions/_lib/auth-facade.js'),
    'release workflow must verify the auth facade upstream pin');
  assert.ok(workflow.includes(PRODUCTION_WORKER_LITERAL),
    'release workflow must still assert the fixed production Worker upstream');
  assert.ok(workflow.includes('PAGES_FUNCTION_UPSTREAM_PIN_SCAN: PASS'),
    'release workflow must emit a bounded Pages Function upstream pin disposition');

  // The upstream pin belongs to the server facades and must actually be there.
  for (const [label, src] of [['app-facade.js', appFacade], ['auth-facade.js', authFacade]]) {
    assert.ok(src.includes(PRODUCTION_WORKER),
      `${label} must pin the canonical production Worker upstream`);
    assert.match(src, /export const WORKER_API_BASE\s*=\s*'https:\/\/padiem-danjion-api-production\.padiem\.workers\.dev'/,
      `${label} must export WORKER_API_BASE as the fixed production Worker`);
  }
}

/* ============ 4. the browser runtime is genuinely same-origin (real vm evaluation) ============ */
{
  const load = (location) => {
    const ctx = { location, URLSearchParams, console };
    ctx.window = ctx;
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(sessionSource, ctx);
    return ctx.DanjionSession;
  };

  for (const hostname of CANONICAL_HOSTS) {
    const s = load({ search: '', hostname, origin: `https://${hostname}` });
    assert.equal(s.isCanonicalProduction(), true, `${hostname} must be canonical production`);
    assert.equal(s.danjionApiBase(), '', `${hostname} application API base must be same-origin`);
    assert.equal(s.danjionAuthBase(), '', `${hostname} Better Auth base must be same-origin`);

    const crafted = `?apiBase=${encodeURIComponent('https://evil.example/collect')}`;
    const evil = load({ search: crafted, hostname, origin: `https://${hostname}` });
    assert.equal(evil.danjionApiBase(), '',
      `${hostname} must refuse a crafted external ?apiBase= for the application API`);
    assert.equal(evil.danjionAuthBase(), '',
      `${hostname} must refuse a crafted external ?apiBase= for Better Auth`);
  }

  // The browser artifact itself must NOT carry the Worker absolute URL: that is
  // the server-side facade's job, and re-adding it would re-introduce the drift.
  assert.ok(!sessionSource.includes(PRODUCTION_WORKER_LITERAL),
    'the browser session runtime must not embed the production Worker absolute URL');

  // Canonical hostname constants must be exported and match.
  const probe = load({ search: '', hostname: CANONICAL_HOSTS[1], origin: `https://${CANONICAL_HOSTS[1]}` });
  assert.equal(probe.PRIMARY_PRODUCTION_HOSTNAME, CANONICAL_HOSTS[0],
    'runtime must export the primary production hostname');
  assert.equal(probe.PRODUCTION_PAGES_HOSTNAME, CANONICAL_HOSTS[1],
    'runtime must export the canonical Pages hostname');

  // Non-canonical origins stay fail-closed.
  const demo = load({ search: '', hostname: 'danjion-review.pages.dev', origin: 'https://danjion-review.pages.dev' });
  assert.equal(demo.danjionApiBase(), '', 'non-canonical origins must stay fail-closed without an explicit override');
  assert.equal(demo.danjionAuthBase(), '', 'non-canonical origins must stay fail-closed without an explicit override');
  assert.equal(demo.isCanonicalProduction(), false, 'non-canonical origins must not be canonical production');
}

/* ============ 5. preserved safety guards ============ */
{
  // dev-auth artifact scan
  assert.ok(/grep[^\n]*x-danjion-dev-auth-user[^\n]*\bdist\b/.test(workflow),
    'the dev-auth artifact scan over dist must remain');
  // canonical hostname greps on the browser artifact
  assert.ok(workflow.includes(`'${CANONICAL_HOSTS[0]}'`),
    'the primary production hostname guard must remain');
  assert.ok(workflow.includes(`'${CANONICAL_HOSTS[1]}'`),
    'the canonical Pages hostname guard must remain');
  // top-level frontend contract gate
  assert.ok(workflow.includes('node frontend/tests/toplevel-frontend-contract-gate.mjs'),
    'the top-level frontend contract gate must remain');
  // Padiem + project + branch
  assert.ok(workflow.includes('Padiem'), 'the Padiem Cloudflare account guard must remain');
  assert.ok(workflow.includes('PAGES_PROJECT: danjion'), 'the danjion Pages project pin must remain');
  assert.ok(workflow.includes('PAGES_PRODUCTION_BRANCH: main'), 'the production branch guard must remain');
  // API health + JWKS
  assert.ok(workflow.includes('/api/health'), 'the production API health preflight must remain');
  assert.ok(workflow.includes('/api/auth/jwks'), 'the production Better Auth JWKS preflight must remain');
  // canonical deployment readback + commit readback
  assert.ok(workflow.includes('Canonical Pages deployment API readback: PASS'),
    'the canonical deployment readback must remain');
  assert.ok(workflow.includes('$GITHUB_SHA'), 'the $GITHUB_SHA commit readback must remain');
  // root byte parity + critical leaf parity + true 404 parity
  assert.ok(workflow.includes('Canonical DanjiOn Pages root + critical leaf content parity + true 404: PASS'),
    'root/leaf byte parity + true 404 parity must remain');
  assert.ok(workflow.includes('40\\d.html') || workflow.includes('dist/404.html'),
    'the 404 parity target must remain');
  // deployment-time dispatch confirmation
  assert.ok(workflow.includes('confirm_production'), 'the manual production confirmation gate must remain');
  assert.match(workflow, /if:\s*inputs\.confirm_production/,
    'the production deploy job must stay gated on confirm_production');
}

console.log('leaf-b804-pages-release-same-origin-guard-contract: PASS (stale browser Worker literal guard removed; same-origin facade scan + server upstream pin pinned)');
