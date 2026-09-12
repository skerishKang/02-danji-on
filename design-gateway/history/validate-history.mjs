import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const registry = JSON.parse(await readFile(join(root, 'registry.json'), 'utf8'));
const expectedFamilies = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V6 COLORWAYS', 'V7', 'M1', 'STATIC V2', 'REACT V2', 'CURRENT V3', 'CURRENT GATEWAY', 'PR #378'];
const entries = registry.entries;
const newEntries = entries.filter((entry) => !entry.existing_route);

assert.equal(registry.schema_version, 'danjion-full-history-archive/v1');
assert.equal(registry.route, '/history/');
assert.equal(registry.generated_from_main, 'a9f620afec9ca2f0007c6ff1e58c2ebefa6c50b8');
assert.equal(registry.noindex, true);
assert.equal(registry.production_url_untouched, true);
assert.equal(registry.production_api_write, false);
assert.equal(registry.production_secrets, false);
assert.equal(entries.length, 19);
assert.equal(new Set(entries.map((entry) => entry.slug)).size, entries.length);
assert.ok(entries.every((entry) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug)));
assert.ok(entries.every((entry) => entry.source_path && entry.source_ref && entry.source_sha));
assert.ok(entries.every((entry) => entry.difference && entry.difference.length > 10));
assert.deepEqual([...new Set(entries.map((entry) => entry.family))], expectedFamilies.filter((family) => entries.some((entry) => entry.family === family)));

const files = [];
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, item.name);
    if (item.isDirectory()) await walk(full);
    else files.push(full);
  }
}
await walk(join(root, 'bundles'));

for (const entry of newEntries) {
  const bundle = join(root, entry.bundle.replace(/^bundles\//, 'bundles/'));
  const entryPath = join(bundle, entry.entry);
  assert.ok(await stat(bundle), `${entry.slug} bundle directory exists`);
  assert.ok(await stat(entryPath), `${entry.slug} entry exists`);
  const html = await readFile(entryPath, 'utf8');
  assert.ok(html.length > 500, `${entry.slug} entry is renderable-sized`);
  assert.doesNotMatch(html, /CLOUDFLARE_API_TOKEN\s*[=:]\s*[^\s,}]+/);
  assert.doesNotMatch(html, /DANJION_PRODUCTION_DB_URL\s*[=:]\s*[^\s,}]+/);
  assert.doesNotMatch(html, /BETTER_AUTH_SECRET\s*[=:]\s*[^\s,}]+/);
  assert.doesNotMatch(html, /padiem-danjion-api-production\.padiem\.workers\.dev/);
}

const v7Files = files.filter((file) => file.includes('v7-silly-color')).map((file) => relative(root, file).replaceAll('\\', '/'));
assert.deepEqual(v7Files, ['bundles/v7-silly-color/index.html']);
assert.ok(!files.some((file) => file.includes('v6-colorway') && file.endsWith('02_색상안B_코퍼에디토리얼.html')));

const forbidden = [/https?:\/\/padiem-danjion-api-production\.padiem\.workers\.dev/i, /CLOUDFLARE_API_TOKEN\s*[=:]\s*[^\s,}]+/i, /DANJION_PRODUCTION_DB_URL\s*[=:]\s*[^\s,}]+/i, /BETTER_AUTH_SECRET\s*[=:]\s*[^\s,}]+/i];
for (const file of [join(root, 'index.html'), join(root, 'registry.json'), join(root, '_headers'), ...files]) {
  const text = await readFile(file, 'utf8');
  for (const pattern of forbidden) assert.doesNotMatch(text, pattern, `${relative(root, file)} safety scan`);
}

const headers = await readFile(join(root, '_headers'), 'utf8');
assert.match(headers, /X-Robots-Tag:\s*noindex,\s*nofollow/);
assert.match(await readFile(join(root, 'index.html'), 'utf8'), /<meta name="robots" content="noindex, nofollow">/);

const manifest = [];
for (const file of files) {
  const bytes = await readFile(file);
  manifest.push({
    path: relative(root, file).replaceAll('\\', '/'),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
manifest.sort((a, b) => a.path.localeCompare(b.path));
const expectedManifest = JSON.parse(await readFile(join(root, 'bundle-manifest.json'), 'utf8'));
assert.deepEqual(expectedManifest.files, manifest);

console.log(`history archive: PASS candidates=${entries.length} included=${newEntries.length} files=${files.length}`);
