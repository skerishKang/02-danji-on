import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const workflow = await readFile(new URL('../../.github/workflows/pages-production-release.yml', import.meta.url), 'utf8');

/* #432: canonical production upload must not force a branch-directed preview deploy. */
assert.match(workflow, /npx wrangler@4\.131\.0 pages deploy dist[\s\S]*--project-name "\$PAGES_PROJECT"[\s\S]*--commit-hash "\$GITHUB_SHA"/,
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
assert.match(workflow, /canonical_commit[\s\S]*GITHUB_SHA/,
  'canonical deployment source SHA must be compared when Cloudflare exposes it');

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
