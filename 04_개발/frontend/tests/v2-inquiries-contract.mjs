import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [client, portal, main] = await Promise.all([
  readFile(new URL('src/resident-inquiries-client.ts', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2InquiriesPortal.tsx', root), 'utf8'),
  readFile(new URL('src/main.tsx', root), 'utf8')
]);

assert.match(client, /\/api\/v1\/me\/inquiries\?complexSlug=/);
assert.match(client, /\/api\/v1\/me\/inquiries'/,
  'create must use canonical resident inquiry collection');
assert.match(client, /status: 'closed'/,
  'resident close must use canonical answered->closed transition');
assert.match(client, /authenticatedFetch\(/);
assert.doesNotMatch(client, /localStorage|sessionStorage|indexedDB/i);
assert.match(client, /inquiryType\.length > 64/);
assert.match(client, /title\.length > 160/);
assert.match(client, /body\.length > 10000/);

assert.match(portal, /data-v2-inquiries-panel/);
assert.match(portal, /residentInquiriesClient\.list\(\)/);
assert.match(portal, /residentInquiriesClient\.create/);
assert.match(portal, /residentInquiriesClient\.get\(id\)/);
assert.match(portal, /residentInquiriesClient\.close\(selected\.id\)/);
assert.doesNotMatch(portal, /file|attachment|objectKey|building|unitCode|buildingCode|provider/i,
  'V2 inquiry slice must not invent attachment policy or expose residence/provider identity');
assert.match(main, /V2InquiriesPortal/);

console.log('PASS V2 resident inquiry lifecycle authority/privacy contract');
