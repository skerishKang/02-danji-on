import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const scriptPath = fileURLToPath(new URL('scripts/assert-live-build-env.mjs', root));
const [adapter, storage, envExample, pagesWorkflow] = await Promise.all([
  readFile(new URL('src/api/adapter.ts', root), 'utf8'),
  readFile(new URL('src/storage.ts', root), 'utf8'),
  readFile(new URL('.env.example', root), 'utf8'),
  readFile(new URL('../../.github/workflows/pages-production-release.yml', root), 'utf8')
]);

function run(extraEnv) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv }
  });
}

const missing = run({ VITE_DATA_MODE: '', VITE_AUTH_MODE: '', VITE_STORAGE_MODE: '' });
assert.notEqual(missing.status, 0, 'live preflight must fail when authority modes are missing');
assert.match(missing.stderr, /VITE_DATA_MODE must be api/);
assert.match(missing.stderr, /VITE_AUTH_MODE must be danjion/);
assert.match(missing.stderr, /VITE_STORAGE_MODE must be drive/);

const mock = run({ VITE_DATA_MODE: 'mock', VITE_AUTH_MODE: 'dev', VITE_STORAGE_MODE: 'mock' });
assert.notEqual(mock.status, 0, 'mock/dev/mock must never qualify as a live artifact');

const live = run({ VITE_DATA_MODE: 'api', VITE_AUTH_MODE: 'danjion', VITE_STORAGE_MODE: 'drive' });
assert.equal(live.status, 0, live.stderr || 'exact live profile must pass');
assert.match(live.stdout, /PASS live frontend authority profile/);

assert.match(adapter, /VITE_DATA_MODE === 'api'[\s\S]*new ApiAdapter\(\)[\s\S]*new MockAdapter\(\)/,
  'frontend data authority must remain explicit');
assert.match(storage, /VITE_STORAGE_MODE === 'drive'[\s\S]*new GoogleDriveStorageAdapter\(\)[\s\S]*new MockStorageAdapter\(\)/,
  'frontend storage authority must remain explicit');
assert.match(envExample, /VITE_DATA_MODE=mock/);
assert.match(envExample, /VITE_AUTH_MODE=dev/);
assert.match(envExample, /VITE_STORAGE_MODE=mock/);

// Canonical production Pages release contract for #239 / parent #222.
assert.match(pagesWorkflow, /name: Pages Production Release/);
assert.match(pagesWorkflow, /workflow_dispatch:/, 'Pages production must remain explicitly dispatched');
assert.match(pagesWorkflow, /environment: production/, 'Pages mutation must use the GitHub production environment boundary');
assert.match(pagesWorkflow, /VITE_UI_VARIANT:\s*v2/, 'canonical DanjiOn production must expose the integrated V2 surface');
assert.match(pagesWorkflow, /VITE_DATA_MODE:\s*api/);
assert.match(pagesWorkflow, /VITE_AUTH_MODE:\s*danjion/);
assert.match(pagesWorkflow, /VITE_STORAGE_MODE:\s*drive/);
assert.match(pagesWorkflow, /VITE_API_BASE_URL:\s*https:\/\/padiem-danjion-api-production\.padiem\.workers\.dev/);
assert.match(pagesWorkflow, /VITE_AUTH_BASE_URL:\s*https:\/\/padiem-danjion-api-production\.padiem\.workers\.dev/);
assert.match(pagesWorkflow, /PAGES_PROJECT:\s*danjion/);
assert.match(pagesWorkflow, /PAGES_PRODUCTION_BRANCH:\s*main/);
assert.match(pagesWorkflow, /CANONICAL_PAGES_URL:\s*https:\/\/danjion\.pages\.dev/);
assert.match(pagesWorkflow, /CLOUDFLARE_API_TOKEN:\s*\$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
assert.match(pagesWorkflow, /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
assert.match(pagesWorkflow, /account_name.*Padiem/s, 'Pages workflow must fail closed outside the Padiem Cloudflare account');
assert.match(pagesWorkflow, /pages\/projects\/\$\{PAGES_PROJECT\}/, 'canonical Pages project must be read back before mutation');
assert.match(pagesWorkflow, /production_branch/, 'canonical production branch must be read back before mutation');
assert.match(pagesWorkflow, /\/api\/health/);
assert.match(pagesWorkflow, /\/api\/auth\/jwks/);
assert.ok(
  pagesWorkflow.indexOf('Require live production API and Better Auth before Pages mutation')
    < pagesWorkflow.indexOf('Deploy canonical Pages production'),
  'API/JWKS preflight must happen before Pages mutation'
);
assert.match(pagesWorkflow, /npm run build:live/);
assert.match(pagesWorkflow, /wrangler@4\.114\.0 pages deploy dist/);
assert.match(pagesWorkflow, /--project-name "\$PAGES_PROJECT"/);
assert.match(pagesWorkflow, /--branch "\$PAGES_PRODUCTION_BRANCH"/);
assert.match(pagesWorkflow, /--commit-hash "\$GITHUB_SHA"/);
assert.match(pagesWorkflow, /x-danjion-dev-auth-user/, 'release scan must explicitly reject the dev-auth header from the built artifact');
assert.doesNotMatch(pagesWorkflow, /VITE_[A-Z0-9_]+:\s*\$\{\{ secrets\./, 'Vite variables must never consume GitHub secrets');
assert.doesNotMatch(pagesWorkflow, /PADIEM_CONTACT_DELIVERY|DANJION_PRODUCTION_DB_URL/, 'Pages release must not own backend phone delivery or database secrets');

console.log('PASS live frontend build profile and guarded Pages production contract');
