import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const workflow = await readFile(new URL('../../.github/workflows/pages-production-release.yml', import.meta.url), 'utf8');

/* #432: canonical production upload must not force a branch-directed preview deploy. */
assert.match(workflow, /npx wrangler@4\.131\.0 pages deploy dist[\s\S]*--project-name "\$PAGES_PROJECT"[\s\S]*--commit-hash "\$EXPECTED_MAIN"/,
  'production workflow must deploy the V3 artifact with explicit project and source SHA');
assert.doesNotMatch(workflow, /pages deploy dist[\s\S]{0,250}--branch "\$PAGES_PRODUCTION_BRANCH"/,
  'canonical production deploy must not pass --branch');

/* The workflow must read back Cloudflare canonical production state, not trust CLI success. */
assert.match(workflow, /canonical_deployment\.id/,
  'workflow must read project canonical_deployment id');
assert.match(workflow, /canonical_deployment\.environment/,
  'workflow must verify canonical deployment environment');
assert.match(workflow, /deployment_env" != "production"/,
  'deployment detail readback must fail closed outside production');
assert.match(workflow, /canonical_commit[\s\S]*EXPECTED_MAIN/,
  'canonical deployment source SHA must match the exact authorized main SHA');
assert.match(workflow, /\[ -z "\$canonical_commit" \][\s\S]*!= "\$EXPECTED_MAIN"/,
  'canonical deployment source SHA must fail closed when Cloudflare omits provenance');
assert.match(workflow, /deployment_commit[\s\S]*EXPECTED_MAIN/,
  'deployment detail source SHA must match the exact authorized main SHA');

/* HTTP 200 alone is insufficient: canonical bytes and #430 markers must match. */
assert.match(workflow, /expected_sha="\$\(sha256sum dist\/index\.html/,
  'workflow must hash the exact production artifact');
assert.match(workflow, /actual_sha="\$\(sha256sum "\$actual_file"/,
  'workflow must hash canonical live content');
assert.match(workflow, /주민코드가 없어요 · 나중에 인증/,
  'canonical verification must pin the no-code signup path');
assert.match(workflow, /주민코드가 있어요 · 지금 인증/,
  'canonical verification must pin the has-code signup path');
assert.match(workflow, /verificationReceiptRef\|danjionResidentVerified/,
  'canonical verification must reject stale/forbidden signup markers');
assert.doesNotMatch(workflow, /Canonical DanjiOn Pages HTTP smoke: PASS/,
  'workflow must not report HTTP-200-only canonical success');

/* #444 stage-1: the root Pages Functions auth facade must exist where the deploy runs. */
assert.match(workflow, /test -f functions\/_lib\/auth-facade\.js/,
  'assembly must require the shared auth facade module at the repository root');
assert.match(workflow, /test -f 'functions\/api\/auth\/\[\[path\]\]\.js'/,
  'assembly must require the /api/auth/* facade route at the repository root');
assert.match(workflow, /test -f functions\/auth\/social-start\.js/,
  'assembly must require the /auth/social-start facade route at the repository root');

/* Owner decision: the release contract must name the Pages host as the current
   public origin and record the custom domain as future, deferred work. */
assert.match(workflow, /CURRENT_PUBLIC_ORIGIN:\s*https:\/\/danjion\.pages\.dev/,
  'production workflow must declare the current public Pages origin');
assert.match(workflow, /FUTURE_CUSTOM_DOMAIN:\s*https:\/\/danjion\.padiem\.net/,
  'the custom domain must be declared as future work, not the live origin');
assert.match(workflow, /CUSTOM_DOMAIN_STATUS:\s*DEFERRED/,
  'the custom domain must be recorded as deferred');
// Still a valid guarantee: the runtime must keep recognising the custom domain as
// a same-origin-safe host, so future #779 work cannot silently lose it. This is
// source readiness, not current deployment authority.
assert.match(workflow, /grep -R -q 'danjion\.padiem\.net' dist\/assets\/danjion-session\.js/,
  'scan step must keep verifying the custom-domain hostname is recognised in the artifact');
// The deferred domain must never become a release destination or dependency.
assert.ok(!/curl[^\n]*danjion\.padiem\.net/.test(workflow),
  'the release must not require HTTP availability of the deferred custom domain');

/* Release summary regression guard: shell-safe quoting for step summary (#804) */
export function verifyReleaseSummaryShellSafe(workflowText) {
  assert.doesNotMatch(workflowText, /echo '[^'\n]*\\\'\\\'[^'\n]*'/,
    'release summary must not embed escaped single quotes inside single-quoted strings');
  assert.doesNotMatch(workflowText, /echo '- Browser API\/Auth:[^'\n]*\\\'\\\'/,
    'release summary must not contain the broken facade echo line');
  assert.match(workflowText, /printf '%s\\n' ["']- Browser API\/Auth: same-origin Pages Function facade \(resolver returns '' on both canonical hosts\)["']/,
    'release summary must use shell-safe quoting for the same-origin facade item');

  // Static shell syntax verification of the Record Pages release disposition run script
  const summaryStepMatch = workflowText.match(/name:\s*Record Pages release disposition[\s\S]*?run:\s*\|([\s\S]*?)(?:\n\s*-\s*name:|\n\s*[a-z]+:|$)/);
  assert.ok(summaryStepMatch, 'Record Pages release disposition step must exist');
  const summaryLines = summaryStepMatch[1].split('\n');
  for (const line of summaryLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    assert.ok(!/'[^']*\\'/.test(trimmed),
      `line in summary script must not contain illegal \\' inside single quotes: ${trimmed}`);
  }

  // Shell syntax check via bash -n if bash is available
  try {
    const check = spawnSync('bash', ['-n'], { input: summaryStepMatch[1], encoding: 'utf8' });
    if (check.status !== null && check.status !== 0) {
      throw new Error(`Summary script failed bash -n syntax validation (exit ${check.status}): ${check.stderr || check.stdout}`);
    }
  } catch (err) {
    if (err && err.message && err.message.includes('bash -n syntax validation')) {
      throw err;
    }
  }

  return true;
}

// Verify shipped workflow
verifyReleaseSummaryShellSafe(workflow);
console.log('RELEASE_SUMMARY_SHELL_SAFE: PASS');

// Mutation Proof: revert to broken echo with unescapable single-quote in single-quotes
const mutatedWorkflow = workflow.replace(
  /printf '%s\\n' ["']- Browser API\/Auth: same-origin Pages Function facade \(resolver returns '' on both canonical hosts\)["']/,
  "echo '- Browser API/Auth: same-origin Pages Function facade (resolver returns \\'\\' on both canonical hosts)'"
);
assert.notEqual(mutatedWorkflow, workflow, 'workflow mutation must differ from original shipped workflow');

assert.throws(
  () => verifyReleaseSummaryShellSafe(mutatedWorkflow),
  /release summary must not embed escaped single quotes inside single-quoted strings|line in summary script must not contain illegal \\'|bash -n syntax validation/,
  'verifyReleaseSummaryShellSafe must throw on broken shell quoting regression'
);
console.log('RELEASE_SUMMARY_MUTATION_PROOF: PASS');
console.log('leaf-b14-pages-production-release-contract: PASS');

/* #896: the Cloudflare account/project guard must survive transient Cloudflare API
   auth/transport failures with a BOUNDED retry/backoff instead of failing before
   any Pages mutation. Observed 2026-09-23 while the Cloudflare incident
   "Intermittent authentication errors for API and R2" was open: run 35848152267
   died on `curl: (35)` connection reset and run 35849190456 died on HTTP 403,
   while an identical account call passed in run 35847785472 minutes earlier.
   After the bounded attempts the guard must stay fail-closed. */
export function verifyCloudflareGuardRetry(workflowText) {
  const guardStepMatch = workflowText.match(/name:\s*Verify Padiem account and canonical Pages project[\s\S]*?(?=\n\s*-\s*name:)/);
  assert.ok(guardStepMatch, 'Cloudflare account/project guard step must exist');
  const guard = guardStepMatch[0];

  assert.equal((guard.match(/cf_guard_json "https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\//g) || []).length, 2,
    'both guard requests (account + Pages project) must go through the bounded retry helper');
  assert.match(guard, /for attempt in 1 2 3 4 5; do/,
    'guard retry must be bounded to a small finite attempt list');
  assert.doesNotMatch(guard, /while\s+true|while\s*:/,
    'guard must not retry in an unbounded loop');
  assert.match(guard, /return 1/,
    'guard helper must fail closed after the bounded attempts are exhausted');
  assert.equal((guard.match(/exit 1/g) || []).length, 2,
    'both account and project mismatch paths must stay fail-closed (exit 1)');
  assert.match(guard, /set -euo pipefail/, 'guard step must keep strict shell flags');

  return true;
}

// Verify shipped workflow
verifyCloudflareGuardRetry(workflow);
console.log('CLOUDFLARE_GUARD_BOUNDED_RETRY: PASS');

// Mutation Proof A: an unbounded retry loop must be rejected
const unboundedRetryWorkflow = workflow.replace('for attempt in 1 2 3 4 5; do', 'while true; do');
assert.notEqual(unboundedRetryWorkflow, workflow, 'workflow mutation must differ from original shipped workflow');
assert.throws(
  () => verifyCloudflareGuardRetry(unboundedRetryWorkflow),
  /guard retry must be bounded to a small finite attempt list|guard must not retry in an unbounded loop/,
  'unbounded retry must fail the guard retry contract'
);
console.log('CLOUDFLARE_GUARD_UNBOUNDED_MUTATION_PROOF: PASS');

// Mutation Proof B: bypassing the bounded helper for one guard request must be rejected
const bypassedHelperWorkflow = workflow.replace(
  'project_json="$(cf_guard_json "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PAGES_PROJECT}")"',
  'project_json="$(curl --silent --show-error --fail -H "$auth_header" "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PAGES_PROJECT}")"'
);
assert.notEqual(bypassedHelperWorkflow, workflow, 'workflow mutation must differ from original shipped workflow');
assert.throws(
  () => verifyCloudflareGuardRetry(bypassedHelperWorkflow),
  /both guard requests \(account \+ Pages project\) must go through the bounded retry helper/,
  'a direct un-retried guard request must fail the guard retry contract'
);
console.log('CLOUDFLARE_GUARD_HELPER_BYPASS_MUTATION_PROOF: PASS');

// Mutation Proof C: dropping the fail-closed return must be rejected
const openGuardWorkflow = workflow.replace('            return 1\n', '            return 0\n');
assert.notEqual(openGuardWorkflow, workflow, 'workflow mutation must differ from original shipped workflow');
assert.throws(
  () => verifyCloudflareGuardRetry(openGuardWorkflow),
  /guard helper must fail closed after the bounded attempts are exhausted/,
  'an open (non-failing) guard helper must fail the guard retry contract'
);
console.log('CLOUDFLARE_GUARD_FAIL_CLOSED_MUTATION_PROOF: PASS');
console.log('leaf-b14-pages-production-release-contract-retry-hardening: PASS');

/* #974: bind the actual Pages production mutation to the separately authorized
   full main SHA, and fail closed if main or the checkout moves. */
function namedStep(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`      - name: ${escaped}\\n[\\s\\S]*?(?=\\n      - (?:name:|uses:)|$)`));
  assert.ok(match, `required workflow step must exist: ${name}`);
  return match[0];
}

function assertBashSyntax(step, name) {
  const script = step.match(/        run: \|\n([\s\S]*)$/);
  assert.ok(script, `${name} must contain a literal run script`);
  const check = spawnSync('bash', ['-n'], { input: script[1], encoding: 'utf8' });
  assert.equal(check.status, 0, `${name} bash syntax failed: ${check.stderr || check.stdout}`);
}

export function verifyExactMainReleaseAuthority(workflowText) {
  assert.match(
    workflowText,
    /expected_main:\n\s+description: 'Exact origin\/main SHA authorized by CENTRAL[^\n]*'\n\s+required: true\n\s+type: string/,
    'required exact-main input must exist',
  );
  assert.doesNotMatch(workflowText, /^\s{2}(?:push|pull_request|schedule):/m,
    'Production Pages release must remain manual-only');

  const checkout = workflowText.match(/      - uses: actions\/checkout@v4\n\s+with:\n\s+ref: \$\{\{ inputs\.expected_main \}\}\n\s+fetch-depth: 1/);
  assert.ok(checkout, 'checkout must bind directly to the immutable expected_main input');

  const inputStep = namedStep(workflowText, 'Validate exact main release authority input');
  assertBashSyntax(inputStep, 'exact-main input validation step');
  assert.match(inputStep, /GITHUB_REF.*refs\/heads\/main/,
    'non-main dispatch must be denied before checkout');
  assert.match(inputStep, /\[ -z "\$\{EXPECTED_MAIN\}" \]/,
    'missing expected_main must fail closed');
  assert.match(inputStep, /\^\[0-9a-fA-F\]\{40\}\$/,
    'expected_main must require a full 40-character hexadecimal SHA');

  const sourceStep = namedStep(workflowText, 'Verify exact current main authority before source assembly');
  assertBashSyntax(sourceStep, 'exact-main source authority step');
  assert.match(sourceStep, /local_sha="\$\(git rev-parse HEAD\)"/,
    'source authority must read back checked-out HEAD');
  assert.match(sourceStep, /git ls-remote origin refs\/heads\/main/,
    'source authority must fresh-read remote main');
  assert.match(sourceStep, /local_sha.*EXPECTED_MAIN.*remote_sha.*EXPECTED_MAIN/,
    'source authority must compare both checkout and remote main to expected_main');
  assert.match(sourceStep, /PRECHECKOUT_SOURCE_AUTHORITY=PASS/,
    'source authority must emit a safe PASS marker');

  const deployStep = namedStep(workflowText, 'Recheck exact main authority and deploy canonical Pages production');
  assertBashSyntax(deployStep, 'pre-deploy exact-main + Pages deploy step');
  const predeployRead = deployStep.indexOf('predeploy_remote_sha="$(git ls-remote origin refs/heads/main');
  const mutationBoundary = deployStep.indexOf('npx wrangler@4.131.0 pages deploy dist');
  assert.ok(predeployRead >= 0 && predeployRead < mutationBoundary,
    'fresh remote-main equality must be rechecked immediately before Pages mutation');
  assert.match(deployStep, /predeploy_local_sha.*EXPECTED_MAIN.*predeploy_remote_sha.*EXPECTED_MAIN/,
    'pre-deploy guard must compare checkout and current main to expected_main');
  assert.match(deployStep, /--commit-hash "\$EXPECTED_MAIN"/,
    'Pages provenance must record the exact authorized SHA');
  assert.doesNotMatch(deployStep, /--commit-hash "\$GITHUB_SHA"/,
    'Pages provenance must not use the mutable dispatch SHA');
  const deployCommands = deployStep
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  assert.equal((deployCommands.match(/npx wrangler@4\.131\.0 pages deploy/g) || []).length, 1,
    'one dispatched run must execute exactly one Pages mutation');
  assert.doesNotMatch(deployCommands, /while\b|until\b|for\s+\w+\s+in/,
    'Production mutation must not be automatically retried');

  const readbackStep = namedStep(workflowText, 'Verify canonical deployment readback');
  assertBashSyntax(readbackStep, 'canonical deployment SHA readback step');
  assert.match(readbackStep, /\[ -z "\$canonical_commit" \][\s\S]*!= "\$EXPECTED_MAIN"/,
    'canonical provenance must be present and equal expected_main');
  assert.match(readbackStep, /\[ -z "\$deployment_commit" \][\s\S]*!= "\$EXPECTED_MAIN"/,
    'deployment-detail provenance must be present and equal expected_main');

  assert.match(workflowText, /MAX_DISPATCH: '1'/,
    'MAX_DISPATCH=1 policy must remain explicit');
  assert.match(workflowText, /AUTO_RETRY: '0'/,
    'AUTO_RETRY=0 policy must remain explicit');
  assert.match(workflowText, /FAILED_PRODUCTION_RUN_RERUN_FORBIDDEN: 'true'/,
    'failed Production run rerun prohibition must remain explicit');
  assert.match(workflowText, /build-attribution\.mjs dist "\$EXPECTED_MAIN"/,
    'artifact provenance must be stamped from expected_main');

  return true;
}

verifyExactMainReleaseAuthority(workflow);
console.log('EXPECTED_MAIN_INPUT_REQUIRED=PASS');
console.log('FULL_SHA_VALIDATION=PASS');
console.log('CHECKOUT_BINDS_EXPECTED_SHA=PASS');
console.log('CURRENT_MAIN_EQUALITY_GUARD=PASS');
console.log('PRE_DEPLOY_SHA_READBACK=PASS');
console.log('STALE_MAIN_FAIL_CLOSED=PASS');
console.log('MALFORMED_SHA_FAIL_CLOSED=PASS');
console.log('MOVING_MAIN_RACE_CLOSED=PASS');
console.log('PRODUCTION_DEPLOY_NOT_RUN_BY_TEST=PASS');

const requiredInputBlock = `      expected_main:
        description: 'Exact origin/main SHA authorized by CENTRAL for this Production Pages release'
        required: true
        type: string
`;
const missingInputWorkflow = workflow.replace(requiredInputBlock, '');
assert.notEqual(missingInputWorkflow, workflow, 'missing-input mutation must change the workflow');
assert.throws(() => verifyExactMainReleaseAuthority(missingInputWorkflow),
  /required exact-main input must exist/);
console.log('MISSING_EXPECTED_MAIN_MUTATION_PROOF=PASS');

const malformedInputWorkflow = workflow.replace(
  'if ! [[ "${EXPECTED_MAIN}" =~ ^[0-9a-fA-F]{40}$ ]]; then',
  'if false; then',
);
assert.notEqual(malformedInputWorkflow, workflow, 'malformed-input mutation must change the workflow');
assert.throws(() => verifyExactMainReleaseAuthority(malformedInputWorkflow),
  /full 40-character hexadecimal SHA/);
console.log('MALFORMED_EXPECTED_MAIN_MUTATION_PROOF=PASS');

const staleMainWorkflow = workflow.replace(
  'if [ "${local_sha}" != "${EXPECTED_MAIN}" ] || [ "${remote_sha}" != "${EXPECTED_MAIN}" ]; then',
  'if false; then',
);
assert.notEqual(staleMainWorkflow, workflow, 'stale-main mutation must change the workflow');
assert.throws(() => verifyExactMainReleaseAuthority(staleMainWorkflow),
  /compare both checkout and remote main to expected_main/);
console.log('STALE_EXPECTED_MAIN_MUTATION_PROOF=PASS');

const checkedOutMismatchWorkflow = workflow.replace(
  'if [ "${predeploy_local_sha}" != "${EXPECTED_MAIN}" ] || [ "${predeploy_remote_sha}" != "${EXPECTED_MAIN}" ]; then',
  'if false; then',
);
assert.notEqual(checkedOutMismatchWorkflow, workflow, 'checked-out mismatch mutation must change the workflow');
assert.throws(() => verifyExactMainReleaseAuthority(checkedOutMismatchWorkflow),
  /pre-deploy guard must compare checkout and current main to expected_main/);
console.log('CHECKED_OUT_SHA_MISMATCH_MUTATION_PROOF=PASS');

const missingPredeployRemoteWorkflow = workflow.replace(
  'predeploy_remote_sha="$(git ls-remote origin refs/heads/main | awk \'NR==1 {print $1}\')"',
  'predeploy_remote_sha=""',
);
assert.notEqual(missingPredeployRemoteWorkflow, workflow, 'pre-deploy remote-read mutation must change the workflow');
assert.throws(() => verifyExactMainReleaseAuthority(missingPredeployRemoteWorkflow),
  /fresh remote-main equality must be rechecked immediately before Pages mutation/);
console.log('PREDEPLOY_REMOTE_READ_MUTATION_PROOF=PASS');

const emptyPostdeployCommitWorkflow = workflow.replace(
  '[ -z "$canonical_commit" ]',
  '[ -n "$canonical_commit" ]',
);
assert.notEqual(emptyPostdeployCommitWorkflow, workflow, 'empty post-deploy provenance mutation must change the workflow');
assert.throws(() => verifyExactMainReleaseAuthority(emptyPostdeployCommitWorkflow),
  /canonical provenance must be present and equal expected_main/);
console.log('EMPTY_POSTDEPLOY_PROVENANCE_MUTATION_PROOF=PASS');

console.log('leaf-b14-pages-production-release-contract-exact-main: PASS');
