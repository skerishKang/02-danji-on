import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../.github/workflows/pages-production-release.yml', import.meta.url), 'utf8');

/* #432: canonical production upload must not force a branch-directed preview deploy. */
assert.match(workflow, /npx wrangler@4\.114\.0 pages deploy dist[\s\S]*--project-name "\$PAGES_PROJECT"[\s\S]*--commit-hash "\$GITHUB_SHA"/,
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

console.log('leaf-b14-pages-production-release-contract: PASS');
