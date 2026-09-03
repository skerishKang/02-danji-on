import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const wrangler = JSON.parse(await readFile(new URL('wrangler.jsonc', root), 'utf8'));
const worker = await readFile(new URL('src/worker-v2.ts', root), 'utf8');
const signup = await readFile(new URL('src/signup-contact-verification-v1.ts', root), 'utf8');

const production = wrangler.env?.production;
assert.ok(production, 'production Worker environment must exist');
assert.equal(production.name, 'padiem-danjion-api-production');
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

console.log('Production bootstrap safety contract: PASS');
