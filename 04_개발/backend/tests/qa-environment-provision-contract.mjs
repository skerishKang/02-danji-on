import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bindQaPagesRuntime, validateQaApi } from '../scripts/qa-pages-runtime-bind.mjs';

const root = new URL('../../../', import.meta.url);
const workflow = await readFile(new URL('.github/workflows/qa-environment-provision.yml', root), 'utf8');
const wrangler = JSON.parse(await readFile(new URL('04_개발/backend/wrangler.jsonc', root), 'utf8'));
const migration = await readFile(new URL('04_개발/backend/scripts/qa-migration-gate.mjs', root), 'utf8');
const canonicalSession = await readFile(new URL('frontend/assets/danjion-session.js', root), 'utf8');

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
assert.ok(workflow.includes('wrangler@4.131.0 deploy --env qa'), 'Worker deploy must target the qa Wrangler environment');
assert.ok(workflow.includes('pages deploy dist-qa --project-name "$QA_PAGES_PROJECT" --branch main'), 'Pages deploy must target the dedicated QA project');
assert.ok(workflow.includes('X-Robots-Tag: noindex'), 'QA Pages must be noindex');
assert.ok(workflow.includes('response suppressed') && workflow.includes('identity/session material suppressed'), 'synthetic account output must remain secret-safe');
assert.ok(workflow.includes("qa-pages-runtime-bind.mjs' dist-qa"), 'QA Pages artifact must receive a dedicated runtime binding');

// #830 same-origin QA Pages architecture: the QA browser runtime binds the QA Pages facade,
// never a Worker absolute URL. The QA Worker upstream is selected server-side by the Pages
// Function, so the workflow must assert the same-origin contract and must NOT require a direct
// Worker binding inside the browser artifact.
assert.ok(workflow.includes("const QA_PAGES_HOSTNAME = 'danjion-qa.pages.dev';"), 'workflow must verify the exact QA Pages host binding');
assert.ok(workflow.includes("const QA_PAGES_API_BASE = 'https://danjion-qa.pages.dev';"), 'workflow must verify the exact QA Pages API base binding');
assert.ok(workflow.includes('if (hostname === QA_PAGES_HOSTNAME) return QA_PAGES_API_BASE;'), 'workflow must verify the QA API resolver branch');
assert.ok(workflow.includes("if (hostname === QA_PAGES_HOSTNAME) return '';"), 'workflow must verify the QA auth same-origin resolver branch');

// The direct Worker browser binding assertion must be gone; only negative (absence) checks remain.
assert.doesNotMatch(workflow, /^\s*grep -Fq "\$DANJION_QA_API_URL"/m,
  'workflow must not require a direct QA Worker URL inside the browser artifact');
assert.doesNotMatch(workflow, /&&\s*grep -Fq "\$DANJION_QA_API_URL"/,
  'live readiness must not require a direct QA Worker URL inside the browser runtime');
assert.ok(workflow.includes('! grep -Fq "$DANJION_QA_API_URL"'),
  'workflow must actively forbid a direct QA Worker URL in the browser runtime');
assert.ok(workflow.includes("! grep -Fq 'padiem-danjion-api-production.padiem.workers.dev'"),
  'workflow must forbid the fixed Production Worker URL in the browser runtime');
assert.ok(workflow.includes('same-origin QA Pages facade binding verified'),
  'QA disposition must record the same-origin QA Pages facade binding');

// The Assemble step must independently assert the same-origin contract (a regression there must not
// be masked by the readiness step also containing the same literals).
const assembleStepStart = workflow.indexOf('name: Assemble noindex QA frontend artifact with dedicated runtime binding');
const assembleStepEnd = workflow.indexOf('name: Deploy dedicated QA Pages');
assert.ok(assembleStepStart >= 0 && assembleStepEnd > assembleStepStart, 'QA Pages assemble step must exist before deploy');
const assembleStep = workflow.slice(assembleStepStart, assembleStepEnd);
assert.match(assembleStep, /QA_PAGES_HOSTNAME = 'danjion-qa\.pages\.dev'/, 'Assemble must verify the exact QA Pages host binding');
assert.match(assembleStep, /QA_PAGES_API_BASE = 'https:\/\/danjion-qa\.pages\.dev'/, 'Assemble must verify the exact QA Pages API base binding');
assert.match(assembleStep, /return QA_PAGES_API_BASE;/, 'Assemble must verify the QA API resolver branch');
assert.match(assembleStep, /return '';/, 'Assemble must verify the QA auth same-origin branch');
assert.match(assembleStep, /if grep -Fq 'padiem-danjion-api-production\.padiem\.workers\.dev'/, 'Assemble must forbid the fixed Production Worker URL in the artifact');
assert.match(assembleStep, /if grep -Fq "\$DANJION_QA_API_URL"/, 'Assemble must forbid a direct QA Worker URL in the artifact');
assert.doesNotMatch(assembleStep, /^\s*grep -Fq "\$DANJION_QA_API_URL"/m, 'Assemble must not require a direct QA Worker binding');

// #673 regression: first-ever workers.dev propagation may briefly return 404.
const readinessStepStart = workflow.indexOf('name: Verify QA Worker health and JWKS');
const readinessStepEnd = workflow.indexOf('name: Ensure dedicated QA Pages project');
assert.ok(readinessStepStart >= 0 && readinessStepEnd > readinessStepStart, 'QA Worker readiness step must exist before Pages provisioning');
const readinessStep = workflow.slice(readinessStepStart, readinessStepEnd);
assert.match(readinessStep, /for attempt in \$\(seq 1 12\)/, 'Worker readiness must use a bounded retry loop');
assert.match(readinessStep, /sleep 2/, 'Worker readiness retries must have a fixed delay');
assert.match(readinessStep, /--write-out '%\{http_code\}'/, 'Worker readiness must inspect HTTP status without failing immediately on 404');
assert.match(readinessStep, /health_status.*= '200'/s, 'Worker readiness must require health HTTP 200');
assert.match(readinessStep, /\.data\.status == \"ok\" and \.data\.database == \"ok\"/, 'Worker readiness must require healthy app and database state');
assert.match(readinessStep, /jwks_status.*= '200'/s, 'Worker readiness must require JWKS HTTP 200');
assert.match(readinessStep, /\.keys \| type == \"array\"/, 'Worker readiness must require a JWKS keys array');
assert.match(readinessStep, /if \[ \"\$ready\" != '1' \]/, 'Worker readiness must fail closed after the bounded window');
assert.doesNotMatch(readinessStep, /cat .*qa-(health|jwks)/, 'Worker readiness must not print response bodies');

// #675 regression: first-ever Pages deployment may briefly return 522.
const pagesReadyStart = workflow.indexOf('name: Verify QA Pages, runtime binding, and noindex');
const pagesReadyEnd = workflow.indexOf('name: Provision or verify synthetic QA credential account');
assert.ok(pagesReadyStart >= 0 && pagesReadyEnd > pagesReadyStart, 'QA Pages readiness step must exist before synthetic account provisioning');
const pagesReadyStep = workflow.slice(pagesReadyStart, pagesReadyEnd);
assert.match(pagesReadyStep, /for attempt in \$\(seq 1 12\)/, 'Pages readiness must use a bounded retry loop');
assert.match(pagesReadyStep, /sleep 2/, 'Pages readiness retries must have a fixed delay');
assert.match(pagesReadyStep, /root_status.*= '200'/s, 'Pages readiness must require root HTTP 200');
assert.match(pagesReadyStep, /runtime_status.*= '200'/s, 'Pages readiness must require runtime asset HTTP 200');
assert.match(pagesReadyStep, /\^x-robots-tag: noindex/, 'Pages readiness must require noindex header');
assert.match(pagesReadyStep, /QA_PAGES_HOSTNAME = 'danjion-qa\.pages\.dev'/, 'Pages readiness must verify exact QA host binding');
assert.match(pagesReadyStep, /QA_PAGES_API_BASE = 'https:\/\/danjion-qa\.pages\.dev'/, 'Pages readiness must verify the exact QA Pages API base binding');
assert.match(pagesReadyStep, /return QA_PAGES_API_BASE;/, 'Pages readiness must verify the QA API resolver branch');
assert.match(pagesReadyStep, /return '';/, 'Pages readiness must verify the QA auth same-origin branch');
assert.match(pagesReadyStep, /! grep -Fq "\$DANJION_QA_API_URL"/, 'Pages readiness must forbid a direct QA Worker URL in the live browser runtime');
assert.match(pagesReadyStep, /! grep -Fq 'padiem-danjion-api-production\.padiem\.workers\.dev'/, 'Pages readiness must forbid the fixed Production Worker URL in the live browser runtime');
assert.doesNotMatch(pagesReadyStep, /&&\s*grep -Fq "\$DANJION_QA_API_URL"/, 'Pages readiness must not require a direct QA Worker binding');
assert.match(pagesReadyStep, /if \[ \"\$pages_ready\" != '1' \]/, 'Pages readiness must fail closed after the bounded window');
assert.doesNotMatch(pagesReadyStep, /cat .*qa-pages/, 'Pages readiness must not print fetched response bodies');

const qa = wrangler.env?.qa;
assert.ok(qa, 'wrangler must define env.qa');
assert.equal(qa.name, 'padiem-danjion-api-qa');
assert.equal(qa.workers_dev, true);
assert.equal(qa.preview_urls, false);
assert.equal(qa.vars?.APP_ENV, 'qa');
assert.equal(qa.vars?.DEV_AUTH_BYPASS, 'false');
assert.equal(qa.vars?.AUTH_REQUIRE_EMAIL_VERIFICATION, 'false');
assert.notEqual(qa.name, wrangler.env?.production?.name, 'QA Worker name must differ from Production');

// #868 verification preparation: the isolated QA Worker must run the temporary
// resident-access switch ON so the temporary-resident acceptance state can be
// exercised. The switch is a plain var, never a secret, and this file is the
// only place the QA pin is asserted - Production's own pin belongs to the #868
// feature change and is verified there.
assert.equal(qa.vars?.TEMP_RESIDENT_ACCESS_MODE, 'true',
  'QA Worker must enable temporary resident access for the #868 acceptance lane');
assert.ok(!(qa.secrets?.required ?? []).includes('TEMP_RESIDENT_ACCESS_MODE'),
  'the temporary resident-access switch is a var, never a secret');

assert.match(migration, /DANJION_QA_DATABASE_URL/, 'QA migration gate must use a dedicated QA DB variable');
assert.doesNotMatch(migration, /DANJION_PRODUCTION_DB_URL/, 'QA migration gate must never read the Production DB variable');
assert.match(migration, /includeProductionSeed:\s*false/, 'QA migration plan must exclude production seeds');
assert.match(migration, /entry\.class !== 'schema'/, 'QA apply set must reject every non-schema migration');
assert.match(migration, /--confirm-qa-apply/, 'QA migration mutation must require explicit QA confirmation');

const qaOrigin = 'https://padiem-danjion-api-qa.example.workers.dev';
assert.equal(validateQaApi(qaOrigin), qaOrigin, 'dedicated QA Worker origin must be accepted');
for (const forbiddenOrigin of [
  'http://padiem-danjion-api-qa.example.workers.dev',
  'https://padiem-danjion-api-production.padiem.workers.dev',
  'https://padiem-danjion-api-qa.example.workers.dev/path',
  'https://other-worker.example.workers.dev'
]) {
  assert.throws(() => validateQaApi(forbiddenOrigin), /QA_PAGES_RUNTIME_BIND_FAILED/, `unsafe QA API origin must be rejected: ${forbiddenOrigin}`);
}

const boundSession = bindQaPagesRuntime(canonicalSession, qaOrigin);
assert.ok(boundSession.includes("const QA_PAGES_HOSTNAME = 'danjion-qa.pages.dev';"), 'QA artifact runtime must recognize only the exact QA Pages host');
assert.ok(boundSession.includes("const QA_PAGES_API_BASE = 'https://danjion-qa.pages.dev';"), 'QA artifact runtime must bind the exact QA Pages API origin');
assert.ok(boundSession.includes("if (hostname === QA_PAGES_HOSTNAME) return QA_PAGES_API_BASE;"), 'QA binding must bind API base to same-origin QA Pages base');
assert.ok(boundSession.includes("if (hostname === QA_PAGES_HOSTNAME) return '';"), 'QA binding must bind auth base to same-origin relative URL');
assert.ok(!canonicalSession.includes("QA_PAGES_HOSTNAME = 'danjion-qa.pages.dev'"), 'canonical source must not hard-code QA deployment state');

// #830 canonical Production semantics: BOTH canonical hosts stay same-origin in BOTH resolvers.
// Assert by bounded resolver region (not a single loose `includes()`) so a regression in either
// danjionApiBase or danjionAuthBase is caught individually.
const countOccurrences = (haystack, needle) => {
  let total = 0;
  let at = 0;
  while ((at = haystack.indexOf(needle, at)) >= 0) { total += 1; at += needle.length; }
  return total;
};
const FUNCTION_START = /\n  (?:async )?function [A-Za-z_$][\w$]*\s*\(/g;
const resolverRegion = (source, declaration) => {
  const start = source.indexOf(declaration);
  assert.ok(start >= 0, `canonical runtime must declare ${declaration}`);
  FUNCTION_START.lastIndex = start + declaration.length;
  const next = FUNCTION_START.exec(source);
  return source.slice(start, next ? next.index : source.length);
};

const PRIMARY_SAME_ORIGIN_BRANCH = "if (hostname === PRIMARY_PRODUCTION_HOSTNAME) return '';";
const PAGES_SAME_ORIGIN_BRANCH = "if (hostname === PRODUCTION_PAGES_HOSTNAME) return '';";
assert.equal(countOccurrences(canonicalSession, PRIMARY_SAME_ORIGIN_BRANCH), 2,
  'both canonical resolvers must keep danjion.padiem.net same-origin');
assert.equal(countOccurrences(canonicalSession, PAGES_SAME_ORIGIN_BRANCH), 2,
  'both canonical resolvers must keep danjion.pages.dev same-origin');
for (const declaration of ['function danjionApiBase(loc) {', 'function danjionAuthBase(loc) {']) {
  const region = resolverRegion(canonicalSession, declaration);
  assert.ok(region.includes(PRIMARY_SAME_ORIGIN_BRANCH), `${declaration} must keep danjion.padiem.net same-origin`);
  assert.ok(region.includes(PAGES_SAME_ORIGIN_BRANCH), `${declaration} must keep danjion.pages.dev same-origin`);
}
assert.ok(canonicalSession.includes("const PRIMARY_PRODUCTION_HOSTNAME = 'danjion.padiem.net';"),
  'canonical runtime must declare the primary production hostname');
assert.ok(canonicalSession.includes("const PRODUCTION_PAGES_HOSTNAME = 'danjion.pages.dev';"),
  'canonical runtime must declare the canonical Pages hostname');

// The canonical runtime must not depend on the pre-#830 absolute-binding identifiers.
for (const stale of ['CANONICAL_PAGES_API_BASE', 'PRODUCTION_API_BASE']) {
  assert.ok(!canonicalSession.includes(stale),
    `canonical runtime must not rely on the pre-#830 identifier ${stale}`);
}

console.log('qa-environment-provision-contract: PASS');
