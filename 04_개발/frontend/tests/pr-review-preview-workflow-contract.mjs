import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../../.github/workflows/danjion-pr-review-preview.yml', import.meta.url), 'utf8');

assert.match(workflow, /pull_request_target:/,
  'PR review preview must use the trusted base-branch workflow definition');
assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
  'preview deploy authority must be limited to same-repository PRs');
assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/,
  'artifact build must checkout the exact PR head');
assert.match(workflow, /persist-credentials: false/,
  'PR-controlled build checkout must not persist repository credentials');

const deployAt = workflow.indexOf('  deploy-preview:');
assert.ok(deployAt > -1, 'workflow must split build and deploy jobs');
const buildBlock = workflow.slice(0, deployAt);
const deployBlock = workflow.slice(deployAt);
assert.doesNotMatch(buildBlock, /\$\{\{\s*secrets\./,
  'PR-controlled build job must not receive repository/environment secret expressions');
assert.match(deployBlock, /secrets\.CLOUDFLARE_API_TOKEN/);
assert.match(deployBlock, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
assert.doesNotMatch(deployBlock, /actions\/checkout/,
  'secret-bearing deploy job must not checkout PR-controlled source');
assert.doesNotMatch(deployBlock, /design-gateway\/scripts\//,
  'secret-bearing deploy job must not execute PR-controlled build scripts');

assert.match(workflow, /REVIEW_PROJECT: danjion-review/);
assert.match(workflow, /PREVIEW_BRANCH: pr-\$\{\{ github\.event\.pull_request\.number \}\}/);
assert.match(workflow, /PREVIEW_URL: https:\/\/pr-\$\{\{ github\.event\.pull_request\.number \}\}\.danjion-review\.pages\.dev/);
assert.match(workflow, /test "\$REVIEW_PROJECT" != 'danjion'/,
  'production Pages project must be explicitly rejected');
assert.match(workflow, /test "\$PREVIEW_BRANCH" != 'main'/,
  'review deploy must never use the project production branch');
assert.match(workflow, /actions\/upload-artifact@v4/);
assert.match(workflow, /actions\/download-artifact@v4/);
assert.doesNotMatch(workflow, /DANJION_PRODUCTION|DATABASE_URL|BETTER_AUTH_SECRET|padiem-danjion-api-production/,
  'Phase A review preview must carry no Production/DB/auth secret authority');
assert.match(workflow, /<!-- danjion-pr-review-preview -->/,
  'one stable PR comment marker must own the preview link');

console.log('PASS #769 per-PR non-production review preview workflow contract');
