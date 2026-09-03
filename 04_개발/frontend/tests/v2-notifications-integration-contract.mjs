import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [client, panel, portal, residentNewsPortal, main] = await Promise.all([
  readFile(new URL('src/resident-notifications-client.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2NotificationsPanel.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2NotificationsPortal.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2ResidentNewsPortal.tsx', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

assert.match(client, /\/api\/v1\/me\/notifications'/,
  'notification feed must use the canonical resident notification endpoint');
assert.match(client, /\/api\/v1\/me\/notifications\/\$\{encodeURIComponent\(id\)\}\/read/,
  'single-item read state must round-trip through the backend');
assert.match(client, /\/api\/v1\/me\/notifications\/read-all/,
  'read-all must round-trip through the backend');
assert.match(client, /authenticatedFetch\(/,
  'API notification reads/writes must use the resident authenticated session');
assert.doesNotMatch(client, /localStorage|sessionStorage|indexedDB/i,
  'API notification authority must not be reconstructed in browser persistence');
assert.match(client, /resource: \{ type: 'resident_news', id: '00000000-0000-4000-8000-000000000281' \}/,
  'mock notification must mirror the resident-news backend resource contract');

assert.match(panel, /data-v2-notifications-panel/);
assert.match(panel, /residentNotificationsClient\.list\(\)/);
assert.match(panel, /residentNotificationsClient\.markRead\(item\.id\)/);
assert.match(panel, /residentNotificationsClient\.markAllRead\(\)/);
assert.match(panel, /item\.resource\?\.type !== 'conversation'/,
  'conversation navigation must stay explicitly allowlisted');
assert.match(panel, /item\.resource\?\.type !== 'resident_news'/,
  'resident-news navigation must be a second explicit allowlist branch');
assert.match(panel, /UUID_RE\.test\(item\.resource\.id\)/,
  'all navigable resource IDs must be canonical UUIDs before internal navigation');
assert.match(panel, /new CustomEvent\('danjion:v2-open-conversation'/,
  'known conversation resources must map to the internal V2 conversation event');
assert.match(panel, /new CustomEvent\('danjion:v2-open-resident-news'/,
  'resident-news resources must map to the internal verified-resident news event');
assert.match(panel, /주민소식 열기/,
  'resident-news notifications must expose an explicit destination action');
assert.doesNotMatch(panel, /window\.location\s*=|location\.href\s*=|target=_blank|javascript:/i,
  'notification resource data must never become arbitrary external navigation');

assert.match(residentNewsPortal, /addEventListener\('danjion:v2-open-resident-news'/,
  'resident-news portal must listen only to the internal allowlisted event');
assert.match(residentNewsPortal, /UUID_RE\.test\(postId\)/,
  'resident-news portal must reject malformed event IDs before loading detail');
assert.match(residentNewsPortal, /residentNewsClient\.getPost\(postId\)/,
  'notification navigation must still resolve detail through resident backend authority');

assert.match(portal, /\.v2-profile-dialog/,
  'notifications must remain scoped to the existing My DanjiOn dialog');
assert.match(portal, /createPortal\(<V2NotificationsPanel \/>, target\)/);
assert.match(main, /V2NotificationsPortal/);
assert.match(main, /V2ResidentNewsPortal/);
assert.match(main, /v2=\{<>[\s\S]*<V2IntegratedApp \/>[\s\S]*<V2NotificationsPortal \/>[\s\S]*<\/\>\}/,
  'notifications portal must mount only in the V2 surface');

console.log('PASS V2 resident notifications backend-authority/conversation/resident-news deep-link contract');
