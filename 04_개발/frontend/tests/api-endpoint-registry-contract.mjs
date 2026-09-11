import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// #375 F7: the endpoint registry is the named source of truth for the
// cross-surface /api/v1 endpoint set (static sibling-v3 bridges, legacy V1
// clients, production V2 adapter). This contract re-verifies every registry
// claim against the actual consumer files so the registry cannot drift from
// reality. Additive: it pins the registry, not call-site wiring.

const root = new URL('../', import.meta.url);
const registry = await readFile(new URL('src/api/contract/endpoints.ts', root), 'utf8');

assert.match(registry, /export type ApiSurface/, 'registry must define the surface union type');
assert.match(registry, /export interface ApiEndpointEntry/, 'registry must define the entry contract');
assert.match(registry, /export const API_ENDPOINT_REGISTRY: readonly ApiEndpointEntry\[\]/,
  'registry export shape must stay stable for consumers');

const KNOWN_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function consumerFile(key) {
  if (key === 'adapter') return 'src/api/adapter.ts';
  if (key.startsWith('v1:')) return `src/${key.slice(3)}-client.ts`;
  if (key.startsWith('bridge:')) return `../../frontend/assets/${key.slice(7)}-bridge.js`;
  throw new Error(`unknown consumer key: ${key}`);
}

const entries = [...registry.matchAll(
  /path:\s*'([^']+)'\s*,\s*methods:\s*\[([^\]]*)\]\s*,\s*consumers:\s*\[([^\]]*)\]/g
)];
assert.ok(entries.length >= 13, `registry must cover the cross-surface endpoint set (found ${entries.length})`);

const seenPaths = new Set();
for (const match of entries) {
  const path = match[1];
  const methods = match[2].split(',').map((value) => value.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  const consumers = match[3].split(',').map((value) => value.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

  assert.ok(path.startsWith('/api/v1/'), `registry path must be a product API route: ${path}`);
  assert.ok(!seenPaths.has(path), `registry path must be unique: ${path}`);
  seenPaths.add(path);

  assert.ok(methods.length > 0, `registry entry must name methods: ${path}`);
  for (const method of methods) {
    assert.ok(KNOWN_METHODS.has(method), `registry method must be a known HTTP method: ${method} (${path})`);
  }

  assert.ok(consumers.length > 0, `registry entry must name at least one consumer: ${path}`);
  const uniqueConsumers = new Set(consumers);
  assert.equal(uniqueConsumers.size, consumers.length, `registry consumers must be unique: ${path}`);

  for (const consumer of consumers) {
    const relative = consumerFile(consumer);
    let content;
    try {
      content = await readFile(new URL(relative, root), 'utf8');
    } catch {
      assert.fail(`registry consumer file does not exist: ${consumer} -> ${relative} (${path})`);
    }
    assert.ok(
      content.includes(path),
      `registry drift: ${relative} no longer carries ${path} (declared consumer ${consumer})`
    );
  }
}

// The endpoints #373 explicitly cross-verified across surfaces must stay in
// the registry so the drift net cannot silently shrink below that baseline.
for (const baselinePath of [
  '/api/v1/me/business-applications',
  '/api/v1/me/shop-recommendations',
  '/api/v1/me/conversations',
  '/api/v1/household/family-invites/redeem'
]) {
  assert.ok(seenPaths.has(baselinePath), `registry must keep the #373-verified endpoint ${baselinePath}`);
}

console.log(`PASS endpoint/DTO registry consistency (${entries.length} endpoints, all consumer claims verified)`);
