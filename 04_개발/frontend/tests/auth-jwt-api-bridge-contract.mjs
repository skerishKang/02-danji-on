import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [bridge, client, auth, adapter, admin, verification, storage] = await Promise.all([
  read('src/auth-fetch.ts'),
  read('src/auth-client.ts'),
  read('src/auth.ts'),
  read('src/api/adapter.ts'),
  read('src/admin-api.ts'),
  read('src/verification-api.ts'),
  read('src/storage.ts')
]);

assert.match(bridge, /getProductApiBearerToken/);
assert.match(bridge, /authorization.*Bearer/si);
assert.match(bridge, /first\.status !== 401/);
assert.match(bridge, /clearProductApiBearerTokenCache/);
assert.match(bridge, /TOKEN_CACHE_MAX_AGE_MS/);
assert.doesNotMatch(bridge, /localStorage|sessionStorage/, 'JWT must not be persisted in browser storage');

assert.match(client, /danjionAuthClient\.token\(\)/, 'bridge source must be Better Auth JWT endpoint');
assert.match(auth, /Danjion Better Auth requires the async JWT bridge/, 'sync Danjion auth path must remain fail-closed');

assert.match(adapter, /authenticatedFetch\(target, requestInit, 'resident'\)/);
assert.match(adapter, /options\.auth === false\s*\? await fetch\(target, requestInit\)/, 'public product reads must not require a bearer token');
assert.doesNotMatch(adapter, /authProvider\.headers\('resident'\)/);

assert.match(admin, /authenticatedFetch[\s\S]*'admin'/);
assert.doesNotMatch(admin, /authProvider\.headers\('admin'\)/);

assert.match(verification, /authenticatedFetch[\s\S]*scope/);
assert.doesNotMatch(verification, /authProvider\.headers\(scope\)/);

assert.match(storage, /authenticatedFetch\(storageUrl\('\/api\/v1\/storage\/objects'\)/);
assert.match(storage, /endpoint\.endsWith\('\/private'\)[\s\S]*authenticatedFetch/);
assert.match(storage, /: await fetch\(url\)/, 'public Drive object reads must stay unauthenticated');
assert.doesNotMatch(storage, /authProvider\.headers\('resident'\)/);

console.log('PASS Better Auth JWT -> Danjion protected API bridge contract');
