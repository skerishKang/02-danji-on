import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const sessionSrc = await read('../assets/danjion-session.js');
const auditSrc = await read('../assets/danjion-admin-global-audit.js');
const adminPage = await read('../admin/index.html');

const ctx = { location: { hostname: 'danjion.pages.dev', search: '' }, URL, URLSearchParams, console };
vm.createContext(ctx);
vm.runInContext(sessionSrc, ctx);
vm.runInContext(auditSrc, ctx);
const A = ctx.DanjionAdminGlobalAudit;

const calls = [];
const okFetch = async (url, init = {}) => {
  calls.push({ url, init });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: [{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        actorKind: 'operator',
        action: 'authorization.padiem-authority-check',
        scope: 'platform.audit.read',
        resourceType: null,
        decision: 'allowed',
        reasonCode: 'PRIVILEGED_WILDCARD_GRANT',
        createdAt: '2026-09-16T15:00:00.000Z'
      }]
    })
  };
};

const listed = await A.list(okFetch, 'https://api.test', {
  limit: 999,
  decision: 'denied',
  before: '2026-09-17T00:00:00Z'
});
assert.equal(listed.state, 'ready');
assert.equal(listed.rows.length, 1);
const url = new URL(calls[0].url);
assert.equal(url.pathname, '/api/v1/admin/audit-events');
assert.equal(url.searchParams.get('limit'), '200');
assert.equal(url.searchParams.get('decision'), 'denied');
assert.equal(url.searchParams.get('before'), '2026-09-17T00:00:00.000Z');
assert.equal(calls[0].init.credentials, 'include');

const relativeCalls = [];
const relative = await A.list(async (url, init = {}) => {
  relativeCalls.push({ url, init });
  return { ok: true, status: 200, json: async () => ({ data: [] }) };
}, '', { limit: 5 });
assert.equal(relative.state, 'ready');
assert.equal(relativeCalls[0].url, '/api/v1/admin/audit-events?limit=5');

const invalidDecision = await A.list(okFetch, 'https://api.test', { decision: 'maybe' });
assert.equal(invalidDecision.state, 'invalid-request');
assert.equal(calls.length, 1, 'invalid audit filter must fail before network');

const forbidden = await A.list(
  async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: { code: 'PRIVILEGED_FORBIDDEN' } })
  }),
  'https://api.test',
  {}
);
assert.equal(forbidden.state, 'forbidden');
assert.equal(forbidden.code, 'PRIVILEGED_FORBIDDEN');

assert.ok(adminPage.includes('<script src="/assets/danjion-admin-global-audit.js"></script>'));
assert.ok(adminPage.includes('auditApi=window.DanjionAdminGlobalAudit'));
assert.ok(adminPage.includes("renderAuditManager(panel,apiBase)"));
assert.ok(adminPage.includes("auditApi.list(fetch,apiBase,{limit:100,decision:decision.value})"));
assert.ok(adminPage.includes("capability.id!=='users'&&capability.id!=='audit'"));
assert.ok(adminPage.includes('사용자·세대·resource 식별자와 request ID, raw metadata는 표시하지 않습니다.'));
for (const forbiddenToken of ['actorUserId', 'complexId', 'resourceId', 'requestId', 'metadata:']) {
  assert.ok(!auditSrc.includes(forbiddenToken), `audit bridge must not introduce ${forbiddenToken}`);
}

console.log('leaf-b615-admin-global-audit-contract: PASS');
