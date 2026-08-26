import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/app.ts');
const storage = read('src/storage-v1.ts');
const frontendStorage = read('../frontend/src/storage.ts');
const docs = read('../docs/GOOGLE_DRIVE_STORAGE_v1.md');
const privacyHold = read('../docs/RESIDENT_EVIDENCE_STORAGE_PRIVACY_HOLD_20260827.md');
const uploadHold = read('../docs/RESIDENT_EVIDENCE_UPLOAD_POLICY_HOLD_20260827.md');
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

const uploadStart = storage.indexOf('async function upload(');
const uploadEnd = storage.indexOf('async function streamObject(', uploadStart);
assert.ok(uploadStart >= 0 && uploadEnd > uploadStart, 'upload block must exist');
const upload = storage.slice(uploadStart, uploadEnd);
const uploadAuthIndex = upload.indexOf('await requireStorageActor(request, env, requestId)');
const uploadHoldIndex = upload.indexOf("if (kind === 'resident-evidence')");
const uploadLegacyMembershipIndex = upload.indexOf('await membershipFor(auth.sql, auth.actor.id, complexSlug)');
const driveUploadIndex = upload.indexOf('await uploadDriveFile(env, validation.kind, file, auth.actor, complexSlug)');
assert.ok(uploadAuthIndex >= 0, 'storage upload must require canonical product authentication');
assert.ok(uploadHoldIndex > uploadAuthIndex, 'resident-evidence HOLD must execute only after canonical account authentication');
assert.ok(upload.includes("'RESIDENT_VERIFICATION_POLICY_HOLD'"), 'new resident-evidence persistence must fail closed under Issue #59');
assert.ok(uploadLegacyMembershipIndex > uploadHoldIndex,
  'resident-evidence HOLD must return before any historical complex-membership lookup can become evidence collection authority');
assert.ok(driveUploadIndex > uploadHoldIndex,
  'resident-evidence HOLD must return before the Google Drive persistence helper');
assert.ok(upload.indexOf('validateStorageUpload(kind, files)') > uploadHoldIndex,
  'held resident evidence must not enter the historical storage-kind validation/persistence workflow');
assert.ok(upload.includes("const kind = String(form.get('kind') || '').trim()"));
assert.ok(upload.includes('await uploadDriveFile(env, validation.kind, file, auth.actor, complexSlug)'),
  'business-image uploads must retain the existing validated Google Drive upload path');

const authorizeStart = storage.indexOf('async function authorizeObject(');
const authorizeEnd = storage.indexOf('async function upload(', authorizeStart);
assert.ok(authorizeStart >= 0 && authorizeEnd > authorizeStart, 'authorizeObject block must exist');
const authorize = storage.slice(authorizeStart, authorizeEnd);
const uploaderIndex = authorize.indexOf('props.danjionUploaderUserId === actor.id');
const holdIndex = authorize.indexOf("props.danjionKind === 'resident-evidence' || props.danjionVisibility === 'private'");
const legacyManagerIndex = authorize.indexOf("['manager', 'admin'].includes(String(membership.role))");
assert.ok(uploaderIndex >= 0, 'uploader self-access must remain explicit');
assert.ok(holdIndex > uploaderIndex, 'non-uploader resident evidence must hit policy HOLD after uploader self-access');
assert.ok(authorize.includes('RESIDENT_VERIFICATION_POLICY_HOLD'), 'resident evidence non-uploader access must fail closed under Issue #59');
assert.ok(legacyManagerIndex > holdIndex,
  'any historical legacy manager/admin fallback must occur only after the resident-evidence HOLD branch and therefore cannot authorize resident evidence');
assert.ok(authorize.includes("String(membership.verification_status) !== 'verified'"));

const streamStart = storage.indexOf('async function streamObject(');
const streamEnd = storage.indexOf('async function removeObject(', streamStart);
const streamBlock = storage.slice(streamStart, streamEnd);
assert.ok(streamBlock.includes('const denied = await authorizeObject(auth.sql, auth.actor, metadata, requestId)'),
  'private evidence read must use the current fail-closed object authorization boundary');

const removeStart = storage.indexOf('async function removeObject(');
const removeEnd = storage.indexOf('export async function handleStorageRequest', removeStart);
const removeBlock = storage.slice(removeStart, removeEnd);
assert.ok(removeBlock.includes('const denied = await authorizeObject(auth.sql, auth.actor, metadata, requestId)'),
  'resident evidence delete/trash must use the same current fail-closed object authorization boundary');
assert.ok(storage.includes("body: JSON.stringify({ trashed: true })"));

assert.equal(storage.includes('/permissions'), false, 'storage implementation must not create Drive public permissions');
assert.equal(storage.includes('webContentLink'), false, 'storage implementation must not expose Drive webContentLink');
assert.equal(storage.includes('webViewLink'), false, 'storage implementation must not expose Drive webViewLink');
assert.equal(frontendStorage.includes("export type StorageMode = 'mock' | 'drive'"), true);
assert.equal(frontendStorage.includes('R2StorageAdapter'), false);
assert.ok(frontendStorage.includes('gdrive/private/resident-evidence/'));
assert.ok(docs.includes('실제 주민 개인정보 파일은 smoke test에 사용하지 않는다'));
assert.ok(docs.includes('현재 Track에서는 R2 adapter, binding, bucket, deploy 설정을 구현하거나 활성화하지 않는다'));
assert.ok(privacyHold.includes('RESIDENT_EVIDENCE_NON_UPLOADER -> POLICY_HOLD_DENY'));
assert.ok(privacyHold.includes('LEGACY_MANAGER_ADMIN != RESIDENT_EVIDENCE_AUTHORITY'));
assert.ok(privacyHold.includes('PADIEM_OR_COUNCIL_OPERATIONAL_SCOPE != RESIDENT_EVIDENCE_ACCESS'));
assert.ok(uploadHold.includes('ISSUE_59_OPEN -> NEW_RESIDENT_EVIDENCE_PERSISTENCE_DENY'));
assert.ok(uploadHold.includes('BUSINESS_IMAGE_UPLOAD != RESIDENT_EVIDENCE_UPLOAD'));
assert.ok(uploadHold.includes('PREEXISTING_UPLOADER_SELF_ACCESS != NEW_EVIDENCE_COLLECTION_AUTHORITY'));
assert.ok(devVars.includes('GOOGLE_DRIVE_CLIENT_SECRET=replace-with-oauth-client-secret'));
assert.ok(devVars.includes('GOOGLE_DRIVE_REFRESH_TOKEN=replace-with-refresh-token'));

console.log('PASS Google Drive storage contract, canonical auth integration, evidence access HOLD and new evidence persistence HOLD');
