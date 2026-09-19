import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Issue #790: Prepare exact-origin auth/app runtime for danjion.padiem.net
// Verifies domain source readiness invariants:
// 1. danjion.padiem.net -> app API and auth same-origin
// 2. danjion.pages.dev -> legacy fallback normal
// 3. danjion-qa.pages.dev -> QA isolation normal
// 4. arbitrary hostname -> fail-closed
// 5. spoofed origins -> cannot gain authority
// 6. ?apiBase= -> cannot override primary or legacy production hosts
// 7. backend public-base resolver -> marker + exact origin dual guard
// 8. forged client Origin/internal marker -> stripped/rewritten, cannot gain authority
// 9. OAuth callback -> matches approved origin
// 10. production Worker source policy includes primary + bounded legacy origins
// 11. legacy Pages fallback not removed

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const sessionSrc = await read('../assets/danjion-session.js');
const authFacadeSrc = await read('../../functions/_lib/auth-facade.js');
const appFacadeSrc = await read('../../functions/_lib/app-facade.js');
const backendSrc = await read('../../04_개발/backend/src/auth-better-v1.ts');
const releaseWorkflow = await read('../../.github/workflows/pages-production-release.yml');
const wranglerSource = await read('../../04_개발/backend/wrangler.jsonc');

const PRIMARY_HOST = 'danjion.padiem.net';
const PRIMARY_ORIGIN = 'https://danjion.padiem.net';
const LEGACY_HOST = 'danjion.pages.dev';
const LEGACY_ORIGIN = 'https://danjion.pages.dev';
const QA_HOST = 'danjion-qa.pages.dev';
const QA_ORIGIN = 'https://danjion-qa.pages.dev';

const loadSession = (location) => {
  const ctx = { location, URLSearchParams, console };
  vm.createContext(ctx);
  vm.runInContext(sessionSrc, ctx);
  return ctx.DanjionSession;
};

/* --- 1. danjion.padiem.net: app API same-origin, auth same-origin --- */
{
  const s = loadSession({ search: '', hostname: PRIMARY_HOST });
  assert.equal(s.danjionApiBase(), PRIMARY_ORIGIN,
    'primary host must bind exact same-origin for general app API');
  assert.equal(s.danjionAuthBase(), '',
    'primary host must bind same-origin (empty string) for Better Auth facade');
  assert.equal(s.joinUrl(s.danjionAuthBase(), '/api/auth/get-session'), '/api/auth/get-session',
    'primary get-session must be relative same-origin');
  assert.equal(s.joinUrl(s.danjionApiBase(), '/api/v1/me'), `${PRIMARY_ORIGIN}/api/v1/me`,
    'primary app API must route to same-origin');
}

/* --- 2. danjion.pages.dev: legacy fallback normal --- */
{
  const s = loadSession({ search: '', hostname: LEGACY_HOST });
  assert.equal(s.danjionApiBase(), LEGACY_ORIGIN,
    'legacy host must bind exact legacy same-origin for general app API');
  assert.equal(s.danjionAuthBase(), '',
    'legacy host must bind same-origin for Better Auth facade');
  assert.equal(s.joinUrl(s.danjionAuthBase(), '/api/auth/get-session'), '/api/auth/get-session',
    'legacy get-session must be relative same-origin');
}

/* --- 3. danjion-qa.pages.dev: QA isolation normal --- */
{
  // Canonical source does not auto-bind QA before deployment artifact binding
  const s = loadSession({ search: '', hostname: QA_HOST });
  assert.equal(s.danjionAuthBase(), '', 'unbound QA host does not gain production authority');
  assert.equal(s.danjionApiBase(), '', 'unbound QA host does not gain production app API');

  // Facades route QA exact origin to dedicated QA Worker
  assert.ok(authFacadeSrc.includes("QA_PAGES_ORIGIN = 'https://danjion-qa.pages.dev'"));
  assert.ok(authFacadeSrc.includes("QA_WORKER_API_BASE = 'https://padiem-danjion-api-qa.padiem.workers.dev'"));
  assert.ok(appFacadeSrc.includes("QA_PAGES_ORIGIN = 'https://danjion-qa.pages.dev'"));
  assert.ok(appFacadeSrc.includes("QA_WORKER_API_BASE = 'https://padiem-danjion-api-qa.padiem.workers.dev'"));
}

/* --- 4. arbitrary hostname: fail-closed --- */
{
  for (const hostname of ['localhost', '127.0.0.1', 'danjion-review.pages.dev', 'preview.padiem.net', 'example.com', '']) {
    const s = loadSession({ search: '', hostname });
    assert.equal(s.danjionApiBase(), '', `${hostname} must stay fail-closed on app API`);
    assert.equal(s.danjionAuthBase(), '', `${hostname} must stay fail-closed on auth`);
  }
}

/* --- 5. spoofed origins: cannot gain production authority --- */
{
  const spoofedHosts = [
    'danjion.padiem.net.evil.example',
    'evil-danjion.padiem.net',
    'danjion.padiem.net.attacker.com',
    'danjion.pages.dev.evil.example',
    'evil-danjion.pages.dev',
    'padiem.net',
    'notdanjion.padiem.net'
  ];
  for (const hostname of spoofedHosts) {
    const s = loadSession({ search: '', hostname });
    assert.equal(s.danjionApiBase(), '', `spoofed ${hostname} must not gain production api base`);
    assert.equal(s.danjionAuthBase(), '', `spoofed ${hostname} must not gain production auth base`);
  }

  // Ensure no wildcard or suffix matches exist in facades or backend
  assert.ok(!authFacadeSrc.includes('*.padiem.net'));
  assert.ok(!authFacadeSrc.includes('*.pages.dev'));
  assert.ok(!authFacadeSrc.includes("endsWith('padiem.net')"));
  assert.ok(!authFacadeSrc.includes("endsWith('pages.dev')"));
  assert.ok(!appFacadeSrc.includes('*.padiem.net'));
  assert.ok(!appFacadeSrc.includes('*.pages.dev'));
  assert.ok(!appFacadeSrc.includes("endsWith('padiem.net')"));
  assert.ok(!appFacadeSrc.includes("endsWith('pages.dev')"));
  assert.ok(!backendSrc.includes('*.padiem.net'));
  assert.ok(!backendSrc.includes('*.pages.dev'));
  assert.ok(!backendSrc.includes("endsWith('padiem.net')"));
  assert.ok(!backendSrc.includes("endsWith('pages.dev')"));
}

/* --- 6. ?apiBase=: cannot override new or legacy Production host --- */
{
  const maliciousOverride = `?apiBase=${encodeURIComponent('https://evil-attacker.example/api')}`;
  const sPrimary = loadSession({ search: maliciousOverride, hostname: PRIMARY_HOST });
  assert.equal(sPrimary.danjionApiBase(), PRIMARY_ORIGIN,
    'query parameter must not override primary production app API');
  assert.equal(sPrimary.danjionAuthBase(), '',
    'query parameter must not override primary production auth base');

  const sLegacy = loadSession({ search: maliciousOverride, hostname: LEGACY_HOST });
  assert.equal(sLegacy.danjionApiBase(), LEGACY_ORIGIN,
    'query parameter must not override legacy production app API');
  assert.equal(sLegacy.danjionAuthBase(), '',
    'query parameter must not override legacy production auth base');
}

/* --- 7. backend public-base resolver: marker + exact origin dual guard --- */
{
  assert.ok(backendSrc.includes("export const PRIMARY_PRODUCTION_AUTH_BASE_URL = 'https://danjion.padiem.net';"));
  assert.ok(backendSrc.includes("export const LEGACY_PRODUCTION_AUTH_BASE_URL = 'https://danjion.pages.dev';"));
  assert.ok(backendSrc.includes("export const CANONICAL_PAGES_AUTH_BASE_URL = 'https://danjion.pages.dev';"));
  assert.ok(backendSrc.includes("export const QA_PAGES_AUTH_BASE_URL = 'https://danjion-qa.pages.dev';"));
  assert.ok(backendSrc.includes("if (request.headers.get(AUTH_FACADE_MARKER_HEADER) !== AUTH_FACADE_MARKER_VALUE) return envBase;"));
  assert.ok(backendSrc.includes("if (origin === new URL(PRIMARY_PRODUCTION_AUTH_BASE_URL).origin) return PRIMARY_PRODUCTION_AUTH_BASE_URL;"));
  assert.ok(backendSrc.includes("if (origin === new URL(LEGACY_PRODUCTION_AUTH_BASE_URL).origin) return LEGACY_PRODUCTION_AUTH_BASE_URL;"));
}

/* --- 8. forged client Origin/internal marker stripped/rewritten --- */
{
  assert.ok(authFacadeSrc.includes("const FORGED_GUARDED_HEADERS = new Set(['origin', FACADE_REQUEST_MARKER_HEADER]);"));
  assert.ok(authFacadeSrc.includes("headers.set('origin', url.origin);"));
  assert.ok(authFacadeSrc.includes("headers.set(FACADE_REQUEST_MARKER_HEADER, FACADE_REQUEST_MARKER_VALUE);"));
  assert.ok(appFacadeSrc.includes("const GUARDED_HEADERS = new Set(['origin', 'x-forwarded-host', 'x-forwarded-proto', 'authorization']);"));
  assert.ok(appFacadeSrc.includes("headers.set('origin', url.origin);"));
}

/* --- 9. OAuth callback: same-origin with current approved origin --- */
{
  assert.ok(authFacadeSrc.includes("export const PRIMARY_GOOGLE_REDIRECT_URI = `${PRIMARY_PRODUCTION_ORIGIN}/api/auth/callback/google`;"));
  assert.ok(authFacadeSrc.includes("export const EXPECTED_GOOGLE_REDIRECT_URI = `${CANONICAL_PAGES_ORIGIN}/api/auth/callback/google`;"));
}

/* --- 10. production Worker origin policy is source-ready and exact --- */
{
  const wrangler = JSON.parse(wranglerSource);
  const productionVars = wrangler.env?.production?.vars || {};
  assert.equal(
    productionVars.CORS_ALLOWED_ORIGINS,
    'https://danjion.padiem.net,https://danjion.pages.dev',
    'production CORS must include primary + bounded legacy origins only'
  );
  assert.equal(
    productionVars.AUTH_TRUSTED_ORIGINS,
    'https://danjion.padiem.net,https://danjion.pages.dev',
    'production Better Auth trusted origins must include primary + bounded legacy origins only'
  );
  assert.ok(!String(productionVars.CORS_ALLOWED_ORIGINS || '').includes('*'),
    'production CORS must not use wildcard trust');
  assert.ok(!String(productionVars.AUTH_TRUSTED_ORIGINS || '').includes('*'),
    'production trusted origins must not use wildcard trust');
}

/* --- 11. legacy Pages fallback not removed --- */
{
  assert.ok(sessionSrc.includes("const LEGACY_PRODUCTION_HOSTNAME = 'danjion.pages.dev';"));
  assert.ok(sessionSrc.includes("const PRODUCTION_PAGES_HOSTNAME = 'danjion.pages.dev';"));
  assert.ok(sessionSrc.includes("const CANONICAL_PAGES_API_BASE = 'https://danjion.pages.dev';"));
  assert.ok(authFacadeSrc.includes("export const LEGACY_PRODUCTION_ORIGIN = 'https://danjion.pages.dev';"));
  assert.ok(appFacadeSrc.includes("export const LEGACY_PRODUCTION_ORIGIN = 'https://danjion.pages.dev';"));
  assert.ok(releaseWorkflow.includes("LEGACY_PUBLIC_ORIGIN: https://danjion.pages.dev"));
}

console.log('leaf-b790-domain-source-readiness-contract: PASS');
