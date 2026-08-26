import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/app.ts');
const storage = read('src/storage-v1.ts');
const residentEconomy = read('src/resident-economy-v2.ts');
const frontendStorage = read('../frontend/src/storage.ts');
const docs = read('../docs/GOOGLE_DRIVE_STORAGE_v1.md');
const privacyHold = read('../docs/RESIDENT_EVIDENCE_STORAGE_PRIVACY_HOLD_20260827.md');
const uploadHold = read('../docs/RESIDENT_EVIDENCE_UPLOAD_POLICY_HOLD_20260827.md');
const businessMediaAuthz = read('../docs/BUSINESS_MEDIA_STORAGE_AUTHZ_CURRENT_20260827.md');
const devVars = read('.dev.vars.example');

assert.ok(app.includes("import { handleStorageRequest } from './storage-v1';"));
assert.ok(app.indexOf('handleStorageRequest') < app.lastIndexOf('core.fetch'));
assert.ok(storage.includes("import { requireActor as requireCanonicalActor, type Actor } from './auth-v1';"));
assert.ok(storage.includes("import { requireVerifiedResident } from './authorization-v2';"));
assert.ok(storage.includes('await requireCanonicalActor(request, env, sql, requestId)'));
assert.equal(storage.includes('AUTH_ADAPTER_PENDING'), false, 'storage must not retain the pre-Track-A pending auth path');
assert.equal(storage.includes('actorFromRequest'), false, 'storage must not retain a duplicate actor resolver');
assert.equal(storage.includes('complex_memberships'), false,
  'current storage runtime must not use historical complex_memberships as mutation authority');
assert.equal(storage.includes('membershipFor('), false,
  'historical storage membership helper must be removed');
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
const uploadValidationIndex = upload.indexOf('validateStorageUpload(kind, files)');
const verifiedResidentIndex = upload.indexOf('await requireVerifiedResident(request, env, auth.sql, requestId, complexSlug)');
const driveUploadIndex = upload.indexOf('await uploadDriveFile(env, validation.kind, file, resident, resident.complexSlug)');
assert.ok(uploadAuthIndex >= 0, 'storage upload must require canonical product authentication');
assert.ok(uploadHoldIndex > uploadAuthIndex, 'resident-evidence HOLD must execute only after canonical account authentication');
assert.ok(upload.includes("'RESIDENT_VERIFICATION_POLICY_HOLD'"), 'new resident-evidence persistence must fail closed under Issue #59');
assert.ok(uploadValidationIndex > uploadHoldIndex,
  'held resident evidence must not enter storage validation/persistence workflow');
assert.ok(verifiedResidentIndex > uploadValidationIndex,
  'business-image upload must require current Household-v2 verified resident after payload validation');
assert.ok(driveUploadIndex > verifiedResidentIndex,
  'Google Drive persistence must occur only after current verified-resident authorization');
assert.ok(upload.includes("const kind = String(form.get('kind') || '').trim()"));
assert.ok(upload.includes('const resident = residentOrResponse;'));
assert.ok(residentEconomy.includes('await requireVerifiedResident(request, env, sql, requestId, input.complexSlug)'),
  'business application create must retain the same current verified-resident authority family');

const authorizeStart = storage.indexOf('async function authorizeObject(');
const authorizeEnd = storage.indexOf('async function upload(', authorizeStart);
assert.ok(authorizeStart >= 0 && authorizeEnd > authorizeStart, 'authorizeObject block must exist');
const authorize = storage.slice(authorizeStart, authorizeEnd);
const uploaderIndex = authorize.indexOf('props.danjionUploaderUserId === actor.id');
const holdIndex = authorize.indexOf("props.danjionKind === 'resident-evidence' || props.danjionVisibility === 'private'");
const businessDenyIndex = authorize.indexOf("'Only the storage uploader may mutate this business image until explicit media moderation authority is defined'");
assert.ok(uploaderIndex >= 0, 'uploader self-access must remain explicit');
assert.ok(holdIndex > uploaderIndex, 'non-uploader resident evidence must hit policy HOLD after uploader self-access');
assert.ok(authorize.includes('RESIDENT_VERIFICATION_POLICY_HOLD'), 'resident evidence non-uploader access must fail closed under Issue #59');
assert.ok(businessDenyIndex > holdIndex,
  'non-uploader business media must fail after preserving the stronger resident-evidence HOLD');
assert.equal(authorize.includes("['manager', 'admin']"), false,
  'legacy manager/admin must not be business-media mutation authority');
assert.equal(authorize.includes('requireOperationalAuthority'), false,
  'application-review scopes must not be silently widened into storage media-delete authority');

const streamStart = storage.indexOf('async function streamObject(');
const streamEnd = storage.indexOf('async function removeObject(', streamStart);
const streamBlock = storage.slice(streamStart, streamEnd);
assert.ok(streamBlock.includes('const denied = await authorizeObject(auth.actor, metadata, requestId)'),
  'private evidence read must use the current fail-closed object authorization boundary');
assert.ok(streamBlock.includes("parsed.visibility !== 'public' || parsed.kind !== 'business-image'"),
  'public business-image read route must remain public-display-only');

const removeStart = storage.indexOf('async function removeObject(');
const removeEnd = storage.indexOf('export async function handleStorageRequest', removeStart);
const removeBlock = storage.slice(removeStart, removeEnd);
assert.ok(removeBlock.includes('const denied = await authorizeObject(auth.actor, metadata, requestId)'),
  'all storage delete/trash mutations must use uploader/HOLD/current deny boundary');
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
assert.ok(businessMediaAuthz.includes('BUSINESS_IMAGE_UPLOAD_AUTHZ == HOUSEHOLD_V2_VERIFIED_RESIDENT'));
assert.ok(businessMediaAuthz.includes('LEGACY_COMPLEX_MEMBERSHIP != BUSINESS_MEDIA_STORAGE_AUTHORITY'));
assert.ok(businessMediaAuthz.includes('LEGACY_MANAGER_ADMIN != BUSINESS_MEDIA_DELETE_AUTHORITY'));
assert.ok(businessMediaAuthz.includes('PUBLIC_MEDIA_READ != PUBLIC_MEDIA_MUTATION'));
assert.ok(devVars.includes('GOOGLE_DRIVE_CLIENT_SECRET=replace-with-oauth-client-secret'));
assert.ok(devVars.includes('GOOGLE_DRIVE_REFRESH_TOKEN=replace-with-refresh-token'));

console.log('PASS Google Drive storage contract, evidence HOLD and current Household-v2 business-media authorization');
