import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/app.ts');
const storage = read('src/storage-v1.ts');
const frontendStorage = read('../frontend/src/storage.ts');
const docs = read('../docs/GOOGLE_DRIVE_STORAGE_v1.md');
const devVars = read('.dev.vars.example');

assert.ok(app.includes("import { handleStorageRequest } from './storage-v1';"));
assert.ok(app.indexOf('handleStorageRequest') < app.lastIndexOf('core.fetch'));
assert.ok(storage.includes("import { requireActor as requireCanonicalActor, type Actor } from './auth-v1';"));
assert.ok(storage.includes('await requireCanonicalActor(request, env, sql, requestId)'));
assert.equal(storage.includes('AUTH_ADAPTER_PENDING'), false, 'Track C storage must not retain the pre-Track-A pending auth path');
assert.equal(storage.includes('actorFromRequest'), false, 'Track C storage must not retain a duplicate actor resolver');
assert.ok(storage.includes('https://oauth2.googleapis.com/token'));
assert.ok(storage.includes('GOOGLE_DRIVE_REFRESH_TOKEN'));
assert.ok(storage.includes("path === '/api/v1/storage/public'"));
assert.ok(storage.includes("path === '/api/v1/storage/private'"));
assert.ok(storage.includes("parsed.visibility !== 'private' || parsed.kind !== 'resident-evidence'"));
assert.ok(storage.includes("['manager', 'admin'].includes(String(membership.role))"));
assert.ok(storage.includes("String(membership.verification_status) !== 'verified'"));
assert.ok(storage.includes("body: JSON.stringify({ trashed: true })"));
assert.equal(storage.includes('/permissions'), false, 'storage implementation must not create Drive public permissions');
assert.equal(storage.includes('webContentLink'), false, 'storage implementation must not expose Drive webContentLink');
assert.equal(storage.includes('webViewLink'), false, 'storage implementation must not expose Drive webViewLink');
assert.equal(frontendStorage.includes("export type StorageMode = 'mock' | 'drive'"), true);
assert.equal(frontendStorage.includes('R2StorageAdapter'), false);
assert.ok(frontendStorage.includes('gdrive/private/resident-evidence/'));
assert.ok(docs.includes('실제 주민 개인정보 파일은 smoke test에 사용하지 않는다'));
assert.ok(docs.includes('현재 Track에서는 R2 adapter, binding, bucket, deploy 설정을 구현하거나 활성화하지 않는다'));
assert.ok(devVars.includes('GOOGLE_DRIVE_CLIENT_SECRET=replace-with-oauth-client-secret'));
assert.ok(devVars.includes('GOOGLE_DRIVE_REFRESH_TOKEN=replace-with-refresh-token'));

console.log('PASS Google Drive storage contract, canonical auth integration and privacy boundary checks');
