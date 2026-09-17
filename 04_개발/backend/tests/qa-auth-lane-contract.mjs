import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'qa-authenticated-traversal.yml'), 'utf8');
const smoke = readFileSync(join(here, 'qa-authenticated-traversal-smoke.mjs'), 'utf8');

assert.match(workflow, /workflow_dispatch:/, 'QA live gate must be manual-dispatch capable');
assert.match(workflow, /pull_request:/, 'QA source contract must run on pull requests');
assert.match(workflow, /environment:\s*qa/, 'live QA job must use the dedicated qa GitHub environment');
assert.match(workflow, /expected_main:/, 'live QA dispatch must require an exact-main input');
assert.match(workflow, /git ls-remote origin refs\/heads\/main/, 'live QA job must fresh-read remote main');
assert.match(workflow, /test "\$actual" = "\$expected"/, 'live QA job must compare checked-out main to expected SHA');
assert.match(workflow, /test "\$remote" = "\$expected"/, 'live QA job must compare remote main to expected SHA');
assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.run_live/, 'live job must not run automatically');

for (const name of [
  'DANJION_QA_API_URL',
  'DANJION_QA_FRONTEND_URL',
  'DANJION_QA_EMAIL',
  'DANJION_QA_PASSWORD'
]) {
  assert.ok(workflow.includes(name), `workflow missing QA input ${name}`);
}

for (const forbidden of [
  'DANJION_PRODUCTION_DB_URL',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'wrangler deploy',
  'pages deploy',
  'production-worker-bootstrap',
  'pages-production-release'
]) {
  assert.ok(!workflow.includes(forbidden), `QA workflow must not carry Production/deploy authority: ${forbidden}`);
}

assert.ok(smoke.includes('padiem-danjion-api-production.padiem.workers.dev'), 'smoke must deny the canonical Production Worker host');
assert.ok(smoke.includes('danjion.pages.dev'), 'smoke must deny the canonical Production Pages host');
assert.ok(smoke.includes('padiem-danjion-api-qa.'), 'smoke must require the dedicated QA Worker hostname prefix');
assert.ok(smoke.includes('danjion-qa.pages.dev'), 'smoke must require the dedicated QA Pages hostname');
assert.ok(smoke.includes('PRODUCTION_API_TARGET_FORBIDDEN'), 'smoke must fail closed on Production API');
assert.ok(smoke.includes('PRODUCTION_PAGES_TARGET_FORBIDDEN'), 'smoke must fail closed on Production Pages');
assert.ok(smoke.includes('QA_API_TARGET_INVALID'), 'smoke must fail closed on an unexpected API hostname');
assert.ok(smoke.includes('QA_PAGES_TARGET_INVALID'), 'smoke must fail closed on an unexpected Pages hostname');

for (const endpoint of [
  '/api/auth/sign-in/email',
  '/api/auth/get-session',
  '/api/auth/token',
  '/api/v1/me',
  '/api/auth/sign-out'
]) {
  assert.ok(smoke.includes(endpoint), `real Better Auth/product session endpoint missing: ${endpoint}`);
}

for (const route of [
  '/04_데일리홈.html',
  '/01_이웃가게_발견.html',
  '/05_우리단지_첫화면.html',
  '/06_단지온공지_목록.html',
  '/08_아파트소식_목록.html',
  '/10_주민소식_목록.html',
  '/19_내정보_메인.html',
  '/26_우리집연결.html'
]) {
  assert.ok(smoke.includes(route), `canonical V3 traversal route missing: ${route}`);
}

assert.ok(!smoke.includes('x-danjion-dev-auth-user'), 'QA lane must not use the dev-auth header');
assert.ok(!/console\.log\([^\n]*(email|password|cookie|jwt|token)/i.test(smoke), 'QA smoke must not log credentials/session material');
assert.ok(!/console\.error\([^\n]*(email|password|cookie|jwt|token)/i.test(smoke), 'QA smoke must not error-log credentials/session material');

console.log('qa-auth-lane-contract: PASS');
