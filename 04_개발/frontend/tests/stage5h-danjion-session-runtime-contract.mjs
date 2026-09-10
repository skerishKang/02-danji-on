import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const source = await readFile(new URL('frontend/assets/danjion-session.js', root), 'utf8');

function mockLocation(search = '') {
  return { search, origin: 'https://demo.example' };
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return body; }
  };
}

function loadRuntime(loc) {
  const context = { globalThis: null, location: loc || mockLocation(), URLSearchParams };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'danjion-session.js' });
  return context.DanjionSession;
}

const Session = loadRuntime();
assert.ok(Session && typeof Session.danjionApiBase === 'function');
assert.ok(Session && typeof Session.joinUrl === 'function');
assert.ok(Session && typeof Session.request === 'function');
assert.ok(Session && typeof Session.createSessionFetch === 'function');

/* --- danjionApiBase: reads ?apiBase=, strips trailing slashes --- */
{
  const r1 = loadRuntime(mockLocation('?apiBase=https://api.example.test/'));
  assert.equal(r1.danjionApiBase(), 'https://api.example.test');
}
{
  const r2 = loadRuntime(mockLocation('?apiBase=https://api.example.test'));
  assert.equal(r2.danjionApiBase(), 'https://api.example.test');
}
{
  const r3 = loadRuntime(mockLocation(''));
  assert.equal(r3.danjionApiBase(), '');
}
{
  const r4 = loadRuntime(mockLocation('?other=1'));
  assert.equal(r4.danjionApiBase(), '');
}
{
  const r5 = loadRuntime(mockLocation('?apiBase=https://api.example.test///'));
  assert.equal(r5.danjionApiBase(), 'https://api.example.test');
}

/* --- joinUrl: canonical base+path concatenation --- */
{
  assert.equal(Session.joinUrl('https://api.example.test', '/api/v1/me'), 'https://api.example.test/api/v1/me');
  assert.equal(Session.joinUrl('https://api.example.test/', '/api/v1/me'), 'https://api.example.test/api/v1/me');
  assert.equal(Session.joinUrl('', '/api/v1/me'), '/api/v1/me');
  assert.equal(Session.joinUrl('https://api.example.test', 'api/v1/me'), 'https://api.example.testapi/v1/me');
}

/* --- request: credentials include, JSON content-type on body, fail-closed --- */
{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return response(200, { data: { id: 'x' } });
  };
  const result = await Session.request(fetchImpl, 'https://api.example.test/api/v1/me', { method: 'GET' });
  assert.equal(result.ok, true);
  assert.equal(calls[0].init.credentials, 'include');
}

{
  const fetchImpl = async () => response(401, { error: { code: 'UNAUTHENTICATED' } });
  const result = await Session.request(fetchImpl, 'https://api.example.test/api/v1/me');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'auth-required');
  assert.equal(result.status, 401);
}

{
  const fetchImpl = async () => response(403, { error: { code: 'FORBIDDEN' } });
  const result = await Session.request(fetchImpl, 'https://api.example.test/api/v1/me');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'auth-required');
  assert.equal(result.status, 403);
}

{
  const fetchImpl = async () => response(500, { error: { code: 'INTERNAL' } });
  const result = await Session.request(fetchImpl, 'https://api.example.test/api/v1/me');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'server-error');
  assert.equal(result.status, 500);
}

{
  const fetchImpl = async () => { throw new Error('offline'); };
  const result = await Session.request(fetchImpl, 'https://api.example.test/api/v1/me');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'network-error');
  assert.equal(result.status, 0);
}

/* --- request: content-type header when body present --- */
{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return response(201, { data: { id: 'y' } });
  };
  await Session.request(fetchImpl, 'https://api.example.test/api/v1/me', {
    method: 'POST',
    body: JSON.stringify({ name: 'test' })
  });
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
}

/* --- createSessionFetch: pre-binds apiBase, delegates to request --- */
{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return response(200, { data: [] });
  };
  const sessionFetch = Session.createSessionFetch('https://api.example.test');
  const result = await sessionFetch(fetchImpl, '/api/v1/me/bookmarks', { method: 'GET' });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'https://api.example.test/api/v1/me/bookmarks');
  assert.equal(calls[0].init.credentials, 'include');
}

{
  const sessionFetch = Session.createSessionFetch('');
  const fetchImpl = async (url) => {
    assert.equal(url, '/api/v1/me');
    return response(200, { data: null });
  };
  await sessionFetch(fetchImpl, '/api/v1/me', { method: 'GET' });
}

console.log('PASS #324 danjion-session runtime contract');