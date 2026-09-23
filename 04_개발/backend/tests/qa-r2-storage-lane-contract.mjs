import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  STATUS,
  RETRY_POLICY,
  assertNonProductionTargets,
  assertRemoteOnly,
  classifyError,
  classifyHttpStatus,
  isRetryableStatus,
  parseRetryAfterMs,
  shouldRetry,
  stepResult,
  summarizeResults,
  validateFixtures,
  validateObjectKey,
  redactSecrets
} from './runtime-qa-r2-storage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const runtimePath = join(here, 'runtime-qa-r2-storage.mjs');
const runtime = readFileSync(runtimePath, 'utf8');
const workflowPath = join(repoRoot, '.github', 'workflows', 'qa-r2-storage-validation.yml');
const workflow = readFileSync(workflowPath, 'utf8');

// --- unit: classification ---
assert.equal(classifyHttpStatus(200), STATUS.PASS);
assert.equal(classifyHttpStatus(201), STATUS.PASS);
assert.equal(classifyHttpStatus(401), STATUS.AUTH_FAILURE);
assert.equal(classifyHttpStatus(403), STATUS.AUTH_FAILURE);
assert.equal(classifyHttpStatus(429), STATUS.RATE_LIMITED);
assert.equal(classifyHttpStatus(500), STATUS.APPLICATION_FAILURE);
assert.equal(classifyHttpStatus(400), STATUS.APPLICATION_FAILURE);
assert.equal(classifyHttpStatus(404), STATUS.APPLICATION_FAILURE);
assert.equal(classifyError(Object.assign(new Error('t'), { name: 'AbortError' })), STATUS.INFRA_FAILURE);
assert.equal(classifyError(Object.assign(new Error('e'), { cause: { code: 'ECONNREFUSED' } })), STATUS.INFRA_FAILURE);

// --- unit: retry separation ---
assert.equal(isRetryableStatus(500), true);
assert.equal(isRetryableStatus(502), true);
assert.equal(isRetryableStatus(503), true);
assert.equal(isRetryableStatus(504), true);
assert.equal(isRetryableStatus(401), false);
assert.equal(isRetryableStatus(403), false);
assert.equal(isRetryableStatus(429), false);
assert.equal(isRetryableStatus(400), false);
assert.equal(isRetryableStatus(404), false);

assert.equal(shouldRetry({
  attempt: 1,
  maxAttempts: RETRY_POLICY.networkAttempts,
  error: Object.assign(new Error('x'), { name: 'AbortError' })
}), true);
assert.equal(shouldRetry({
  attempt: RETRY_POLICY.networkAttempts,
  maxAttempts: RETRY_POLICY.networkAttempts,
  error: Object.assign(new Error('x'), { name: 'AbortError' })
}), false);
assert.equal(shouldRetry({
  attempt: 1,
  maxAttempts: RETRY_POLICY.serverAttempts,
  status: 503
}), true);
assert.equal(shouldRetry({ attempt: 1, maxAttempts: 3, status: 401 }), false);
assert.equal(shouldRetry({ attempt: 1, maxAttempts: 3, status: 403 }), false);
assert.equal(shouldRetry({ attempt: 1, maxAttempts: 3, status: 429 }), false);
assert.equal(shouldRetry({ attempt: 1, maxAttempts: 3, status: 400 }), false);

assert.ok(RETRY_POLICY.networkAttempts >= 1 && RETRY_POLICY.networkAttempts <= 5, 'network retry must stay small/bounded');
assert.ok(RETRY_POLICY.serverAttempts >= 1 && RETRY_POLICY.serverAttempts <= 5, '5xx retry must stay small/bounded');
assert.ok(RETRY_POLICY.timeoutMs > 0 && RETRY_POLICY.timeoutMs <= 60000, 'timeout must be bounded');

// --- unit: remote-only / production deny ---
assert.throws(
  () => assertRemoteOnly({ remoteFlag: false, envRemote: '', apiUrl: 'https://padiem-danjion-api-qa.padiem.workers.dev' }),
  /REMOTE_ONLY_REQUIRED/
);
assert.throws(
  () => assertRemoteOnly({ remoteFlag: true, envRemote: '', apiUrl: 'http://localhost:8787' }),
  /LOCAL_TARGET_FORBIDDEN|HTTPS_REQUIRED/
);
assert.throws(
  () => assertRemoteOnly({ remoteFlag: true, envRemote: '', apiUrl: 'https://127.0.0.1' }),
  /LOCAL_TARGET_FORBIDDEN/
);
assert.doesNotThrow(() => assertRemoteOnly({
  remoteFlag: true,
  envRemote: '',
  apiUrl: 'https://padiem-danjion-api-qa.padiem.workers.dev'
}));
assert.doesNotThrow(() => assertRemoteOnly({
  remoteFlag: false,
  envRemote: '1',
  apiUrl: 'https://padiem-danjion-api-qa.padiem.workers.dev'
}));

assert.throws(
  () => assertNonProductionTargets(
    'https://padiem-danjion-api-production.padiem.workers.dev',
    'https://danjion-qa.pages.dev'
  ),
  /PRODUCTION_API_TARGET_FORBIDDEN/
);
assert.throws(
  () => assertNonProductionTargets(
    'https://padiem-danjion-api-qa.padiem.workers.dev',
    'https://danjion.pages.dev'
  ),
  /PRODUCTION_PAGES_TARGET_FORBIDDEN/
);
assert.throws(
  () => assertNonProductionTargets(
    'https://example.workers.dev',
    'https://danjion-qa.pages.dev'
  ),
  /QA_API_TARGET_INVALID/
);
assert.doesNotThrow(() => assertNonProductionTargets(
  'https://padiem-danjion-api-qa.padiem.workers.dev',
  'https://danjion-qa.pages.dev'
));

// --- unit: fixture / enum validation before network ---
const good = validateFixtures({
  email: 'skerish_people_test@naver.com',
  password: 'abcdefghij',
  complexSlug: 'banglim-myeongji-roadhill',
  relationRaw: 'self',
  relationType: '',
  businessName: 'B',
  categoryName: '카페',
  serviceSummary: 'S'
});
assert.equal(good.ok, true, good.errors.join(','));

assert.equal(validateFixtures({ ...good.fixture, relationRaw: 'owner' }).ok, false);
assert.equal(validateFixtures({ ...good.fixture, relationRaw: 'owner' }).errors.includes('INVALID_FIXTURE_RELATION_RAW_ENUM'), true);
assert.equal(validateFixtures({ ...good.fixture, relationType: 'owner' }).errors.includes('INVALID_FIXTURE_RELATION_TYPE_ENUM'), true);
assert.equal(validateFixtures({
  ...good.fixture,
  relationRaw: 'self',
  relationType: 'neighbor'
}).errors.includes('INVALID_FIXTURE_RELATION_MISMATCH'), true);
assert.equal(validateFixtures({ ...good.fixture, email: 'not-an-email' }).ok, false);
assert.equal(validateFixtures({ ...good.fixture, password: 'short' }).ok, false);

// --- unit: objectKey shape ---
assert.equal(validateObjectKey('gdrive/public/business-image/1a944861cde147ca81b26065dd41330f'), true);
assert.equal(validateObjectKey('gdrive/public/business-image/bad'), false);
assert.equal(validateObjectKey('not-a-key'), false);
assert.equal(validateObjectKey(''), false);

// --- unit: summarize ---
const summary = summarizeResults([
  stepResult('A', STATUS.PASS),
  stepResult('E', STATUS.APPLICATION_FAILURE, { httpStatus: 500 }),
  stepResult('G', STATUS.RATE_LIMITED, { httpStatus: 429 })
]);
assert.equal(summary.overall, STATUS.RATE_LIMITED);
assert.equal(summary.counts.APPLICATION_FAILURE, 1);

const summaryHarness = summarizeResults([
  stepResult('A', STATUS.PASS),
  stepResult('X', STATUS.HARNESS_FAILURE)
]);
assert.equal(summaryHarness.overall, STATUS.HARNESS_FAILURE);

// --- unit: redaction ---
const redacted = redactSecrets('password=hunter2token=abc Authorization: Bearer xyz.abc.def eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart');
assert.ok(!redacted.includes('hunter2'), 'password must be redacted');
assert.ok(!redacted.includes('eyJhbGciOiJIUzI1NiJ9'), 'jwt must be redacted');
assert.ok(redacted.includes('***') || redacted.includes('REDACTED'));

const fakeHeaders = { headers: { get: (k) => (k.toLowerCase() === 'retry-after' ? '7' : null) } };
assert.equal(parseRetryAfterMs(fakeHeaders), 7000);

// --- static: runtime source contracts ---
assert.ok(runtime.includes('REMOTE_ONLY_REQUIRED'), 'runtime must require remote-only mode');
assert.ok(runtime.includes('PRODUCTION_API_TARGET_FORBIDDEN'), 'runtime must deny production API');
assert.ok(runtime.includes('PRODUCTION_PAGES_TARGET_FORBIDDEN'), 'runtime must deny production Pages');
assert.ok(runtime.includes('LOCAL_TARGET_FORBIDDEN'), 'runtime must deny loopback/local targets');
assert.ok(runtime.includes('--remote'), 'runtime must accept explicit --remote flag');
assert.ok(runtime.includes('DANJION_QA_REMOTE'), 'runtime must accept env remote switch');
assert.ok(runtime.includes('INVALID_FIXTURE_RELATION_RAW_ENUM'), 'runtime must reject bad relationRaw enum');
assert.ok(runtime.includes('FIXTURE_INVALID'), 'runtime must fail-closed invalid fixtures before network');
assert.ok(runtime.includes('SECRET_OUTPUT=NO'), 'runtime must assert no secret output');
assert.ok(runtime.includes('TOKEN_OUTPUT=NO'), 'runtime must assert no token output');
assert.ok(runtime.includes('COOKIE_OUTPUT=NO'), 'runtime must assert no cookie output');
assert.ok(runtime.includes('IDENTITY_SOURCE=ENV_DANJION_QA_EMAIL'), 'test identity must be explicit');
assert.ok(runtime.includes('STREAM_MISSING_RESULT'), 'runtime must classify missing-object stream');
assert.ok(runtime.includes('ATTACH_RATE_LIMIT_RESULT'), 'runtime must classify attach rate limit');
assert.ok(runtime.includes('BLOCKED_RATE_LIMIT'), 'runtime must mark blocked rate limit');
assert.ok(runtime.includes('STATUS.RATE_LIMITED'), 'runtime must expose RATE_LIMITED status');
assert.ok(runtime.includes('AbortError'), 'runtime must classify timeout as infra');
assert.ok(runtime.includes('ECONNREFUSED'), 'runtime must classify network errors as infra');

assert.ok(
  !/console\.(log|error|warn)\([^\n]*\b(password|jwt|cookie|set-auth-jwt)\b\s*[:=]/i.test(runtime),
  'runtime must not log credential field values'
);
assert.ok(!runtime.includes('wrangler deploy'), 'runtime must not deploy');
assert.ok(!runtime.includes('PRODUCTION_MUTATION=1'), 'runtime must keep production mutation 0');
assert.ok(runtime.includes('PRODUCTION_MUTATION=0'), 'runtime must report production mutation 0');

// no dependency on #910 product sources for mutation
for (const forbidden of [
  "from '../src/storage-r2-v1",
  "from '../src/storage-v1",
  "from '../src/storage-upload-v2",
  "from '../src/storage-reference-v1"
]) {
  assert.ok(!runtime.includes(forbidden), `runtime must not import #910 product module: ${forbidden}`);
}

// stale command/path guard
assert.ok(!runtime.includes('gdrive auth'), 'obsolete gdrive CLI path forbidden');
assert.ok(!runtime.includes('wrangler r2 object put'), 'obsolete wrangler r2 put path forbidden');
assert.ok(!runtime.includes('--local'), 'runtime must not offer a local validation switch');

// --- workflow contract ---
assert.match(workflow, /workflow_dispatch:/, 'workflow must be dispatch-capable');
assert.match(workflow, /environment:\s*qa/, 'live job must use qa environment');
assert.match(workflow, /expected_main:/, 'dispatch must require exact main');
assert.match(workflow, /git ls-remote origin refs\/heads\/main/, 'must fresh-read remote main');
assert.match(workflow, /github\.event_name == 'workflow_dispatch'/, 'live job must not auto-run');
for (const name of [
  'DANJION_QA_API_URL',
  'DANJION_QA_FRONTEND_URL',
  'DANJION_QA_EMAIL',
  'DANJION_QA_PASSWORD'
]) {
  assert.ok(workflow.includes(name), `workflow missing QA binding ${name}`);
}
for (const forbidden of [
  'DANJION_PRODUCTION_DB_URL',
  'wrangler deploy',
  'pages deploy',
  'production-worker-bootstrap',
  'pages-production-release'
]) {
  assert.ok(!workflow.includes(forbidden), `workflow must not carry production/deploy authority: ${forbidden}`);
}
assert.ok(workflow.includes('--remote'), 'workflow live job must pass --remote');
assert.ok(workflow.includes('qa-r2-storage-lane-contract.mjs'), 'workflow must run source contract');
assert.ok(workflow.includes('runtime-qa-r2-storage.mjs'), 'workflow must run runtime harness');

// product sources on this main baseline must remain untouched (read-only check).
// storage-r2-v1.ts lives only on #910 branch and is intentionally not asserted here.
const productFiles = [
  '04_개발/backend/src/storage-v1.ts',
  '04_개발/backend/src/storage-upload-v2.ts',
  '04_개발/backend/src/storage-reference-v1.ts',
  '04_개발/backend/src/storage-reconciliation-v1.ts',
  '04_개발/backend/src/application-docs-core-v1.ts',
  '04_개발/backend/src/worker-v2.ts',
  '04_개발/backend/src/app.ts'
];
for (const rel of productFiles) {
  const abs = join(repoRoot, rel);
  const src = readFileSync(abs, 'utf8');
  assert.ok(typeof src === 'string' && src.length > 0, `product file readable: ${rel}`);
}
const ref = readFileSync(join(repoRoot, '04_개발/backend/src/storage-reference-v1.ts'), 'utf8');
assert.ok(ref.includes('validateOfficialNewsImageReference'), '#844 lane function must remain in product source');
assert.ok(!ref.includes('runtime-qa-r2-storage'), 'product reference source must not reference harness');

console.log('qa-r2-storage-lane-contract: PASS');
