import assert from 'node:assert/strict';
import {
  acquireAccount,
  exactHttpsOrigin,
  failureStage,
  failureToken,
  fetchPersonaMe,
  formatAcquisitionFailure,
  formatDiagnosisCounts,
  formatPinnedAuthority,
  signinStatus,
  withDbRetry
} from '../scripts/qa-persona-provision-lite.mjs';

/*
 * #868 QA acceptance lane: the lite provisioning script must keep the same
 * fail-closed target binding as the full persona lane — exact https origin, exact
 * host, no path/query/hash — and must probe the auth bridge with the QA frontend
 * origin only.
 *
 * It also pins the two account-acquisition modes against a stubbed transport: the
 * read-only diagnosis (#868 Phase 5-2-D) may only read the structure and probe
 * sign-in, while the write path must create-or-tolerate the account first.
 */

const apiOrigin = exactHttpsOrigin(
  'https://padiem-danjion-api-qa.padiem.workers.dev/',
  'API',
  'padiem-danjion-api-qa.padiem.workers.dev'
);
const frontendOrigin = exactHttpsOrigin(
  'https://danjion-qa.pages.dev/',
  'FRONTEND',
  'danjion-qa.pages.dev'
);

assert.throws(
  () => exactHttpsOrigin(
    'https://padiem-danjion-api-production.padiem.workers.dev/',
    'API',
    'padiem-danjion-api-qa.padiem.workers.dev'
  ),
  /QA_PERSONA_LITE_UNSAFE_TARGET:API/
);
assert.throws(
  () => exactHttpsOrigin('https://malicious.example/', 'API', 'padiem-danjion-api-qa.padiem.workers.dev'),
  /QA_PERSONA_LITE_UNSAFE_TARGET:API/
);
assert.throws(
  () => exactHttpsOrigin('https://danjion-qa.pages.dev/deep', 'FRONTEND', 'danjion-qa.pages.dev'),
  /QA_PERSONA_LITE_UNSAFE_TARGET:FRONTEND/
);

const requests = [];
const okResponse = await fetchPersonaMe(apiOrigin, frontendOrigin, 'jwt-for-contract-test', 'QA_RESIDENT', async (request, init) => {
  requests.push({ request, init });
  return new Response(JSON.stringify({ data: { id: 'safe-test-actor' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
});

assert.equal(okResponse.status, 200);
assert.equal(requests.length, 1);
assert.equal(String(requests[0].request), 'https://padiem-danjion-api-qa.padiem.workers.dev/api/v1/me');
assert.equal(requests[0].init.headers.authorization, 'Bearer jwt-for-contract-test');
assert.equal(requests[0].init.headers.origin, 'https://danjion-qa.pages.dev');

await assert.rejects(
  () => fetchPersonaMe(apiOrigin, frontendOrigin, 'jwt-for-contract-test', 'QA_RESIDENT', async () => (
    new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED' } }), { status: 401 })
  )),
  /QA_PERSONA_LITE_AUTH_BRIDGE_QA_RESIDENT_HTTP_401/
);

// --- read-only diagnosis must write nothing ---------------------------------
process.env.DANJION_QA_SUPER_PASSWORD = 'contract-only-password';

const sqlStatements = [];
const sqlStub = (strings) => {
  sqlStatements.push(strings.join('?'));
  return Promise.resolve([{ id: 'contract-app-user' }]);
};
const personaAccount = {
  name: 'QA_SUPER',
  email: 'skerish_super_test@naver.com',
  passwordEnv: 'DANJION_QA_SUPER_PASSWORD'
};

const readOnlyRequests = [];
const readOnlyFetch = async (request, init) => {
  readOnlyRequests.push(`${init?.method || 'GET'} ${String(request)}`);
  if (String(request).includes('/api/auth/sign-in/email')) {
    return new Response(JSON.stringify({ error: { code: 'INVALID_EMAIL_OR_PASSWORD' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    });
  }
  throw new Error(`read-only diagnosis must not call ${request}`);
};

const readOnlyResult = await acquireAccount(frontendOrigin, apiOrigin, sqlStub, personaAccount, readOnlyFetch, false, false);
assert.equal(readOnlyResult, null, 'a refused identity must be reported, not thrown, in read-only mode');
assert.deepEqual(readOnlyRequests, ['POST https://danjion-qa.pages.dev/api/auth/sign-in/email'],
  'read-only diagnosis must never sign up or open a session');
assert.equal(sqlStatements.length, 2,
  'read-only diagnosis must issue exactly the structure read and the post-refusal re-read');
assert.ok(sqlStatements.every((statement) => /^\s*select\b/i.test(statement)),
  'read-only diagnosis must issue nothing but SELECT statements');
assert.doesNotMatch(sqlStatements[0], /\b(insert|update|delete)\b/i,
  'read-only diagnosis must issue no write statement');

// The default write path must still create-or-tolerate the account first.
const writeRequests = [];
const writeFetch = async (request, init) => {
  writeRequests.push(`${init?.method || 'GET'} ${String(request)}`);
  if (String(request).includes('/api/auth/sign-up/email')) {
    return new Response(JSON.stringify({ error: { code: 'USER_ALREADY_EXISTS' } }), {
      status: 422,
      headers: { 'content-type': 'application/json' }
    });
  }
  if (String(request).includes('/api/auth/sign-in/email')) {
    return new Response(JSON.stringify({ error: { code: 'INVALID_EMAIL_OR_PASSWORD' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    });
  }
  throw new Error(`unexpected write-path request: ${request}`);
};

await assert.rejects(
  () => acquireAccount(frontendOrigin, apiOrigin, sqlStub, personaAccount, writeFetch, false, true),
  /QA_PERSONA_LITE_SIGNIN_PASSWORD_MISMATCH:QA_SUPER/,
  'the write path must report an unusable stored credential'
);
assert.deepEqual(writeRequests, [
  'POST https://danjion-qa.pages.dev/api/auth/sign-up/email',
  'POST https://danjion-qa.pages.dev/api/auth/sign-in/email'
], 'the write path must tolerate USER_ALREADY_EXISTS and then sign in');
assert.ok(sqlStatements.every((statement) => !/\b(insert|update|delete)\b/i.test(statement)),
  'with repair off every auth row must stay untouched');

// --- the failing stage must be named, never the credential -------------------
assert.equal(failureStage(new Error('QA_PERSONA_LITE_SESSION_QA_RESIDENT_HTTP_500')), 'session');
assert.equal(failureStage(new Error('QA_PERSONA_LITE_SESSION_CREDENTIAL_MISSING:QA_SUPER')), 'session_credential');
assert.equal(failureStage(new Error('QA_PERSONA_LITE_SERVICE_JWT_MISSING:QA_SUPER')), 'token');
assert.equal(failureStage(new Error('QA_PERSONA_LITE_AUTH_BRIDGE_QA_RESIDENT_HTTP_401')), 'bridge');
assert.equal(failureStage(new Error('QA_PERSONA_LITE_APP_USER_LINK_MISSING:QA_RESIDENT')), 'app_user');
assert.equal(failureStage(new Error('boom')), 'unknown');
assert.equal(failureToken(new Error('QA_PERSONA_LITE_SESSION_QA_RESIDENT_HTTP_500:extra')),
  'QA_PERSONA_LITE_SESSION_QA_RESIDENT_HTTP_500');
assert.equal(failureToken('not-an-error'), 'not-an-error');

// The pinned authority snapshot must name the super wildcard and count the bundle.
assert.equal(
  formatPinnedAuthority('QA_SUPER', { appUserRows: 1, activeScopes: ['*'] }),
  'SCOPES=QA_SUPER app_user_link=true wildcard=true active_scope_count=1 scope_list=*'
);
assert.equal(
  formatPinnedAuthority('QA_OPERATOR', {
    appUserRows: 1,
    activeScopes: [
      'benefit.manage',
      'business.review',
      'community.moderate',
      'inquiry.respond',
      'official-content.manage',
      'resident.verification.exempt',
      'resident_news.review',
      'safety.report.review'
    ]
  }),
  'SCOPES=QA_OPERATOR app_user_link=true wildcard=false active_scope_count=8 scope_list=' +
  'benefit.manage,business.review,community.moderate,inquiry.respond,official-content.manage,' +
  'resident.verification.exempt,resident_news.review,safety.report.review'
);
assert.equal(
  formatPinnedAuthority('QA_RESIDENT', { appUserRows: 1, activeScopes: [] }),
  'SCOPES=QA_RESIDENT app_user_link=true wildcard=false active_scope_count=0 scope_list=-'
);
assert.equal(
  formatPinnedAuthority('QA_SUPER', { appUserRows: 0, activeScopes: [] }),
  'SCOPES=QA_SUPER app_user_link=false wildcard=false active_scope_count=0 scope_list=-'
);

const captureLog = (sink) => {
  const original = console.log;
  console.log = (...args) => { sink.push(args.join(' ')); };
  return () => { console.log = original; };
};
const runReadOnly = async (fetchImpl, sink, sql = sqlStub) => {
  const release = captureLog(sink);
  try {
    return await acquireAccount(frontendOrigin, apiOrigin, sql, personaAccount, fetchImpl, false, false);
  } finally {
    release();
  }
};

// A 5xx from the auth endpoint is reported as status + stage + provider code + shape.
const jsonErrorLog = [];
const jsonErrorResult = await runReadOnly(async (request) => {
  assert.ok(String(request).includes('/api/auth/sign-in/email'), 'the sign-in probe is the only request');
  return new Response(JSON.stringify({ error: { code: 'INTERNAL_SERVER_ERROR' } }), {
    status: 500,
    headers: { 'content-type': 'application/json' }
  });
}, jsonErrorLog);
assert.equal(jsonErrorResult, null, 'a 5xx must not throw in read-only mode');
assert.deepEqual(jsonErrorLog, [
  'SIGNIN=QA_SUPER status=500 stage=signin code=INTERNAL_SERVER_ERROR body=json ' +
  'session_rows_before=0 session_rows_after=0 authority_probe=not_reached'
], 'a 5xx must report status + stage + code + shape + whether a session row survived');

// A non-JSON error page and an empty body stay distinguishable without content.
const textErrorLog = [];
await runReadOnly(async () => new Response('Internal Server Error', { status: 500, headers: { 'content-type': 'text/plain' } }), textErrorLog);
assert.match(textErrorLog[0], /^SIGNIN=QA_SUPER status=500 stage=signin code=UNPARSED body=text /,
  'a plain-text error page must be reported as an unparsed text body');

const emptyErrorLog = [];
await runReadOnly(async () => new Response('', { status: 503 }), emptyErrorLog);
assert.match(emptyErrorLog[0], /^SIGNIN=QA_SUPER status=503 stage=signin code=UNPARSED body=empty /,
  'an empty error body must be reported as empty, not as JSON');

// An unreadable re-read must degrade to UNREADABLE instead of killing the diagnosis.
let structureCalls = 0;
const flakySql = () => {
  structureCalls += 1;
  if (structureCalls > 1) return Promise.reject(new Error('QA_PERSONA_LITE_STRUCTURE_UNREADABLE'));
  return Promise.resolve([{ id: 'contract-app-user' }]);
};
const unreadableLog = [];
const releaseUnreadable = captureLog(unreadableLog);
try {
  await acquireAccount(frontendOrigin, apiOrigin, flakySql, personaAccount, async () => new Response('', { status: 500 }), false, false);
} finally {
  releaseUnreadable();
}
assert.match(unreadableLog[0], /session_rows_after=UNREADABLE authority_probe=not_reached$/,
  'an unreadable post-refusal count must be reported, not thrown');

// --- a database fetch failure must never read as an auth failure -------------
process.env.QA_PERSONA_LITE_DB_RETRY_MS = '1';

// The database signature is the wrapped one; a bare HTTP transport failure is not.
assert.equal(failureStage(new Error('Error connecting to database: TypeError: fetch failed')), 'db');
assert.equal(failureStage(new Error('connect ECONNREFUSED 127.0.0.1:5432')), 'db');
assert.equal(failureStage(new Error('TypeError: fetch failed')), 'unknown',
  'a bare HTTP transport failure must not be classified as a database failure');
assert.equal(failureToken(new Error('Error connecting to database: TypeError: fetch failed')),
  'Error connecting to database');

// The retry is bounded, database-only, and inert whenever it is not enabled.
const retryLog = [];
const releaseRetryLog = captureLog(retryLog);
const dbError = new Error('Error connecting to database: TypeError: fetch failed');
let persistentAttempts = 0;
await assert.rejects(
  () => withDbRetry(async () => { persistentAttempts += 1; throw dbError; }, true),
  (error) => error === dbError,
  'a persistent database failure must still fail after the bounded attempts'
);
assert.equal(persistentAttempts, 3, 'a database fetch may be retried at most 3 times');
let recoveredAttempts = 0;
assert.equal(await withDbRetry(async () => {
  recoveredAttempts += 1;
  if (recoveredAttempts < 2) throw dbError;
  return 'recovered';
}, true), 'recovered', 'a transient database failure must be recovered by the retry');
let nonDbAttempts = 0;
await assert.rejects(
  () => withDbRetry(async () => { nonDbAttempts += 1; throw new Error('QA_PERSONA_LITE_STRUCTURE_UNREADABLE'); }, true),
  /QA_PERSONA_LITE_STRUCTURE_UNREADABLE/,
  'a non-database failure must not be retried'
);
assert.equal(nonDbAttempts, 1, 'only a database connectivity failure may be retried');
let disabledAttempts = 0;
await assert.rejects(() => withDbRetry(async () => { disabledAttempts += 1; throw dbError; }, false), (error) => error === dbError);
assert.equal(disabledAttempts, 1, 'the convergence path must not retry anything');
releaseRetryLog();
assert.ok(retryLog.every((line) => line.startsWith('DB_RETRY=')), 'only retry markers may be logged by the retry');
assert.ok(retryLog.every((line) => !line.includes('contract-only-password')), 'the retry must never print a credential');

// A completely unreachable database must still yield the HTTP sign-in result.
const dbDownLog = [];
await runReadOnly(async (request) => {
  assert.ok(String(request).includes('/api/auth/sign-in/email'), 'the sign-in probe must still run without a database');
  return new Response(JSON.stringify({ error: { code: 'INTERNAL_SERVER_ERROR' } }), {
    status: 500,
    headers: { 'content-type': 'application/json' }
  });
}, dbDownLog, () => Promise.reject(new Error('Error connecting to database: TypeError: fetch failed')));
assert.deepEqual(dbDownLog, [
  'DB_RETRY=attempt_1_of_3 stage=db detail=Error connecting to database',
  'DB_RETRY=attempt_2_of_3 stage=db detail=Error connecting to database',
  'DB_RETRY=attempt_3_of_3 stage=db detail=Error connecting to database',
  'AUTH_STRUCTURE=QA_SUPER status=UNREADABLE stage=db detail=Error connecting to database',
  'DB_RETRY=attempt_1_of_3 stage=db detail=Error connecting to database',
  'DB_RETRY=attempt_2_of_3 stage=db detail=Error connecting to database',
  'DB_RETRY=attempt_3_of_3 stage=db detail=Error connecting to database',
  'SIGNIN=QA_SUPER status=500 stage=signin code=INTERNAL_SERVER_ERROR body=json ' +
  'session_rows_before=UNREADABLE session_rows_after=UNREADABLE authority_probe=not_reached'
], 'an unreachable database must be reported as db and must not be mistaken for an auth failure');

// Nothing that was captured anywhere in this contract may leak a credential.
const everyLogLine = [
  ...jsonErrorLog, ...textErrorLog, ...emptyErrorLog, ...unreadableLog, ...retryLog, ...dbDownLog
];
assert.ok(everyLogLine.every((line) => !line.includes('contract-only-password')),
  'the diagnosis must never print the password');
assert.ok(everyLogLine.every((line) => !/[$]2[aby][$]/.test(line)), 'the diagnosis must never print a password hash');
assert.ok(everyLogLine.every((line) => !/[\w.-]+@[\w.-]+[.]\w+/.test(line)), 'the diagnosis must never print an address');

// --- labels must match the fact that happened --------------------------------
// A post-sign-in database failure means the identity CAN sign in. It must be reported
// as such, and it must still be counted as a sign-in.
const dbErrorTagged = new Error('Error connecting to database: TypeError: fetch failed');
assert.equal(signinStatus(dbErrorTagged), 0, 'an untagged failure is not a sign-in');
assert.equal(formatAcquisitionFailure('QA_SUPER', dbErrorTagged),
  'SIGNIN=QA_SUPER status=- stage=db detail=Error connecting to database',
  'an untagged failure must remain a "no sign-in" report');

dbErrorTagged.signinStatus = 200;
assert.equal(signinStatus(dbErrorTagged), 200, 'a tagged failure carries its sign-in status');
assert.equal(formatAcquisitionFailure('QA_SUPER', dbErrorTagged),
  'PERSONA=QA_SUPER POST_SIGNIN_STAGE_FAILED stage=db signin_status=200 detail=Error connecting to database',
  'a post-sign-in failure must not be reported as a failed sign-in');

// The sign-in count and the acquisition count must not be the same number.
assert.deepEqual(formatDiagnosisCounts(3, 1, 3), [
  'SIGNIN_OK_COUNT=3/3',
  'ACQUIRED_COUNT=1/3',
  'DIAGNOSIS_RESULT=COMPLETE'
], 'all three sign-ins with a degraded database must still be a COMPLETE sign-in diagnosis');
assert.deepEqual(formatDiagnosisCounts(2, 2, 3), [
  'SIGNIN_OK_COUNT=2/3',
  'ACQUIRED_COUNT=2/3',
  'DIAGNOSIS_RESULT=INCOMPLETE'
], 'a missing sign-in is what makes the diagnosis INCOMPLETE');

// A real post-sign-in database failure must arrive tagged, and only the sign-in step
// may reach the network before it.
let linkSqlCalls = 0;
const linkFailSql = () => {
  linkSqlCalls += 1;
  if (linkSqlCalls > 1) return Promise.reject(new Error('Error connecting to database: TypeError: fetch failed'));
  return Promise.resolve([{ id: 'contract-app-user' }]);
};
const postSigninLog = [];
const postSigninRequests = [];
const releasePostSignin = captureLog(postSigninLog);
let taggedError = null;
try {
  await acquireAccount(
    frontendOrigin,
    apiOrigin,
    linkFailSql,
    personaAccount,
    async (request) => {
      const url = String(request);
      postSigninRequests.push(url);
      if (url.includes('/api/auth/sign-in/email')) {
        return new Response(JSON.stringify({ user: { id: 'auth-user-1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-auth-token': 'contract-session-token', 'set-auth-jwt': 'contract-jwt' }
        });
      }
      if (url.includes('/api/auth/get-session')) {
        return new Response(JSON.stringify({ user: { id: 'auth-user-1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-auth-jwt': 'contract-jwt' }
        });
      }
      if (url.includes('/api/auth/token')) {
        return new Response(JSON.stringify({ token: 'contract-jwt' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (url.includes('/api/v1/me')) {
        return new Response(JSON.stringify({ data: { id: 'auth-user-1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (url.includes('/api/auth/sign-out')) return new Response('{}', { status: 200 });
      throw new Error(`unexpected request: ${url}`);
    },
    false,
    false
  );
} catch (error) {
  taggedError = error;
} finally {
  releasePostSignin();
}
assert.ok(taggedError, 'a database failure after a successful sign-in must still throw in read-only mode');
assert.equal(signinStatus(taggedError), 200,
  'the post-sign-in failure must be tagged with the sign-in status that already succeeded');
assert.equal(formatAcquisitionFailure('QA_SUPER', taggedError),
  'PERSONA=QA_SUPER POST_SIGNIN_STAGE_FAILED stage=db signin_status=200 detail=Error connecting to database');
assert.deepEqual(postSigninLog, ['SIGNIN=QA_SUPER status=200'],
  'the successful sign-in must still be reported as a sign-in');
assert.ok(postSigninLog.every((line) => !line.includes('contract-session-token') && !line.includes('contract-jwt')),
  'the diagnosis must never print a session token or a service JWT');

console.log('qa-persona-provision-lite-auth-target-contract: PASS');
