import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const wrangler = JSON.parse(await readFile(new URL('wrangler.jsonc', root), 'utf8'));
const worker = await readFile(new URL('src/worker-v2.ts', root), 'utf8');
const signup = await readFile(new URL('src/signup-contact-verification-v1.ts', root), 'utf8');
const workflow = await readFile(new URL('../../.github/workflows/production-worker-bootstrap.yml', root), 'utf8');

const production = wrangler.env?.production;
assert.ok(production, 'production Worker environment must exist');
assert.equal(production.name, 'padiem-danjion-api-production');
assert.equal(production.workers_dev, true, 'production Worker must retain a stable workers.dev URL until a custom API domain exists');
assert.equal(
  production.vars?.DANJION_AUTH_BASE_URL,
  'https://padiem-danjion-api-production.padiem.workers.dev',
  'Better Auth issuer/base URL must match the canonical production Worker URL'
);
assert.deepEqual(
  production.secrets?.required,
  ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'DANJION_CONTACT_REF_SECRET'],
  'production deploy must fail closed unless core auth/database secrets are present'
);
assert.equal(production.vars?.BUSINESS_IMAGE_RECONCILIATION_ENABLED, 'false', 'first production bootstrap must keep background Drive reconciliation off until its runtime is fully configured');
assert.deepEqual(production.triggers?.crons, ['*/15 * * * *'], 'the production schedule remains declared for later activation');

assert.match(worker, /BUSINESS_IMAGE_RECONCILIATION_ENABLED\?: string/);
assert.match(worker, /backgroundReconciliationEnabled/);
assert.match(worker, /if \(!backgroundReconciliationEnabled\(env\)\)/, 'scheduled handler must fail inert before touching production storage');
assert.ok(
  worker.indexOf('if (!backgroundReconciliationEnabled(env))') < worker.indexOf('runBusinessImageLifecycleReconciliation(env)'),
  'bootstrap gate must execute before the mutating reconciliation runtime'
);

assert.match(signup, /!env\.PADIEM_CONTACT_VERIFICATION \|\| !env\.PADIEM_CONTACT_DELIVERY \|\| !env\.DANJION_CONTACT_REF_SECRET/);
assert.match(signup, /VERIFICATION_NOT_CONFIGURED/);
assert.doesNotMatch(wrangler.services ? JSON.stringify(wrangler.services) : '', /PADIEM_CONTACT_DELIVERY/);
assert.doesNotMatch(JSON.stringify(production.services || []), /PADIEM_CONTACT_DELIVERY/, 'no delivery binding may be implied before a real provider service exists');
assert.deepEqual(
  production.services,
  [{ binding: 'PADIEM_CONTACT_VERIFICATION', service: 'padiem-contact-verification' }],
  'production must bind only the canonical private Padiem verification core in this bootstrap slice'
);

assert.match(workflow, /name: Production Worker Bootstrap/);
assert.match(workflow, /workflow_dispatch:/, 'production deployment must remain explicitly dispatchable');
assert.match(workflow, /environment: production/, 'production mutation must use the GitHub production environment boundary');
assert.match(workflow, /\[production-bootstrap\]/, 'the one-time merge-triggered bootstrap must require an explicit commit marker');
assert.match(workflow, /node-version: '24'/);
assert.doesNotMatch(workflow, /cache-dependency-path:/, 'bootstrap must not reference a nonexistent backend lockfile');
assert.doesNotMatch(workflow, /cache:\s*npm/, 'bootstrap must not enable setup-node npm caching without a committed lockfile');
assert.match(workflow, /npm install --ignore-scripts/, 'backend dependencies must use the repository-compatible install path');
assert.doesNotMatch(workflow, /npm ci --ignore-scripts/, 'npm ci cannot be used while the backend has no committed package-lock');
assert.match(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
assert.match(workflow, /DANJION_PRODUCTION_DB_URL: \$\{\{ secrets\.DANJION_PRODUCTION_DB_URL \}\}/);
assert.match(workflow, /account_name.*Padiem/s, 'workflow must fail closed outside the Padiem Cloudflare account');
assert.match(workflow, /VERIFICATION_WORKER: padiem-contact-verification/);
assert.match(workflow, /workers\/services\/\$\{VERIFICATION_WORKER\}/, 'private Padiem verification Worker must be checked before production mutation');
assert.match(workflow, /wrangler secret list --env production --format json/, 'existing secret names must be read without exposing values');
assert.match(workflow, /openssl rand -hex 32/, 'missing product-only secrets must be generated with cryptographic randomness');
assert.match(workflow, /wrangler deploy --env production --secrets-file/, 'production deploy must upload secrets through the encrypted Worker secret path');
assert.match(workflow, /Production health \+ Better Auth JWKS smoke: PASS/);
assert.match(workflow, /Real phone OTP delivery: HOLD \/ Issue #235/);
assert.doesNotMatch(workflow, /PADIEM_CONTACT_DELIVERY:/, 'bootstrap must not invent a real phone delivery binding');
assert.doesNotMatch(workflow, /set -x/, 'production workflow must never shell-trace secret-bearing commands');

console.log('Production bootstrap safety contract: PASS');
