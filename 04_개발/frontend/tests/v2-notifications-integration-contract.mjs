import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [client, panel, portal, main] = await Promise.all([
  readFile(new URL('src/resident-notifications-client.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2NotificationsPanel.tsx', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2NotificationsPortal.tsx', root), 'utf8'),
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

assert.match(panel, /data-v2-notifications-panel/);
assert.match(panel, /residentNotificationsClient\.list\(\)/);
assert.match(panel, /residentNotificationsClient\.markRead\(item\.id\)/);
assert.match(panel, /residentNotificationsClient\.markAllRead\(\)/);
assert.match(panel, /item\.resource\?\.type !== 'conversation'/,
  'resource navigation must be allowlisted rather than interpreting arbitrary backend URLs');
assert.match(panel, /UUID_RE\.test\(item\.resource\.id\)/,
  'conversation resource IDs must be canonical UUIDs before internal navigation');
assert.match(panel, /new CustomEvent\('danjion:v2-open-conversation'/,
  'known conversation resources must map to the internal V2 conversation event');
assert.doesNotMatch(panel, /window\.location\s*=|location\.href\s*=|target=_blank|javascript:/i,
  'notification resource data must never become arbitrary external navigation');

assert.match(portal, /\.v2-profile-dialog/,
  'notifications must remain scoped to the existing My DanjiOn dialog');
assert.match(portal, /createPortal\(<V2NotificationsPanel \/>, target\)/);
assert.match(main, /V2NotificationsPortal/);
assert.match(main, /v2=\{<>[\s\S]*<V2IntegratedApp \/>[\s\S]*<V2NotificationsPortal \/>[\s\S]*<\/\>\}/,
  'notifications portal must mount only in the V2 surface');

console.log('PASS V2 resident notifications backend-authority/deep-link contract');
