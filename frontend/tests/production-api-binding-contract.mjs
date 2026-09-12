import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Issue #419 [production promotion]: the top-level frontend/ V3 static site is the
// canonical Pages production artifact, and the production API binding is hostname-gated:
//   - explicit ?apiBase= (controlled preview) always wins, including ?apiBase= empty as
//     the fail-closed escape hatch on the production hostname;
//   - danjion.pages.dev auto-binds https://padiem-danjion-api-production.padiem.workers.dev;
//   - every other origin (danjion-review.pages.dev, localhost, previews) resolves to ''
//     and stays on the static/demo lane.
// Run: node frontend/tests/production-api-binding-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const PRODUCTION_API_BASE = 'https://padiem-danjion-api-production.padiem.workers.dev';
const PRODUCTION_HOST = 'danjion.pages.dev';

/* ================= resolver runtime contract (danjion-session.js) ================= */
const sessionSource = await read('../assets/danjion-session.js');
const loadSession = (location) => {
  const ctx = { location, URLSearchParams, console };
  vm.createContext(ctx);
  vm.runInContext(sessionSource, ctx);
  return ctx.DanjionSession;
};

{
  const s = loadSession({ search: '', hostname: PRODUCTION_HOST });
  assert.equal(s.danjionApiBase(), PRODUCTION_API_BASE, 'canonical Pages hostname must auto-bind the production API');
  assert.equal(s.PRODUCTION_PAGES_HOSTNAME, PRODUCTION_HOST, 'session runtime must export the canonical hostname');
  assert.equal(s.PRODUCTION_API_BASE, PRODUCTION_API_BASE, 'session runtime must export the canonical production base');
}
{
  const s = loadSession({ search: '', hostname: 'danjion-review.pages.dev' });
  assert.equal(s.danjionApiBase(), '', 'the review Pages hostname must stay fail-closed (demo) without an explicit apiBase');
}
{
  for (const hostname of ['localhost', '127.0.0.1', '[::1]', 'kilo1.danjion-preview.pages.dev']) {
    const s = loadSession({ search: '', hostname });
    assert.equal(s.danjionApiBase(), '', `${hostname} must stay fail-closed (demo) without an explicit apiBase`);
  }
}
{
  const s = loadSession({ search: '', hostname: PRODUCTION_HOST.toUpperCase() });
  assert.equal(s.danjionApiBase(), PRODUCTION_API_BASE, 'hostname comparison must be case-insensitive');
}
{
  const s = loadSession({ search: `?apiBase=${encodeURIComponent('https://preview.test/api//')}`, hostname: 'danjion-review.pages.dev' });
  assert.equal(s.danjionApiBase(), 'https://preview.test/api', 'explicit apiBase must win on any hostname with trailing slashes trimmed');
}
{
  const s = loadSession({ search: '?apiBase=', hostname: PRODUCTION_HOST });
  assert.equal(s.danjionApiBase(), '', 'an explicit empty ?apiBase= must force the demo lane even on the production hostname (escape hatch)');
}
{
  const s = loadSession({ search: '?utm=other', hostname: 'localhost' });
  assert.equal(s.danjionApiBase(), '', 'unrelated query params must not enable server mode');
}
{
  const s = loadSession({ search: '', hostname: `evil-${PRODUCTION_HOST}` });
  assert.equal(s.danjionApiBase(), '', 'suffix-spoofed hostnames must not bind the production API');
}
{
  const s = loadSession({ search: '', hostname: 'demo.test' });
  assert.equal(s.danjionApiBase({ search: '', hostname: PRODUCTION_HOST }), PRODUCTION_API_BASE, 'resolver must accept an injected location for harnesses');
  assert.equal(s.danjionApiBase(), '', 'with no query and a non-canonical global location the injected demo host stays fail-closed');
}

/* ================= page wiring contract: canonical resolver everywhere ================= */
const pages = readdirSync(new URL('..', import.meta.url), { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.html'))
  .map((e) => e.name);

const SESSION_TAG = '<script src="assets/danjion-session.js"></script>';
const QUERY_READER = "get('apiBase')";
let convertedPages = 0;

for (const name of pages) {
  const src = await read(`../${name}`);
  const usesResolver = src.includes('DanjionSession.danjionApiBase()');
  const loadsBridge = src.includes('assets/resident-bridge.js');
  const rawQueryReader = src.includes(`new URLSearchParams(location.search).${QUERY_READER}`);
  if (usesResolver || loadsBridge) {
    const tagAt = src.indexOf(SESSION_TAG);
    assert.ok(tagAt > -1, `${name} must load the canonical session runtime before using the resolver`);
    if (usesResolver) {
      assert.ok(tagAt < src.indexOf('DanjionSession.danjionApiBase()'), `${name} session runtime must load before the first resolver call`);
      convertedPages++;
    }
    if (loadsBridge) {
      assert.ok(tagAt < src.indexOf('assets/resident-bridge.js'), `${name} session runtime must load before resident-bridge.js`);
    }
  }
  assert.ok(!rawQueryReader, `${name} must not keep a query-only apiBase reader that bypasses the #419 hostname gate`);
}
assert.ok(convertedPages >= 13, `expected every V3 server-mode page to resolve apiBase through DanjionSession (got ${convertedPages})`);

/* page 05 keeps its #352 OPTION B lock (no session token) while carrying the same gate inline */
{
  const f05 = await read('../05_우리단지_첫화면.html');
  assert.ok(!f05.includes('DanjionSession'), '05 must stay free of the DanjionSession token (OPTION B remains in force)');
  assert.ok(f05.includes(`'${PRODUCTION_HOST}'`) && f05.includes(PRODUCTION_API_BASE),
    '05 must carry the same #419 hostname gate inline (public fetch only)');
}

/* ================= production workflow contract (V3 promotion) ================= */
const workflow = await read('../../.github/workflows/pages-production-release.yml');
{
  assert.ok(!workflow.includes('04_개발/frontend'), 'the production workflow must no longer deploy the V2 React tree');
  assert.ok(!workflow.includes('VITE_UI_VARIANT'), 'the production workflow must not inject Vite V2 build profiles');
  assert.ok(!workflow.includes('build:live'), 'the production workflow must not run the V2 live build');
  assert.ok(workflow.includes('confirm_production'), 'the manual production confirmation gate must remain');
  assert.ok(workflow.includes('node frontend/tests/toplevel-frontend-contract-gate.mjs'),
    'the production workflow must validate the V3 source through the top-level contract gate');
  assert.ok(workflow.includes('frontend/index.html'), 'the production artifact entry must be the V3 canonical entry');
  assert.ok(workflow.includes('PAGES_PROJECT: danjion'), 'the workflow must stay pinned to the danjion Pages project');
  assert.ok(workflow.includes('Padiem'), 'the Padiem account guard must remain');
  assert.ok(workflow.includes('/api/health'), 'the production API health preflight must remain');
  assert.ok(workflow.includes('/api/auth/jwks'), 'the production Better Auth JWKS preflight must remain');
  assert.ok(workflow.includes(PRODUCTION_API_BASE), 'the workflow must pin the canonical production API origin');
  assert.ok(workflow.includes('x-danjion-dev-auth-user'), 'the dev-auth artifact scan must remain');
  assert.ok(workflow.includes(`CANONICAL_PAGES_URL: https://${PRODUCTION_HOST}`), 'the canonical Pages smoke URL must remain');
}

/* the V3 source itself must stay free of any dev-auth bypass surface */
for (const name of pages) {
  const src = await read(`../${name}`);
  assert.ok(!src.includes('x-danjion-dev-auth-user'), `${name} must never reference the development auth header`);
}
const bridgeSources = ['../assets/resident-bridge.js', '../assets/danjion-session.js'];
for (const rel of bridgeSources) {
  const src = await read(rel);
  assert.ok(!src.includes('x-danjion-dev-auth-user'), `${rel} must never reference the development auth header`);
}

console.log('production-api-binding-contract: PASS');
