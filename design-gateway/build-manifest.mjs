import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

async function walk(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, item.name);
    if (item.isDirectory()) result.push(...await walk(full));
    else result.push(full);
  }
  return result;
}

const files = [];
for (const file of await walk(join(root, 'versions'))) {
  const bytes = await readFile(file);
  files.push({
    path: relative(root, file).replaceAll('\\', '/'),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
files.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(join(root, 'bundle-manifest.json'), `${JSON.stringify({
  schema_version: 'danjion-static-design-bundle/v1',
  generated_from_main: 'f23c4e1f5622a2313c51c94d2ac54df568b2ea9a',
  files,
}, null, 2)}\n`);
console.log(`static design bundle manifest: PASS files=${files.length}`);
