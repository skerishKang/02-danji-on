import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const wrangler = JSON.parse(fs.readFileSync(path.join(backendRoot, 'wrangler.jsonc'), 'utf8'));
const authSource = fs.readFileSync(path.join(backendRoot, 'src', 'auth-v1.ts'), 'utf8');

assert.equal(wrangler.env.preview.name, 'padiem-danjion-api-preview');
assert.equal(wrangler.env.preview.vars.APP_ENV, 'preview');
assert.equal(wrangler.env.preview.vars.DEV_AUTH_BYPASS, 'true');
assert.equal(wrangler.env.preview.workers_dev, false);
assert.equal(wrangler.env.preview.preview_urls, true);

assert.equal(wrangler.env.production.name, 'padiem-danjion-api-production');
assert.equal(wrangler.env.production.vars.APP_ENV, 'production');
assert.equal(wrangler.env.production.vars.DEV_AUTH_BYPASS, 'false');
assert.equal(wrangler.env.production.workers_dev, false);
assert.equal(wrangler.env.production.preview_urls, false);

assert.match(
  authSource,
  /env\.APP_ENV\s*!==\s*['"]production['"]\s*&&\s*env\.DEV_AUTH_BYPASS\s*===\s*['"]true['"]/,
  'shared auth resolver must require both non-production APP_ENV and explicit DEV_AUTH_BYPASS=true'
);

console.log('PASS preview demo auth contract: synthetic header bypass is preview-only and production remains closed');
