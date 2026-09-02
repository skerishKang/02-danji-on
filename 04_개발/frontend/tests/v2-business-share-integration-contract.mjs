import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [types, adapter, integration, main] = await Promise.all([
  readFile(new URL('src/types.ts', root), 'utf8'),
  readFile(new URL('src/api/adapter.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2BusinessShareIntegration.tsx', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

assert.match(types, /interface BusinessShareRef/);
assert.match(types, /getBusinessShare\(id: string\): Promise<BusinessShareRef>/);
assert.match(types, /resolveBusinessShare\(shareSlug: string\): Promise<BusinessShareRef>/);

assert.match(adapter, /businesses\/\$\{id\}\/share`, undefined, \{ auth: false \}/,
  'UUID -> share resolver must be public');
assert.match(adapter, /businesses\/share\/\$\{encodeURIComponent\(shareSlug\)\}`, undefined, \{ auth: false \}/,
  'share slug -> UUID resolver must be public and encode the opaque slug');
assert.match(adapter, /return mapBusinessShare\(row\)/);

assert.match(integration, /searchParams\.set\('shop', reference\.shareSlug\)/,
  'shared URL must use the opaque backend share slug');
assert.match(integration, /dataAdapter\.resolveBusinessShare\(shareSlug!\)/,
  'incoming share link must resolve through backend authority');
assert.match(integration, /element\.dataset\.shopId === businessId/,
  'resolved UUID/id must target the canonical rendered shop card');
assert.match(integration, /textContent\?\.trim\(\) === '상세보기'/,
  'deep link must reopen the existing canonical detail action');
assert.match(integration, /navigator\.clipboard\.writeText\(url\)/,
  'share action should copy the stable link when clipboard is available');
assert.doesNotMatch(integration, /localStorage|sessionStorage/,
  'share links must not create browser-storage authority');
assert.doesNotMatch(integration, /find\([^\n]*businessName|includes\([^\n]*businessName|businessName[^\n]*===/,
  'incoming share resolution must not fall back to mutable business name');

assert.match(main, /V2BusinessShareIntegration/);
assert.match(main, /<V2BusinessShareIntegration \/>/,
  'share integration must mount only with the V2 surface');

console.log('PASS V2 stable business share link/deep-link contract');
