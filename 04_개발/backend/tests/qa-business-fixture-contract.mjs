import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const workflow = await readFile(new URL('.github/workflows/qa-business-fixture.yml', root), 'utf8');
const script = await readFile(new URL('04_개발/backend/scripts/qa-business-fixture.mjs', root), 'utf8');

/* --- workflow: source-only on PR, mutation gated and QA-scoped --- */
assert.match(workflow, /pull_request:/, 'fixture source contract must run on PRs');
assert.match(workflow, /workflow_dispatch:/, 'fixture mutation must be manual only');
assert.match(workflow, /environment:\s*qa/, 'fixture mutation must use GitHub qa environment');
assert.doesNotMatch(workflow, /environment:\s*production/, 'fixture must never use production environment');
assert.match(workflow, /inputs\.confirm_qa_fixture/, 'fixture mutation requires explicit confirmation');
assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.confirm_qa_fixture/,
  'fixture mutation job must require both dispatch and explicit confirmation');
assert.match(workflow, /expected_main/, 'fixture workflow must carry exact-main authority');
assert.match(workflow, /git rev-parse HEAD/, 'fixture must read the checked-out HEAD');
assert.match(workflow, /git ls-remote origin refs\/heads\/main/, 'fixture must fresh-read remote main');
assert.match(workflow, /test "\$actual" = "\$expected"/, 'fixture must exact-match checked-out main');
assert.match(workflow, /test "\$remote" = "\$expected"/, 'fixture must exact-match remote main');
assert.match(workflow, /ref: main/, 'fixture must run from main, not the dispatch ref');
assert.match(workflow, /DANJION_QA_FRONTEND_URL" = 'https:\/\/danjion-qa\.pages\.dev'/,
  'fixture must pin the exact QA frontend origin');
assert.match(workflow, /DANJION_QA_FRONTEND_URL" != 'https:\/\/danjion\.pages\.dev'/,
  'fixture must reject the public production Pages origin');
assert.match(workflow, /node --check 04_개발\/backend\/scripts\/qa-business-fixture\.mjs/,
  'fixture script must be syntax-checked on PRs');

for (const required of [
  'APP_ENV: qa',
  'DANJION_QA_API_URL',
  'DANJION_QA_FRONTEND_URL',
  'DANJION_QA_DATABASE_URL'
]) assert.ok(workflow.includes(required), `missing QA fixture authority ${required}`);

for (const forbidden of [
  'DANJION_PRODUCTION_DB_URL',
  '--env production',
  'padiem-danjion-api-production',
  '--project-name danjion'
]) assert.ok(!workflow.includes(forbidden), `fixture workflow carries production authority: ${forbidden}`);
assert.doesNotMatch(workflow, /^\s+DATABASE_URL:\s*\$\{\{\s*secrets\./m,
  'fixture workflow must not bind a generic DATABASE_URL secret');
assert.doesNotMatch(workflow, /DANJION_QA_RESIDENT_|DANJION_QA_EMAIL|DANJION_QA_PASSWORD/,
  'fixture must not require resident or operator credentials it does not need');
assert.doesNotMatch(workflow, /wrangler|pages deploy|secrets put|d1 execute/,
  'fixture must stay DB-only and never mutate Cloudflare resources');

/* --- script: QA-only fail-closed authority --- */
assert.match(script, /APP_ENV.*qa/, 'fixture must fail closed unless APP_ENV=qa');
assert.match(script, /QA_API_HOST = 'padiem-danjion-api-qa\.padiem\.workers\.dev'/, 'fixture must pin dedicated QA Worker');
assert.match(script, /QA_FRONTEND_HOST = 'danjion-qa\.pages\.dev'/, 'fixture must pin dedicated QA Pages');
assert.match(script, /DANJION_QA_DATABASE_URL/, 'fixture must use the dedicated QA DB variable');
assert.match(script, /GENERIC_DATABASE_URL_FORBIDDEN/, 'fixture must reject generic DATABASE_URL authority');
assert.match(script, /UNSAFE_TARGET/, 'fixture must reject a non-exact QA origin');
assert.doesNotMatch(script, /DANJION_PRODUCTION_DB_URL/, 'fixture must never reference a production DB variable');
assert.doesNotMatch(script, /process\.env\.DATABASE_URL\s*(\|\||&&|\?)/, 'fixture must never fall back to DATABASE_URL');

/* --- synthetic identity, never production pilot material --- */
assert.match(script, /banglim-myeongji-roadhill/, 'fixture must target the QA pilot complex slug');
assert.match(script, /\[QA\]/, 'fixture must use an unmistakably synthetic label');
assert.match(script, /QA-only deterministic identity/, 'fixture must declare its QA-only id namespace');
assert.doesNotMatch(script, /d0a1c4a1/, 'fixture must not reuse migration 042 production seed identifiers');
for (const forbiddenSeed of ['042_', '900_', '901_', '902_']) {
  assert.ok(!script.includes(forbiddenSeed), `fixture must not reuse seed migration material: ${forbiddenSeed}`);
}
/* The approval state must be converged by the businesses upsert itself, not
   merely filtered later — a readback predicate alone would let a draft row in. */
const businessUpsert = script.slice(
  script.indexOf('insert into businesses ('),
  script.indexOf('async function attachBusiness')
);
assert.ok(businessUpsert.length > 0, 'the businesses upsert block must exist');
assert.match(businessUpsert, /'approved'\s*\n\s*\)\s*\n\s*on conflict \(id\)/,
  'the businesses insert must create an approved row');
assert.ok(businessUpsert.includes("status = 'approved',"),
  'the businesses update must converge status back to approved on every run');
assert.match(script, /do update set\s+relation_type = excluded\.relation_type,\s+verification_status = 'verified'/,
  'fixture must converge the complex relation to verified on every run');
assert.match(script, /QA_BUSINESS_FIXTURE_RELATION_UNRESOLVED/, 'a missing relation row must fail closed');

/*
 * Defining the convergence helpers is not enough — main() must actually run
 * them in dependency order and prove the result through the public facade.
 */
const mainBody = script.slice(script.indexOf('async function main() {'));
assert.ok(mainBody.length > 0, 'fixture must keep a single main entry point');
let cursor = 0;
for (const call of [
  'assertQaOnlyAuthority()',
  'resolveComplex(sql)',
  'resolveCategory(sql)',
  'upsertBusiness(sql, categoryId)',
  'attachBusiness(sql, businessId, complexId)',
  'attachCategory(sql, businessId, categoryId)',
  'readback(sql, complexId, businessId)',
  'readbackPublicDiscovery(frontendOrigin)'
]) {
  const at = mainBody.indexOf(call, cursor);
  assert.ok(at >= 0, `main must invoke ${call} in dependency order`);
  cursor = at;
}

/* --- discovery contract: same predicates src/core-v1.ts applies --- */
assert.match(script, /c\.status in \('active','pilot'\)/, 'readback must require a discoverable complex status');
assert.match(script, /b2\.status = 'approved'/, 'readback must reuse the public approved filter');
assert.match(script, /r2\.verification_status = 'verified'/, 'readback must reuse the public verified-relation filter');
assert.match(script, /business_complex_relations/, 'fixture must create the mandatory business-complex relation');
assert.match(script, /business_category_relations/, 'fixture must expose the category through the relation table');
assert.match(script, /QA_BUSINESS_FIXTURE_DISCOVERY_MISSING/, 'fixture must fail closed when discovery omits its row');
assert.match(script, /\/api\/v1\/complexes\/.*businesses\?limit=50/s, 'fixture must read back the public discovery path');
assert.match(script, /new URL\(`\/api\/v1\/complexes\/.*limit=50`, frontendOrigin\)/,
  'discovery readback must go through the QA Pages facade the acceptance harness uses');
assert.match(script, /QA_BUSINESS_FIXTURE_DISCOVERY_HTTP_\$\{response\.status\}/,
  'a non-200 discovery readback must fail closed with its status');

/* --- idempotent convergence on real unique keys --- */
assert.match(script, /on conflict \(slug\) do nothing/, 'complex must converge without overwriting an authoritative row');
assert.match(script, /on conflict \(slug\)\s*\n\s*do update set name = excluded\.name/, 'category must converge idempotently');
assert.match(script, /on conflict \(id\)\s*\n\s*do update set/, 'business must converge idempotently on its primary key');
assert.match(script, /on conflict \(business_id, complex_id\)\s*\n\s*do update set/,
  'business-complex relation must converge idempotently');
assert.match(script, /on conflict \(business_id, category_id\) do nothing/,
  'business-category relation must converge idempotently');
assert.match(script, /insert into businesses \(\s*id, owner_user_id/, 'fixture must pin a deterministic business id');

/* share_slug is immutable-by-trigger and defaulted: naming it breaks every re-run. */
assert.match(script, /share_slug/, 'fixture must document the share_slug trigger constraint');
assert.doesNotMatch(script, /do update set[^;]*share_slug/s, 'fixture must never update share_slug');
assert.doesNotMatch(script, /insert into business_complex_relations \(\s*business_id, complex_id, share_slug/,
  'fixture must let the share_slug default satisfy the NOT NULL column');

/* --- minimal synthetic data only: no owner, contacts, benefits, grants --- */
assert.match(script, /\$\{SYNTHETIC_BUSINESS_SUMMARY\},\s*\n\s*\$\{SYNTHETIC_BUSINESS_SUMMARY\},\s*\n\s*'approved'/,
  'fixture must supply only the minimal business fields');
assert.match(script, /values \(\s*\$\{FIXTURE_BUSINESS_ID\}::uuid,\s*\n\s*null/, 'owner_user_id must stay NULL');
assert.match(script, /OWNER_USER_FORBIDDEN/, 'fixture must fail closed if an owner account appears');
assert.match(script, /CONTACT_FORBIDDEN/, 'fixture must fail closed if contact data appears');
assert.match(script, /BENEFIT_FORBIDDEN/, 'fixture must fail closed if benefit data appears');
assert.match(script, /COMPLEX_NOT_DISCOVERABLE/, 'fixture must refuse to overwrite an authoritative complex it cannot use');
assert.doesNotMatch(script, /benefits \(|business_contacts \(|operator_grants/,
  'fixture must not insert benefit, contact, or operator rows');

/* --- bounded, privacy-safe output --- */
for (const marker of [
  'QA_BUSINESS_FIXTURE_PRESENT=true',
  'QA_BUSINESS_COUNT=',
  'QA_BUSINESS_APPROVED=true',
  'QA_BUSINESS_RELATION_PRESENT=true',
  'PRODUCTION_TARGET=NO',
  'SECRET_OUTPUT=NO'
]) assert.ok(script.includes(marker), `missing bounded fixture disposition output: ${marker}`);

for (const sensitiveOutput of [
  'console.log(databaseUrl',
  'console.log(complexId',
  'console.log(categoryId',
  'console.log(businessId',
  'console.log(password',
  'console.log(email'
]) assert.ok(!script.includes(sensitiveOutput), `fixture must not print sensitive value: ${sensitiveOutput}`);
assert.doesNotMatch(script, /console\.log\([^)]*\$\{(businessId|complexId|categoryId|databaseUrl)\b/,
  'fixture must keep resolved row ids and the DB authority out of its output');
assert.match(script, /QA_FIXTURE_BUSINESS_ID_PREFIX=\$\{FIXTURE_BUSINESS_ID\.slice\(0, 8\)\}/,
  'fixture may only emit a bounded business identifier prefix');

console.log('qa-business-fixture-contract: PASS');
