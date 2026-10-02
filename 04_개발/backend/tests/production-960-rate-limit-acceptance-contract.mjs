// #960 Production rate-limit acceptance harness contract.
//
// The acceptance itself (a credentialed Production run) may only be dispatched
// by CENTRAL. This contract guards the HARNESS so a dispatch can never widen
// its own boundary: it pins the workflow's dispatch-only/exact-main/no-database
// posture, the script's fail-closed guards, the "expectations are read from the
// deployed source, never hard-coded" rule, and the canonical source facts the
// acceptance depends on at the reviewed main.
//
//   node 04_개발/backend/tests/production-960-rate-limit-acceptance-contract.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const workflow = await read('../../../.github/workflows/production-960-rate-limit-acceptance.yml');
const script = await read('../scripts/production-rate-limit-acceptance.mjs');
const rateLimitSource = await read('../src/product-rate-limit-v1.ts');
const appSource = await read('../src/app.ts');
const householdSource = await read('../src/household-family-v2.ts');

const {
  parseAuthzGuard,
  parseCanonicalPolicy,
  parseLimiterOrdering,
} = await import(new URL('../scripts/production-rate-limit-acceptance.mjs', import.meta.url).href);

// ===========================================================================
// 1. Workflow posture: dispatch-only live execution, exact main, no database.
// ===========================================================================
assert.match(workflow, /^name: 'Production #960 Product Mutation Rate-Limit Acceptance'/m, 'the workflow must carry its #960 identity');
assert.match(workflow, /workflow_dispatch:/, 'the workflow must be dispatchable');
assert.match(workflow, /expected_main:/, 'the dispatch must require an exact main SHA');
assert.match(workflow, /run_live:/, 'the live run must require an explicit authorization flag');
assert.ok(
  /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.run_live \}\}/.test(workflow),
  'the live job must be gated on workflow_dispatch + run_live',
);
assert.ok(
  !/^\s*(schedule|push|workflow_run|issue_comment):/m.test(workflow),
  'no automatic trigger may start the credentialed acceptance',
);
assert.match(workflow, /environment: production/, 'the live job must run in the production environment');
assert.match(workflow, /permissions:\s*\n\s*contents: read/, 'the workflow must stay contents:read');
assert.match(workflow, /group: danjion-production-960-rate-limit-acceptance/, 'the acceptance must own a concurrency group');
assert.match(workflow, /cancel-in-progress: false/, 'a production acceptance must not be cancelled mid-flight');
assert.ok(!/continue-on-error/.test(workflow), 'no step may swallow an acceptance failure');
assert.ok(!/max-attempts|--retry|npm ci|playwright/i.test(workflow), 'the acceptance must not install engines or retry');
assert.match(workflow, /timeout-minutes: 15/, 'the live job must be time-bounded');
assert.match(workflow, /needs: source-contract/, 'the live run must depend on the source contract');
// exact-main guard
for (const guardLine of [
  /test "\$GITHUB_REF" = 'refs\/heads\/main'/,
  /test "\$actual" = "\$EXPECTED_MAIN"/,
  /test "\$remote" = "\$EXPECTED_MAIN"/,
  /test -z "\$\{DATABASE_URL:-\}"/,
  /test -z "\$\{DANJION_PRODUCTION_DB_URL:-\}"/,
]) {
  assert.ok(guardLine.test(workflow), `the live guard must contain ${guardLine}`);
}
// credentials: only the existing production test-resident secret pair
for (const secret of [
  'DANJION_PRODUCTION_TEST_RESIDENT_EMAIL',
  'DANJION_PRODUCTION_TEST_RESIDENT_PASSWORD',
]) {
  assert.ok(workflow.includes(`secrets.${secret}`), `the live run must use the existing ${secret}`);
}
assert.ok(
  !/secrets\.(DANJION_PRODUCTION_DB_URL|ADMIN_[A-Z_]+|CLOUDFLARE_[A-Z_]+|[A-Z_]*NEON[A-Z_]*|DANJION_HOUSEHOLD[A-Z_]*)/.test(workflow),
  'the acceptance must not receive database, admin, infrastructure or household credentials',
);
const echoLines = workflow.split('\n').filter((line) => /\becho\b/.test(line));
assert.ok(
  echoLines.every((line) => !/\$\{?[^}\s"']*(PASSWORD|EMAIL|TOKEN|SECRET)/i.test(line) && !/secrets\./.test(line)),
  'no echo statement may print a credential value or secret reference',
);
// self-verification before any credentialed run
assert.match(workflow, /--self-test/, 'the acceptance self-test must run before the live job');
assert.match(workflow, /production-960-rate-limit-acceptance-contract\.mjs/, 'the contract must gate the live job');

// ===========================================================================
// 2. Script posture: fail-closed, no hard-coded policy, no retry, no leaks.
// ===========================================================================
assert.ok(!/method: '(DELETE|PUT|PATCH)'/.test(script), 'the acceptance may only issue POST probes');
assert.ok(!/DELETE FROM|UPDATE .* SET|TRUNCATE/i.test(script), 'the acceptance must never write to the database');
assert.ok(!/DATABASE_URL|postgres|neon/i.test(script), 'the acceptance must hold no database handle');
assert.ok(
  !/max:\s*10|windowSeconds:\s*3600|=== ?10\b|>= ?10\b/.test(script),
  'the canonical threshold must be read from source, never hard-coded in the acceptance',
);
assert.match(script, /parseCanonicalPolicy/, 'the acceptance must read PRODUCT_MUTATION_LIMITS from the deployed source');
assert.match(script, /evaluateNumericExpression/, 'windowSeconds must be parsed from the canonical expression');
const scriptCode = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
assert.ok(
  !/setInterval|backoff|while\s*\(/.test(scriptCode),
  'the acceptance must not implement a retry or backoff mechanism',
);
assert.ok(
  !/catch[\s\S]{0,200}?\bpost\(/.test(scriptCode),
  'a failed request must never be re-issued from a catch handler',
);
assert.ok(
  /for \(let attempt = 1; attempt <= policy\.max; attempt \+= 1\)/.test(scriptCode),
  'the pre-threshold probe must be a single bounded pass over the canonical threshold',
);
assert.ok(
  /status >= 200 && status < 300/.test(script) && /mutationSuccessObserved = true/.test(script),
  'a successful mutation must be recorded and abort the run',
);
assert.match(script, /outcome: 'INCONCLUSIVE'/, 'a pre-polluted bucket must end the run as INCONCLUSIVE');
assert.ok(
  /status === 429[\s\S]{0,400}not at baseline/.test(script),
  'an unexpected early 429 must be treated as a polluted baseline, not retried',
);
assert.match(script, /retry-after/, 'the acceptance must verify the retry-after header');
assert.match(script, /x-danjion-rate-limit-action/, 'the acceptance must verify the canonical action header');
assert.match(script, /RATE_LIMITED/, 'the acceptance must verify the canonical rate-limited envelope');
assert.match(script, /status !== 403/, 'under-threshold requests must be held to the existing 403 policy');
assert.match(script, /error\.code !== guard\.code/, 'the 403 body class must match the canonical guard exactly');
// credential hygiene: the values may be read, never logged
assert.ok(
  !/console\.log\([^)]*(email|password|cookie|token)/i.test(script),
  'the acceptance must never print credentials, cookies or tokens',
);

// ===========================================================================
// 3. Canonical source facts the acceptance depends on (reviewed main).
// ===========================================================================
{
  const policy = parseCanonicalPolicy(rateLimitSource, 'family_invite_create');
  assert.equal(policy.action, 'family_invite_create');
  assert.equal(policy.max, 10, 'the canonical family_invite_create threshold is 10');
  assert.equal(policy.windowSeconds, 3600, 'the canonical family_invite_create window is 3600s');

  const guard = parseAuthzGuard(householdSource);
  assert.equal(guard.code, 'HOUSEHOLD_PRIMARY_REQUIRED');
  assert.ok(
    guard.guardOffset < guard.firstInsertOffset,
    'the verified-primary guard must precede the first product insert (mutation-0 proof)',
  );

  const ordering = parseLimiterOrdering(appSource, rateLimitSource);
  assert.ok(
    ordering.limiterOffset < ordering.handlerOffset,
    'the limiter middleware must be dispatched before the household-family handler (limiter-before-authz proof)',
  );
  assert.ok(
    ordering.actorBoundaryOffset < ordering.consumeOffset,
    'the actor boundary must resolve before the bucket is consumed (401 can never reach a 429)',
  );
}

// ===========================================================================
// 4. The acceptance self-test must pass, proving the guards behave.
// ===========================================================================
{
  const selfTest = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../scripts/production-rate-limit-acceptance.mjs', import.meta.url)), '--self-test'],
    { encoding: 'utf8' },
  );
  assert.equal(selfTest.status, 0, `the acceptance self-test must pass: ${selfTest.stdout}${selfTest.stderr}`);
  assert.match(selfTest.stdout, /960_SELF_TEST=PASS/);
  assert.match(selfTest.stdout, /mutation abort/);
}

console.log('PASS #960 acceptance harness: dispatch-only, exact-main, no database, source-derived expectations, fail-closed guards');
console.log('production-960-rate-limit-acceptance-contract: PASS');
