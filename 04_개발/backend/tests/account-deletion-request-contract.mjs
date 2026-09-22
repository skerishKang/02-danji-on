import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Issue #861 [회원 탈퇴 mock 제거 / Backend API] contract.
// Static source-code contract in the same style as account-lifecycle-contract.mjs:
// no DB is contacted and no production resource is touched.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const runtime = read('src/account-deletion-request-v1.ts');
const auth = read('src/auth-v1.ts');
const app = read('src/app.ts');
const migration = read('migrations/059_account_deletion_requests.sql');
const ledger = JSON.parse(read('migration-safety-ledger.json'));
const manifest = JSON.parse(read('../test-runner.manifest.json'));
const pkg = JSON.parse(read('package.json'));

const PATH = '/api/v1/me/account-deletion-request';
const SCRIPT_ID = 'test:account-deletion-request';

const checks = [
  // --- wiring ---
  ['deletion request route is dispatched from app.ts', app.includes('handleAccountDeletionRequest') && app.includes('./account-deletion-request-v1')],
  ['endpoint path is the canonical me/account route', runtime.includes(`'${PATH}'`)],
  ['only POST is accepted', runtime.includes("request.method !== 'POST'") && runtime.includes("'METHOD_NOT_ALLOWED'")],

  // --- authentication boundary ---
  ['endpoint requires an authenticated actor', runtime.includes('requireActor(') && runtime.includes('actorOrResponse instanceof Response')],
  ['unauthenticated callers fail closed with 401', auth.includes("'AUTH_REQUIRED'") && auth.includes('401') && runtime.includes('requireActor(request, env, sql, requestId)')],
  ['stored user id comes from the authenticated actor only', runtime.includes('createDeletionRequest(request, sql, actor.id, requestId)') && !runtime.includes('body.user') && !runtime.includes('userIdRaw')],

  // --- duplicate pending request ---
  ['duplicate pending request returns 409', runtime.includes("'DELETION_REQUEST_ALREADY_PENDING'") && runtime.includes('409')],
  ['duplicate guard is also enforced at the database level', migration.includes('create unique index if not exists uq_account_deletion_requests_pending') && migration.includes("where status = 'pending'")],
  ['duplicate race is caught via unique violation', runtime.includes("'23505'")],
  ['pending existence is pre-checked before insert', runtime.includes('where not exists') && runtime.includes("status = ${PENDING_STATUS}")],

  // --- permission boundary on the body ---
  ['only an optional reason is accepted', runtime.includes("Object.keys(body).some((key) => key !== 'reason')")],
  ['reason length is bounded', runtime.includes('MAX_REASON_LENGTH = 500')],
  ['reason length is also bounded by the shared payload policy', read('src/payload-policy.ts').includes('reason: 500')],

  // --- response shape ---
  ['success is a 201 with the pending record', runtime.includes('}, requestId, 201)') && runtime.includes("status: String(row.status)") && runtime.includes('requestedAt: row.requested_at')],
  ['errors use the { error: { code, message } } envelope', runtime.includes('{ error: { code, message }, requestId }')],

  // --- no account/user deletion or mutation ---
  ['runtime never deletes account data', !/(delete|truncate)\b/i.test(runtime.replace(/\/\/[^\n]*/g, ''))],
  ['runtime never mutates app_users', !runtime.includes('update app_users') && !runtime.includes('delete from app_users')],
  ['migration only creates the request table', /create table if not exists account_deletion_requests/.test(migration) && !/\b(drop|delete|truncate|update)\b/i.test(migration.replace(/--[^\n]*/g, ''))],
  ['migration is idempotent', migration.includes('create table if not exists') && migration.includes('create index if not exists')],
  ['migration declares the required columns', ['id', 'user_id', 'status', 'requested_at', 'processed_at', 'reason'].every((col) => migration.includes(col))],
  ['migration defaults new requests to pending', migration.includes("default 'pending'") && migration.includes("check (status in ('pending', 'processed', 'cancelled'))")],
  ['migration does not declare a cascading foreign key', !migration.includes('references app_users')],

  // --- registration ---
  ['migration is registered in the safety ledger as schema', ledger.migrations['059_account_deletion_requests.sql']?.class === 'schema' && ledger.migrations['059_account_deletion_requests.sql']?.marker?.name === 'account_deletion_requests'],
  ['contract is registered in package.json', pkg.scripts[SCRIPT_ID] === 'node tests/account-deletion-request-contract.mjs'],
  ['contract is registered in the backend manifest run order', manifest.scopes.backend.run.some((step) => step.id === SCRIPT_ID)]
];

const failed = checks.filter(([, pass]) => !pass);
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`\n${failed.length} account deletion request contract check(s) failed.`);
  process.exit(1);
}
console.log(`\n${checks.length} account deletion request contract checks passed.`);
