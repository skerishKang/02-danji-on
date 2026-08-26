import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateBusinessImageReference } from '../src/storage-v1.ts';

const root = new URL('../', import.meta.url);
const economy = await readFile(new URL('src/resident-economy-v2.ts', root), 'utf8');
const admin = await readFile(new URL('src/admin-operational-v2.ts', root), 'utf8');
const storage = await readFile(new URL('src/storage-v1.ts', root), 'utf8');

const env = {
  STORAGE_MODE: 'drive',
  GOOGLE_DRIVE_CLIENT_ID: 'client',
  GOOGLE_DRIVE_CLIENT_SECRET: 'secret',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh',
  GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID: 'business-folder'
};
const key = 'gdrive/public/business-image/file_1234567890';
let metadata = {
  id: 'file_1234567890',
  name: 'image.webp',
  trashed: false,
  parents: ['business-folder'],
  appProperties: {
    danjionKind: 'business-image',
    danjionVisibility: 'public',
    danjionUploaderUserId: 'resident-1',
    danjionComplexSlug: 'complex-a'
  }
};

globalThis.fetch = async (url) => {
  const value = String(url);
  if (value === 'https://oauth2.googleapis.com/token') {
    return Response.json({ access_token: 'token', expires_in: 3600 });
  }
  if (value.includes('/drive/v3/files/file_1234567890?')) {
    return Response.json(metadata);
  }
  throw new Error(`Unexpected fetch: ${value}`);
};

assert.equal(await validateBusinessImageReference(env, key, 'resident-1', 'complex-a', 'req-valid'), null);

let denied = await validateBusinessImageReference(env, key, 'resident-2', 'complex-a', 'req-owner');
assert.ok(denied instanceof Response);
assert.equal(denied.status, 403);
assert.equal((await denied.json()).error.code, 'BUSINESS_IMAGE_REFERENCE_FORBIDDEN');

denied = await validateBusinessImageReference(env, key, 'resident-1', 'complex-b', 'req-complex');
assert.ok(denied instanceof Response);
assert.equal(denied.status, 403);

metadata = { ...metadata, trashed: true };
denied = await validateBusinessImageReference(env, key, 'resident-1', 'complex-a', 'req-trashed');
assert.ok(denied instanceof Response);
assert.equal(denied.status, 400);
assert.equal((await denied.json()).error.code, 'INVALID_BUSINESS_IMAGE_REFERENCE');

metadata = { ...metadata, trashed: false, parents: ['other-folder'] };
denied = await validateBusinessImageReference(env, key, 'resident-1', 'complex-a', 'req-folder');
assert.ok(denied instanceof Response);
assert.equal(denied.status, 400);

metadata = {
  ...metadata,
  parents: ['business-folder'],
  appProperties: {
    ...metadata.appProperties,
    danjionKind: 'resident-evidence'
  }
};
denied = await validateBusinessImageReference(env, key, 'resident-1', 'complex-a', 'req-kind');
assert.ok(denied instanceof Response);
assert.equal(denied.status, 400);

const invalidNamespace = await validateBusinessImageReference(
  env,
  'gdrive/private/resident-evidence/file_1234567890',
  'resident-1',
  'complex-a',
  'req-namespace'
);
assert.ok(invalidNamespace instanceof Response);
assert.equal(invalidNamespace.status, 400);

assert.ok(storage.includes('export async function validateBusinessImageReference('));
assert.ok(storage.includes("parsed.visibility !== 'public' || parsed.kind !== 'business-image'"));
assert.ok(storage.includes('metadataMatches(driveEnv, parsed, metadata)'));
assert.ok(storage.includes('props.danjionUploaderUserId !== expectedUploaderUserId'));
assert.ok(storage.includes('props.danjionComplexSlug !== expectedComplexSlug'));

const createStart = economy.indexOf('async function createBusinessApplication(');
const createEnd = economy.indexOf('async function claimBenefit(', createStart);
const createBlock = economy.slice(createStart, createEnd);
const createAuth = createBlock.indexOf('requireVerifiedResident(request, env, sql, requestId, input.complexSlug)');
const replayLookup = createBlock.indexOf('from business_applications');
const createValidate = createBlock.indexOf('await validateBusinessImageReference(');
const createInsert = createBlock.indexOf('insert into business_applications');
assert.ok(createAuth >= 0 && replayLookup > createAuth,
  'verified-resident auth must precede idempotent replay lookup');
assert.ok(createValidate > replayLookup,
  'completed idempotent replay must resolve before external image revalidation');
assert.ok(createInsert > createValidate,
  'new application insert must occur only after image reference validation');
assert.ok(createBlock.includes('resident.id'));
assert.ok(createBlock.includes('resident.complexSlug'));

assert.ok(admin.includes("import { validateBusinessImageReference } from './storage-v1';"));
assert.ok(admin.includes('a.applicant_user_id'));
assert.ok(admin.includes('a.representative_image_object_key'));
const patchStart = admin.indexOf('async function patchApplication(');
const patchEnd = admin.indexOf('async function createPost(', patchStart);
const patchBlock = admin.slice(patchStart, patchEnd);
const operatorAuth = patchBlock.indexOf('await authority(request, env, sql, requestId');
const alreadyApproved = patchBlock.indexOf("String(current.status) === 'approved'");
const approvalValidate = patchBlock.indexOf('await validateBusinessImageReference(');
const materialize = patchBlock.indexOf('await approveApplication(');
assert.ok(operatorAuth >= 0 && alreadyApproved > operatorAuth,
  'business-review authority must be established before approval handling');
assert.ok(approvalValidate > alreadyApproved,
  'already-approved replay must not depend on current Drive state');
assert.ok(materialize > approvalValidate,
  'approval materialization must occur only after image reference revalidation');
assert.ok(patchBlock.includes('String(current.applicant_user_id)'));
assert.ok(patchBlock.includes('String(current.complex_slug)'));

console.log('PASS business image reference integrity: create ownership binding + approval revalidation');
