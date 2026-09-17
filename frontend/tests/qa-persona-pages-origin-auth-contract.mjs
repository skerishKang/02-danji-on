import assert from 'node:assert/strict';
import { appFacadeFetch } from '../../functions/_lib/app-facade.js';

// QA persona provisioning must not call /api/v1/me through the Pages facade
// with a browser-style Bearer header. The facade deliberately strips client
// Authorization and only bridges a first-party session cookie server-side.
// This test preserves that security boundary while documenting the 401 failure
// mode that occurs when a server-side provisioning script targets Pages.

const upstreamRequests = [];
const response = await appFacadeFetch({
  request: new Request('https://danjion-qa.pages.dev/api/v1/me', {
    headers: { authorization: 'Bearer synthetic-jwt-for-contract-test' }
  }),
  env: { ASSETS: { fetch: async () => new Response('asset') } }
}, {
  fetchImpl: async (request) => {
    upstreamRequests.push(request);
    return new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    });
  }
});

assert.equal(response.status, 401, 'Pages facade must preserve the Worker auth denial');
assert.equal(upstreamRequests.length, 1, 'the facade should make one bounded Worker request');
assert.equal(
  upstreamRequests[0].url,
  'https://padiem-danjion-api-qa.padiem.workers.dev/api/v1/me',
  'QA Pages must use the fixed QA Worker upstream'
);
assert.equal(
  upstreamRequests[0].headers.get('authorization'),
  null,
  'client Authorization must not become Worker authority through Pages'
);
assert.equal(
  response.headers.get('x-danjion-auth-bridge'),
  'no-cookie',
  'a Pages request without a session cookie must fail closed'
);

console.log('qa-persona-pages-origin-auth-contract: PASS');
