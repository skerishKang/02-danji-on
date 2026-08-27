import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  acquireBusinessImageDeleteIntent,
  registerBusinessImageObject
} from '../src/storage-v1.ts';

const root = new URL('../', import.meta.url);
const storage = await readFile(new URL('src/storage-v1.ts', root), 'utf8');
const economy = await readFile(new URL('src/resident-economy-v2.ts', root), 'utf8');
const migration = await readFile(new URL('migrations/019_business_image_lifecycle_registry.sql', root), 'utf8');
const architecture = await readFile(
  new URL('../docs/BUSINESS_IMAGE_CROSS_SYSTEM_ATOMICITY_ARCHITECTURE_20260827.md', root),
  'utf8'
);

const key = 'gdrive/public/business-image/file_1234567890';
const uploader = '11111111-1111-4111-8111-111111111111';
const complexId = '22222222-2222-4222-8222-222222222222';

// Migration/schema contract.
assert.ok(migration.includes('create table if not exists business_image_objects'));
assert.ok(migration.includes('object_key text primary key'));
assert.ok(migration.includes('uploader_user_id uuid not null references app_users(id)'));
assert.ok(migration.includes('complex_id uuid not null references complexes(id)'));
assert.ok(migration.includes("state in ('active', 'delete_pending', 'retired')"));
assert.ok(migration.includes("object_key like 'gdrive/public/business-image/%'"));
assert.ok(migration.includes("state = 'delete_pending' and delete_requested_at is not null and retired_at is null"));
assert.ok(migration.includes("state = 'retired' and delete_requested_at is not null and retired_at is not null"));
assert.equal(migration.includes('resident-evidence'), false,
  'resident evidence must stay outside the business-image lifecycle registry');

// Upload must not return a business-image key before active registry registration.
const uploadStart = storage.indexOf('async function upload(');
const uploadEnd = storage.indexOf('async function streamObject(', uploadStart);
const uploadBlock = storage.slice(uploadStart, uploadEnd);
const driveUpload = uploadBlock.indexOf('await uploadDriveFile(');
const keyBuild = uploadBlock.indexOf('const uploadedObjectKey = objectKey(');
const register = uploadBlock.indexOf('await registerBusinessImageObject(');
const returnKey = uploadBlock.indexOf('objectKey: uploadedObjectKey');
assert.ok(driveUpload >= 0 && keyBuild > driveUpload);
assert.ok(register > keyBuild, 'Drive upload must be followed by DB lifecycle registration');
assert.ok(returnKey > register, 'object key must be returned only after registry registration succeeds');
assert.ok(uploadBlock.includes("if (validation.kind === 'business-image')"));
assert.ok(uploadBlock.includes('resident.complexId'));

// Create: strict Drive validation remains before the two-command DB reference transaction.
const createStart = economy.indexOf('async function createBusinessApplication(');
const createEnd = economy.indexOf('async function resubmitBusinessApplication(', createStart);
const createBlock = economy.slice(createStart, createEnd);
const createValidate = createBlock.indexOf('await validateBusinessImageReference(');
const createTransaction = createBlock.indexOf('await sql.transaction([');
const createLock = createBlock.indexOf('from business_image_objects', createTransaction);
const createForUpdate = createBlock.indexOf('for update', createLock);
const createInsert = createBlock.indexOf('insert into business_applications', createTransaction);
assert.ok(createValidate >= 0 && createTransaction > createValidate);
assert.ok(createLock > createTransaction && createForUpdate > createLock);
assert.ok(createInsert > createForUpdate);
assert.ok(createBlock.includes("bio.state = 'active'"));
assert.ok(createBlock.includes('bio.uploader_user_id = ${resident.id}::uuid'));
assert.ok(createBlock.includes('bio.complex_id = ${resident.complexId}::uuid'));

// Resubmit: replacement reference is acquired under the same registry lock discipline.
const resubmitStart = economy.indexOf('async function resubmitBusinessApplication(');
const resubmitEnd = economy.indexOf('async function claimBenefit(', resubmitStart);
const resubmitBlock = economy.slice(resubmitStart, resubmitEnd);
const resubmitValidate = resubmitBlock.indexOf('await validateBusinessImageReference(');
const resubmitTransaction = resubmitBlock.indexOf('await sql.transaction([');
const resubmitLock = resubmitBlock.indexOf('from business_image_objects', resubmitTransaction);
const resubmitForUpdate = resubmitBlock.indexOf('for update', resubmitLock);
const resubmitUpdate = resubmitBlock.indexOf('update business_applications a', resubmitTransaction);
assert.ok(resubmitValidate >= 0 && resubmitTransaction > resubmitValidate);
assert.ok(resubmitLock > resubmitTransaction && resubmitForUpdate > resubmitLock);
assert.ok(resubmitUpdate > resubmitForUpdate);
assert.ok(resubmitBlock.includes("bio.state = 'active'"));

function makeTransactionalSql({ locked, decision, throwTransaction = false }) {
  const built = [];
  const sql = (strings, ...values) => {
    const query = { text: strings.join('?'), values };
    built.push(query);
    return query;
  };
  sql.transaction = async (queries) => {
    assert.equal(queries.length, 2, 'delete intent must be a two-command DB transaction');
    assert.equal(queries[0], built[0]);
    assert.equal(queries[1], built[1]);
    if (throwTransaction) throw new Error('synthetic transaction outage');
    return [[locked].filter(Boolean), [decision].filter(Boolean)];
  };
  return { sql, built };
}

// Executable delete-intent helper contract.
let fixture = makeTransactionalSql({
  locked: { object_key: key, uploader_user_id: uploader, complex_id: complexId, state: 'active' },
  decision: {
    state: 'delete_pending', uploader_user_id: uploader,
    business_media_in_use: false, application_in_use: false,
    delete_intent_acquired: true
  }
});
let result = await acquireBusinessImageDeleteIntent(fixture.sql, key, uploader, 'req-acquire');
assert.deepEqual(result, { acquired: true, state: 'delete_pending' });
assert.ok(fixture.built[0].text.includes('for update'), 'Statement A must own the registry row lock');
assert.ok(fixture.built[1].text.includes('from business_media bm'));
assert.ok(fixture.built[1].text.includes('from business_applications a'));
assert.ok(fixture.built[1].text.includes("a.status in ('draft', 'pending', 'changes_requested', 'approved')"));
assert.ok(fixture.built[1].text.includes("set state = 'delete_pending'"));
assert.equal(fixture.built[1].text.includes("'rejected'"), false);

fixture = makeTransactionalSql({
  locked: { object_key: key, uploader_user_id: uploader, complex_id: complexId, state: 'active' },
  decision: {
    state: 'active', uploader_user_id: uploader,
    business_media_in_use: true, application_in_use: false,
    delete_intent_acquired: false
  }
});
result = await acquireBusinessImageDeleteIntent(fixture.sql, key, uploader, 'req-in-use');
assert.ok(result instanceof Response);
assert.equal(result.status, 409);
assert.equal((await result.json()).error.code, 'BUSINESS_IMAGE_IN_USE');

fixture = makeTransactionalSql({
  locked: { object_key: key, uploader_user_id: uploader, complex_id: complexId, state: 'delete_pending' },
  decision: {
    state: 'delete_pending', uploader_user_id: uploader,
    business_media_in_use: false, application_in_use: false,
    delete_intent_acquired: false
  }
});
result = await acquireBusinessImageDeleteIntent(fixture.sql, key, uploader, 'req-pending');
assert.deepEqual(result, { acquired: false, state: 'delete_pending' });

fixture = makeTransactionalSql({
  locked: { object_key: key, uploader_user_id: '33333333-3333-4333-8333-333333333333', complex_id: complexId, state: 'active' },
  decision: { state: 'active', delete_intent_acquired: false }
});
result = await acquireBusinessImageDeleteIntent(fixture.sql, key, uploader, 'req-owner');
assert.ok(result instanceof Response);
assert.equal(result.status, 403);

fixture = makeTransactionalSql({ locked: null, decision: null, throwTransaction: true });
result = await acquireBusinessImageDeleteIntent(fixture.sql, key, uploader, 'req-db');
assert.ok(result instanceof Response);
assert.equal(result.status, 503);
assert.equal((await result.json()).error.code, 'BUSINESS_IMAGE_REFERENCE_CHECK_UNAVAILABLE');

// Registration helper must fail closed and never manufacture success on conflict/outage.
const registrationQueries = [];
const registrationSql = async (strings, ...values) => {
  registrationQueries.push({ text: strings.join('?'), values });
  return [{ object_key: key }];
};
assert.equal(await registerBusinessImageObject(registrationSql, key, uploader, complexId, 'req-register'), null);
assert.ok(registrationQueries[0].text.includes('insert into business_image_objects'));
assert.ok(registrationQueries[0].text.includes("'active'"));

const conflictSql = async () => [];
let registrationError = await registerBusinessImageObject(conflictSql, key, uploader, complexId, 'req-conflict');
assert.ok(registrationError instanceof Response);
assert.equal(registrationError.status, 409);
assert.equal((await registrationError.json()).error.code, 'BUSINESS_IMAGE_REGISTRY_CONFLICT');

const downSql = async () => { throw new Error('synthetic registry outage'); };
registrationError = await registerBusinessImageObject(downSql, key, uploader, complexId, 'req-down');
assert.ok(registrationError instanceof Response);
assert.equal(registrationError.status, 503);

// Retirement saga and retry invariants are executable source boundaries.
const intentStart = storage.indexOf('export async function acquireBusinessImageDeleteIntent(');
const intentEnd = storage.indexOf('async function finalizeBusinessImageRetired(', intentStart);
const intentBlock = storage.slice(intentStart, intentEnd);
assert.ok(intentBlock.includes('await sql.transaction(['));
assert.ok(intentBlock.indexOf('for update') < intentBlock.indexOf('with usage as'));
assert.ok(intentBlock.includes("set state = 'delete_pending'"));

const registeredStart = storage.indexOf('async function removeRegisteredBusinessImage(');
const registeredEnd = storage.indexOf('async function removeLegacyUnregisteredBusinessImage(', registeredStart);
const registeredBlock = storage.slice(registeredStart, registeredEnd);
assert.ok(registeredBlock.includes("state === 'delete_pending'"));
assert.ok(registeredBlock.includes("state === 'retired'"));
const acquireIntent = registeredBlock.indexOf('await acquireBusinessImageDeleteIntent(');
const driveAfterIntent = registeredBlock.indexOf('return trashBusinessImageAndFinalize(', acquireIntent);
assert.ok(acquireIntent >= 0 && driveAfterIntent > acquireIntent,
  'Drive trash must be reached only after committed delete intent acquisition');

const reconcileStart = storage.indexOf('async function reconcileBusinessImageRetirement(');
const reconcileEnd = storage.indexOf('async function removeRegisteredBusinessImage(', reconcileStart);
const reconcileBlock = storage.slice(reconcileStart, reconcileEnd);
assert.ok(reconcileBlock.includes('await readDriveMetadata(env, parsed)'));
assert.ok(reconcileBlock.includes('if (!metadata)'));
assert.ok(reconcileBlock.includes('if (metadata.trashed)'));
assert.ok(reconcileBlock.includes('await finalizeBusinessImageRetired('));
assert.equal(reconcileBlock.includes('metadataMatches(env, parsed, metadata)'), false,
  'delete_pending retry must not reuse strict active-image metadata validation');

const removeStart = storage.indexOf('async function removeObject(');
const removeEnd = storage.indexOf('export async function handleStorageRequest', removeStart);
const removeBlock = storage.slice(removeStart, removeEnd);
assert.ok(removeBlock.includes("if (parsed.kind === 'resident-evidence')"));
assert.ok(removeBlock.includes("if (parsed.kind === 'business-image')"));
assert.ok(removeBlock.includes('await readBusinessImageRegistry('));

assert.ok(architecture.includes('NEW_REFERENCE XOR DELETE_INTENT'));
assert.ok(architecture.includes('Statement A'));
assert.ok(architecture.includes('Statement B'));
assert.ok(architecture.includes('STRICT_ACTIVE_METADATA_VALIDATION != RETIREMENT_RECONCILIATION_PROBE'));

console.log('PASS business image cross-system atomicity registry/transaction/saga contract');
