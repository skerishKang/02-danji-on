import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../../.github/workflows/qa-authenticated-ui-readback.yml', import.meta.url), 'utf8');
const script = await readFile(new URL('../scripts/qa-authenticated-ui-readback.mjs', import.meta.url), 'utf8');

// Workflow gating: PRs must be source-only; live run requires manual dispatch + explicit confirmation.
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /expected_main:/);
assert.match(workflow, /run_live:/);
assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.run_live/);
assert.match(workflow, /environment: qa/);
assert.match(workflow, /ref: main/);
assert.match(workflow, /git ls-remote origin refs\/heads\/main/);

// Only the existing QA API/frontend origins and synthetic credential pair are bound.
for (const token of [
  'DANJION_QA_API_URL',
  'DANJION_QA_FRONTEND_URL',
  'DANJION_QA_EMAIL',
  'DANJION_QA_PASSWORD',
]) assert.ok(workflow.includes(token), `workflow must bind ${token}`);

for (const forbidden of [
  'DANJION_QA_DATABASE_URL',
  'DANJION_QA_BETTER_AUTH_SECRET',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'wrangler deploy',
  'pages deploy',
  'qa-household-fixture',
  'sign-up/email',
]) assert.ok(!workflow.includes(forbidden), `workflow must not contain ${forbidden}`);

// Browser-session contract: sign-in happens through the same Playwright BrowserContext
// whose pages perform the final UI readback.
assert.match(script, /chromium\.launch/);
assert.match(script, /browser\.newContext/);
assert.match(script, /context\.request\.post\(`\$\{apiBase\}\/api\/auth\/sign-in\/email`/);
assert.match(script, /context\.request\.get\(`\$\{apiBase\}\/api\/auth\/get-session`/);
assert.match(script, /context\.newPage/);
assert.match(script, /19_내정보_메인\.html/);
assert.match(script, /26_우리집연결\.html/);

// QA origins are exact and Production is impossible by construction.
assert.ok(script.includes("padiem-danjion-api-qa.padiem.workers.dev"));
assert.ok(script.includes("danjion-qa.pages.dev"));
assert.ok(!script.includes('padiem-danjion-api-production.padiem.workers.dev'));
assert.ok(!script.includes("'https://danjion.pages.dev'"));

// The expected pending-state copy is verified on both surfaces.
assert.ok(script.includes("주민인증 심사 대기 중"));
assert.ok(script.includes("우리집 연결됨 · 주민인증 심사 대기 중"));
assert.ok(script.includes('PAGE_19_PENDING_COPY=PASS'));
assert.ok(script.includes('PAGE_26_PENDING_HERO=PASS'));
assert.ok(script.includes('PAGE_26_PENDING_MEMBER_COPY=PASS'));
assert.ok(script.includes('BARE_COMPLETION_COPY_VISIBLE=NO'));

// Readback must not print secret or identity material.
for (const forbiddenLog of [
  'console.log(email',
  'console.log(password',
  'console.log(sessionJson',
  'console.log(page26.hero',
  'console.log(page26.role',
  'storageState(',
]) assert.ok(!script.includes(forbiddenLog), `script must not emit ${forbiddenLog}`);

assert.ok(script.includes('QA_AUTH_SESSION_MUTATION=EPHEMERAL_ONLY'));
assert.ok(script.includes('QA_FIXTURE_MUTATION=0'));
assert.ok(script.includes('PRODUCTION_MUTATION=0'));
assert.ok(script.includes('SECRET_OUTPUT=NO'));

console.log('OK: qa-authenticated-ui-readback contract passed');
