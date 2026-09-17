import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../../.github/workflows/qa-worker-deploy.yml', import.meta.url), 'utf8');
const must = (needle, message = `missing ${needle}`) => assert.ok(workflow.includes(needle), message);
const mustNot = (needle, message = `forbidden ${needle}`) => assert.ok(!workflow.includes(needle), message);

must('name: QA Worker Deploy');
must('workflow_dispatch:');
must('expected_main:');
must('confirm_qa_worker:');
must('environment: qa');
must("github.event_name == 'workflow_dispatch'");
must('inputs.confirm_qa_worker');
must('git ls-remote origin refs/heads/main');
must('DANJION_QA_DATABASE_URL');
must('DANJION_QA_BETTER_AUTH_SECRET');
must('DANJION_QA_API_URL');
must('DANJION_QA_FRONTEND_URL');
must('padiem-danjion-api-qa');
must("--var 'APP_ENV:qa'");
must('AUTH_CANONICAL_PUBLIC_BASE_URL');
must('wrangler@4.114.0 deploy --env qa');
must('--secrets-file');
must('for attempt in $(seq 1 12)');
must('Database migration: NO');
must('Pages deploy: NO');
must('Fixture mutation: NO');
must('Production target: NO');

mustNot('qa-migration-gate.mjs');
mustNot('pages deploy');
mustNot('/api/auth/sign-up/email');
mustNot('qa-household-fixture');
mustNot('provision_synthetic_account');

assert.equal((workflow.match(/padiem-danjion-api-production\.padiem\.workers\.dev/g) || []).length, 1,
  'Production Worker may appear exactly once as a rejection guard');
assert.equal((workflow.match(/danjion\.pages\.dev/g) || []).length, 1,
  'Production Pages may appear exactly once as a rejection guard');

const deployJob = workflow.slice(workflow.indexOf('  deploy-worker:'));
assert.ok(deployJob.includes("if: ${{ github.event_name == 'workflow_dispatch' && inputs.confirm_qa_worker }}"),
  'Worker deploy must require manual dispatch + explicit confirmation');
assert.ok(!workflow.slice(0, workflow.indexOf('  deploy-worker:')).includes('wrangler@4.114.0 deploy --env qa'),
  'PR source-contract job must never deploy Worker');

console.log('OK: qa-worker-deploy-contract passed');
