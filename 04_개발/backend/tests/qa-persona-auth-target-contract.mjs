import assert from 'node:assert/strict';
import { exactHttpsOrigin, fetchPersonaMe } from '../scripts/qa-persona-provision.mjs';

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
  /QA_PERSONA_UNSAFE_TARGET:API/
);
assert.throws(
  () => exactHttpsOrigin('https://malicious.example/', 'API', 'padiem-danjion-api-qa.padiem.workers.dev'),
  /QA_PERSONA_UNSAFE_TARGET:API/
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
  /QA_PERSONA_AUTH_BRIDGE_QA_RESIDENT_HTTP_401/
);

console.log('qa-persona-auth-target-contract: PASS');
