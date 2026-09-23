import assert from 'node:assert/strict';
import {
  ROOT_CLASS,
  MAX_RETRY_ATTEMPTS,
  classifyFailure,
  shouldRetry,
  withBoundedRetry,
  resolveRootClass,
  checkCredentialBinding,
  redactSecrets,
  safeBody,
  buildReport,
  isMutationPath
} from '../scripts/qa-auth-diagnostic-classifier.mjs';
import { diagnosePersona, exactHttpsOrigin } from '../scripts/qa-auth-diagnostic.mjs';

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

const PERSONA = { name: 'QA_SUPER', emailEnv: 'DANJION_QA_SUPER_EMAIL', passwordEnv: 'DANJION_QA_SUPER_PASSWORD', email: 'stub@example.com' };
const PASSWORD = 'stub-password-value';
const API = 'https://padiem-danjion-api-qa.padiem.workers.dev';
const FRONTEND = 'https://danjion-qa.pages.dev';

function makeFetch(script) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input.url || input.href);
    const method = String(init.method || 'GET').toUpperCase();
    calls.push({ url, method });
    const next = script.shift();
    if (!next) throw new Error('unexpected_fetch_call');
    if (next.throw) throw next.throw;
    return next.response;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function successSigninScript() {
  return [
    { response: jsonResponse(200, { token: 'stub-session' }, { 'set-cookie': 'better-auth.session=abc; Path=/', 'set-auth-token': 'stub-bearer' }) },
    { response: jsonResponse(200, { user: { id: 'user-1' } }, { 'set-auth-jwt': 'stub-jwt' }) },
    { response: jsonResponse(200, { data: { id: 'user-1' } }) }
  ];
}

async function testCredentialMismatch401() {
  const fetchImpl = makeFetch([{ response: jsonResponse(401, { error: { code: 'INVALID_EMAIL_OR_PASSWORD' } }) }]);
  const result = await diagnosePersona(API, FRONTEND, PERSONA, PASSWORD, fetchImpl);
  assert.equal(result.ROOT_CLASS, ROOT_CLASS.AUTH_CREDENTIAL_MISMATCH);
  assert.equal(result.retries, 0, 'deterministic 401 must not retry');
}

async function testForbidden403() {
  const fetchImpl = makeFetch([
    { response: jsonResponse(200, { token: 'stub-session' }, { 'set-cookie': 'better-auth.session=abc; Path=/', 'set-auth-token': 'stub-bearer' }) },
    { response: jsonResponse(200, { user: { id: 'user-1' } }, { 'set-auth-jwt': 'stub-jwt' }) },
    { response: jsonResponse(403, { error: { code: 'FORBIDDEN' } }) }
  ]);
  const result = await diagnosePersona(API, FRONTEND, PERSONA, PASSWORD, fetchImpl);
  assert.equal(result.ROOT_CLASS, ROOT_CLASS.AUTH_FORBIDDEN);
  assert.equal(result.SIGNIN_STATUS, 200);
}

async function testSignin500() {
  const fetchImpl = makeFetch([
    { response: jsonResponse(500, { error: { code: 'INTERNAL' } }) },
    { response: jsonResponse(500, { error: { code: 'INTERNAL' } }) },
    { response: jsonResponse(500, { error: { code: 'INTERNAL' } }) }
  ]);
  const result = await diagnosePersona(API, FRONTEND, PERSONA, PASSWORD, fetchImpl);
  assert.equal(result.ROOT_CLASS, ROOT_CLASS.AUTH_SERVER_FAILURE);
  assert.ok(result.retries > 0, '5xx must retry');
  assert.ok(result.retries <= MAX_RETRY_ATTEMPTS);
}

async function testSigninTimeout() {
  const timeoutError = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const fetchImpl = makeFetch([
    { throw: timeoutError },
    { throw: timeoutError },
    { throw: timeoutError }
  ]);
  const result = await diagnosePersona(API, FRONTEND, PERSONA, PASSWORD, fetchImpl);
  assert.equal(result.ROOT_CLASS, ROOT_CLASS.NETWORK_TIMEOUT);
  assert.ok(result.retries > 0, 'timeout must retry');
}

async function testSessionFailureAfterSignin200() {
  const fetchImpl = makeFetch([
    { response: jsonResponse(200, { token: 'stub-session' }, { 'set-cookie': 'better-auth.session=abc; Path=/', 'set-auth-token': 'stub-bearer' }) },
    { response: jsonResponse(500, { error: { code: 'INTERNAL' } }) }
  ]);
  const result = await diagnosePersona(API, FRONTEND, PERSONA, PASSWORD, fetchImpl);
  assert.equal(result.SIGNIN_STATUS, 200, 'sign-in success must be reported separately');
  assert.equal(result.ROOT_CLASS, ROOT_CLASS.SESSION_FAILURE);
  assert.equal(result.POST_SIGNIN, ROOT_CLASS.SESSION_FAILURE);
}

async function testDbFailureAfterSignin200() {
  const dbError = new Error('error connecting to database');
  const fetchImpl = makeFetch([
    { response: jsonResponse(200, { token: 'stub-session' }, { 'set-cookie': 'better-auth.session=abc; Path=/', 'set-auth-token': 'stub-bearer' }) },
    { response: jsonResponse(200, { user: { id: 'user-1' } }, { 'set-auth-jwt': 'stub-jwt' }) },
    { throw: dbError }
  ]);
  const result = await diagnosePersona(API, FRONTEND, PERSONA, PASSWORD, fetchImpl);
  assert.equal(result.SIGNIN_STATUS, 200, 'sign-in success must be reported separately');
  assert.equal(result.ROOT_CLASS, ROOT_CLASS.DB_INFRA_FAILURE);
}

async function testAuthorityFailureAfterSignin200() {
  const fetchImpl = makeFetch([
    { response: jsonResponse(200, { token: 'stub-session' }, { 'set-cookie': 'better-auth.session=abc; Path=/', 'set-auth-token': 'stub-bearer' }) },
    { response: jsonResponse(200, { user: { id: 'user-1' } }, { 'set-auth-jwt': 'stub-jwt' }) },
    { response: jsonResponse(500, { error: { code: 'AUTHORITY_UNAVAILABLE' } }) }
  ]);
  const result = await diagnosePersona(API, FRONTEND, PERSONA, PASSWORD, fetchImpl);
  assert.equal(result.SIGNIN_STATUS, 200);
  assert.equal(result.ROOT_CLASS, ROOT_CLASS.AUTHORITY_FAILURE);
}

async function testTransient503RetrySuccess() {
  const fetchImpl = makeFetch([
    { response: jsonResponse(503, { error: { code: 'UNAVAILABLE' } }) },
    ...successSigninScript()
  ]);
  const result = await diagnosePersona(API, FRONTEND, PERSONA, PASSWORD, fetchImpl);
  assert.equal(result.ROOT_CLASS, ROOT_CLASS.SUCCESS);
  assert.ok(result.retries >= 1, 'transient 503 must retry at least once');
}

async function testDeterministic401NoRetry() {
  await testCredentialMismatch401();
}

async function testSecretRedaction() {
  const secret = 'super-secret-password-1234';
  const report = buildReport({
    personas: { QA_SUPER: { ROOT_CLASS: ROOT_CLASS.SUCCESS, DETAIL: `echo ${secret}` } },
    probes: {},
    forbiddenMutationCount: 0,
    secretValues: [secret]
  });
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes(secret), 'report must not contain the raw secret');
  assert.ok(serialized.includes('[REDACTED]'), 'secret must be replaced with a redaction marker');
  assert.equal(report.SECRET_EXPOSURE, 'NO');
}

async function testForbiddenMutationCountZero() {
  const fetchImpl = makeFetch(successSigninScript());
  await diagnosePersona(API, FRONTEND, PERSONA, PASSWORD, fetchImpl);
  const mutationCalls = fetchImpl.calls.filter((call) => call.method !== 'GET' && call.method !== 'HEAD' && isMutationPath(call.url));
  assert.equal(mutationCalls.length, 0, 'read-only diagnostic must never call a mutation endpoint');

  const signinCall = fetchImpl.calls.find((call) => call.url.endsWith('/api/auth/sign-in/email'));
  assert.equal(signinCall?.method, 'POST', 'sign-in POST is an allowed diagnostic operation');

  const report = buildReport({ personas: {}, probes: {}, forbiddenMutationCount: 0 });
  assert.equal(report.FORBIDDEN_MUTATION_COUNT, 0);
  assert.ok(!isMutationPath('/api/auth/sign-in/email'), 'sign-in is a diagnostic probe, not a mutation path');
  assert.ok(isMutationPath('/api/auth/sign-up/email'), 'sign-up must be flagged as a mutation path');
}

async function testInfrastructureCorrelationScope() {
  const personaFailure = { QA_SUPER: { ROOT_CLASS: ROOT_CLASS.AUTH_SERVER_FAILURE }, QA_OPERATIONAL: { ROOT_CLASS: ROOT_CLASS.AUTH_SERVER_FAILURE } };

  const personaOnly = buildReport({
    personas: personaFailure,
    probes: {
      health: { rootClass: ROOT_CLASS.SUCCESS },
      jwks: { rootClass: ROOT_CLASS.SUCCESS }
    }
  });
  assert.equal(personaOnly.INFRA_CORRELATED, 'NO');
  assert.equal(personaOnly.NEON_COLD_START_SUSPECTED, 'NO');

  const singleProbe = buildReport({
    personas: { QA_SUPER: { ROOT_CLASS: ROOT_CLASS.AUTH_SERVER_FAILURE } },
    probes: {
      health: { rootClass: ROOT_CLASS.AUTH_SERVER_FAILURE },
      jwks: { rootClass: ROOT_CLASS.SUCCESS }
    }
  });
  assert.equal(singleProbe.INFRA_CORRELATED, 'NO');
  assert.equal(singleProbe.NEON_COLD_START_SUSPECTED, 'NO');

  for (const healthClass of [ROOT_CLASS.AUTH_SERVER_FAILURE, ROOT_CLASS.DB_INFRA_FAILURE]) {
    const dualProbe = buildReport({
      personas: {},
      probes: {
        health: { rootClass: healthClass },
        jwks: { rootClass: ROOT_CLASS.AUTH_SERVER_FAILURE }
      }
    });
    assert.equal(dualProbe.INFRA_CORRELATED, 'YES');
    assert.equal(dualProbe.NEON_COLD_START_SUSPECTED, 'YES');
  }
}

async function testMalformedSecretFailClosed() {
  const missing = checkCredentialBinding('DANJION_QA_SUPER_PASSWORD', '');
  assert.equal(missing.ok, false);
  assert.equal(missing.rootClass, ROOT_CLASS.SECRET_BINDING_FAILURE);

  const malformed = checkCredentialBinding('DANJION_QA_SUPER_PASSWORD', 'short');
  assert.equal(malformed.ok, false);
  assert.equal(malformed.rootClass, ROOT_CLASS.SECRET_BINDING_FAILURE);

  const fetchImpl = makeFetch([]);
  const result = await diagnosePersona(API, FRONTEND, PERSONA, '', fetchImpl);
  assert.equal(result.ROOT_CLASS, ROOT_CLASS.SECRET_BINDING_FAILURE);
  assert.equal(fetchImpl.calls.length, 0, 'a missing binding must fail closed before any network call');
}

async function testClassificationUnitRules() {
  assert.equal(classifyFailure({ stage: 'signin', status: 401, bodyText: '' }), ROOT_CLASS.AUTH_CREDENTIAL_MISMATCH);
  assert.equal(classifyFailure({ stage: 'authority', status: 403, bodyText: '' }), ROOT_CLASS.AUTH_FORBIDDEN);
  assert.equal(classifyFailure({ stage: 'signin', status: 500, bodyText: '' }), ROOT_CLASS.AUTH_SERVER_FAILURE);
  assert.equal(classifyFailure({ stage: 'signin', error: Object.assign(new Error('timeout'), { name: 'TimeoutError' }) }), ROOT_CLASS.NETWORK_TIMEOUT);
  assert.equal(classifyFailure({ stage: 'authority', bodyText: 'error connecting to database' }), ROOT_CLASS.DB_INFRA_FAILURE);

  assert.equal(shouldRetry(ROOT_CLASS.AUTH_CREDENTIAL_MISMATCH, 1), false, '401 must never retry');
  assert.equal(shouldRetry(ROOT_CLASS.AUTH_FORBIDDEN, 1), false, '403 must never retry');
  assert.equal(shouldRetry(ROOT_CLASS.AUTH_SERVER_FAILURE, 1), true);
  assert.equal(shouldRetry(ROOT_CLASS.NETWORK_TIMEOUT, MAX_RETRY_ATTEMPTS), false, 'retry must stay bounded');

  assert.equal(resolveRootClass([
    { rootClass: ROOT_CLASS.SUCCESS },
    { rootClass: ROOT_CLASS.SESSION_FAILURE }
  ]), ROOT_CLASS.SESSION_FAILURE);

  assert.equal(safeBody('{"code":"INVALID_EMAIL_OR_PASSWORD"}'), 'code=INVALID_EMAIL_OR_PASSWORD body=json');
  assert.ok(!safeBody('password=super-secret-value').includes('super-secret'), 'safeBody must never echo raw bodies');

  assert.equal(redactSecrets('token=abc123secret', ['abc123secret']), 'token=[REDACTED]');
}

async function testProductionTargetForbidden() {
  assert.throws(
    () => exactHttpsOrigin('https://padiem-danjion-api-production.padiem.workers.dev', 'API', 'padiem-danjion-api-qa.padiem.workers.dev'),
    /QA_AUTH_DIAG_UNSAFE_TARGET|QA_AUTH_DIAG_PRODUCTION_TARGET_FORBIDDEN/
  );
  assert.throws(
    () => exactHttpsOrigin('https://evil.example.com', 'API', 'padiem-danjion-api-qa.padiem.workers.dev'),
    /QA_AUTH_DIAG_UNSAFE_TARGET/
  );
}

const tests = [
  ['401 credential mismatch', testCredentialMismatch401],
  ['403 authority failure', testForbidden403],
  ['sign-in 500', testSignin500],
  ['sign-in timeout', testSigninTimeout],
  ['sign-in 200 + session failure', testSessionFailureAfterSignin200],
  ['sign-in 200 + DB failure', testDbFailureAfterSignin200],
  ['sign-in 200 + authority failure', testAuthorityFailureAfterSignin200],
  ['transient 503 retry success', testTransient503RetrySuccess],
  ['deterministic 401 no retry', testDeterministic401NoRetry],
  ['secret redaction', testSecretRedaction],
  ['forbidden mutation count zero', testForbiddenMutationCountZero],
  ['malformed secret fail-closed', testMalformedSecretFailClosed],
  ['classification unit rules', testClassificationUnitRules],
  ['infrastructure correlation scope', testInfrastructureCorrelationScope],
  ['production target forbidden', testProductionTargetForbidden]
];

let passed = 0;
for (const [name, fn] of tests) {
  await fn();
  console.log(`PASS ${name}`);
  passed += 1;
}
console.log(`qa-auth-diagnostic-classifier-contract: PASS (${passed}/${tests.length})`);
