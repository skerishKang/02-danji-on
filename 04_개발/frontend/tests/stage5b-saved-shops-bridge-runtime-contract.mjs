import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const source = await readFile(new URL('frontend/assets/saved-shops-bridge.js', root), 'utf8');

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    dump(key) { return data.get(key); }
  };
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return body; }
  };
}

function loadRuntime() {
  const context = { globalThis: null };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'saved-shops-bridge.js' });
  return context.DanJionSavedShopsBridge;
}

const Runtime = loadRuntime();
assert.ok(Runtime && typeof Runtime.create === 'function');

const id1 = 'd0a1c4a1-41c5-4c51-8001-000000000001';
const id2 = 'd0a1c4a1-41c5-4c51-8001-000000000002';

assert.equal(Runtime.businessIdForKey(`api-${id1}`), id1);
assert.equal(Runtime.businessIdForKey('florist'), null);
assert.equal(Runtime.businessIdForKey('api-not-a-uuid'), null);

// A successful server probe owns account state and ignores stale browser fixtures.
{
  const calls = [];
  const local = storage({ 'danjion:savedShops': JSON.stringify(['florist']) });
  const bridge = Runtime.create({
    apiBase: 'https://api.example.test/',
    storage: local,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(200, { data: [{ id: id1 }, { id: id2 }] });
    }
  });
  const state = await bridge.load();
  assert.equal(state.mode, 'server');
  assert.deepEqual([...state.keys].sort(), [`api-${id1}`, `api-${id2}`].sort());
  assert.equal(calls[0].url, 'https://api.example.test/api/v1/me/bookmarks');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(local.dump('danjion:savedShops'), JSON.stringify(['florist']),
    'server hydration must not rewrite legacy local storage');
}

// Canonical server mode fails closed on auth/permission errors instead of importing local state.
for (const [status, expectedMode] of [[401, 'auth-required'], [403, 'forbidden']]) {
  const local = storage({ 'danjion:savedShops': JSON.stringify(['florist']) });
  const bridge = Runtime.create({
    apiBase: 'https://api.example.test',
    storage: local,
    fetchImpl: async () => response(status, {})
  });
  const state = await bridge.load();
  assert.equal(state.mode, expectedMode);
  assert.deepEqual([...state.keys], []);
  assert.equal(bridge.isSaved('florist'), false);
  await assert.rejects(() => bridge.toggle('florist'), /server authority unavailable|server business id/);
  assert.equal(local.dump('danjion:savedShops'), JSON.stringify(['florist']),
    'failed server authority must never mutate browser bookmark state');
}

// Server/network failure is degraded + empty, never local account authority.
{
  const local = storage({ 'danjion:savedShops': JSON.stringify(['food']) });
  const bridge = Runtime.create({
    apiBase: 'https://api.example.test',
    storage: local,
    fetchImpl: async () => response(503, {})
  });
  const state = await bridge.load();
  assert.equal(state.mode, 'degraded');
  assert.deepEqual([...state.keys], []);
  await assert.rejects(() => bridge.toggle(`api-${id1}`), /server authority unavailable/);
  assert.equal(local.dump('danjion:savedShops'), JSON.stringify(['food']));
}

// Authenticated API-backed cards use POST/DELETE and never mutate localStorage.
{
  const methods = [];
  const local = storage({ 'danjion:savedShops': JSON.stringify(['florist']) });
  const bridge = Runtime.create({
    apiBase: 'https://api.example.test',
    storage: local,
    fetchImpl: async (url, init) => {
      methods.push([url, init.method, init.credentials]);
      if (init.method === 'GET') return response(200, { data: [] });
      return response(init.method === 'POST' ? 201 : 200, { data: { businessId: id1 } });
    }
  });
  await bridge.load();
  let result = await bridge.toggle(`api-${id1}`);
  assert.equal(result.saved, true);
  result = await bridge.toggle(`api-${id1}`);
  assert.equal(result.saved, false);
  assert.deepEqual(methods.slice(1).map((x) => x[1]), ['POST', 'DELETE']);
  assert.ok(methods.slice(1).every((x) => x[0].endsWith(`/api/v1/me/bookmarks/${id1}`) && x[2] === 'include'));
  assert.equal(local.dump('danjion:savedShops'), JSON.stringify(['florist']));
}

// Explicit no-api preview mode may retain the original local demo behavior.
{
  const local = storage();
  const bridge = Runtime.create({ apiBase: '', storage: local, fetchImpl: async () => { throw new Error('must not fetch'); } });
  const state = await bridge.load();
  assert.equal(state.mode, 'local');
  const result = await bridge.toggle('florist');
  assert.equal(result.saved, true);
  assert.equal(local.dump('danjion:savedShops'), JSON.stringify(['florist']));
}

console.log('PASS #738 saved shops Production server-authority contract');
