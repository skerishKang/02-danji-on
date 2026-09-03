import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [client, store, panel, adminApp, adminApi, residentClient] = await Promise.all([
  readFile(new URL('src/resident-news-admin-client.ts', root), 'utf8'),
  readFile(new URL('src/mock-resident-news-store.ts', root), 'utf8'),
  readFile(new URL('src/ResidentNewsReviewPanel.tsx', root), 'utf8'),
  readFile(new URL('src/AdminApp.tsx', root), 'utf8'),
  readFile(new URL('src/admin-api.ts', root), 'utf8'),
  readFile(new URL('src/resident-news-client.ts', root), 'utf8')
]);

assert.match(client, /import \{ authenticatedFetch \} from '\.\/auth-fetch'/,
  'operator resident-news client must use canonical authenticated fetch');
assert.match(client, /authenticatedFetch\([\s\S]*'admin'\)/,
  'operator resident-news client must use the admin auth surface');
assert.match(client, /\/api\/v1\/operator\/complexes\/\$\{encodeURIComponent\(COMPLEX_SLUG\)\}\/resident-news\/submissions/,
  'operator queue and mutations must use the merged resident-news operator backend');
assert.doesNotMatch(client, /localStorage|sessionStorage|indexedDB/i,
  'operator resident-news authority must not use browser persistence');
assert.doesNotMatch(store, /localStorage|sessionStorage|indexedDB/i,
  'mock resident-news parity must remain in-memory only');
assert.match(store, /status: 'submitted'/);
assert.match(store, /status: 'reviewing'/);
assert.match(store, /status: 'approved'/);
assert.match(store, /status: 'rejected'/);
assert.match(store, /reviewMockResidentNewsSubmission/);
assert.match(store, /posts = \[[\s\S]*title:/,
  'mock approval must materialize a resident-only published post');

assert.match(panel, /주민소식 검토/);
assert.match(panel, /submitted/);
assert.match(panel, /reviewing/);
assert.match(panel, /approved/);
assert.match(panel, /rejected/);
assert.match(panel, /검토 시작/);
assert.match(panel, /승인·게시/);
assert.match(panel, /반려/);
assert.match(panel, /운영자 검토 메모/);
assert.match(panel, /publishedTitle/);
assert.match(panel, /publishedBody/);
assert.match(panel, /await load\(status\)/,
  'operator queue must refresh from the canonical adapter after each mutation');
assert.doesNotMatch(panel, /building|unit|household|proof|동호|세대코드/i,
  'operator queue UI must not surface residence or proof fields');

assert.match(adminApp, /ResidentNewsReviewPanel/,
  'AdminApp must mount the resident-news review surface');
assert.match(adminApp, /residentNews/,
  'AdminApp must expose a resident-news review tab');
assert.match(adminApi, /\/api\/v1\/admin\/complexes\/\$\{COMPLEX_SLUG\}\/posts/,
  'official complex post publishing must remain on its existing API');
assert.doesNotMatch(client, /\/api\/v1\/admin\/complexes\/.*\/posts/,
  'resident-news approval must never write public official complex posts');
assert.doesNotMatch(residentClient, /resident_news\.review|council\.resident_news\.review|\/operator\//,
  'resident client must remain free of operator authority');

console.log('PASS resident-news operator queue/review/publish privacy and mock-parity contract');
