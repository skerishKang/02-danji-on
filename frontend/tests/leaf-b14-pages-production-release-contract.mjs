import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

console.log('leaf-b14-pages-production-release-contract: PASS');
