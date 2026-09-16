import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const sessionSrc = await read('../assets/danjion-session.js');
const authoritySrc = await read('../assets/danjion-admin-authority.js');
const bootstrapSrc = await read('../assets/danjion-admin-bootstrap.js');
const adminPage = await read('../admin/index.html');

function context(location = { hostname: 'danjion.pages.dev', search: '' }) {
  const ctx = { location, URL, URLSearchParams, console };
  vm.createContext(ctx);
  vm.runInContext(sessionSrc, ctx);
  vm.runInContext(authoritySrc, ctx);
  vm.runInContext(bootstrapSrc, ctx);
  return ctx;
}

function response(status, payload, seen) {
  return async (url, init) => {
    if (seen) seen.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload
    };
  };
}

// 1. Bootstrap is a dedicated POST endpoint and sends no authority-selection body.
{
  const ctx = context();
  const B = ctx.DanjionAdminBootstrap;
  assert.equal(B.BOOTSTRAP_PATH, '/api/v1/admin/bootstrap');

  const seen = [];
  const outcome = await B.bootstrapAuthority(
    response(200, { data: { level: 'operator', wildcard: false, scopes: ['business.review'] } }, seen)
  );
  assert.equal(outcome.state, 'operator');
  assert.equal(seen.length, 1);
  assert.ok(seen[0].url.endsWith('/api/v1/admin/bootstrap'));
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.body, undefined, 'browser must not send email/provider/role/scopes to bootstrap');
  assert.equal(seen[0].init.credentials, 'include');
}

// 2. Server outcomes stay fail-closed.
{
  const B = context().DanjionAdminBootstrap;
  assert.equal((await B.bootstrapAuthority(response(401, {}), { apiBase: 'https://api.test' })).state, 'signed-out');
  assert.equal((await B.bootstrapAuthority(response(403, { error: { code: 'ADMIN_BOOTSTRAP_NOT_ALLOWED' } }), { apiBase: 'https://api.test' })).state, 'not-registered');
  assert.equal((await B.bootstrapAuthority(response(503, {}), { apiBase: 'https://api.test' })).state, 'unavailable');
  assert.equal((await B.bootstrapAuthority(response(500, {}), { apiBase: 'https://api.test' })).state, 'error');
  assert.equal((await B.bootstrapAuthority(response(200, { data: {} }), { apiBase: 'https://api.test' })).state, 'invalid',
    'malformed successful response must reuse strict authority validation');
}

// 3. Local/unbound environments cannot emit an onboarding request accidentally.
{
  const B = context({ hostname: 'localhost', search: '' }).DanjionAdminBootstrap;
  let calls = 0;
  const outcome = await B.bootstrapAuthority(async () => { calls += 1; throw new Error('must not call'); });
  assert.equal(outcome.state, 'unbound');
  assert.equal(calls, 0);
}

// 4. The bootstrap asset has no client-selected identity/authority payload.
{
  for (const forbidden of [
    'JSON.stringify',
    'localStorage',
    'sessionStorage',
    'document.cookie',
    'x-danjion-role',
    'x-danjion-scope',
    'provider:',
    'email:',
    'scopes:',
    'authorityLevel:'
  ]) {
    assert.ok(!bootstrapSrc.includes(forbidden), 'bootstrap browser bridge must not carry client authority input: ' + forbidden);
  }
  assert.ok(!/innerHTML\s*=/.test(bootstrapSrc));
}

// 5. /admin/ exposes activation only after ordinary authority denial and never a
// public registration form.
{
  const sessionAt = adminPage.indexOf('/assets/danjion-session.js');
  const authorityAt = adminPage.indexOf('/assets/danjion-admin-authority.js');
  const bootstrapAt = adminPage.indexOf('/assets/danjion-admin-bootstrap.js');
  const consoleAt = adminPage.indexOf('/assets/danjion-admin-console.js');
  assert.ok(sessionAt > -1 && sessionAt < authorityAt && authorityAt < bootstrapAt && bootstrapAt < consoleAt,
    'admin assets must load session -> authority -> bootstrap -> console');

  assert.ok(adminPage.includes("if(state==='denied'&&bootstrapApi)"),
    'activation action must only appear after server authority denial');
  assert.ok(adminPage.includes("bootstrapApi.bootstrapAuthority(fetch)"));
  assert.ok(adminPage.includes("authority.hasAdminSurface(outcome)){renderConsole(outcome)"),
    'successful bootstrap must still pass strict canonical authority shape before console render');
  assert.ok(adminPage.includes('등록된 관리자 권한 확인'));
  assert.ok(adminPage.includes('일반 Google 로그인만으로는 관리자 권한이 생기지 않습니다.'));
  assert.ok(adminPage.includes("outcome.state==='not-registered'"));
  assert.ok(!/<form\b/i.test(adminPage), 'admin onboarding must not ship a public registration form');
  assert.ok(!/<input\b/i.test(adminPage), 'admin onboarding must not ask the browser for identity or role inputs');
}

console.log('PASS #592 pre-registered admin bootstrap browser boundary');
