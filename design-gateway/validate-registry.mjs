import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const registry = JSON.parse(await readFile(join(root, 'version-registry.json'), 'utf8'));
const expected = new Map([
  ['v3-current', 'index.html'],
  ['legacy-a', 'index.html'],
  ['legacy-b', 'index.html'],
  ['pr378', 'site/index.html'],
]);

assert.equal(registry.schema_version, 'danjion-static-design-version/v1');
assert.equal(registry.generated_from_main, 'f23c4e1f5622a2313c51c94d2ac54df568b2ea9a');
assert.equal(registry.production_url_untouched, true);
assert.equal(registry.production_api_write, false);
assert.equal(registry.production_secrets, false);
assert.equal(registry.versions.length, 4);
assert.deepEqual(new Set(registry.versions.map((version) => version.version_id)), new Set(expected.keys()));

for (const version of registry.versions) {
  assert.equal(version.frozen, true, `${version.version_id} must be frozen`);
  assert.equal(version.mutable, false, `${version.version_id} must be immutable`);
  assert.ok(version.source_sha, `${version.version_id} must have source provenance`);
  assert.ok(version.do_not_merge, `${version.version_id} must have a merge boundary`);
  const entry = join(root, 'versions', version.version_id, expected.get(version.version_id));
  const entryText = await readFile(entry, 'utf8');
  assert.ok(entryText.length > 0, `${version.version_id} entry must be non-empty`);
  // Compiled React dependencies may retain the names of environment variables
  // without containing their values. Scan values/configuration separately.
  assert.doesNotMatch(entryText, /CLOUDFLARE_API_TOKEN\s*[=:]\s*[^\s,}]+/);
  assert.doesNotMatch(entryText, /DANJION_PRODUCTION_DB_URL\s*[=:]\s*[^\s,}]+/);
  assert.doesNotMatch(entryText, /BETTER_AUTH_SECRET\s*[=:]\s*[^\s,}]+/);
  assert.doesNotMatch(entryText, /padiem-danjion-api-production\.padiem\.workers\.dev/);
}

const files = [];
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, item.name);
    if (item.isDirectory()) await walk(full);
    else files.push(full);
  }
}
await walk(join(root, 'versions'));
assert.ok(!files.some((file) => relative(root, file).replaceAll('\\', '/').startsWith('versions/v2-runtime/')), 'v2-runtime must not be packaged by KILO2');
for (const file of files) {
  const text = await readFile(file, 'utf8');
  assert.doesNotMatch(text, /CLOUDFLARE_API_TOKEN\s*[=:]\s*[^\s,}]+/);
  assert.doesNotMatch(text, /DANJION_PRODUCTION_DB_URL\s*[=:]\s*[^\s,}]+/);
  assert.doesNotMatch(text, /BETTER_AUTH_SECRET\s*[=:]\s*[^\s,}]+/);
  assert.doesNotMatch(text, /padiem-danjion-api-production\.padiem\.workers\.dev/);
}

const pr378 = registry.versions.find((version) => version.version_id === 'pr378');
assert.equal(pr378.source_sha, 'b618cad4abb4d966181f3ab7fcac2e7c2ebcc7f3');
assert.match(pr378.do_not_merge, /DO_NOT_MERGE/);
assert.ok(files.some((file) => relative(join(root, 'versions', 'pr378'), file) === join('site', 'index.html')));
assert.ok(!files.some((file) => relative(join(root, 'versions', 'pr378'), file) === join('site', 'index3.html')));

console.log(`static design registry: PASS retained=${registry.versions.length} files=${files.length}`);
