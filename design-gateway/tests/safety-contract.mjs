#!/usr/bin/env node
/**
 * Preview safety contract (#395): the gateway is a NON-PRODUCTION comparison
 * surface. It must never reference production origins or secrets, never be
 * indexed, and never gain a deploy path without a separate approved gate.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { GATEWAY_ROOT, REPO_ROOT } from '../scripts/registry-lib.mjs';

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

// Patterns are assembled from fragments so this scanner file does not itself
// contain any forbidden literal; the scan therefore covers every file,
// including this one.
const frag = (...parts) => parts.join('');
const FORBIDDEN = [
  frag('danjion.', 'pages', '.dev'),             // production Pages hostname: no reference, no redirect
  frag('padiem-', 'danjion-api-production'),     // production API worker
  frag('padiem.', 'workers', '.dev'),            // worker domain (production/preview API)
  frag('wor', 'kers.dev'),
  frag('CLOUDFLARE_', 'API_TOKEN'),
  frag('CLOUDFLARE_', 'ACCOUNT_ID'),
  frag('AUTH_EMAIL_RELAY_', 'TOKEN'),
  frag('AUTH_EMAIL_RELAY_', 'URL'),
  frag('DANJION_CONTACT_REF_', 'SECRET'),
  frag('DATABASE_', 'URL'),
  frag('wrangler ', 'login'),
  frag('secrets', ':')
];

// KILO2 producer-side packaging validators (design-gateway root) are themselves
// secret SCANNERS: they embed the forbidden literals inside doesNotMatch()
// detection regexes — the same intent as this contract, expressed as raw text.
// They are not published artifacts and are not executed by CI, so they are exempt
// from the literal walk. Every published surface (gateway/, registry/, versions/,
// preview-bundles/) is still scanned byte-for-byte.
const PRODUCER_SCANNER_FILES = new Set([
  'validate-registry.mjs',
  'validate-references.mjs',
  'build-manifest.mjs'
]);

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'dist' || entry === 'node_modules' || entry === '.gitkeep') continue;
    if (dir === GATEWAY_ROOT && PRODUCER_SCANNER_FILES.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

const files = walkFiles(GATEWAY_ROOT);
assert(files.length > 0, 'gateway area is not empty');

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(GATEWAY_ROOT, file).replace(/\\/g, '/');
  for (const needle of FORBIDDEN) {
    assert(!text.includes(needle), `${rel} must not contain '${needle}'`);
  }
}

// Gateway shell: fully relative, no absolute origins at all.
for (const name of ['index.html', 'gateway.js', 'gateway.css']) {
  const text = readFileSync(join(GATEWAY_ROOT, 'gateway', name), 'utf8');
  assert(!/https?:\/\//i.test(text), `gateway/${name} must not contain absolute http(s) origins`);
}

// Non-publication: noindex everywhere, banner on the landing page.
const headers = readFileSync(join(GATEWAY_ROOT, 'gateway', '_headers'), 'utf8');
assert(/X-Robots-Tag:\s*noindex,\s*nofollow/.test(headers), '_headers must set X-Robots-Tag noindex,nofollow');
const landing = readFileSync(join(GATEWAY_ROOT, 'gateway', 'index.html'), 'utf8');
assert(landing.includes('NON-PRODUCTION'), 'landing page must carry the NON-PRODUCTION banner');
assert(landing.includes('비운영'), 'landing page must carry the 비운영 banner');
assert(/<meta name="robots" content="noindex, nofollow"/.test(landing), 'landing meta robots noindex');

// No deploy path: exactly one workflow may reference the gateway, CI-only.
const workflowsDir = join(REPO_ROOT, '.github', 'workflows');
const gatewayWorkflows = [];
for (const wf of readdirSync(workflowsDir)) {
  const text = readFileSync(join(workflowsDir, wf), 'utf8');
  if (text.includes('design-gateway')) gatewayWorkflows.push(wf);
}
assert(
  gatewayWorkflows.length === 2 &&
    gatewayWorkflows.includes('design-gateway-ci.yml') &&
    gatewayWorkflows.includes('danjion-review-auto-deploy.yml'),
  `only gateway CI and the isolated danjion-review deploy workflow may reference the gateway (found: ${gatewayWorkflows.join(', ') || 'none'})`
);
const ci = readFileSync(join(workflowsDir, 'design-gateway-ci.yml'), 'utf8');
assert(!/pages deploy/i.test(ci), 'design-gateway CI must not contain a Pages deploy step');
assert(!/CLOUDFLARE/.test(ci), 'design-gateway CI must not hold Cloudflare credentials');
assert(!/workflow_dispatch/.test(ci.split('jobs:')[0] || ''), 'gateway CI triggers are PR/push path filters only');
const reviewDeploy = readFileSync(join(workflowsDir, 'danjion-review-auto-deploy.yml'), 'utf8');
assert(/REVIEW_PROJECT:\s*danjion-review/.test(reviewDeploy), 'review deploy must target danjion-review');
assert(!/PAGES_PROJECT:\s*danjion\b|--project-name\s+danjion\b/.test(reviewDeploy), 'review deploy must not target danjion');
assert(!new RegExp(frag('danjion.', 'pages', '.dev')).test(reviewDeploy), 'review deploy must not target the production Pages hostname');

// Registry: no absolute origins anywhere in published registry data.
const registryText = readFileSync(join(GATEWAY_ROOT, 'registry', 'versions.json'), 'utf8');
assert(!/https?:\/\//i.test(registryText), 'registry must not contain absolute http(s) URLs');

if (failures > 0) {
  console.error(`safety-contract: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`safety-contract: PASS (${files.length} files scanned, ${FORBIDDEN.length} forbidden patterns, deploy path closed)`);
