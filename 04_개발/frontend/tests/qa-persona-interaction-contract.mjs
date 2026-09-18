import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const workflow = await readFile(new URL('.github/workflows/qa-persona-interaction.yml', root), 'utf8');
const script = await readFile(new URL('04_개발/frontend/scripts/qa-persona-interaction.mjs', root), 'utf8');

// PRs must validate source only; live QA execution stays manually dispatched.
assert.match(workflow, /pull_request:/, 'interaction source contract must run on pull requests');
assert.match(workflow, /workflow_dispatch:/, 'live interaction validation must remain manual');
assert.match(workflow, /environment:\s*qa/, 'live interaction must use the qa environment');
assert.doesNotMatch(workflow, /environment:\s*production/, 'interaction workflow must never use production environment');
assert.match(workflow, /inputs\.run_live/, 'live interaction requires explicit run_live authority');
assert.match(workflow, /expected_main/, 'live interaction must carry exact-main authority');
assert.match(workflow, /needs:\s*source-contract/, 'live interaction must depend on the source contract');
assert.match(workflow, /node --check 04_개발\/frontend\/scripts\/qa-persona-interaction\.mjs/, 'source gate must syntax-check the browser script');
assert.match(workflow, /node 04_개발\/frontend\/tests\/qa-persona-interaction-contract\.mjs/, 'source gate must execute this contract');

for (const required of [
  'DANJION_QA_FRONTEND_URL',
  'DANJION_QA_SUPER_EMAIL',
  'DANJION_QA_SUPER_PASSWORD'
]) assert.ok(workflow.includes(required), `missing QA interaction input ${required}`);

assert.doesNotMatch(workflow, /DANJION_PRODUCTION|environment:\s*production/, 'interaction workflow must not target Production');

// The browser flow must track the canonical static multi-page DOM actually served by QA Pages.
assert.match(script, /const FRONTEND = 'https:\/\/danjion-qa\.pages\.dev'/, 'interaction script must pin QA Pages');
assert.ok(script.includes('12_%EC%9D%B4%EC%9B%83%EB%8C%80%ED%99%94_%EC%B2%AB%ED%99%94%EB%A9%B4.html?type=question'),
  'interaction script must enter the canonical static community list');
for (const selector of ["#writeMain", "#title", "#body", "[data-publish]", "#commentText", "#commentForm button[type=\"submit\"]"]) {
  assert.ok(script.includes(selector), `missing canonical static selector ${selector}`);
}
assert.doesNotMatch(script, /data-v2-nav-key|v2-community-write-main/, 'interaction script must not regress to the legacy React V2 modal selectors');

// Preserve #724 session recovery and verify the real account-menu logout path.
assert.match(script, /async function sessionShape\(context\)/, 'session shape guard must remain');
assert.ok(script.includes('/api/auth/sign-in/email'), 'missing bounded QA session refresh');
assert.match(script, /DEBUG_SESSION_EXPIRED_BEFORE_SUBMIT=true/, 'session refresh diagnostic must remain value-free');
assert.ok(script.includes('.danjion-account-trigger'), 'logout must open the static account menu');
assert.ok(script.includes("name: '로그아웃', exact: true"), 'logout must click the real account-menu control');
assert.ok(script.includes('/api/auth/get-session'), 'logout must verify the session is cleared');

// Product writes are bounded to community post/comment routes and QA-stamped synthetic content.
assert.ok(script.includes('[QA테스트] 상호작용 점검'), 'post content must remain visibly synthetic');
assert.ok(script.includes('[QA테스트 댓글'), 'comment content must remain visibly synthetic');
assert.match(script, /community\\\/posts\$/, 'post response predicate must be bounded to community post creation');
assert.match(script, /community\\\/posts\\\/\[\^\/\]\+\\\/comments\$/, 'comment response predicate must be bounded to community comment creation');
assert.doesNotMatch(script, /danjion\.pages\.dev/, 'interaction script must never reference Production Pages');
assert.doesNotMatch(script, /DANJION_QA_DATABASE_URL|DATABASE_URL/, 'browser interaction must not receive direct database authority');

for (const sensitiveOutput of [
  'console.log(email',
  'console.log(password',
  'console.log(sBody',
  'console.log(afterBody',
  'console.log(await session'
]) assert.ok(!script.includes(sensitiveOutput), `interaction script must not print sensitive value: ${sensitiveOutput}`);

assert.match(script, /SECRET_OUTPUT=NO/, 'interaction report must state no secret output');

console.log('qa-persona-interaction-contract: PASS');
