import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [types, adapter, panel, portal, main] = await Promise.all([
  readFile(new URL('src/types.ts', root), 'utf8'),
  readFile(new URL('src/api/adapter.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2ActivityPanel.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2ActivityPortal.tsx', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

assert.match(types, /listMyActivity\(options\?: ActivityListOptions\): Promise<ActivityPage>/,
  'DataAdapter must expose typed Activity pagination');
assert.match(types, /title: string \| null/);
assert.match(types, /bodyPreview: string \| null/);

assert.match(adapter, /\/api\/v1\/me\/activity\?\$\{params\.toString\(\)\}/,
  'API adapter must call canonical resident Activity endpoint');
assert.match(adapter, /if \(options\.cursor\) params\.set\('cursor', options\.cursor\)/,
  'server opaque cursor must be forwarded verbatim');
assert.doesNotMatch(adapter, /localStorage|sessionStorage/,
  'Activity adapter must not create browser-storage authority');

assert.match(panel, /dataAdapter\.listMyActivity\(\{ type: 'all', limit: 5 \}\)/,
  'Activity should lazy-load from DataAdapter on panel mount');
assert.match(panel, /cursor: nextCursor/,
  'load-more must use the server-provided cursor');
assert.match(panel, /item\.title/);
assert.match(panel, /숨김 또는 삭제된 활동/,
  'redacted server data must render generically instead of being reconstructed');
assert.doesNotMatch(panel, /mock-content-store|mockPosts|localStorage|sessionStorage/,
  'Activity panel must not reconstruct backend-redacted content');

assert.match(portal, /\.v2-profile-dialog/,
  'Activity integration must remain scoped to the V2 My dialog');
assert.match(portal, /createPortal\(<V2ActivityPanel \/>, target\)/);
assert.match(main, /V2ActivityPortal/);
const v2Mount = main.match(/v2=\{<>([\s\S]*?)<\/>\}/)?.[1] ?? '';
assert.match(v2Mount, /<V2IntegratedApp \/>/,
  'V2 must retain the integrated product shell');
assert.match(v2Mount, /<V2ActivityPortal \/>/,
  'Activity portal must remain mounted inside the V2 fragment even as other V2 integrations are added');

console.log('PASS V2 resident Activity adapter/portal/redaction contract');
