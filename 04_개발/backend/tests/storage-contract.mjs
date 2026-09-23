import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/app.ts');
const storage = read('src/storage-v1.ts');
const uploadV2 = read('src/storage-upload-v2.ts');
const executableStorage = storage.replace(/^\s*\/\/.*$/gm, '');
const residentEconomy = read('src/resident-economy-v2.ts');
const frontendStorage = read('../frontend/src/storage.ts');
const docs = read('../docs/GOOGLE_DRIVE_STORAGE_v1.md');
const privacyHold = read('../docs/RESIDENT_EVIDENCE_STORAGE_PRIVACY_HOLD_20260827.md');
const uploadHold = read('../docs/RESIDENT_EVIDENCE_UPLOAD_POLICY_HOLD_20260827.md');
const businessMediaAuthz = read('../docs/BUSINESS_MEDIA_STORAGE_AUTHZ_CURRENT_20260827.md');
const atomicityArchitecture = read('../docs/BUSINESS_IMAGE_CROSS_SYSTEM_ATOMICITY_ARCHITECTURE_20260827.md');
const lifecycleMigration = read('migrations/019_business_image_lifecycle_registry.sql');
const devVars = read('.dev.vars.example');

assert.ok(app.includes("import { handleStorageRequest } from './storage-v1';"));
assert.ok(app.indexOf('handleStorageRequest') < app.lastIndexOf('core.fetch'));
assert.ok(storage.includes("import { requireActor as requireCanonicalActor, type Actor } from './auth-v1';"));
// #372 D2 / #375 F6: the verified-resident upload authority now belongs to the
// tracked upload lane; storage-v1 no longer hosts the generic upload path.
assert.ok(uploadV2.includes("import { requireVerifiedResident } from './authorization-v2';"));
assert.ok(storage.includes('await requireCanonicalActor(request, env, sql, requestId)'));
assert.equal(executableStorage.includes('AUTH_ADAPTER_PENDING'), false, 'storage must not retain the pre-Track-A pending auth path');
assert.equal(executableStorage.includes('actorFromRequest'), false, 'storage must not retain a duplicate actor resolver');
assert.equal(executableStorage.includes('complex_memberships'), false,
  'current storage executable runtime must not use historical complex_memberships as mutation authority');
assert.equal(executableStorage.includes('membershipFor('), false,
  'historical storage membership helper must be removed from executable runtime');
assert.ok(storage.includes('https://oauth2.googleapis.com/token'));
assert.ok(storage.includes('GOOGLE_DRIVE_REFRESH_TOKEN'));
assert.ok(storage.includes("path === '/api/v1/storage/public'"));
assert.ok(storage.includes("path === '/api/v1/storage/private'"));
assert.ok(storage.includes("parsed.visibility !== 'private' || parsed.kind !== 'resident-evidence'"));

// #372 D2 / #375 F6: POST /api/v1/storage/objects is owned exclusively by the
// tracked upload lane (storage-upload-v2). The generic upload path on the
// storage route owner was dead and is removed; the upload ordering contract is
// pinned against the live tracked-upload lane instead.
assert.equal(storage.includes('async function upload('), false,
  'storage route owner must not retain the dead generic upload path');
const storageRouteStart = storage.indexOf('export async function handleStorageRequest');
const storageRouteBlock = storage.slice(storageRouteStart);
assert.equal(storageRouteBlock.includes("request.method === 'POST'"), false,
  'storage route owner must no longer accept POST /api/v1/storage/objects');
assert.ok(app.indexOf('handleTrackedStorageUploadRequest') < app.indexOf('handleStorageRequest'),
  'tracked upload lane must intercept storage routes before the storage route owner');

const uploadHandlerStart = uploadV2.indexOf('export async function handleTrackedStorageUploadRequest(');
assert.ok(uploadHandlerStart >= 0, 'tracked upload handler must exist');
const upload = uploadV2.slice(uploadHandlerStart);
const uploadAuthIndex = upload.indexOf('await requireCanonicalActor(request, env, sql, requestId)');
const uploadHoldIndex = upload.indexOf("if (kind === 'resident-evidence')");
const uploadValidationIndex = upload.indexOf('validateStorageUpload(kind, files)');
const verifiedResidentIndex = upload.indexOf('await requireVerifiedResident(request, env, sql, requestId, complexSlug)');
const idempotencyIndex = upload.indexOf("request.headers.get('idempotency-key')");
const businessImageGateIndex = upload.indexOf("if (validation.kind === 'business-image')");
const trackedUploadIndex = upload.indexOf('await runTrackedBusinessImageUpload(');
assert.ok(uploadAuthIndex >= 0, 'storage upload must require canonical product authentication');
assert.ok(uploadHoldIndex > uploadAuthIndex, 'resident-evidence HOLD must execute only after canonical account authentication');
assert.ok(upload.includes("'RESIDENT_VERIFICATION_POLICY_HOLD'"), 'new resident-evidence persistence must fail closed under Issue #59');
assert.ok(uploadValidationIndex > uploadHoldIndex,
  'held resident evidence must not enter storage validation/persistence workflow');
assert.ok(verifiedResidentIndex > uploadValidationIndex,
  'business-image upload must require current Household-v2 verified resident after payload validation');
assert.ok(idempotencyIndex > verifiedResidentIndex,
  'idempotency key validation must occur only after verified-resident authorization');
assert.ok(businessImageGateIndex > idempotencyIndex,
  'kind routing must remain after idempotency validation');
assert.ok(trackedUploadIndex > businessImageGateIndex,
  'business-image persistence must run through the tracked lifecycle upload runtime');
assert.ok(upload.includes('await runTrackedApplicationDocumentUpload('),
  'application-document uploads must remain on the tracked lane');
assert.ok(upload.includes("const kind = String(form.get('kind') || '').trim()"));
assert.ok(upload.includes("const complexSlug = String(form.get('complexSlug') || '').trim()"));
assert.ok(residentEconomy.includes('await requireVerifiedResident(request, env, sql, requestId, input.complexSlug)'),
  'business application create must retain the same current verified-resident authority family');

const authorizeStart = storage.indexOf('async function authorizeObject(');
const authorizeEnd = storage.indexOf('async function streamObject(', authorizeStart);
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
const streamEnd = storage.indexOf('async function trashBusinessImageAndFinalize(', streamStart);
const streamBlock = storage.slice(streamStart, streamEnd);
assert.ok(streamBlock.includes('const denied = await authorizeObject(auth.actor, metadata, requestId)'),
  'private evidence read must use the current fail-closed object authorization boundary');
assert.ok(streamBlock.includes("parsed.visibility !== 'public'") &&
  streamBlock.includes("parsed.kind !== 'business-image' && parsed.kind !== 'official-news-image'"),
  'public read route must remain public-display-only (business-image plus the #844 official-news public kind)');
assert.ok(streamBlock.includes('officialNewsImagePubliclyVisible(env, parsed.objectKey, requestId)'),
  '#844: official-news images are streamed publicly only while an active object is referenced by a published post');

const removeStart = storage.indexOf('async function removeObject(');
const removeEnd = storage.indexOf('export async function handleStorageRequest', removeStart);
const removeBlock = storage.slice(removeStart, removeEnd);
assert.ok(removeBlock.includes("if (parsed.kind === 'resident-evidence')"),
  'resident evidence delete must remain an explicit separate path');
assert.ok(removeBlock.includes('const denied = await authorizeObject(auth.actor, metadata, requestId)'),
  'resident-evidence delete/trash must retain uploader/HOLD authorization');
assert.ok(removeBlock.includes("if (parsed.kind === 'business-image')"),
  'business image delete must enter lifecycle registry routing');
assert.ok(removeBlock.includes("if (parsed.kind === 'official-news-image')"),
  '#844: official news image delete must have its own reference-guarded lane');
assert.ok(removeBlock.includes('await acquireOfficialNewsImageDeleteIntent(auth.sql, parsed.objectKey, requestId)'),
  '#844 BLOCKER 1: delete must acquire a durable delete intent before any Drive mutation');
assert.equal(removeBlock.includes("set state = 'retired'"), false,
  '#844 BLOCKER 1: the route must not jump active -> retired directly after a Drive mutation');

const registeredStart = storage.indexOf('async function removeRegisteredBusinessImage(');
const registeredEnd = storage.indexOf('async function removeLegacyUnregisteredBusinessImage(', registeredStart);
const registeredBlock = storage.slice(registeredStart, registeredEnd);
assert.ok(registeredBlock.includes('String(registry.uploader_user_id ?? \'\') !== auth.actor.id'),
  'registry does not create non-uploader media mutation authority');
assert.ok(registeredBlock.includes('await acquireBusinessImageDeleteIntent('));
assert.ok(registeredBlock.includes("state === 'delete_pending'"));
assert.ok(registeredBlock.includes("state === 'retired'"));

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
assert.ok(atomicityArchitecture.includes('NEW_REFERENCE XOR DELETE_INTENT'));
assert.ok(lifecycleMigration.includes('create table if not exists business_image_objects'));
assert.equal(lifecycleMigration.includes('resident-evidence'), false);
assert.ok(devVars.includes('GOOGLE_DRIVE_CLIENT_SECRET=replace-with-oauth-client-secret'));
assert.ok(devVars.includes('GOOGLE_DRIVE_REFRESH_TOKEN=replace-with-refresh-token'));

/* ---------------- #844 official apartment-news public image lane ---------------- */

const storagePolicy = read('src/storage-policy.mjs');
const officialNewsMigration = read('migrations/057_official_news_image_storage.sql');
const migrationLedger = read('migration-safety-ledger.json');
const referenceModule = read('src/storage-reference-v1.ts');
const adminOperational = read('src/admin-operational-v2.ts');

// storage kind is additive and public
assert.ok(storagePolicy.includes("'official-news-image'"), '#844 storage kind must exist');
assert.ok(uploadV2.includes('gdrive/public/official-news-image/'), '#844 objectKey namespace must be the official-news lane');

// migration + ledger
assert.ok(officialNewsMigration.includes("'official-news-image'"));
assert.ok(officialNewsMigration.includes("object_key like 'gdrive/public/official-news-image/%'"));
assert.ok(officialNewsMigration.includes('uq_official_news_image_upload_idempotency'));
assert.ok(migrationLedger.includes('057_official_news_image_storage.sql'),
  '#844 migration must be registered in the migration safety ledger');

// Amendment A: no dedicated Drive folder/binding, only the two pre-existing ones.
assert.equal(/(OFFICIAL_NEWS_FOLDER|ANNOUNCEMENT_FOLDER|PUBLIC_MEDIA_FOLDER)/.test(uploadV2 + storage), false,
  'Amendment A: no new Drive folder env/binding may be introduced');
assert.ok(storage.includes("return kind === 'business-image' || kind === 'official-news-image';"),
  'official-news-image must reuse the public business folder + public visibility');
assert.ok(uploadV2.includes("danjionKind: 'official-news-image'") && uploadV2.includes("danjionVisibility: 'public'"));
assert.ok(uploadV2.includes('GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID'),
  'official-news upload must physically reuse the existing public business folder');

// Amendment B: operator official-content authority, never resident verification, for the new lane.
const routeStart = uploadV2.indexOf('export async function handleTrackedStorageUploadRequest(');
const routeBlock = uploadV2.slice(routeStart);
assert.ok(routeBlock.includes("'official-content.manage'") && routeBlock.includes("'council.official-content.manage'"),
  'Amendment B: official-news upload must require official-content authority');
assert.ok(routeBlock.includes("validation.kind === 'official-news-image'"),
  'the upload route must branch the official-news kind explicitly');
assert.ok(uploadV2.includes('runTrackedOfficialNewsImageUpload'), '#844 upload lane must exist');
assert.ok(uploadV2.includes("and kind = 'official-news-image'"), 'registry reads/writes must be kind-scoped');

// Amendment B: reference validation without forced uploader identity.
assert.ok(referenceModule.includes('export async function validateOfficialNewsImageReference('));
const referenceBlock = referenceModule.slice(referenceModule.indexOf('export async function validateOfficialNewsImageReference('));
for (const needle of [
  "parsed.kind !== 'official-news-image'",
  "registry.kind !== 'official-news-image'",
  "String(registry.complex_id) !== expectedComplexId",
  "String(registry.state) !== 'active'",
  'metadataMatches(driveEnv, parsed, metadata, r2Mode)'
]) {
  assert.ok(referenceBlock.includes(needle), `official-news reference validation must include: ${needle}`);
}
// #932 Production STORAGE_MODE=r2: the official-news reference validator must
// share the #809 R2 parity branch instead of forcing a Drive-only credential gate.
assert.ok(referenceBlock.includes('const r2Mode = r2Enabled(env as R2StorageEnv);'),
  '#932 R2 parity: official-news reference must branch on r2Enabled');
assert.ok(referenceBlock.includes('!r2Mode && (!driveConfigured(driveEnv) || !requiredDriveCredentials(driveEnv))'),
  '#932 R2 parity: Drive credentials are only required outside r2 mode');
assert.ok(referenceBlock.includes('r2Head(env as R2StorageEnv, parsed.kind, parsed.fileId)'),
  '#932 R2 parity: R2 mode must verify identity through r2Head');
assert.ok(referenceBlock.includes('metadataMatches(driveEnv, parsed, metadata, r2Mode)'),
  '#932 R2 parity: metadataMatches must receive the same r2Mode flag');
assert.equal(referenceBlock.includes('danjionUploaderUserId !=='), false,
  'Amendment B: attaching a photo must not require the same uploader as the post editor');
assert.ok(adminOperational.includes('validateOfficialNewsImageReference'),
  'create/patch must validate client-supplied attachment keys server-side');

// Amendment D: public streaming requires an active object referenced by a PUBLISHED official post.
assert.ok(storage.includes('officialNewsImagePubliclyVisible'));
assert.ok(storage.includes("p.status = 'published'"));
assert.ok(storage.includes("p.channel in ('apartment_news', 'management_office')"),
  '#844 BLOCKER 3: the public resolver must require an official apartment-news channel');
assert.ok(storage.includes("o.state = 'active'"));
assert.ok(storage.includes('business_image_objects o'), 'resolver must consult the lifecycle registry');

// Amendment C / BLOCKER 1: durable delete intent, refused while referenced, reconcilable on failure.
assert.ok(storage.includes('export async function acquireOfficialNewsImageDeleteIntent('));
const deleteGuard = storage.slice(storage.indexOf('export async function acquireOfficialNewsImageDeleteIntent('));
assert.ok(deleteGuard.includes('sql.transaction('), 'BLOCKER 1: intent acquisition must be transactional');
assert.ok(deleteGuard.includes('for update'), 'BLOCKER 1: the registry row must be locked');
assert.ok(deleteGuard.includes('from complex_posts p') && deleteGuard.includes('p.attachment_object_key = ${objectKeyValue}'),
  'BLOCKER 1: the reference check must live in the same serialization boundary');
assert.ok(deleteGuard.includes("set state = 'delete_pending'"), 'BLOCKER 1: active -> delete_pending');
assert.ok(deleteGuard.includes('and not u.post_in_use'), 'NEW_REFERENCE_XOR_DELETE_INTENT');
assert.ok(deleteGuard.includes('OFFICIAL_NEWS_IMAGE_IN_USE'));
assert.ok(deleteGuard.includes('409'), 'a referenced official-news image delete must fail with 409');
assert.ok(storage.includes('finalizeOfficialNewsImageRetired'), 'DELETE_PENDING -> RETIRED finalize must exist');
assert.ok(storage.includes('trashOfficialNewsImageAndFinalize'));
assert.ok(storage.includes('OFFICIAL_NEWS_IMAGE_RETIREMENT_RECONCILABLE'),
  'DRIVE_FAILURE_RECONCILABLE / FINALIZE_FAILURE_RECONCILABLE');
assert.ok(storage.includes('reconcileOfficialNewsImageRetirement'),
  'a delete_pending object must stay retryable');

// BLOCKER 4: registry uploader must equal the Drive-recorded uploader (editor equality is not required).
assert.ok(referenceBlock.includes('registry.uploader_user_id') && referenceBlock.includes('danjionUploaderUserId'),
  'BLOCKER 4: REGISTRY_UPLOADER_EQUALS_DRIVE_UPLOADER');

// BLOCKER 3: the admin write path refuses an attachment on a non-official channel.
assert.ok(adminOperational.includes('OFFICIAL_NEWS_IMAGE_CHANNEL_INVALID'),
  'BLOCKER 3: danjion_notice/chair_greeting attachments must be rejected');
assert.ok(adminOperational.includes("channel !== 'apartment_news' && channel !== 'management_office'"),
  'BLOCKER 3: only apartment_news/management_office may carry a photo');

console.log('PASS Google Drive storage contract, evidence HOLD and current Household-v2 business-media authorization');
console.log('PASS #844 official apartment-news public image lane (kind, namespace, authz, resolver, delete guard)');
