import assert from 'node:assert/strict';
import { acquireAccount, exactHttpsOrigin, fetchPersonaMe } from '../scripts/qa-persona-provision-lite.mjs';

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
assert.equal(sqlStatements.length, 1, 'read-only diagnosis must issue exactly the structure read');
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

console.log('qa-persona-provision-lite-auth-target-contract: PASS');
