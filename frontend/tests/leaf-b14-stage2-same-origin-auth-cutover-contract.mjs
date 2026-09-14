import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Issue #444 Stage 2 [frontend cutover]: browser Better Auth traffic on the
// canonical Pages origin binds the same-origin auth facade (functions/), while
// general application API traffic stays on the production Worker.
// Run: node frontend/tests/leaf-b14-stage2-same-origin-auth-cutover-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const PRODUCTION_HOST = 'danjion.pages.dev';
const WORKER_API_BASE = 'https://padiem-danjion-api-production.padiem.workers.dev';
const CANONICAL_PAGES_ORIGIN = 'https://danjion.pages.dev';

const AUTH_ENDPOINTS = [
  '/auth/social-start',
  '/api/auth/get-session',
  '/api/auth/sign-in/social',
  '/api/auth/sign-in/email',
  '/api/auth/sign-up/email',
  '/api/auth/forget-password'
];

const index = await read('../index.html');
const session = await read('../assets/danjion-session.js');

/* ================= 1. resolver runtime contract (danjionAuthBase) ================= */
const loadSession = (location) => {
  const ctx = { location, URLSearchParams, console };
  vm.createContext(ctx);
  vm.runInContext(session, ctx);
  return ctx.DanjionSession;
};

{
  const s = loadSession({ search: '', hostname: PRODUCTION_HOST });
  assert.equal(typeof s.danjionAuthBase, 'function', 'DanjionSession must export the auth base resolver');
  assert.equal(s.danjionAuthBase(), '', 'canonical Pages auth base must be same-origin (relative)');
  assert.equal(s.joinUrl(s.danjionAuthBase(), '/api/auth/get-session'), '/api/auth/get-session',
    'canonical get-session must be a same-origin relative URL');
  assert.equal(s.joinUrl(s.danjionAuthBase(), '/auth/social-start'), '/auth/social-start',
    'canonical social-start must be a same-origin relative URL');
  assert.equal(s.danjionApiBase(), WORKER_API_BASE,
    'general application API base must stay bound to the production Worker');
}
{
  const s = loadSession({ search: '', hostname: PRODUCTION_HOST.toUpperCase() });
  assert.equal(s.danjionAuthBase(), '', 'canonical auth same-origin must be hostname case-insensitive');
}
{
  for (const hostname of ['danjion-review.pages.dev', 'localhost', '127.0.0.1', '[::1]', 'kilo1.danjion-preview.pages.dev', 'demo.test']) {
    const s = loadSession({ search: '', hostname });
    assert.equal(s.danjionAuthBase(), '', `${hostname} must not auto-bind any auth backend (demo lane, serverMode off)`);
    assert.equal(s.danjionApiBase(), '', `${hostname} must stay fail-closed on the general API too`);
  }
}
{
  const s = loadSession({ search: '', hostname: `evil-${PRODUCTION_HOST}` });
  assert.equal(s.danjionAuthBase(), '', 'suffix-spoofed hostnames must not bind the production auth facade');
}
{
  const s = loadSession({ search: '?apiBase=', hostname: PRODUCTION_HOST });
  assert.equal(s.danjionAuthBase(), '', 'the empty ?apiBase= escape hatch must stay fail-closed on auth too');
}
{
  const crafted = `?apiBase=${encodeURIComponent('https://attacker.example/collect')}`;
  const s = loadSession({ search: crafted, hostname: PRODUCTION_HOST });
  assert.equal(s.danjionAuthBase(), '',
    'canonical production auth must ignore a crafted ?apiBase= and remain same-origin');
  assert.equal(s.danjionApiBase(), WORKER_API_BASE,
    'canonical production general API must ignore a crafted ?apiBase= and remain Worker-bound');
  assert.equal(s.joinUrl(s.danjionAuthBase(), '/api/auth/sign-in/email'), '/api/auth/sign-in/email',
    'crafted production links must never redirect credential-bearing auth traffic off-origin');
}
{
  const s = loadSession({ search: `?apiBase=${encodeURIComponent('https://preview.test/api//')}`, hostname: 'danjion-review.pages.dev' });
  assert.equal(s.danjionAuthBase(), 'https://preview.test/api',
    'explicit ?apiBase= (controlled preview) must keep routing auth to the operator-configured base');
}
{
  // executable: the real sessionFetch issued from the canonical host is a
  // relative same-origin request, never a Worker-absolute auth URL.
  const s = loadSession({ search: '', hostname: PRODUCTION_HOST });
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); return new Response('{}', { status: 200 }); };
  const sessionFetch = s.createSessionFetch(s.danjionAuthBase());
  await sessionFetch(fetchImpl, '/api/auth/get-session');
  assert.deepEqual(calls, ['/api/auth/get-session'], 'canonical get-session fetch must be same-origin relative');
}

/* ================= 2. entry wiring: every browser auth call uses the auth base ================= */
assert.match(index, /createSessionFetch\(__session\.danjionAuthBase\(\)\)[\s\S]{0,120}'\/api\/auth\/get-session'/,
  'serverSessionCheck must fetch get-session through the auth base');
assert.match(index, /location\.href=__session\.joinUrl\(__session\.danjionAuthBase\(\),'\/auth\/social-start'\)/,
  'social entry must navigate through the auth base');
for (const endpoint of ['/api/auth/sign-in/email', '/api/auth/sign-up/email', '/api/auth/forget-password']) {
  assert.ok(index.includes(`__session.joinUrl(__session.danjionAuthBase(),'${endpoint}')`),
    `email auth must use the auth base: ${endpoint}`);
}

/* ================= 3. no direct Worker auth calls anywhere in the canonical frontend ================= */
for (const endpoint of AUTH_ENDPOINTS) {
  assert.ok(!index.includes(`danjionApiBase(),'${endpoint}'`),
    `index.html must not bind the Worker API base directly to ${endpoint}`);
  assert.ok(!session.includes(`danjionApiBase(),'${endpoint}'`),
    `danjion-session.js must not bind the Worker API base directly to ${endpoint}`);
}
assert.ok(!index.includes('createSessionFetch(__session.danjionApiBase())'),
  'session check must not run against the Worker API base anymore');
assert.equal(index.match(/danjionApiBase\(\)/g).length, 1,
  'the only danjionApiBase() use left in the entry is the serverMode general-API gate');
assert.match(index, /serverMode=!!__session&&__session\.danjionApiBase\(\)!==''/,
  'serverMode must keep its #419 general-API binding semantics unchanged');

const htmlPages = readdirSync(new URL('..', import.meta.url), { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.html'))
  .map((e) => e.name);
for (const name of htmlPages) {
  const src = await read(`../${name}`);
  for (const endpoint of AUTH_ENDPOINTS) {
    if (!src.includes(endpoint)) continue;
    assert.equal(name, 'index.html', `${name} must not carry browser auth endpoint traffic`);
  }
}
const bridgeAssets = readdirSync(new URL('../assets', import.meta.url), { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.js') && e.name !== 'danjion-session.js')
  .map((e) => e.name);
for (const name of bridgeAssets) {
  const src = await read(`../assets/${name}`);
  assert.ok(!src.includes('/api/auth') && !src.includes('/auth/social-start'),
    `${name} (general API bridge) must never call Better Auth endpoints`);
}

/* ================= 4. preserved invariants ================= */
assert.match(index, /q\.set\('requestSignUp','1'\)/, 'requestSignUp=1 must stay unconditional for every social provider');
assert.match(index, /const q=new URLSearchParams\(\{provider,callbackURL:location\.origin\+location\.pathname\}\)/,
  'social-start must be entered with a GET query built from the page origin (canonical Pages on production)');
assert.ok(!index.includes('callbackURL:__session.danjionApiBase()'),
  'callbackURL must never be derived from the Worker API base');

// #452 native session parsing must survive the cutover untouched.
assert.match(session, /result\.ok && result\.raw && typeof result\.raw === 'object' && result\.raw\.session && result\.raw\.user/,
  'nativeSessionReady must judge the session from the raw Better Auth payload (PR #452 fix)');
assert.match(index, /return __session\.nativeSessionReady\(r\)/,
  'serverSessionCheck must return the nativeSessionReady verdict');
assert.ok(!/r\.data\s*&&\s*r\.data\.session/.test(index),
  'session detection must not fall back to the { data } envelope');

// neutral social copy must be untouched by the cutover.
for (const copy of ['Google로 계속하기', '네이버로 계속하기', '카카오로 계속하기']) {
  assert.ok(index.includes(copy), `social button copy must stay neutral: ${copy}`);
}

/* ================= 5. Stage-1 facade authority stays intact ================= */
const facade = await read('../../functions/_lib/auth-facade.js');
assert.ok(facade.includes(`export const EXPECTED_GOOGLE_REDIRECT_URI = \`\${CANONICAL_PAGES_ORIGIN}/api/auth/callback/google\`;`),
  'Google callback contract must remain the canonical Pages callback');
assert.ok(facade.includes(`export const CANONICAL_PAGES_ORIGIN = '${CANONICAL_PAGES_ORIGIN}';`),
  'the facade must keep failing closed outside the canonical Pages origin');
const backend = await read('../../04_개발/backend/src/auth-better-v1.ts');
assert.ok(backend.includes("export const AUTH_FACADE_MARKER_VALUE = 'canonical-pages-v1';"),
  'Stage-1 backend resolver marker must be unchanged');
assert.ok(backend.includes("export const CANONICAL_PAGES_AUTH_BASE_URL = 'https://danjion.pages.dev';"),
  'Stage-1 backend canonical auth base constant must be unchanged');

console.log('leaf-b14-stage2-same-origin-auth-cutover-contract: PASS');
