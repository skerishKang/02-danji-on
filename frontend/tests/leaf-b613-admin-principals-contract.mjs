import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const sessionSrc = await read('../assets/danjion-session.js');
const principalSrc = await read('../assets/danjion-admin-principals.js');
const adminPage = await read('../admin/index.html');

const ctx = { location: { hostname: 'danjion.pages.dev', search: '' }, URL, URLSearchParams, console };
vm.createContext(ctx);
vm.runInContext(sessionSrc, ctx);
vm.runInContext(principalSrc, ctx);
const P = ctx.DanjionAdminPrincipals;

const calls = [];
const okFetch = async (url, init = {}) => {
  calls.push({ url, init });
  return {
    ok: true,
    status: init.method === 'POST' ? 201 : 200,
    json: async () => ({ data: [] })
  };
};

const listed = await P.list(okFetch, 'https://api.test');
assert.equal(listed.state, 'ready');
assert.ok(calls[0].url.endsWith('/api/v1/admin/principals'));
assert.equal(calls[0].init.credentials, 'include');

const created = await P.create(okFetch, 'https://api.test', {
  email: 'Admin.Example@Example.com ',
  role: 'operator',
  reason: 'four-principal setup'
});
assert.equal(created.state, 'ready');
assert.equal(calls[1].init.method, 'POST');
assert.deepEqual(JSON.parse(calls[1].init.body), {
  email: 'admin.example@example.com',
  role: 'operator',
  reason: 'four-principal setup'
});

const updated = await P.update(
  okFetch,
  'https://api.test',
  'd0a1c4a1-0000-4000-8000-000000000061',
  { role: 'admin', status: 'active', reason: 'promote' }
);
assert.equal(updated.state, 'ready');
assert.equal(calls[2].init.method, 'PATCH');
assert.ok(calls[2].url.endsWith('/api/v1/admin/principals/d0a1c4a1-0000-4000-8000-000000000061'));
assert.deepEqual(JSON.parse(calls[2].init.body), {
  role: 'admin',
  status: 'active',
  reason: 'promote'
});

const invalidBefore = calls.length;
const invalid = await P.create(okFetch, 'https://api.test', { email: '', role: 'operator' });
assert.equal(invalid.state, 'invalid-request');
assert.equal(calls.length, invalidBefore, 'invalid principal form must fail before network mutation');

const selfLockout = await P.update(
  async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: { code: 'SELF_LOCKOUT_BLOCKED' } })
  }),
  'https://api.test',
  'd0a1c4a1-0000-4000-8000-000000000061',
  { role: 'operator', status: 'active' }
);
assert.equal(selfLockout.state, 'conflict');
assert.equal(selfLockout.code, 'SELF_LOCKOUT_BLOCKED');

assert.ok(adminPage.includes('<script src="/assets/danjion-admin-principals.js"></script>'),
  'canonical admin page must load the principal bridge');
assert.ok(adminPage.includes("principalApi=window.DanjionAdminPrincipals"),
  'page must bind the reviewed principal bridge');
assert.ok(adminPage.includes("목표 구성은 최고관리자 2계정 + 일반관리자 2계정"),
  'SUPER view must state the four-principal target');
assert.ok(adminPage.includes("principalApi.list(fetch,apiBase)"),
  'SUPER manager must refresh from the server principal roster');
assert.ok(adminPage.includes("principalApi.create(fetch,apiBase"),
  'SUPER manager must delegate creation to the bridge');
assert.ok(adminPage.includes("principalApi.update(fetch,apiBase,row.id"),
  'SUPER manager must delegate authority synchronization to the bridge');
assert.ok(adminPage.includes("capability.id!=='users'"),
  'the former users placeholder must be replaced, while other privileged placeholders remain');
assert.ok(!/innerHTML\s*=/.test(adminPage), 'principal management must remain text-safe');
for (const token of ['localStorage', 'sessionStorage', 'document.cookie', 'x-danjion-dev-auth-user']) {
  assert.ok(!principalSrc.includes(token), `principal bridge must never trust ${token}`);
}

console.log('leaf-b613-admin-principals-contract: PASS');
