import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [client, portal, main, backend] = await Promise.all([
  readFile(new URL('src/resident-account-lifecycle-client.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2AccountClosurePortal.tsx', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8'),
  readFile(new URL('../backend/src/account-lifecycle-v1.ts', root), 'utf8')
]);

assert.match(client, /DANJION_ACCOUNT_CLOSE_CONFIRMATION = 'CLOSE_DANJION_ACCOUNT'/);
assert.match(client, /\/api\/v1\/me\/account\/close/);
assert.match(client, /method: 'POST'/);
assert.match(client, /JSON\.stringify\(\{ confirm \}\)/);
assert.match(client, /authenticatedFetch\(/);
assert.match(client, /authProviderAccountDeleted: false/,
  'mock contract must preserve provider-account non-deletion semantics');
assert.doesNotMatch(client, /deleteProvider|deleteOauth|deleteOAuth|unlinkProvider|removeProvider/i,
  'frontend must not invent an external auth-provider deletion operation');

assert.match(portal, /confirmation\.trim\(\) !== DANJION_ACCOUNT_CLOSE_CONFIRMATION/,
  'destructive submit must stay disabled until the exact backend confirmation is entered');
assert.match(portal, /외부 로그인 제공자 계정은 삭제하지 않습니다/);
assert.match(portal, /residentAccountLifecycleClient\.closeProductAccount\(confirmation\)/);
assert.match(portal, /data-v2-account-closure-complete/);
assert.match(main, /V2AccountClosurePortal/);

assert.match(backend, /const CLOSE_CONFIRMATION = 'CLOSE_DANJION_ACCOUNT'/);
assert.match(backend, /path === '\/api\/v1\/me\/account\/close'/);
assert.match(backend, /authProviderAccountDeleted: false/);
assert.match(backend, /PRODUCT_ACCOUNT_CLOSED/);

console.log('PASS V2 explicit product-account closure/provider boundary contract');
