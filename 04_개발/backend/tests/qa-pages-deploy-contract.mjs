import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../../.github/workflows/qa-pages-deploy.yml', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../scripts/qa-pages-runtime-bind.mjs', import.meta.url), 'utf8');

const must = (needle, message = `missing ${needle}`) => assert.ok(workflow.includes(needle), message);
const mustNot = (needle, message = `forbidden ${needle}`) => assert.ok(!workflow.includes(needle), message);

must('name: QA Pages Deploy');
must('workflow_dispatch:');
must("expected_main:");
must('confirm_qa_pages:');
must('environment: qa');
must("github.event_name == 'workflow_dispatch'");
must('inputs.confirm_qa_pages');
must("ref: main");
must("git ls-remote origin refs/heads/main");
must("QA_PAGES_PROJECT: danjion-qa");
must("DANJION_QA_CLOUDFLARE_API_TOKEN");
must("DANJION_QA_CLOUDFLARE_ACCOUNT_ID");
must("DANJION_QA_API_URL");
must("DANJION_QA_FRONTEND_URL");
must("padiem-danjion-api-qa.");
must("danjion-qa.pages.dev");
must("padiem-danjion-api-production.padiem.workers.dev");
must("danjion.pages.dev");
must("qa-pages-runtime-bind.mjs");
must("X-Robots-Tag: noindex");
must("wrangler@4.114.0 pages deploy");
must("--project-name \"$QA_PAGES_PROJECT\"");
must("for attempt in $(seq 1 12)");
must("x-robots-tag: noindex");
must("QA_PAGES_HOSTNAME = 'danjion-qa.pages.dev';");
must("grep -Fq \"return '';\" dist-qa/assets/danjion-session.js");
must("'frontend/assets/danjion-session.js'");
must("'functions/**'");
must("functions/_lib/auth-facade.js");
must("functions/_lib/app-facade.js");
must("functions/api/auth/[[path]].js");
must("functions/api/v1/[[path]].js");
must("x-danjion-auth-facade: danjion-auth-facade/v1");
must("x-danjion-app-facade: danjion-app-facade/v1");
must("[ \"$auth_status\" = '200' ]");
must("[ \"$app_status\" = '401' ]");
must("Same-origin auth facade: PASS");
must("Same-origin app facade: PASS");
must("Database mutation: NO");
must("Worker mutation: NO");
must("Auth secret mutation: NO");
must("Synthetic account mutation: NO");
must("Production target: NO");

// This workflow must never gain authority for DB, Worker, Better Auth, or synthetic-account mutation.
mustNot('DANJION_QA_DATABASE_URL');
mustNot('DANJION_QA_BETTER_AUTH_SECRET');
mustNot('DANJION_QA_EMAIL');
mustNot('DANJION_QA_PASSWORD');
mustNot('qa-migration-gate.mjs');
mustNot('wrangler@4.114.0 deploy --env qa');
mustNot('--secrets-file');
mustNot('/api/auth/sign-up/email');
mustNot('/api/auth/sign-in/email');
mustNot('qa-household-fixture');

// Production names may appear only in explicit rejection guards; never as deployment targets.
assert.equal((workflow.match(/padiem-danjion-api-production\.padiem\.workers\.dev/g) || []).length, 1,
  'Production Worker hostname must appear exactly once as a rejection guard');
assert.equal((workflow.match(/danjion\.pages\.dev/g) || []).length, 1,
  'Production Pages hostname must appear exactly once as a rejection guard');

// PRs may validate source only. The mutating job is manual + explicit-confirm gated.
const deployJob = workflow.slice(workflow.indexOf('  deploy-pages:'));
assert.ok(deployJob.includes("if: ${{ github.event_name == 'workflow_dispatch' && inputs.confirm_qa_pages }}"),
  'deploy-pages must be manual and confirmation-gated');
assert.ok(!workflow.slice(0, workflow.indexOf('  deploy-pages:')).includes('pages deploy'),
  'source-contract job must not deploy Pages');

assert.ok(runtime.includes("if (hostname === QA_PAGES_HOSTNAME) return '';"),
  'QA runtime must bind browser API and auth bases to same-origin relative URLs');
assert.ok(!runtime.includes('QA_API_BASE'),
  'QA runtime must not inject a direct Worker browser base');

console.log('OK: qa-pages-deploy-contract passed');
