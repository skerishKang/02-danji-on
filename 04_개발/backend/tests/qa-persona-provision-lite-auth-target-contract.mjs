import assert from 'node:assert/strict';
import {
  acquireAccount,
  exactHttpsOrigin,
  failureStage,
  failureToken,
  fetchPersonaMe,
  formatPinnedAuthority
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
const runReadOnly = async (fetchImpl, sink) => {
  const release = captureLog(sink);
  try {
    return await acquireAccount(frontendOrigin, apiOrigin, sqlStub, personaAccount, fetchImpl, false, false);
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

console.log('qa-persona-provision-lite-auth-target-contract: PASS');
