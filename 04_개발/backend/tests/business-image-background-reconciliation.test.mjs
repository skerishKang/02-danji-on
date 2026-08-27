import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  claimBusinessImageReconciliationBatch,
  reconcileClaimedBusinessImage,
  reconciliationBackoffSeconds,
  runBusinessImageLifecycleReconciliation
} from '../src/storage-reconciliation-v1.ts';

const root = new URL('../', import.meta.url);
const runtime = await readFile(new URL('src/storage-reconciliation-v1.ts', root), 'utf8');
const uploadRuntime = await readFile(new URL('src/storage-upload-v2.ts', root), 'utf8');
const storageRuntime = await readFile(new URL('src/storage-v1.ts', root), 'utf8');
const worker = await readFile(new URL('src/worker-v2.ts', root), 'utf8');
const migration021 = await readFile(new URL('migrations/021_business_image_reconciliation_lease.sql', root), 'utf8');
const migration023 = await readFile(new URL('migrations/023_business_image_resolved_reconciliation_cleanup.sql', root), 'utf8');
const wrangler = JSON.parse(await readFile(new URL('wrangler.jsonc', root), 'utf8'));

const uploader = '11111111-1111-4111-8111-111111111111';
const complexId = '22222222-2222-4222-8222-222222222222';
const complexSlug = 'reconcile-ci-complex';
const folderId = 'drive_business_folder_1234567890';
const fileId = 'background_file_1234567890';
const objectKey = `gdrive/public/business-image/${fileId}`;
const leaseToken = '33333333-3333-4333-8333-333333333333';
const env = {
  APP_ENV: 'production',
  DATABASE_URL: 'postgresql://unused-in-unit-test',
  STORAGE_MODE: 'drive',
  GOOGLE_DRIVE_CLIENT_ID: 'client-for-test',
  GOOGLE_DRIVE_CLIENT_SECRET: 'secret-for-test',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh-for-test',
  GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID: folderId
};

function claim(state, attempt = 1) {
  return {
    object_key: objectKey,
    uploader_user_id: uploader,
    complex_id: complexId,
    complex_slug: complexSlug,
    state,
    reconcile_attempt_count: attempt
  };
}

function validMetadata({ trashed = false, uploaderId = uploader, slug = complexSlug, parent = folderId } = {}) {
  return {
    id: fileId,
    trashed,
    parents: [parent],
    appProperties: {
      danjionKind: 'business-image',
      danjionVisibility: 'public',
      danjionUploaderUserId: uploaderId,
      danjionComplexSlug: slug
    }
  };
}

// Static architecture/runtime boundary.
assert.equal(wrangler.main, 'src/worker-v2.ts');
assert.deepEqual(wrangler.env.production.triggers.crons, ['*/15 * * * *']);
assert.equal(Object.hasOwn(wrangler, 'triggers'), false, 'default environment must not schedule the production reconciler');
assert.equal(Object.hasOwn(wrangler.env.preview, 'triggers'), false, 'preview must not schedule the production reconciler');
assert.ok(worker.includes('fetch: app.fetch'), 'HTTP fetch path must remain delegated to the existing app');
assert.ok(worker.includes('async scheduled('));
assert.ok(worker.includes('ctx.waitUntil('));
assert.ok(worker.includes('runBusinessImageLifecycleReconciliation(env)'));

assert.ok(migration021.includes('reconcile_lease_token uuid'));
assert.ok(migration021.includes('reconcile_lease_expires_at timestamptz'));
assert.ok(migration021.includes('reconcile_attempt_count integer not null default 0'));
assert.ok(migration021.includes('chk_business_image_reconcile_lease_pair'));
assert.ok(migration021.includes("where state in ('upload_pending', 'delete_pending')"));
assert.equal(migration021.includes('resident-evidence'), false);

assert.ok(migration023.includes("where state in ('active', 'retired')"));
assert.ok(migration023.includes('chk_business_image_resolved_reconciliation_clear'));
assert.ok(migration023.includes("state in ('upload_pending', 'delete_pending')"));
for (const field of [
  'reconcile_lease_token = null',
  'reconcile_lease_expires_at = null',
  'reconcile_next_attempt_at = null',
  'reconcile_last_error_code = null'
]) {
  assert.ok(migration023.includes(field), `migration 023 must clear ${field}`);
}
assert.equal(migration023.includes('reconcile_attempt_count = null'), false, 'attempt count is retained as history');
assert.equal(migration023.includes('reconcile_last_attempt_at = null'), false, 'last attempt timestamp is retained as history');

const activationStart = uploadRuntime.indexOf('export async function activateBusinessImageUpload(');
const activationEnd = uploadRuntime.indexOf('async function readRegistryRow(', activationStart);
const activationBlock = uploadRuntime.slice(activationStart, activationEnd);
assert.ok(activationStart >= 0 && activationEnd > activationStart);
assert.ok(activationBlock.includes("set state = 'active'"));
for (const field of [
  'reconcile_lease_token = null',
  'reconcile_lease_expires_at = null',
  'reconcile_next_attempt_at = null',
  'reconcile_last_error_code = null'
]) {
  assert.ok(activationBlock.includes(field), `foreground activation must clear ${field}`);
}
assert.equal(activationBlock.includes('reconcile_attempt_count ='), false, 'foreground activation preserves attempt history');
assert.equal(activationBlock.includes('reconcile_last_attempt_at ='), false, 'foreground activation preserves last-attempt history');

const retirementStart = storageRuntime.indexOf('async function finalizeBusinessImageRetired(');
const retirementEnd = storageRuntime.indexOf('async function uploadDriveFile(', retirementStart);
const retirementBlock = storageRuntime.slice(retirementStart, retirementEnd);
assert.ok(retirementStart >= 0 && retirementEnd > retirementStart);
assert.ok(retirementBlock.includes("set state = 'retired'"));
for (const field of [
  'reconcile_lease_token = null',
  'reconcile_lease_expires_at = null',
  'reconcile_next_attempt_at = null',
  'reconcile_last_error_code = null'
]) {
  assert.ok(retirementBlock.includes(field), `foreground retirement must clear ${field}`);
}
assert.equal(retirementBlock.includes('reconcile_attempt_count ='), false, 'foreground retirement preserves attempt history');
assert.equal(retirementBlock.includes('reconcile_last_attempt_at ='), false, 'foreground retirement preserves last-attempt history');

assert.ok(runtime.includes("bio.state in ('upload_pending', 'delete_pending')"));
assert.ok(runtime.includes('for update skip locked'));
assert.ok(runtime.includes("bio.updated_at <= now() - interval '2 minutes'"));
assert.ok(runtime.includes('reconcile_lease_expires_at'));
assert.ok(runtime.includes("and state = 'upload_pending'"));
assert.ok(runtime.includes("and state = 'delete_pending'"));
assert.ok(runtime.includes('and reconcile_lease_token = ${leaseToken}::uuid'));
assert.equal(runtime.includes('resident-evidence'), false);
assert.equal(runtime.includes('/files?'), false, 'background reconciliation must never list Drive files');
assert.equal(runtime.includes("from './auth-v1'"), false, 'scheduled lifecycle recovery must not impersonate a user actor');

assert.equal(reconciliationBackoffSeconds(1), 60);
assert.equal(reconciliationBackoffSeconds(2), 300);
assert.equal(reconciliationBackoffSeconds(3), 900);
assert.equal(reconciliationBackoffSeconds(4), 3600);
assert.equal(reconciliationBackoffSeconds(5), 21600);
assert.equal(reconciliationBackoffSeconds(99), 21600);

// Non-production scheduled invocation is inert even without storage/database configuration.
const previewSummary = await runBusinessImageLifecycleReconciliation({ APP_ENV: 'preview', DATABASE_URL: '' });
assert.equal(previewSummary.skipped, true);
assert.equal(previewSummary.claimed, 0);

// Claim SQL is bounded, pending-only, lease-aware and uses SKIP LOCKED.
let claimSqlText = '';
let claimSqlValues = [];
const claimSql = async (strings, ...values) => {
  claimSqlText = strings.join('?');
  claimSqlValues = values;
  return [claim('upload_pending')];
};
const claimed = await claimBusinessImageReconciliationBatch(claimSql, leaseToken, 999);
assert.equal(claimed.length, 1);
assert.ok(claimSqlText.includes("state in ('upload_pending', 'delete_pending')"));
assert.ok(claimSqlText.includes('reconcile_next_attempt_at'));
assert.ok(claimSqlText.includes('reconcile_lease_expires_at'));
assert.ok(claimSqlText.includes('for update skip locked'));
assert.ok(claimSqlValues.includes(25), 'claim batch must clamp to 25');
assert.ok(claimSqlValues.includes(300), 'claim lease must be five minutes');

function makeLifecycleSql(initialState, options = {}) {
  let state = initialState;
  let lastError = null;
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    calls.push(text);
    if (text.includes("set state = 'active'")) {
      if (options.staleFinalize) return [];
      if (state !== 'upload_pending') return [];
      state = 'active';
      return [{ state }];
    }
    if (text.includes("set state = 'retired'")) {
      if (options.staleFinalize) return [];
      if (state !== 'delete_pending') return [];
      state = 'retired';
      return [{ state }];
    }
    if (text.includes('reconcile_next_attempt_at = now()')) {
      if (options.staleDefer) return [];
      const knownCodes = values.filter((value) => typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,79}$/.test(value));
      lastError = knownCodes[0] || null;
      return [{ state }];
    }
    throw new Error(`Unexpected SQL in reconciliation test: ${text}`);
  };
  return {
    sql,
    calls,
    getState: () => state,
    getLastError: () => lastError
  };
}

function installDriveScenario({ reads, patchMetadata = validMetadata({ trashed: true }), patchStatus = 200 }) {
  const queue = [...reads];
  let patches = 0;
  let exactReads = 0;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('oauth2.googleapis.com/token')) {
      return Response.json({ access_token: 'background-test-access-token', expires_in: 3600 });
    }
    if (href.includes(`/drive/v3/files/${fileId}?`)) {
      if (init.method === 'PATCH') {
        patches += 1;
        assert.equal(init.body, JSON.stringify({ trashed: true }));
        if (patchStatus === 404) return new Response('', { status: 404 });
        if (patchStatus >= 500) return new Response('', { status: patchStatus });
        return Response.json(patchMetadata, { status: patchStatus });
      }
      exactReads += 1;
      const next = queue.shift();
      if (next instanceof Error) throw next;
      if (next === null) return new Response('', { status: 404 });
      return Response.json(next);
    }
    throw new Error(`Unexpected fetch in reconciliation test: ${href}`);
  };
  return { patches: () => patches, exactReads: () => exactReads };
}

const originalFetch = globalThis.fetch;
try {
  // upload_pending: exact valid object activates without Drive mutation.
  let fixture = makeLifecycleSql('upload_pending');
  let drive = installDriveScenario({ reads: [validMetadata()] });
  let outcome = await reconcileClaimedBusinessImage(env, fixture.sql, claim('upload_pending'), leaseToken);
  assert.equal(outcome, 'activated');
  assert.equal(fixture.getState(), 'active');
  assert.equal(drive.patches(), 0);
  assert.equal(drive.exactReads(), 1);

  // upload_pending 404 is conservative: remain pending and back off.
  fixture = makeLifecycleSql('upload_pending');
  drive = installDriveScenario({ reads: [null] });
  outcome = await reconcileClaimedBusinessImage(env, fixture.sql, claim('upload_pending', 2), leaseToken);
  assert.equal(outcome, 'deferred');
  assert.equal(fixture.getState(), 'upload_pending');
  assert.equal(drive.patches(), 0);

  // upload metadata owner mismatch never mutates Drive.
  fixture = makeLifecycleSql('upload_pending');
  drive = installDriveScenario({ reads: [validMetadata({ uploaderId: '99999999-9999-4999-8999-999999999999' })] });
  outcome = await reconcileClaimedBusinessImage(env, fixture.sql, claim('upload_pending'), leaseToken);
  assert.equal(outcome, 'deferred');
  assert.equal(fixture.getState(), 'upload_pending');
  assert.equal(drive.patches(), 0);

  // delete_pending exact live object is trashed, re-read, then retired.
  fixture = makeLifecycleSql('delete_pending');
  drive = installDriveScenario({ reads: [validMetadata(), validMetadata({ trashed: true })] });
  outcome = await reconcileClaimedBusinessImage(env, fixture.sql, claim('delete_pending'), leaseToken);
  assert.equal(outcome, 'retired');
  assert.equal(fixture.getState(), 'retired');
  assert.equal(drive.patches(), 1);
  assert.equal(drive.exactReads(), 2);

  // delete_pending 404 is authoritative absence for an existing delete intent.
  fixture = makeLifecycleSql('delete_pending');
  drive = installDriveScenario({ reads: [null] });
  outcome = await reconcileClaimedBusinessImage(env, fixture.sql, claim('delete_pending'), leaseToken);
  assert.equal(outcome, 'retired');
  assert.equal(fixture.getState(), 'retired');
  assert.equal(drive.patches(), 0);

  // already-trashed exact metadata also retires without another PATCH.
  fixture = makeLifecycleSql('delete_pending');
  drive = installDriveScenario({ reads: [validMetadata({ trashed: true })] });
  outcome = await reconcileClaimedBusinessImage(env, fixture.sql, claim('delete_pending'), leaseToken);
  assert.equal(outcome, 'retired');
  assert.equal(drive.patches(), 0);

  // delete metadata mismatch is fail-closed and never trashed.
  fixture = makeLifecycleSql('delete_pending');
  drive = installDriveScenario({ reads: [validMetadata({ slug: 'wrong-complex' })] });
  outcome = await reconcileClaimedBusinessImage(env, fixture.sql, claim('delete_pending'), leaseToken);
  assert.equal(outcome, 'deferred');
  assert.equal(fixture.getState(), 'delete_pending');
  assert.equal(drive.patches(), 0);

  // Drive transport failure remains pending for retry.
  fixture = makeLifecycleSql('delete_pending');
  drive = installDriveScenario({ reads: [new Error('synthetic Drive outage')] });
  outcome = await reconcileClaimedBusinessImage(env, fixture.sql, claim('delete_pending'), leaseToken);
  assert.equal(outcome, 'deferred');
  assert.equal(fixture.getState(), 'delete_pending');
  assert.equal(drive.patches(), 0);

  // A stale lease token cannot finalize even after a harmless upload metadata read.
  fixture = makeLifecycleSql('upload_pending', { staleFinalize: true });
  drive = installDriveScenario({ reads: [validMetadata()] });
  outcome = await reconcileClaimedBusinessImage(env, fixture.sql, claim('upload_pending'), leaseToken);
  assert.equal(outcome, 'stale');
  assert.equal(fixture.getState(), 'upload_pending');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('PASS business-image background reconciliation + resolved-state lease cleanup contract');