#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const sourceRoot = new URL('src/v2/', root);
const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (/\.tsx$/.test(entry.name)) files.push(path);
  }
}
await collect(fileURLToPath(new URL('.', sourceRoot)));

const modalSources = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  if (/aria-modal\s*=\s*["']true["']/.test(source)) modalSources.push({ file, source });
}

assert.ok(modalSources.length >= 10, `expected the V2 dialog inventory to remain broad, found ${modalSources.length}`);
for (const { file, source } of modalSources) {
  assert.match(source, /role\s*=\s*["']dialog["']|role:\s*["']dialog["']/, `${file} has aria-modal without a dialog role`);
  assert.match(source, /aria-labelledby\s*=\s*["'][^"']+["']/, `${file} has an unlabelled V2 dialog`);
}

const app = await readFile(new URL('src/v2/integration/V2IntegratedApp.tsx', root), 'utf8');
assert.match(app, /useV2DialogLifecycle\(\)/, 'V2 root must mount the shared lifecycle hook');
assert.equal((app.match(/useV2DialogLifecycle\(\)/g) ?? []).length, 1, 'lifecycle hook must have one root mount');

const community = await readFile(new URL('src/v2/visual/V2CommunityView.tsx', root), 'utf8');
assert.match(community, /v2-community-writer[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.match(community, /v2-community-detail[^>]*role="dialog"[^>]*aria-modal="true"/);

console.log(`v2-dialog-lifecycle-contract: PASS (${modalSources.length} modal sources inventoried)`);
