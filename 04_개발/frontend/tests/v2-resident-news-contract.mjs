import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const client = readFileSync(path.join(root, 'src/resident-news-client.ts'), 'utf8');
const portal = readFileSync(path.join(root, 'src/v2/integration/V2ResidentNewsPortal.tsx'), 'utf8');
const main = readFileSync(path.join(root, 'src/main.tsx'), 'utf8');

function requireText(source, text, label) {
  if (!source.includes(text)) throw new Error(`Missing ${label}: ${text}`);
}

requireText(client, "authenticatedFetch", 'authenticated resident client');
requireText(client, "/resident-news", 'resident-news endpoint');
requireText(client, "/api/v1/me/resident-news/submissions", 'own submission endpoint');
requireText(client, "VITE_DATA_MODE === 'api'", 'API-mode boundary');
requireText(portal, 'data-v2-resident-news-entry', 'resident-news V2 entry');
requireText(portal, 'data-v2-resident-news-list', 'resident-news list');
requireText(portal, 'data-v2-resident-news-detail', 'resident-news detail');
requireText(portal, 'data-v2-resident-news-submit', 'resident submission form');
requireText(portal, 'data-v2-resident-news-mine', 'own submission status');
requireText(portal, '운영 확인 전 주민소식 피드에 노출되지 않습니다', 'pre-publication explanation');
requireText(main, "V2ResidentNewsPortal", 'V2 resident-news mount');

for (const forbidden of ['localStorage', 'sessionStorage', 'publicComplexNewsClient', 'complex_posts', 'reviewNote']) {
  if (client.includes(forbidden) || portal.includes(forbidden)) {
    throw new Error(`Resident-news V2 authority must not depend on ${forbidden}`);
  }
}

if (/input[^>]+type=["']file["']/i.test(portal) || /storageAdapter|upload/i.test(portal)) {
  throw new Error('Resident-news attachments must remain out of scope until upload policy is decided');
}

console.log('PASS v2 resident-news contract: authenticated canonical routes, isolated resident publication, no browser-storage/public-news authority');
