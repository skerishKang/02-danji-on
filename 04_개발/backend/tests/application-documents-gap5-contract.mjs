import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const economy = await readFile(new URL('src/resident-economy-v2.ts', root), 'utf8');
const upload = await readFile(new URL('src/storage-upload-v2.ts', root), 'utf8');
const policyTypes = await readFile(new URL('src/storage-policy.d.mts', root), 'utf8');

const createBody = economy.slice(
  economy.indexOf('async function createBusinessApplication('),
  economy.indexOf('async function resubmitBusinessApplication(')
);
const resubmitBody = economy.slice(
  economy.indexOf('async function resubmitBusinessApplication('),
  economy.indexOf('async function claimBenefit(')
);
const replayBody = economy.slice(
  economy.indexOf('async function idempotentReplayResponse('),
  economy.indexOf('function businessImageRegistryFailure(')
);

// CREATE atomicity (REQ A): one non-interactive transaction owns the
// application row and every document association. The application id must be
// generated client-side so document rows can join the same transaction.
assert.ok(createBody.includes('const newApplicationId = crypto.randomUUID();'),
  'create must generate the application id client-side for single-transaction document association');
assert.equal((createBody.match(/\$\{newApplicationId\}::uuid/g) ?? []).length, 3,
  'application id must appear in both insert branches and every document insert');
assert.ok(/sql\.transaction\(\[[\s\S]*?for update[\s\S]*?insert into business_applications[\s\S]*?\.\.\.documentInsertQueries\s*\]\)/.test(createBody),
  'representative-image create must run registry lock, application insert and document inserts in one transaction');
assert.ok(/sql\.transaction\(\[[\s\S]*?insert into business_applications[\s\S]*?\.\.\.documentInsertQueries\s*\]\)/.test(createBody),
  'plain create must run application insert and document inserts in one transaction');
assert.equal(createBody.includes('insertApplicationDocuments'), false,
  'no separate post-commit document association helper may exist');
assert.equal(createBody.includes('delete from business_applications'), false,
  'compensation-delete rollback must not exist: atomicity is transactional');
const duplicateIdx = createBody.indexOf("DOCUMENT_DUPLICATE_OBJECT_KEY");
const transactionIdx = createBody.indexOf('let inserted;');
assert.ok(duplicateIdx > 0 && duplicateIdx < transactionIdx,
  'duplicate object key association must fail before the create transaction opens');
assert.ok(/select object_key from business_application_documents[\s\S]{0,120}any\(\$\{objectKeys\}\)/.test(createBody),
  'create must pre-check business_application_documents for already-associated object keys');

// RESUBMIT atomicity (REQ B): UPDATE + old document DELETE + new INSERTs in
// the same transaction for both branches.
assert.ok(resubmitBody.includes('delete from business_application_documents'),
  'resubmit must delete prior document associations inside the transaction');
assert.equal((resubmitBody.match(/documentDeletes,\s*\.\.\.documentInserts/g) ?? []).length, 2,
  'both resubmit branches must include document delete+insert queries in the same transaction');
assert.ok(/sql\.transaction\(\[[\s\S]*?update business_applications a[\s\S]*?documentDeletes,\s*\.\.\.documentInserts[\s\S]*?\]\)/.test(resubmitBody),
  'resubmit must mutate application and documents in one sql.transaction([...])');

// documents validation (REQ C): omitted preserves, [] rejects, quotas hold.
assert.ok(economy.includes('if (input.documents !== undefined) {'),
  'documents field must be validated by presence, not truthiness');
assert.ok(/if \(input\.documents\.length < 1\) \{\s*return fail\('DOCUMENT_OPERATION_PROOF_REQUIRED'/.test(economy),
  'documents=[] must return 400 DOCUMENT_OPERATION_PROOF_REQUIRED');
assert.ok(economy.includes("if (operationProofs.length < 1)"),
  'at least one operation_proof document is required');
assert.ok(economy.includes('if (otherEvidences.length > 3)'),
  'other_evidence documents are capped at 3');
assert.ok(economy.includes('if (additionalReferences.length > 3)'),
  'additional_reference documents are capped at 3');

// registry guard (REQ E): active state, applicant owner, complex scope and
// kind='application-document' must all be enforced from a single registry read.
assert.ok(economy.includes("if (String(registry.kind ?? '') !== 'application-document')"),
  'registry rows must be rejected unless kind is application-document');
assert.ok(economy.includes("DOCUMENT_KIND_INVALID"),
  'kind guard must return the deterministic DOCUMENT_KIND_INVALID code');
assert.ok(economy.includes("String(registry.state ?? '') !== 'active'"),
  'registry guard must require active state');
assert.ok(economy.includes("String(registry.uploader_user_id ?? '') !== expectedUploaderUserId"),
  'registry guard must require the applicant as uploader');
assert.ok(economy.includes("String(registry.complex_id ?? '') !== expectedComplexId"),
  'registry guard must require the same complex');
assert.equal((economy.match(/state, kind\s+from business_image_objects/g) ?? []).length, 1,
  'document registry validation must use exactly one SELECT that includes kind');

// upload contract (REQ D): uploadApplicationDocumentFile returns DriveMetadata
// directly, throws on a failed Drive response, and the caller never treats it
// as a Response. Success path answers 201.
assert.ok(/async function uploadApplicationDocumentFile\([\s\S]*?\): Promise<DriveMetadata> \{/.test(upload),
  'uploadApplicationDocumentFile must be typed to return DriveMetadata');
assert.ok(upload.includes('return response.json() as Promise<DriveMetadata>;'),
  'uploadApplicationDocumentFile must return the parsed Drive metadata');
assert.ok(/if \(!response\.ok\) \{[\s\S]*?throw new Error\(`Google Drive application-document upload failed/.test(upload),
  'uploadApplicationDocumentFile must throw when Drive rejects the upload');
const appUploadBody = upload.slice(
  upload.indexOf('async function runTrackedApplicationDocumentUpload('),
  upload.indexOf('export async function handleTrackedStorageUploadRequest(')
);
assert.equal(appUploadBody.includes('readDriveMetadata'), false,
  'application-document upload must not redeclare metadata via a second read path');
assert.equal(appUploadBody.includes('.ok'), false,
  'caller must not test DriveMetadata.ok');
assert.ok(appUploadBody.includes('metadata = await uploadApplicationDocumentFile('),
  'caller must consume DriveMetadata directly from uploadApplicationDocumentFile');
assert.ok(upload.includes('GOOGLE_DRIVE_PRIVATE_RESIDENT_VERIFICATION_FOLDER_ID?: string;'),
  'DriveEnv must declare the private folder used for application documents');
assert.ok(upload.includes("validation.kind !== 'application-document'"),
  'upload route must accept application-document kind');
assert.ok(/}, requestId, 201\);/.test(upload),
  'successful tracked upload must answer HTTP 201');
assert.match(policyTypes, /export type StorageKind = 'business-image' \| 'resident-evidence' \| 'application-document';/,
  'StorageKind type must include application-document');

// idempotent replay (REQ G + H): completed replays reload persisted documents
// with idempotency_replayed: true, the document read fails closed with 503,
// and replay short-circuits before any registry/Drive revalidation.
assert.ok(replayBody.includes('docs = await getApplicationDocuments(sql, String(existing.id))'),
  'replay must load the persisted document set of the completed application');
assert.ok(replayBody.includes('return ok(withGallery({ ...existing, documents: docs, idempotency_replayed: true }, stored), requestId);'),
  'replay must return documents plus the explicit replay marker');
assert.ok(/catch \{[\s\S]*?DOCUMENT_REGISTRY_UNAVAILABLE[\s\S]*?503/.test(replayBody),
  'replay document read failure must fail closed with 503');
const replayCallIdx = createBody.indexOf('return await idempotentReplayResponse(sql, existing');
const imageValidateIdx = createBody.indexOf('validateBusinessImageReference(');
const documentValidateIdx = createBody.indexOf('await validateApplicationDocuments(');
assert.ok(replayCallIdx > 0 && replayCallIdx < imageValidateIdx && imageValidateIdx < documentValidateIdx,
  'replay must be resolved before any current registry or Drive revalidation');
assert.ok(createBody.includes('if (inserted[0]) {'),
  'fresh create success must be gated on the inserted application row');
assert.ok(createBody.includes('idempotency_replayed: false }, galleryKeys), requestId, 201);'),
  'fresh create must answer 201 with documents and an explicit non-replay marker');

console.log('PASS GAP-5 application documents: create/resubmit atomicity, documents validation, registry kind guard, DriveMetadata upload contract and fail-closed replay');
