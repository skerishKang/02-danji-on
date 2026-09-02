import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const scriptPath = fileURLToPath(new URL('scripts/assert-live-build-env.mjs', root));
const [adapter, storage, envExample] = await Promise.all([
  readFile(new URL('src/api/adapter.ts', root), 'utf8'),
  readFile(new URL('src/storage.ts', root), 'utf8'),
  readFile(new URL('.env.example', root), 'utf8')
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

console.log('PASS live frontend build profile fail-closed contract');
