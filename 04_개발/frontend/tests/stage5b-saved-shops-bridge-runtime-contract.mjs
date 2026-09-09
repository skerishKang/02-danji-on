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

// API-key parsing must never treat fallback fixture keys as canonical business IDs.
assert.equal(Runtime.businessIdForKey(`api-${id1}`), id1);
assert.equal(Runtime.businessIdForKey('florist'), null);
assert.equal(Runtime.businessIdForKey('api-not-a-uuid'), null);

// Authenticated GET 200 establishes server authority and ignores stale local fixture keys.
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
}

// 401/403 means unauthenticated local fallback, preserving sibling-v3 localStorage semantics.
for (const status of [401, 403]) {
  const local = storage({ 'danjion:savedShops': JSON.stringify(['florist']) });
  const bridge = Runtime.create({ apiBase: 'https://api.example.test', storage: local, fetchImpl: async () => response(status, {}) });
  const state = await bridge.load();
  assert.equal(state.mode, 'local');
  assert.equal(bridge.isSaved('florist'), true);
}

// Authenticated API-backed cards use POST/DELETE with UUID and never mutate localStorage.
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
  assert.equal(bridge.isSaved(`api-${id1}`), true);
  result = await bridge.toggle(`api-${id1}`);
  assert.equal(result.saved, false);
  assert.equal(bridge.isSaved(`api-${id1}`), false);
  assert.deepEqual(methods.slice(1).map((x) => x[1]), ['POST', 'DELETE']);
  assert.ok(methods.slice(1).every((x) => x[0].endsWith(`/api/v1/me/bookmarks/${id1}`) && x[2] === 'include'));
  assert.equal(local.dump('danjion:savedShops'), JSON.stringify(['florist']));
}

// Static fallback cards remain local even when the authenticated server probe succeeded.
{
  const local = storage();
  const bridge = Runtime.create({ apiBase: '', storage: local, fetchImpl: async () => response(200, { data: [] }) });
  await bridge.load();
  const result = await bridge.toggle('florist');
  assert.equal(result.saved, true);
  assert.equal(bridge.isSaved('florist'), true);
  assert.equal(local.dump('danjion:savedShops'), JSON.stringify(['florist']));
}

// Server/network failure is explicit degraded mode; existing local behavior remains available.
{
  const local = storage({ 'danjion:savedShops': JSON.stringify(['food']) });
  const bridge = Runtime.create({ apiBase: '', storage: local, fetchImpl: async () => response(503, {}) });
  const state = await bridge.load();
  assert.equal(state.mode, 'degraded');
  assert.equal(bridge.isSaved('food'), true);
  await bridge.toggle('food');
  assert.equal(JSON.parse(local.dump('danjion:savedShops')).length, 0);
}

console.log('PASS #278 saved shops server/local bridge runtime contract');
