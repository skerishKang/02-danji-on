import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const workflow = await readFile(new URL('.github/workflows/qa-environment-provision.yml', root), 'utf8');
const wrangler = JSON.parse(await readFile(new URL('04_개발/backend/wrangler.jsonc', root), 'utf8'));
const migration = await readFile(new URL('04_개발/backend/scripts/qa-migration-gate.mjs', root), 'utf8');

assert.match(workflow, /pull_request:/, 'QA source safety contract must run on PRs');
assert.match(workflow, /workflow_dispatch:/, 'QA cloud mutation must be manual only');
assert.match(workflow, /environment:\s*qa/, 'QA mutation job must use the GitHub qa environment');
assert.doesNotMatch(workflow, /environment:\s*production/, 'QA workflow must never use the production GitHub environment');
assert.match(workflow, /inputs\.mode == 'deploy_qa' && inputs\.confirm_qa/, 'QA deploy requires explicit mode + confirmation');

for (const name of [
  'DANJION_QA_CLOUDFLARE_API_TOKEN',
  'DANJION_QA_CLOUDFLARE_ACCOUNT_ID',
  'DANJION_QA_DATABASE_URL',
  'DANJION_QA_BETTER_AUTH_SECRET',
  'DANJION_QA_EMAIL',
  'DANJION_QA_PASSWORD',
  'DANJION_QA_API_URL',
  'DANJION_QA_FRONTEND_URL'
]) assert.ok(workflow.includes(name), `missing isolated QA input ${name}`);

for (const forbidden of [
  'DANJION_PRODUCTION_DB_URL',
  'production-worker-bootstrap',
  'pages-production-release',
  '--env production'
]) assert.ok(!workflow.includes(forbidden), `QA workflow carries Production authority: ${forbidden}`);

assert.ok(workflow.includes("QA_WORKER_NAME: padiem-danjion-api-qa"));
assert.ok(workflow.includes("QA_PAGES_PROJECT: danjion-qa"));
assert.ok(workflow.includes("api.hostname === 'padiem-danjion-api-production.padiem.workers.dev'"), 'canonical Production Worker must be explicitly rejected');
assert.ok(workflow.includes("front.hostname === 'danjion.pages.dev'"), 'canonical Production Pages must be explicitly rejected');
assert.ok(workflow.includes('git ls-remote origin refs/heads/main'), 'QA deploy must fresh-read remote main');
assert.ok(workflow.includes('test "$actual" = "$expected"') && workflow.includes('test "$remote" = "$expected"'), 'QA deploy must exact-main guard local and remote heads');
assert.ok(workflow.includes("qa-migration-gate.mjs' apply --confirm-qa-apply"), 'QA schema apply must use explicit QA confirmation');
assert.ok(workflow.includes('wrangler@4.114.0 deploy --env qa'), 'Worker deploy must target the qa Wrangler environment');
assert.ok(workflow.includes('pages deploy dist-qa --project-name "$QA_PAGES_PROJECT" --branch main'), 'Pages deploy must target the dedicated QA project');
assert.ok(workflow.includes('X-Robots-Tag: noindex'), 'QA Pages must be noindex');
assert.ok(workflow.includes('response suppressed') && workflow.includes('identity/session material suppressed'), 'synthetic account output must remain secret-safe');

const qa = wrangler.env?.qa;
assert.ok(qa, 'wrangler must define env.qa');
assert.equal(qa.name, 'padiem-danjion-api-qa');
assert.equal(qa.workers_dev, true);
assert.equal(qa.preview_urls, false);
assert.equal(qa.vars?.APP_ENV, 'qa');
assert.equal(qa.vars?.DEV_AUTH_BYPASS, 'false');
assert.equal(qa.vars?.AUTH_REQUIRE_EMAIL_VERIFICATION, 'false');
assert.notEqual(qa.name, wrangler.env?.production?.name, 'QA Worker name must differ from Production');

assert.match(migration, /DANJION_QA_DATABASE_URL/, 'QA migration gate must use a dedicated QA DB variable');
assert.doesNotMatch(migration, /DANJION_PRODUCTION_DB_URL/, 'QA migration gate must never read the Production DB variable');
assert.match(migration, /includeProductionSeed:\s*false/, 'QA migration plan must exclude production seeds');
assert.match(migration, /entry\.class !== 'schema'/, 'QA apply set must reject every non-schema migration');
assert.match(migration, /--confirm-qa-apply/, 'QA migration mutation must require explicit QA confirmation');

console.log('qa-environment-provision-contract: PASS');
