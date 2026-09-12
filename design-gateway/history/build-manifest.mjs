import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const files = [];

async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, item.name);
    if (item.isDirectory()) await walk(full);
    else files.push(full);
  }
}

await walk(join(root, 'bundles'));
const manifest = files.map((file) => {
  const bytes = readFileSync(file);
  return {
    path: relative(root, file).replaceAll('\\', '/'),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}).sort((a, b) => a.path.localeCompare(b.path));

await writeFile(join(root, 'bundle-manifest.json'), `${JSON.stringify({
  schema_version: 'danjion-history-bundle/v1',
  generated_from_main: 'a9f620afec9ca2f0007c6ff1e58c2ebefa6c50b8',
  files: manifest,
}, null, 2)}\n`);
console.log(`history bundle manifest: PASS files=${manifest.length}`);
